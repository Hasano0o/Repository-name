/**
 * 🛡️ الحارس — يشتغل مع مهمة المراقبة لكل راوتر، ويصلّح لحاله بالتدريج (من الأخف للأثقل):
 *   ١) يصحّي الراديو (wakeRadio)  ٢) يعيد الاتصال بالبرج (reattach / reconnectData)
 *   ٣) يرجّع الراوتر يختار بنفسه لو كان مثبّت  ٤) إعادة تشغيل (مرة وحدة باليوم كحد أقصى)
 *
 * المشاكل اللي يعالجها:
 *   • «بدون خدمة» (الراوتر شغال بس ما عنده شبكة)
 *   • إشارة ضعيفة فحصين ورا بعض
 *   • 5G طاح (كان موجود آخر ٢٤ ساعة وصار غايب فحصين ورا بعض) — لو 5G مو مثبّت (المثبّت يتولاه حارس 5G)
 *
 * قواعد ما يتعداها: ١٠ دقايق على الأقل بين كل علاج، ٤ علاجات باليوم، إعادة تشغيل وحدة باليوم،
 * ما يقطع النت والبيت يحمّل (إلا لو النت طايح أصلاً)، يحترم «إيقاف المساعد بالكامل»،
 * ما يتدخل لو فيه عملية ثانية على الراوتر. كل علاج يرسل إشعار وينكتب في السجل.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedRouter } from '../store/routers';
import { withSession, isRouterBusyAnywhere, isRouterBusy, holdRouter, dropSession } from '../store/sessions';
import { driverById } from '../drivers/registry';
import { getHealer, saveHealer, addLog, HealerState } from '../store/healer';
import { getGuard } from '../store/guard';
import { overallLevel, isNoService } from '../utils/signal';
import { notify } from '../utils/notify';
import type { Signal, RouterDriver } from '../drivers/types';
import { parseState } from '../assistant/core';

const MIN = 60_000;
const HOUR = 60 * MIN;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const BUSY_DOWN_BPS = 250_000; // ~٢ ميقابت — فوقها نعتبر فيه أحد يستخدم النت

async function assistantStopped(): Promise<boolean> {
  try { return parseState(await AsyncStorage.getItem('bandly.assistant.state')).mode === 'disabled'; } catch { return false; }
}

export async function runHealer(r: SavedRouter, sig: Signal | null, online: boolean): Promise<boolean> {
  let h = await getHealer(r.id);
  if (!h.on) return false;
  if (await assistantStopped()) return false;
  if (await isRouterBusyAnywhere(r)) return false;
  const proto = driverById(r.driverId);
  if (!proto) return false;

  // يوم جديد ← نصفّر العدّاد
  if (h.day !== dayKey()) h = { ...h, day: dayKey(), actionsToday: 0 };

  // ═══ نحدد المشكلة ═══
  const hasNr = !!sig && (sig.nrRsrp !== undefined || !!sig.nrBand || !!sig.nrActiveFromStatus);
  if (hasNr) h.nrSeenAt = Date.now();
  const noService = !online || isNoService(sig, online);
  const poor = !noService && overallLevel(sig ?? undefined) === 'poor';
  const guard = await getGuard(r.id);
  const nrLost = !noService && !hasNr && !!h.nrSeenAt && Date.now() - h.nrSeenAt < 24 * HOUR && !guard.on;
  const issue: HealerState['issue'] = noService ? 'noservice' : poor ? 'poor' : nrLost ? 'nr' : null;

  // ═══ ما فيه مشكلة ═══
  if (!issue) {
    if (h.issue && (h.step ?? 0) > 0) {
      h = addLog({ ...h, issue: null, bad: 0, step: 0 }, '✓ رجع الاتصال طبيعي', true);
      notify('🛡️ الحارس', `${r.name}: رجع الاتصال طبيعي ✓`, r.id);
      await saveHealer(r.id, h);
      return true;
    }
    if (h.issue || h.bad) await saveHealer(r.id, { ...h, issue: null, bad: 0, step: 0 });
    else await saveHealer(r.id, h);
    return false;
  }

  // نفس المشكلة ← نزيد العدّاد. مشكلة جديدة ← نبدأ من أول
  h = issue === h.issue ? { ...h, bad: (h.bad ?? 0) + 1 } : { ...h, issue, bad: 1, step: 0 };
  // ما نتصرف من أول فحص (ممكن لحظية) — إلا «بدون خدمة» نصبر فحص واحد بعد
  if ((h.bad ?? 0) < 2) { await saveHealer(r.id, h); return false; }
  if (h.lastActionAt && Date.now() - h.lastActionAt < 10 * MIN) { await saveHealer(r.id, h); return false; }
  if ((h.actionsToday ?? 0) >= 4) { await saveHealer(r.id, h); return false; }

  // البيت يستخدم النت؟ ما نقطعه (إلا لو النت طايح أصلاً)
  if (issue !== 'noservice' && proto.getTraffic) {
    const tr = await withSession(r, d => d.getTraffic!(), false).catch(() => null);
    if (tr && tr.downBytesPerSec > BUSY_DOWN_BPS) { await saveHealer(r.id, h); return false; }
  }

  const write = async (fn: (d: RouterDriver) => Promise<unknown>) => {
    if (await isRouterBusyAnywhere(r)) return false;
    if (isRouterBusy(r)) return false;
    const p = withSession(r, fn, false);
    holdRouter(r, p);
    await p;
    return true;
  };
  const what = issue === 'noservice' ? 'الراوتر بدون خدمة' : issue === 'poor' ? 'الإشارة ضعيفة' : '5G طاح';

  // ═══ الدرجة الجاية من العلاج ═══
  const steps: { n: number; can: boolean; text: string; run: () => Promise<unknown> }[] = [
    { n: 1, can: !!proto.wakeRadio && issue === 'noservice', text: 'صحّيت الراديو', run: () => write(d => d.wakeRadio!()) },
    {
      n: 2, can: !!proto.reattach || !!proto.reconnectData, text: 'أعدت الاتصال بالبرج',
      run: () => write(d => (d.reattach ? d.reattach(15) : d.reconnectData!({ holdSecs: 5 }))),
    },
    {
      n: 3, can: !!proto.getBandConfig && !!proto.setBand, text: 'رجّعت الراوتر يختار التردد بنفسه',
      run: async () => {
        const cfg = await withSession(r, d => d.getBandConfig!(), false).catch(() => null);
        if (!cfg || (!cfg.locked.length && !cfg.nrLocked.length)) return 'skip';
        return write(d => d.setBand!([], cfg.nrSupported.length ? [] : undefined));
      },
    },
    {
      n: 4, can: !!proto.reboot && (!h.lastRebootAt || Date.now() - h.lastRebootAt > 24 * HOUR), text: 'أعدت تشغيل الراوتر',
      run: async () => { const ok = await write(d => d.reboot!()).catch(e => { if (/timeout|network|fetch|abort|ما رد/i.test(String(e?.message ?? e))) return true; throw e; }); dropSession(r.id); return ok; },
    },
  ];
  const cur = h.step ?? 0;
  for (const st of steps) {
    if (st.n <= cur || !st.can) continue;
    try {
      const res = await st.run();
      if (res === false) { await saveHealer(r.id, h); return false; } // الراوتر مشغول — نجرب الفحص الجاي
      if (res === 'skip') { h = { ...h, step: st.n }; continue; }
      h = addLog({
        ...h, step: st.n, bad: 0, lastActionAt: Date.now(), actionsToday: (h.actionsToday ?? 0) + 1,
        lastRebootAt: st.n === 4 ? Date.now() : h.lastRebootAt,
      }, `${what} ← ${st.text}`);
      notify('🛡️ الحارس', `${r.name}: ${what}، ف${st.text}. بشيّك بعد شوي.`, r.id);
      await saveHealer(r.id, h);
      return true;
    } catch (e: any) {
      h = addLog({ ...h, step: st.n, lastActionAt: Date.now() }, `${what} ← ما ضبط: ${String(e?.message ?? e).slice(0, 60)}`, false);
      await saveHealer(r.id, h);
      return false;
    }
  }
  // خلصت الدرجات وما ضبط — نبلّغ مرة وحدة، ونوقف لين تتغيّر المشكلة
  if (cur < 99) {
    h = addLog({ ...h, step: 99, lastActionAt: Date.now() }, `${what} — جرّبت كل شي وما رجع. غالباً المشكلة من البرج أو الشركة`, false);
    notify('🛡️ الحارس', `${r.name}: ${what} وجرّبت كل العلاجات. غالباً المشكلة من البرج أو الشركة — جرّب «توجيه الأنتنا» أو كلّم الشركة.`, r.id);
    await saveHealer(r.id, h);
    return true;
  }
  await saveHealer(r.id, h);
  return false;
}
