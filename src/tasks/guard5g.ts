import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { getGuard, saveGuard } from '../store/guard';
import { overallLevel } from '../utils/signal';
import { notify } from '../utils/notify';
import { NetworkInfo, Signal } from '../drivers/types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const HOUR = 3600000;
const label = (lte: number[], nr: number[]) =>
  [...lte.map(b => `B${b}`), ...nr.map(b => `n${b}`)].join(' + ') || 'تلقائي';

async function online(r: SavedRouter): Promise<boolean> {
  return withSession(r, async d => {
    const net: NetworkInfo | null = d.getNetworkInfo ? await d.getNetworkInfo().catch(() => null) : null;
    if (net) return net.connected !== false;
    return d.isConnected ? d.isConnected() : true;
  }, false).catch(() => true); // ما وصلنا للراوتر نفسه — ما نحكم
}

/**
 * يشتغل مع مهمة المراقبة لكل راوتر:
 * - لو مثبّت على ترددات والنت طاح (فحصين ورا بعض بينهم ٢٥ ثانية) ← يرجّع كل شي تلقائي.
 * - لو 5G مثبّت وغايب ٣ فحوصات ورا بعض والنت شغال ← يرجّع 5G بس للتلقائي.
 * - بعد ساعة من الرجوع، لو الإشارة زينة ← يجرب يرجع لتركيبتك مرة؛ لو فشلت ما يعيد إلا بعد ٦ ساعات.
 * يرجع true لو أرسل إشعار.
 */
export async function runGuard(r: SavedRouter, sig: Signal | null, isOnline: boolean): Promise<boolean> {
  const g = await getGuard(r.id);
  if (!g.on) return false;
  try {
    const cfg = await withSession(r, d => (d.getBandConfig ? d.getBandConfig() : Promise.resolve(null)), false);
    if (!cfg) return false;
    const locked = cfg.locked.length > 0 || cfg.nrLocked.length > 0;

    // ── ١) النت طاح وهو مثبّت ──
    if (locked && !isOnline) {
      await sleep(25000);
      if (await online(r)) return false;
      const saved = { lte: cfg.locked, nr: cfg.nrLocked };
      await withSession(r, d => d.setBand!([], cfg.nrSupported.length ? [] : undefined), false);
      const retryFailed = !!g.retriedAt;
      await saveGuard(r.id, {
        ...g,
        saved: retryFailed ? g.saved ?? saved : saved,
        fellBackAt: Date.now(),
        reason: 'انقطع النت',
        nrMiss: 0,
        retriedAt: undefined,
        noRetryUntil: retryFailed ? Date.now() + 6 * HOUR : g.noRetryUntil,
      });
      notify('🛡️ حارس 5G', `${r.name}: انقطع النت على (${label(saved.lte, saved.nr)})، فرجّعنا الراوتر يختار بنفسه.`, r.id);
      return true;
    }

    // ── ٢) 5G مثبّت لكنه غايب والنت شغال ──
    const nrNow = !!sig && (sig.nrRsrp !== undefined || !!sig.nrBand);
    if (cfg.nrLocked.length && isOnline) {
      const miss = nrNow ? 0 : (g.nrMiss ?? 0) + 1;
      if (miss >= 3) {
        const saved = { lte: cfg.locked, nr: cfg.nrLocked };
        await withSession(r, d => d.setBand!(cfg.locked, []), false);
        await saveGuard(r.id, { ...g, saved, fellBackAt: Date.now(), reason: '5G اختفى', nrMiss: 0, retriedAt: undefined });
        notify('🛡️ حارس 5G', `${r.name}: 5G ما ظهر على (${label([], saved.nr)}) فترة طويلة، فرجّعنا 5G يختار بنفسه.`, r.id);
        return true;
      }
      if (miss !== (g.nrMiss ?? 0)) await saveGuard(r.id, { ...g, nrMiss: miss });
    }

    // ── ٣) المحاولة اللي قبل نجحت؟ ننظف ──
    if (g.retriedAt && isOnline) {
      await saveGuard(r.id, { ...g, retriedAt: undefined, saved: undefined, fellBackAt: undefined, reason: undefined });
      notify('🛡️ حارس 5G', `${r.name}: رجعنا لتركيبتك (${label(g.saved?.lte ?? [], g.saved?.nr ?? [])}) وهي شغالة.`, r.id);
      return true;
    }

    // ── ٤) نرجع لتركيبتك بعد ما تستقر ──
    if (g.saved && g.fellBackAt && !locked && isOnline &&
        Date.now() - g.fellBackAt > HOUR && Date.now() > (g.noRetryUntil ?? 0)) {
      const lvl = overallLevel(sig ?? undefined);
      if (lvl === 'excellent' || lvl === 'good') {
        const s = g.saved;
        await withSession(r, d => d.setBand!(s.lte, s.nr.length ? s.nr : undefined), false);
        await saveGuard(r.id, { ...g, retriedAt: Date.now() });
      }
    }
  } catch {}
  return false;
}
