import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedRouter } from '../store/routers';
import { withSession, withSessionPatient, withRouterLock, routerWrite } from '../store/sessions';
import { roleProfiles } from '../store/profiles';
import { applyProfile } from './applyProfile';
import { listLagSessions, Cause, CAUSE_TEXT } from './lagDetector';
import { GameRegion, LatencyResult, measureUrl, regionUrls, gameScore } from './latency';
import { readSnapOrStop, waitOnline } from './safeLock';
import { LockSnapshot, mismatchOf, settleMsFor } from '../drivers/lockSnapshot';
import { driverById } from '../drivers/registry';
import { diag } from '../services/diag';

/* ═══ «جهّزني للعب» — ضغطة وحدة قبل المباراة ═══
 * ١) يقرأ تقارير كاشف اللاق اللي فاتت ويعرف أكثر سبب تقطيع عند هالمستخدم
 * ٢) يحفظ لقطة إعدادك (بدونها ما نغيّر شي)
 * ٣) يطبّق العلاج: «وضع الألعاب» المحفوظ من مُحسّن اللعبة، وإلا 4G فقط لو 5G يقطع،
 *    ويثبّت البرج الحالي لو التنقّل بين الأبراج هو المشكلة
 * ٤) لو النت ما رجع خلال مهلة الموديل ← يرجّع اللقطة فوراً
 * ٥) يقيس قبل وبعد، ويحفظ اللقطة عشان «رجّع إعدادي» بعد اللعب
 * التجهيز يكون قبل المباراة — أي تغيير وقت اللعب يقطع النت ثواني.
 */

const KEY = (id: string) => `bandly.gameprep.${id}`;
const LTE_ONLY = '03';

export interface PrepState {
  at: number;
  snap: LockSnapshot;
  actions: string[];
}

export interface PrepResult {
  ok: boolean;
  /** ما غيّرنا شي (إعدادك الحالي هو الأنسب، أو ما فيه علاج متاح) */
  nothing?: boolean;
  before?: LatencyResult;
  after?: LatencyResult;
  bScore?: number;
  aScore?: number;
  actions: string[];
  tips: string[];
  /** سبب التقطيع الأكثر من التقارير القديمة */
  topCause?: Cause;
  error?: string;
}

export async function getPrep(routerId: string): Promise<PrepState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY(routerId));
    const v = raw ? (JSON.parse(raw) as PrepState) : null;
    return v && v.snap ? v : null;
  } catch {
    return null;
  }
}

/** يدعم الراوتر هالميزة؟ (نحتاج لقطة وإرجاع متحقق منه) */
export function canPrep(r: SavedRouter): boolean {
  const d = driverById(r.driverId);
  return !!(d?.readLockState && d?.restoreLockState && d?.setBand);
}

/** أكثر سبب تقطيع في آخر ١٠ جلسات لكاشف اللاق */
async function topCauseOf(routerId: string): Promise<Cause | undefined> {
  const list = (await listLagSessions(routerId).catch(() => [])).slice(-10);
  const sum: Partial<Record<Cause, number>> = {};
  for (const r of list) for (const [k, v] of Object.entries(r.causes ?? {})) sum[k as Cause] = (sum[k as Cause] ?? 0) + (v ?? 0);
  const top = (Object.entries(sum) as [Cause, number][]).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 0 ? top[0] : undefined;
}

