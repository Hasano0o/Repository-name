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
import { overallLevel, LEVEL_LABEL, LEVEL_COLOR, rsrpLevel, sinrLevel, parseBands, parseNrBands } from '../utils/signal';
import { friendlyBand } from '../utils/bands';
import type { Carrier, DeviceTemp } from '../drivers/types';
import { buildAdvice, ActionRoute } from '../utils/advice';
import { measureLatency, selectedRegion, gameScore, scoreWord } from '../utils/latency';
import { ACTIONS, ActionId, QUICK } from './core';

export interface Reply {
  text: string;
  /** زر يفتح شاشة (يرجع له المستخدم لو احتاج) */
  open?: { route: string; screen: string; auto?: boolean };
  /** نفتح الشاشة على طول بدون ما ينتظر ضغطة */
  go?: boolean;
  /** بطاقة ملوّنة بالأرقام (الإشارة، التردد، الحرارة، البنق) */
  card?: { title: string; color: string; rows: { label: string; value: string; color?: string }[] };
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

/** ألوان Bandly الثابتة: الأساسي أزرق · الثانوي 4G برتقالي · 5G بنفسجي */
const ROLE_COLOR = { primary: '#2f6bff', lte2: '#f97316', nr: '#7c5cff' };
const tempColor = (c: number) => (c >= 80 ? '#e5484d' : c >= 70 ? '#f97316' : c >= 58 ? '#f59e0b' : '#12b76a');
const tempWord = (c: number) => (c >= 80 ? 'حار جداً' : c >= 70 ? 'حار' : c >= 58 ? 'دافي' : 'طبيعي');
const bandText = (tech: 'LTE' | 'NR', b: number) => `${tech === 'NR' ? 'n' : 'B'}${b} · ${friendlyBand(tech, b)}`;

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
      const adv = buildAdvice(sig, [], {});
      const lv = overallLevel(sig);
      const rows: { label: string; value: string; color?: string }[] = [];
      if (sig.rsrp !== undefined) rows.push({ label: '4G القوة', value: fmt(sig.rsrp, ' dBm'), color: LEVEL_COLOR[rsrpLevel(sig.rsrp)] });
      if (sig.sinr !== undefined) rows.push({ label: '4G الصفاء', value: fmt(sig.sinr, ' dB'), color: LEVEL_COLOR[sinrLevel(sig.sinr)] });
      if (sig.nrRsrp !== undefined) rows.push({ label: '5G القوة', value: fmt(sig.nrRsrp, ' dBm'), color: LEVEL_COLOR[rsrpLevel(sig.nrRsrp)] });
      if (sig.nrSinr !== undefined) rows.push({ label: '5G الصفاء', value: fmt(sig.nrSinr, ' dB'), color: LEVEL_COLOR[sinrLevel(sig.nrSinr)] });
      return {
        text: `${adv.sentence}\n\nالقوة غير السرعة والبنق — للتأكد اختبر السرعة أو قِس البنق.`,
        card: { title: `إشارتك ${lvl}`, color: LEVEL_COLOR[lv], rows },
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
      const scColor = sc >= 70 ? '#12b76a' : sc >= 45 ? '#f79009' : '#e5484d';
      return {
        card: {
          title: `${scoreWord(sc)} · ${reg.name}`, color: scColor,
          rows: [
            { label: 'البنق', value: `${Math.round(res.median)} ms`, color: res.median < 60 ? '#12b76a' : res.median < 120 ? '#f79009' : '#e5484d' },
            { label: 'التذبذب', value: `${Math.round(res.jitter)} ms`, color: res.jitter < 10 ? '#12b76a' : res.jitter < 30 ? '#f79009' : '#e5484d' },
            { label: 'الفقد', value: `${Math.round(res.lossPct)}%`, color: res.lossPct < 1 ? '#12b76a' : res.lossPct < 5 ? '#f79009' : '#e5484d' },
          ],
        },
        text: [
          'الرقم يتأثر بالسيرفر والزحمة والتغطية، وما أقدر أضمن رقم معيّن. لو تبي أقل بنق، «مُحسّن الألعاب» يجرّب ويقارن ويرجّع إعدادك لو ما تحسّن.',
        ].join('\n'),
        open: { route: 'ping', screen: 'مُحسّن الألعاب' },
        tone: sc >= 70 ? 'ok' : 'warn',
      };
    }

