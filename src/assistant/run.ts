/**
 * تنفيذ إجراءات المساعد — عبر دوال Bandly الموجودة فقط، وكلها (في هالمرحلة) قراءة أو فتح شاشة:
 *  • ما فيه أي كتابة على الراوتر هنا. التغييرات تصير من شاشاتها المجربة (فيها التأكيد والرجوع التلقائي).
 *  • النتيجة نص مبني على قراءة حقيقية — لو القراءة فشلت نقول فشلت، ما ندّعي شي.
 *  • ما نرسل كلمات مرور ولا أي بيانات لأي مكان: القراءة من الراوتر على الشبكة المحلية بس.
 */
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { driverById } from '../drivers/registry';
import { overallLevel, LEVEL_LABEL } from '../utils/signal';
import { buildAdvice, ActionRoute } from '../utils/advice';
import { measureLatency, selectedRegion, gameScore, scoreWord } from '../utils/latency';
import { ACTIONS, ActionId, QUICK } from './core';

export interface Reply {
  text: string;
  /** زر يفتح شاشة (المستخدم يضغطه بنفسه) */
  open?: { route: string; screen: string };
  /** أزرار اقتراحات بعد الرد */
  chips?: ActionId[];
  tone?: 'ok' | 'warn' | 'danger';
}

const ADVICE_SCREEN: Record<ActionRoute, string> = {
  towers: 'الأبراج', optimize: 'المُحسِّن التلقائي', aim: 'توجيه الأنتنا', bands: 'الترددات',
  ping: 'مُحسّن الألعاب', report: 'تقرير الاتصال', speed: 'اختبار السرعة',
};

const fmt = (v: number | undefined, unit: string) => (v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v)}${unit}`);
const errText = (e: unknown) => String((e as any)?.message ?? e ?? '').slice(0, 120);

export async function runAction(id: ActionId, r: SavedRouter): Promise<Reply> {
  const a = ACTIONS[id];
  const proto = driverById(r.driverId);

  switch (id) {
    case 'help':
      return {
        text: 'أقدر أفحص إشارتك وأقيس البنق وأشرح لك النتيجة بكلام بسيط، وأوديك للأداة المناسبة: الألعاب، توجيه الأنتنا، اختيار الأفضل، السرعة، الأبراج، والأجهزة.\nاكتب طلبك بكلامك، مثل: «النت بطيء» أو «أبي أقل بنق».',
        chips: QUICK,
      };

    case 'check_signal': {
      let sig;
      try {
        sig = await withSession(r, d => (d.getSignal ? d.getSignal() : Promise.resolve(null)), false);
      } catch (e) {
        return { text: `ما قدرت أقرأ الإشارة من الراوتر:\n${errText(e)}\n\nتأكد إنك متصل بشبكة الراوتر وجرّب مرة ثانية.`, tone: 'warn' };
      }
      if (!sig || (sig.rsrp === undefined && sig.nrRsrp === undefined)) {
        return { text: 'الراوتر ما أعطاني أرقام الإشارة الحين. افتح «التفاصيل» وشوف وش يظهر، أو جرّب بعد شوي.', open: { route: 'details', screen: 'التفاصيل' }, tone: 'warn' };
      }
      const lvl = LEVEL_LABEL[overallLevel(sig)];
      const lines = [`إشارتك: ${lvl}.`];
      if (sig.rsrp !== undefined) lines.push(`• 4G: القوة ${fmt(sig.rsrp, '')} · الصفاء ${fmt(sig.sinr, '')}`);
      if (sig.nrRsrp !== undefined) lines.push(`• 5G: القوة ${fmt(sig.nrRsrp, '')} · الصفاء ${fmt(sig.nrSinr, '')}`);
      else if (sig.rsrp !== undefined) lines.push('• 5G: مو متصل الحين');
      const adv = buildAdvice(sig, [], {});
      lines.push('', adv.sentence);
      lines.push('', 'ملاحظة: القوة غير السرعة والبنق — للتأكد اختبر السرعة أو قِس البنق.');
      return {
        text: lines.join('\n'),
        open: adv.action ? { route: adv.action.route, screen: ADVICE_SCREEN[adv.action.route] } : undefined,
        chips: ['ping_now', 'open_speed'],
        tone: lvl === 'ضعيف' ? 'warn' : 'ok',
      };
    }

    case 'ping_now': {
      const reg = await selectedRegion();
      let res;
      try {
        res = await measureLatency(10);
      } catch (e) {
        return { text: `ما قدرت أقيس البنق: ${errText(e)}`, tone: 'warn' };
      }
      if (!res.samples) {
        return { text: `ما وصلت لسيرفرات ${reg.name}${res.error ? ` (${res.error})` : ''}. تأكد إن النت شغّال.`, tone: 'warn' };
      }
      const sc = gameScore(res);
      return {
        text: [
          `البنق لسيرفرات ${reg.name}: ${Math.round(res.median)}ms`,
          `التذبذب: ${Math.round(res.jitter)}ms · الفقد: ${Math.round(res.lossPct)}%`,
          `التقييم: ${scoreWord(sc)}`,
          '',
          'الرقم يتأثر بالسيرفر والزحمة والتغطية، وما أقدر أضمن رقم معيّن. لو تبي أقل بنق، «مُحسّن الألعاب» يجرّب ويقارن ويرجّع إعدادك لو ما تحسّن.',
        ].join('\n'),
        open: { route: 'ping', screen: 'مُحسّن الألعاب' },
        tone: sc >= 70 ? 'ok' : 'warn',
      };
    }

    case 'reboot':
      if (!proto?.reboot) return { text: 'نوع الراوتر هذا ما يدعم إعادة التشغيل من التطبيق. افصل الكهرباء عنه ١٠ ثواني ورجّعها.', tone: 'warn' };
      return {
        text: 'إعادة التشغيل تقطع النت عن كل الأجهزة دقيقتين تقريباً.\nحالياً تسويها من زر «إعادة تشغيل» في صفحة الراوتر (فيه تأكيد قبلها). تنفيذها مني مباشرة يجي بالمرحلة الجاية بعد ما نجربه.',
        open: { route: 'router', screen: 'صفحة الراوتر' },
        tone: 'warn',
      };

    case 'factory_reset':
      if (!proto?.factoryReset) return { text: 'نوع الراوتر هذا ما يدعم ضبط المصنع من التطبيق — يتسوى من زر Reset في الراوتر نفسه.', tone: 'warn' };
      return {
        text: '⚠️ ضبط المصنع يمسح كل شي: اسم الواي فاي وكلمته وكلمة دخول الراوتر والترددات.\nأنا ما أسويه بنفسي. جرّب قبله «رجّع الإشارة» من صفحة الراوتر. ولو لازم، تلقاه آخر «مركز التحكم» وفيه تأكيدين.',
        open: { route: 'control', screen: 'مركز التحكم' },
        tone: 'danger',
      };

    case 'power_off':
      return { text: 'ما أقدر أطفّي الراوتر من التطبيق — ما فيه أمر إطفاء في الراوترات. افصل الكهرباء بنفسك. لو تبي تريّحه، «إعادة التشغيل» أفضل.', chips: ['reboot'] };

    default:
      if (a.route) return { text: `أفتح لك «${a.screen}».`, open: { route: a.route, screen: a.screen ?? a.label } };
      return { text: 'ما عرفت أنفّذ هذا للحين.', tone: 'warn' };
  }
}