export async function prepareForGame(r: SavedRouter, reg: GameRegion, say: (s: string) => void): Promise<PrepResult> {
  const actions: string[] = [];
  const tips: string[] = [];
  if (await getPrep(r.id)) return { ok: false, actions, tips, error: 'جهّزناك قبل — اضغط «رجّع إعدادي» أول' };

  say('نشوف وش أكثر شي يقطّع عندك...');
  const topCause = await topCauseOf(r.id);
  const prof = (await roleProfiles(r.id).catch(() => ({} as any))).game;

  say(`نقيس البنق لسيرفرات ${reg.name}...`);
  const before = await measureUrl(regionUrls(reg), 15);
  if (!before.samples) return { ok: false, actions, tips, topCause, error: 'ما وصلنا لسيرفر اللعبة — تأكد إن النت شغال' };

  say('نحفظ إعدادك الحالي...');
  let snap: LockSnapshot | null;
  try {
    snap = await readSnapOrStop(r);
  } catch (e: any) {
    return { ok: false, actions, tips, topCause, error: e?.message ?? 'ما قدرنا نقرأ إعدادك' };
  }
  if (!snap) return { ok: false, actions, tips, topCause, error: 'نوع الراوتر هذا ما يدعم التجهيز التلقائي' };

  // ═══ نختار العلاج ═══
  const cfg = await withSession(r, async d => (d.getBandConfig ? d.getBandConfig() : null), false).catch(() => null);
  const sig = await withSession(r, async d => (d.getSignal ? d.getSignal() : null), false).catch(() => null);
  const proto = driverById(r.driverId);
  type Step = { label: string; run: () => Promise<unknown> };
  const steps: Step[] = [];

  if (prof) {
    steps.push({ label: `طبّقنا «${prof.name}» (أفضل إعداد طلع لك في مُحسّن اللعبة)`, run: () => applyProfile(r, prof) });
  } else if (topCause === 'nr' && cfg && cfg.mode !== LTE_ONLY && cfg.modes.some(m => m.value === LTE_ONLY)) {
    steps.push({ label: 'شغّلنا «4G فقط» — 5G كان يقطع عندك وقت اللعب', run: () => routerWrite(r, d => d.setNetworkMode!(LTE_ONLY), { label: '4G فقط للعب' }) });
  }
  // تثبيت البرج: هواوي بس — ZTE يعلق «بدون خدمة» أحياناً بعد التثبيت
  if (topCause === 'handover' && r.driverId === 'huawei-lte' && proto?.lockCell && !proto.cellLockRisk && sig?.pci && sig.earfcn) {
    const band = parseInt((String(sig.band ?? '').match(/(\d+)/) ?? [])[1] ?? '', 10);
    steps.push({
      label: `ثبّتنا البرج الحالي (${sig.pci}) — الراوتر كان يتنقّل بين الأبراج وأنت تلعب`,
      run: () => routerWrite(r, d => d.lockCell!({ tech: 'LTE', pci: String(sig.pci), arfcn: String(sig.earfcn), band: Number.isFinite(band) ? band : undefined }), { label: 'تثبيت البرج للعب' }),
    });
  }
  if (!prof) tips.push('شغّل «مُحسّن اللعبة» مرة وحدة — يلقى أفضل باند لك، والمرة الجاية نطبّقه هنا تلقائياً');
  if (topCause && !['nr', 'handover'].includes(topCause)) tips.push(`${CAUSE_TEXT[topCause].icon} أكثر سبب عندك: ${CAUSE_TEXT[topCause].title} — ${CAUSE_TEXT[topCause].fix}`);
  if (!topCause) tips.push('شغّل «كاشف اللاق» وأنت تلعب مرة — نعرف سبب التقطيع عندك ونعالجه هنا');

  // جهاز ثاني يحمّل؟
  const tr = await withSession(r, async d => (d.getTraffic ? d.getTraffic() : null), false).catch(() => null);
  if (tr && tr.downBytesPerSec > 1_500_000) {
    tips.push(`📥 فيه تحميل شغال الحين (${(tr.downBytesPerSec * 8 / 1e6).toFixed(0)} ميقابت) — وقّفه قبل ما تلعب، أو افصل الجهاز من «الأجهزة»`);
  }

  if (!steps.length) {
    return { ok: true, nothing: true, before, bScore: gameScore(before), actions, tips, topCause };
  }

  // ═══ نطبّق ═══
  await AsyncStorage.setItem(KEY(r.id), JSON.stringify({ at: Date.now(), snap, actions: [] } as PrepState)).catch(() => {});
  try {
    for (const st of steps) {
      say('نجهّز الراوتر...');
      await st.run();
      actions.push(st.label);
    }
  } catch (e: any) {
    diag(`[gameprep] apply failed: ${e?.message ?? e}`);
    say('صار خطأ — نرجّع إعدادك...');
    await restoreAfterGame(r, () => {}).catch(() => {});
    return { ok: false, actions: [], tips, topCause, error: `ما قدرنا نجهّز (${String(e?.message ?? e).slice(0, 60)}) — ورجّعنا إعدادك` };
  }

  say('ننتظر الراوتر يتصل...');
  const online = await waitOnline(r, settleMsFor(r.driverId), () => false);
  if (!online) {
    say('النت ما رجع — نرجّع إعدادك فوراً...');
    await restoreAfterGame(r, () => {}).catch(() => {});
    return { ok: false, actions: [], tips, topCause, error: 'النت ما رجع على الإعداد الجديد، فرجّعنا إعدادك كما كان' };
  }
  await AsyncStorage.setItem(KEY(r.id), JSON.stringify({ at: Date.now(), snap, actions } as PrepState)).catch(() => {});

  say('نقيس البنق بعد التجهيز...');
  await new Promise(res => setTimeout(res, 3000));
  const after = await measureUrl(regionUrls(reg), 15);
  return { ok: true, before, after, bScore: gameScore(before), aScore: after.samples ? gameScore(after) : undefined, actions, tips, topCause };
}

/** «رجّع إعدادي» بعد اللعب: يكتب اللقطة ويتأكد منها بالقراءة */
export async function restoreAfterGame(r: SavedRouter, say: (s: string) => void): Promise<{ exact: boolean; items?: string[] }> {
  const st = await getPrep(r.id);
  if (!st) return { exact: true };
  say('نرجّع إعدادك...');
  let exact = false;
  let items: string[] | undefined;
  try {
    await withRouterLock(r, () => withSessionPatient(r, d => d.restoreLockState!(st.snap), 90_000), { label: 'رجّع إعدادي بعد اللعب' });
    exact = true;
  } catch (e) {
    items = mismatchOf(e) ?? undefined;
    if (!items) throw e;
  }
  say('ننتظر الراوتر يتصل...');
  await waitOnline(r, exact ? settleMsFor(r.driverId) : 45_000, () => false);
  if (exact) await AsyncStorage.removeItem(KEY(r.id)).catch(() => {});
  return { exact, items };
}