    case 'my_band': {
      let carriers: Carrier[] = [];
      let sig;
      try {
        [carriers, sig] = await withSession(r, async d => Promise.all([
          d.getCarriers ? d.getCarriers().catch(() => [] as Carrier[]) : Promise.resolve([] as Carrier[]),
          d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
        ]), false);
      } catch (e) {
        return { text: `ما قدرت أقرأ من الراوتر:\n${errText(e)}`, tone: 'warn' };
      }
      const rows: { label: string; value: string; color?: string }[] = [];
      if (carriers.length) {
        for (const c of carriers) {
          const role = c.role === 'PCC' ? (c.tech === 'NR' ? '5G الأساسي' : 'الأساسي') : c.tech === 'NR' ? '5G' : 'الثانوي 4G';
          const color = c.tech === 'NR' ? ROLE_COLOR.nr : c.role === 'PCC' ? ROLE_COLOR.primary : ROLE_COLOR.lte2;
          rows.push({ label: role, value: bandText(c.tech, c.band) + (c.bandwidth ? ` · ${c.bandwidth}MHz` : ''), color });
        }
      } else if (sig) {
        const lte = parseBands(sig.band).map(x => parseInt(x.replace(/\D/g, ''), 10)).filter(Boolean);
        const nr = parseNrBands(sig.nrBand).map(x => parseInt(x.replace(/\D/g, ''), 10)).filter(Boolean);
        lte.forEach((b, i) => rows.push({ label: i === 0 ? 'الأساسي' : 'الثانوي 4G', value: bandText('LTE', b), color: i === 0 ? ROLE_COLOR.primary : ROLE_COLOR.lte2 }));
        nr.forEach(b => rows.push({ label: '5G', value: bandText('NR', b), color: ROLE_COLOR.nr }));
      }
      if (!rows.length) return { text: 'الراوتر ما أعطاني الترددات الحين — افتح «الترددات» تشوف التفاصيل.', open: { route: 'bands', screen: 'الترددات' }, tone: 'warn' };
      const has5g = rows.some(x => x.color === ROLE_COLOR.nr);
      return {
        card: { title: rows.length > 1 ? `متصل على ${rows.length} ترددات مدموجة` : 'متصل على تردد واحد', color: has5g ? ROLE_COLOR.nr : ROLE_COLOR.primary, rows },
        text: has5g ? 'عندك 5G شغّال ✓' : 'ما فيه 5G الحين — لو منطقتك فيها 5G جرّب «أفضل تردد».',
        open: { route: 'bands', screen: 'الترددات' },
        chips: ['best_band', 'best_tower'],
      };
    }

    case 'temp': {
      let temps: DeviceTemp[] = [];
      let tempC: number | undefined;
      try {
        [temps, tempC] = await withSession(r, async d => Promise.all([
          d.getTemps ? d.getTemps().catch(() => [] as DeviceTemp[]) : Promise.resolve([] as DeviceTemp[]),
          d.getExtras ? d.getExtras().then(x => x.health?.tempC).catch(() => undefined) : Promise.resolve(undefined),
        ]), false);
      } catch (e) {
        return { text: `ما قدرت أقرأ من الراوتر:\n${errText(e)}`, tone: 'warn' };
      }
      const list = temps.length ? temps : tempC !== undefined ? [{ key: 'dev', label: 'الجهاز', c: tempC }] : [];
      if (!list.length) return { text: 'راوترك ما يعطي قراءة الحرارة للتطبيق. حط يدك عليه: لو حار مرة، بعّده عن الشمس وخلّ حوله تهوية.', tone: 'warn' };
      const max = Math.max(...list.map(x => x.c));
      const tips = max >= 80 ? 'حار جداً — بعّده عن الشمس والأجهزة الحارة فوراً، وخلّ حوله تهوية. الحرارة تقطّع النت وتقصّر عمره.'
        : max >= 70 ? 'حار — ممكن يخفّف سرعته لحاله. بعّده عن الشمس المباشرة.'
        : max >= 58 ? 'دافي وطبيعي وقت التحميل.' : 'الحرارة ممتازة ✓';
      return {
        card: { title: `${tempWord(max)} · ${Math.round(max)}°`, color: tempColor(max), rows: list.slice(0, 4).map(x => ({ label: x.label, value: `${Math.round(x.c)}°م`, color: tempColor(x.c) })) },
        text: tips,
        tone: max >= 70 ? 'warn' : 'ok',
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
          best_channel: 'وأجرّب قنوات الواي فاي وأثبّت الأنظف — الواي فاي بينقطع ثواني وأسألك قبل أبدأ.',
          autopilot: 'وأضبط كل شي بنفسي: الترددات والأبراج وقناة الواي فاي — وأقارن قبل وبعد. أسألك قبل أبدأ.',
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
