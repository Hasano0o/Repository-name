/**
 * يرجّع إعداد العضو بعد «ثبّت للعب»: لما يخلص الوقت، أو لو النت طاح وهو على تثبيت اللعب.
 * يشتغل مع مهمة المراقبة بالخلفية (tasks/monitor) وعند فتح التطبيق / الرجوع له (_layout).
 * ما يكتب فوق عملية ثانية على الراوتر، ولو العضو غيّر الإعداد بنفسه ينسى بدون ما يلمس شي.
 */
import { SavedRouter, listRouters } from '../store/routers';
import { withSession, isRouterBusyAnywhere, isRouterBusy, holdRouter } from '../store/sessions';
import { getGameLock, clearGameLock } from '../store/gameLock';
import { gameLockVerdict } from '../utils/gameLockCore';
import { notify } from '../utils/notify';
import { diag } from './diag';
import { ipHeld } from '../store/ipGuard';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function isOnline(r: SavedRouter): Promise<boolean | undefined> {
  return withSession(r, async d => {
    const net = d.getNetworkInfo ? await d.getNetworkInfo().catch(() => null) : null;
    if (net) return net.connected !== false;
    return d.isConnected ? d.isConnected() : undefined;
  }, false).catch(() => undefined);
}

/** يرجع نص للعضو لو رجّعنا شي */
export async function checkGameLock(r: SavedRouter, online?: boolean, background = false): Promise<string | null> {
  const g = await getGameLock(r.id);
  if (!g) return null;
  if (await isRouterBusyAnywhere(r)) return null;
  const cfg = await withSession(r, d => (d.getBandConfig ? d.getBandConfig() : Promise.resolve(null)), false).catch(() => null);
  if (!cfg) return null; // ما وصلنا للراوتر — المرة الجاية
  let on = online ?? (await isOnline(r));
  // «حماية الآي بي» والنت شغال ← الإرجاع (يغيّر الترددات = ممكن آي بي جديد) ينتظر
  if (await ipHeld(r.id, on).catch(() => false)) return null;
  let v = gameLockVerdict(g, Date.now(), cfg, on);
  if (v === 'down') {
    // انقطاع لحظي؟ نصبر ٢٠ ثانية ونشيك مرة ثانية
    await sleep(20_000);
    on = await isOnline(r);
    v = gameLockVerdict(g, Date.now(), cfg, on);
  }
  if (!v) return null;
  if (v === 'gone') { await clearGameLock(r.id); return null; }
  if (await isRouterBusyAnywhere(r) || isRouterBusy(r)) return null;
  const p = withSession(r, async d => {
    if (g.kind === 'lteOnly') { if (d.setNetworkMode) await d.setNetworkMode(g.prev.mode); }
    else if (d.setBand) await d.setBand(g.prev.lte, g.prev.nr);
  }, false);
  holdRouter(r, p);
  try {
    await p;
  } catch (e) {
    diag(`[gamelock] الإرجاع فشل (${v}): ${String((e as any)?.message ?? e).slice(0, 80)}`);
    return null; // نحاول المرة الجاية
  }
  await clearGameLock(r.id);
  diag(`[gamelock] رجّعنا إعدادك بعد «${g.label}» (${v})`);
  const msg = v === 'down'
    ? `${r.name}: النت طاح على «${g.label}»، فرجّعنا إعدادك السابق.`
    : `${r.name}: خلص وقت «${g.label}»، ورجّعنا إعدادك السابق (الدمج يرجع).`;
  if (background) notify('🎮 تثبيت اللعب', msg, r.id);
  return msg;
}

let running = false;
export async function runGameLockRecovery(): Promise<string | null> {
  if (running) return null;
  running = true;
  try {
    const out: string[] = [];
    for (const r of await listRouters()) {
      if (r.host === 'demo' || r.host === 'device') continue;
      if (!(await getGameLock(r.id))) continue;
      const m = await checkGameLock(r).catch(() => null);
      if (m) out.push(m);
    }
    return out.length ? out.join('\n') : null;
  } finally {
    running = false;
  }
}
