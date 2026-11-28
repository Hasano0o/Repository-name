/**
 * «حارس التثبيت» — يشتغل مع مهمة المراقبة بالخلفية وعند فتح التطبيق (_layout).
 * بعد ما العضو يثبّت برج/تردد (safeApply kept ← startWatch) نقارن الإشارة بالقراءة وقت التثبيت:
 * لو صارت أسوأ بوضوح فحصين ورا بعض (أو النت طاح وهو مثبّت) ← نرجّع إعداده اللي كان قبل التثبيت
 * (restoreLockState) أو نفك للتلقائي لو ما عندنا لقطة. الوضع «اسألني» يرسل تنبيه بدل ما يرجّع.
 * قواعد: ما نحكم أول ٢٠ دقيقة · مرتين باليوم بالكثير · ما نقطع والبيت يحمّل · ما نلمس «ثبّت للعب» ولا عملية ثانية.
 * العضو غيّر الإعداد بنفسه (أو سوّى رسيت) ← ننسى بدون ما نلمس شي.
 */
import type { SavedRouter } from '../store/routers';
import { listRouters } from '../store/routers';
import { withSession, withSessionPatient, withRouterLock, isRouterBusyAnywhere } from '../store/sessions';
import { getWatch, saveWatch, clearWatch, getWatchMode } from '../store/lockWatch';
import { getGameLock } from '../store/gameLock';
import { watchVerdict, watchStep } from '../utils/lockWatchCore';
import { isNoService } from '../utils/signal';
import { notify } from '../utils/notify';
import { diag } from './diag';
import type { LockSnapshot } from '../drivers/lockSnapshot';
import type { Signal } from '../drivers/types';

const BUSY_DOWN_BPS = 250_000;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export interface WatchOutcome { msg: string; ask?: () => Promise<string> }

/** يرجّع العضو لإعداده قبل التثبيت — يرجع جملة للعضو */
export async function restoreBeforeLock(r: SavedRouter): Promise<string> {
  const w = await getWatch(r.id);
  if (!w) return 'ما فيه إعداد محفوظ';
  const prev = w.prev as LockSnapshot | null;
  if (prev && prev.driver === r.driverId) {
    await withRouterLock(r, () => withSessionPatient(r, d => {
      if (!d.restoreLockState) throw new Error('هذا النوع ما يدعم الإرجاع');
      return d.restoreLockState(prev);
    }, 90_000), { label: 'حارس التثبيت' });
  } else {
    const { freeRelease } = await import('../utils/safeLock');
    await freeRelease(r);
  }
  await clearWatch(r.id);
  return prev ? `رجّعنا إعدادك اللي كان قبل «${w.label}»` : 'رجّعنا الراوتر يختار أقوى برج بنفسه';
}

export async function runLockWatch(r: SavedRouter, background: boolean, pre?: { sig: Signal | null; online: boolean }): Promise<WatchOutcome | null> {
  const w = await getWatch(r.id);
  if (!w) return null;
  const mode = await getWatchMode();
  if (mode === 'off') return null;
  if (await getGameLock(r.id)) return null;
  if (await isRouterBusyAnywhere(r)) return null;

  const data = await withSession(r, async d => {
    const sig = pre ? pre.sig : d.getSignal ? await d.getSignal().catch(() => null) : null;
    let online = pre?.online;
    if (online === undefined) {
      const net = d.getNetworkInfo ? await d.getNetworkInfo().catch(() => null) : null;
      online = net ? net.connected !== false : d.isConnected ? await d.isConnected().catch(() => true) : true;
    }
    const active = d.getActiveLock ? await d.getActiveLock().catch(() => undefined) : undefined;
    const summary = d.readLockState ? (await d.readLockState().catch(() => null))?.summary : undefined;
    const tr = d.getTraffic ? await d.getTraffic().catch(() => null) : null;
    return { sig, online: !!online && !isNoService(sig ?? undefined, !!online), active, summary, busy: !!tr && tr.downBytesPerSec > BUSY_DOWN_BPS };
  }, false).catch(() => null);
  if (!data) return null;

  // الراوتر ما عاد مثبّت (العضو فك أو سوّى رسيت) ← ننسى
  if (data.active === null) { await clearWatch(r.id); return null; }

  const v = watchVerdict(w.base, data.sig, data.online);
  const step = watchStep(w, v, Date.now(), dayKey(), data.summary);
  if (step.do === 'forget') { diag('[lockWatch] الإعداد تغيّر — ننسى'); await clearWatch(r.id); return null; }
  if (step.do === 'none') { await saveWatch(r.id, step.state); return null; }

  // البيت يحمّل والنت شغال ← ما نقطعه الحين، نشوف الفحص الجاي
  if (data.busy && v.kind !== 'down') { await saveWatch(r.id, step.state); return null; }

  const why = `${r.name}: الإعداد المثبّت («${w.label}») صار أضعف من وقت ما ثبّته — ${step.reason}`;
  diag(`[lockWatch] ${why}`);

  if (mode === 'ask') {
    if (w.askedAt && Date.now() - w.askedAt < 2 * 3600_000) { await saveWatch(r.id, step.state); return null; }
    await saveWatch(r.id, { ...step.state, askedAt: Date.now() });
    if (background) notify('🛡️ حارس التثبيت', `${why}. افتح Bandly ورجّع إعدادك.`, r.id);
    return { msg: why, ask: () => restoreBeforeLock(r) };
  }

  await saveWatch(r.id, { ...step.state, acts: (step.state.acts ?? 0) + 1 });
  try {
    const done = await restoreBeforeLock(r);
    const msg = `${why}.\n${done} ✓`;
    if (background) notify('🛡️ حارس التثبيت', msg, r.id);
    return { msg };
  } catch (e: any) {
    diag(`[lockWatch] الإرجاع فشل: ${String(e?.message ?? e).slice(0, 80)}`);
    return null;
  }
}

let running = false;
/** عند فتح التطبيق — كل الرواترات اللي عليها حارس */
export async function runLockWatchAll(): Promise<WatchOutcome[]> {
  if (running) return [];
  running = true;
  try {
    const out: WatchOutcome[] = [];
    for (const r of await listRouters()) {
      if (r.host === 'demo' || r.host === 'device') continue;
      if (!(await getWatch(r.id))) continue;
      const o = await runLockWatch(r, false).catch(() => null);
      if (o) out.push(o);
    }
    return out;
  } finally {
    running = false;
  }
}
