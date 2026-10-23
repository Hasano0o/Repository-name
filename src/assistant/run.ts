/**
 * تنفيذ إجراءات المساعد — عبر دوال Bandly الموجودة فقط:
 *  • الكتابة الوحيدة هنا: إعادة التشغيل (reboot_now) — وما توصل لها إلا بعد تأكيد المستخدم في الشاشة.
 *  • باقي التغييرات تصير من شاشاتها المجربة (فيها التأكيد والرجوع التلقائي).
 *  • النتيجة نص مبني على قراءة حقيقية — لو القراءة فشلت نقول فشلت، ما ندّعي شي.
 *  • ما نرسل كلمات مرور ولا أي بيانات لأي مكان: القراءة من الراوتر على الشبكة المحلية بس.
 */
import { SavedRouter } from '../store/routers';
import { withSession, routerWrite, dropSession, isRouterBusyError } from '../store/sessions';
import { waitOnline } from '../utils/safeLock';
import { driverById } from '../drivers/registry';
import { overallLevel, LEVEL_LABEL } from '../utils/signal';
import { buildAdvice, ActionRoute } from '../utils/advice';
import { measureLatency, selectedRegion, gameScore, scoreWord } from '../utils/latency';
import { ACTIONS, ActionId, QUICK } from './core';

export interface Reply {
  text: string;
  /** زر يفتح شاشة (يرجع له المستخدم لو احتاج) */
  open?: { route: string; screen: string; auto?: boolean };
  /** نفتح الشاشة على طول بدون ما ينتظر ضغطة */
  go?: boolean;
  /** يحتاج موافقة قبل التنفيذ — الشاشة تعرض نافذة، ولو وافق ينفّذ action */
  confirm?: { title: string; body: string; yes: string; action: ActionId };
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

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function runAction(id: ActionId, r: SavedRouter, say: (s: string) => void = () => {}): Promise<Reply> {
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
        text: 'أعيد تشغيل الراوتر؟ النت بينقطع عن كل الأجهزة دقيقتين تقريباً.',
        confirm: {
          title: 'إعادة تشغيل الراوتر',
          body: 'النت بينقطع عن كل الأجهزة المتصلة دقيقتين تقريباً، وبعدها يرجع لحاله.',
          yes: 'أعد التشغيل',
          action: 'reboot_now',
        },
        tone: 'warn',
      };

    case 'reboot_now': {
      if (!proto?.reboot) return { text: 'نوع الراوتر هذا ما يدعم إعادة التشغيل من التطبيق.', tone: 'warn' };
      say('أرسل أمر إعادة التشغيل...');
      try {
        await routerWrite(r, d => d.reboot!(), { label: 'إعادة تشغيل' });
      } catch (e) {
        if (isRouterBusyError(e)) return { text: `الراوتر مشغول بعملية ثانية الحين — ${errText(e)}`, tone: 'warn' };
        // بعض الراوترات تقفل الاتصال وهي تطفي — الرد يضيع بس الأمر وصل. نتأكد بالانتظار تحت.
        if (!/timeout|network|fetch|abort|ما رد|ما قدرنا نوصل/i.test(errText(e))) {
          return { text: `ما قدرت أعيد التشغيل:\n${errText(e)}`, tone: 'warn' };
        }
      }
      dropSession(r.id);
      // نعطيه وقت يطفي فعلاً قبل ما نسأل — وإلا ممكن نلحقه قبل ما يطفي ونقول «رجع» غلط
      say('الراوتر يعيد التشغيل... انتظر شوي');
      await sleep(25_000);
      say('ننتظر الراوتر يرجع (دقيقتين تقريباً)...');
      const back = await waitOnline(r, 180_000, () => false);
      if (back) return { text: '✓ الراوتر رجع واشتغل، والإشارة رجعت. تبي أفحصها لك؟', chips: ['check_signal', 'open_speed'], tone: 'ok' };
      return {
        text: 'أرسلت أمر إعادة التشغيل، بس الراوتر ما رجع خلال ٣ دقايق.\nتأكد إن جوالك رجع اتصل بواي فاي الراوتر، وإن أنواره شغالة. لو طوّل، افصل الكهرباء ١٠ ثواني ورجّعها.',
        tone: 'warn',
      };
    }

    case 'power_on':
      return {
        text: 'لو الراوتر طافي ما أقدر أوصله من التطبيق — شغّله من زر التشغيل أو وصّله بالكهرباء، وانتظر دقيقتين لين تثبت الأنوار. بعدها افتح Bandly وأفحص لك الإشارة.',
        chips: ['check_signal'],
      };

    case 'factory_reset':
      if (!proto?.factoryReset) return { text: 'نوع الراوتر هذا ما يدعم ضبط المصنع من التطبيق — يتسوى من زر Reset في الراوتر نفسه.', tone: 'warn' };
      return {
        text: '⚠️ ضبط المصنع يمسح كل شي: اسم الواي فاي وكلمته وكلمة دخول الراوتر والترددات.\nأنا ما أسويه بنفسي. جرّب قبله «رجّع الإشارة» من صفحة الراوتر. ولو لازم، تلقاه آخر «مركز التحكم» وفيه تأكيدين.',
        open: { route: 'control', screen: 'مركز التحكم' },
        tone: 'danger',
      };

    case 'power_off':
      return { text: 'الراوترات ما فيها أمر إطفاء من التطبيق — ولو طفّيته ما نقدر نرجّعه من الجوال. لو تبي تطفيه، افصل الكهرباء أو اضغط زر التشغيل. ولو تبي تريّحه وتصلّح التعليق، «إعادة التشغيل» أفضل وأسويها لك.', chips: ['reboot'] };

    default:
      if (a.route) {
        const what: Partial<Record<ActionId, string>> = {
          best_band: 'وأجرّب الترددات وأختار لك الأفضل — النت بينقطع شوي وأسألك قبل أبدأ.',
          best_tower: 'وأجرّب الأبراج حولك وأقيس البنق — النت بينقطع شوي وأسألك قبل أبدأ.',
          open_ping: 'وأدوّر لك أقل بنق لسيرفر لعبتك — أسألك قبل أي تغيير.',
          open_speed: 'وأبدأ الاختبار على طول.',
        };
        return {
          text: `أفتح لك «${a.screen}»${what[id] ? ` ${what[id]}` : '.'}`,
          open: { route: a.route, screen: a.screen ?? a.label, auto: a.auto },
          go: true,
        };
      }
      return { text: 'ما عرفت أنفّذ هذا للحين.', tone: 'warn' };
  }
}
