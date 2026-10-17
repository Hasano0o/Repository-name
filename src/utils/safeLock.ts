import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Carrier, RouterDriver, Signal } from '../drivers/types';
import { SavedRouter } from '../store/routers';
import { withSession, withSessionPatient, withRouterLock, dropSession, RouterOp } from '../store/sessions';
import { reportError } from '../services/errors';
import { diag } from '../services/diag';
import { getBaseline } from '../store/baseline';
import { driverById } from '../drivers/registry';
import { trafficBurst } from './nrprobe';
import { isNoService } from './signal';
import { progress, Tracker } from '../ui/Progress';
import { runApply, trackWrites } from './applyGuard';
import { LockSnapshot, mismatchOf, settleMsFor } from '../drivers/lockSnapshot';
import { saveReleaseSnap, getReleaseSnap, clearReleaseSnap } from '../store/lockSnap';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** يرجّع undefined لو الخطوة طوّلت أكثر من المسموح (بدل ما يعلق المستخدم ٤٠ دقيقة) */
const STEP_TIMEOUT = Symbol('timeout');
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof STEP_TIMEOUT> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(STEP_TIMEOUT), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** لقطة واحدة للوضع: الإشارة + النواقل + سعة تقديرية */
export interface Snapshot {
  rsrp?: number;
  sinr?: number;
  /** مجموع عرض النطاق بالميقاهرتز */
  bw: number;
  carriers: number;
  nr: boolean;
  /** مؤشر سعة نسبي (للمقارنة فقط — مو سرعة حقيقية) */
  cap: number;
  bands: string;
  /** رقم الخلية الأساسية — نكشف فيه هل تغيّر البرج أثناء القياس */
  pci?: string;
}

const mhz = (s?: string) => {
  const m = (s ?? '').match(/(\d+(?:\.\d+)?)\s*MHz/i);
  return m ? parseFloat(m[1]) : undefined;
};

/** شانون المبسط: العرض × log2(1+SINR) — نسقف SINR عند 25 لأن الراوتر ما يستفيد فوقها */
const shannon = (bw: number, sinr?: number) => {
  const s = Math.min(25, Math.max(-5, sinr ?? 0));
  return bw * Math.log2(1 + Math.pow(10, s / 10));
};

function capacityOf(sig: Signal, carriers: Carrier[], withNr: boolean) {
  const list = carriers.filter(c => withNr || c.tech === 'LTE');
  if (!list.length) {
    // ما عندنا نواقل — نعتمد على الخلية الأساسية فقط
    const bw = mhz(sig.band) ?? mhz(sig.dlBandwidth) ?? 20;
    let cap = shannon(bw, sig.sinr);
    let total = bw;
    let n = 1;
    if (withNr && sig.nrRsrp !== undefined) {
      const nbw = mhz(sig.nrDlBandwidth) ?? 40;
      cap += shannon(nbw, sig.nrSinr);
      total += nbw;
      n++;
    }
    return { cap, bw: total, n, bands: [sig.band ?? '', sig.nrBand ?? ''].filter(Boolean).join(' + ') };
  }
  let cap = 0;
  let bw = 0;
  for (const c of list) {
    const b = c.bandwidth ?? (c.tech === 'NR' ? 40 : 10);
    const pccSinr = c.tech === 'NR' ? sig.nrSinr : sig.sinr;
    cap += shannon(b, c.sinr ?? pccSinr);
    bw += b;
  }
  const bands = list.map(c => (c.tech === 'NR' ? `n${c.band}` : `B${c.band}`)).join(' + ');
  return { cap, bw, n: list.length, bands };
}

/** يقيس الوضع كم مرة ويرجع المتوسط */
export async function snapshot(r: SavedRouter, withNr = false, samples = 3): Promise<Snapshot | null> {
  const caps: number[] = [];
  const rs: number[] = [];
  const ss: number[] = [];
  let bw = 0;
  let n = 0;
  let nr = false;
  let bands = '';
  let pci: string | undefined;
  for (let i = 0; i < samples; i++) {
    try {
      const { sig, carriers } = await withSession(r, async (d: RouterDriver) => {
        const s = d.getSignal ? await d.getSignal() : ({} as Signal);
        const c = d.getCarriers ? await d.getCarriers().catch(() => [] as Carrier[]) : [];
        return { sig: s, carriers: c };
      }, false);
      if (sig.rsrp === undefined) continue;
      const res = capacityOf(sig, carriers, withNr);
      caps.push(res.cap);
      rs.push(sig.rsrp);
      if (sig.sinr !== undefined) ss.push(sig.sinr);
      bw = Math.max(bw, res.bw);
      n = Math.max(n, res.n);
      nr = nr || sig.nrRsrp !== undefined || carriers.some(c => c.tech === 'NR');
      bands = res.bands || bands;
      pci = sig.pci ?? pci;
    } catch {}
    if (i < samples - 1) await sleep(2500);
  }
  if (!caps.length) return null;
  return { cap: avg(caps)!, rsrp: avg(rs), sinr: avg(ss), bw, carriers: n, nr, bands, pci };
}

export async function waitOnline(r: SavedRouter, timeoutMs: number, isCancelled: () => boolean) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !isCancelled()) {
    await sleep(3000);
    try {
      const ok = await withSession(r, async d => {
        // الإشارة نفسها هي الحكم: لو فيه قراءة برج والمودم ما يقول «خدمة محدودة» = رجعت
        const s = d.getSignal ? await d.getSignal().catch(() => null) : null;
        if (s && (s.rsrp !== undefined || s.nrRsrp !== undefined)) return !isNoService(s);
        if (s && isNoService(s)) return false;
        return d.isConnected ? await d.isConnected() : !d.getSignal;
      }, false);
      if (ok) return true;
    } catch {}
  }
  return false;
}

/** الراوتر قفل الدخول بسبب محاولات كثيرة؟ ننتظر المدة اللي قالها (أو دقيقتين) بدل ما نزيد القفل */
const LOCKED = /قفل تسجيل الدخول|محاولات كثيرة|108007|locked/i;
async function waitIfLocked(e: unknown, say: (s: string) => void): Promise<boolean> {
  const msg = String((e as any)?.message ?? e);
  if (!LOCKED.test(msg)) return false;
  const mins = Number(msg.match(/(\d+)\s*دقيق/)?.[1] ?? 2);
  say(`الراوتر قفل الدخول مؤقتاً — ننتظر ${mins} دقيقة وبعدها نكمّل...`);
  await sleep((mins * 60 + 15) * 1000);
  return true;
}

// ─── الإنقاذ: يرجّع الراوتر لإعداداته الأصلية بدون إعادة ضبط مصنع ───

/** هل نوع هذا الراوتر يدعم «رجّع الإعدادات الأصلية»؟ */
export function canRescue(r: SavedRouter | null | undefined): boolean {
  if (!r) return false;
  const d = driverById(r.driverId);
  return !!d?.restoreAll;
}

/**
 * يفك كل الأقفال ويرجع الإعدادات الأصلية ويعيد التشغيل، وينتظر الراوتر يرجع.
 * يعيد المحاولة لو الراوتر كان في نص إعادة تشغيل. يرجع true لو رجع الاتصال.
 */
async function rescueRouterImpl(r: SavedRouter, say: (s: string) => void): Promise<boolean> {
  const baseline = await getBaseline(r.id);
  let lastErr: unknown;
  let sent = false;
  for (let i = 0; i < 5 && !sent; i++) {
    if (i) { say('الراوتر ما رد — نعيد المحاولة...'); await sleep(15000); }
    try {
      // نعيد تسجيل الدخول بس بعد فشل — كل دخول زيادة يقرّب الراوتر من قفل الدخول
      if (i) dropSession(r.id);
      say('نفك كل الأقفال ونرجّع الإعدادات الأصلية...');
      await withSession(r, d => {
        if (!d.restoreAll) throw new Error('هذا النوع من الراوترات ما يدعم الإرجاع التلقائي');
        return d.restoreAll(baseline);
      }, false);
      sent = true;
    } catch (e) {
      lastErr = e;
      if (/ما يدعم/.test(String((e as any)?.message))) break;
      if (await waitIfLocked(e, say)) i--; // القفل ما يحسب محاولة
    }
  }
  if (!sent) throw lastErr ?? new Error('ما قدرنا نوصل للراوتر');
  dropSession(r.id);
  say('الراوتر يعيد التشغيل — ننتظره يرجع (دقيقتين تقريباً)...');
  await sleep(25000);
  return waitOnline(r, 180000, () => false);
}

/**
 * «رجّع الإشارة»: ما نرجع لإعداد سابق (ممكن يكون هو بعد مقفول على برج ميت) —
 * نفك كل التثبيتات ونخلي الراوتر يلقط أقوى برج بنفسه، والمستخدم بعدها يتحكم براحته.
 * ١. فك تثبيت الأبراج + الترددات على التلقائي (بدون إعادة تشغيل — أسرع)
 * ٢. ما رجع؟ الإنقاذ الكامل (الإعدادات الأصلية + إعادة تشغيل) أو إعادة تشغيل عادية
 */
async function freeReleaseImpl(r: SavedRouter, say: (s: string) => void, keep?: LockSnapshot): Promise<boolean> {
  // قبل ما نفك أي شي: نحفظ الإعداد عشان يقدر يرجّعه بضغطة من صفحة الراوتر
  await rememberBeforeRelease(r, keep);
  say('نفك كل التثبيتات عشان الراوتر يلقط أقوى برج...');
  let released = false;
  for (let i = 0; i < 3 && !released; i++) {
    if (i) await sleep(8000);
    try {
      if (i) dropSession(r.id);
      await withSessionPatient(r, async d => {
        if (d.wakeRadio) { try { await d.wakeRadio(); } catch {} }
        if (d.unlockCell) { try { await d.unlockCell(); } catch {} }
        if (d.setBand) { try { await d.setBand([], []); } catch {} }
        // عالق على 3G/2G (مثل LIMITED_SERVICE_WCDMA): الـ 3G شبه متوقفة عندنا —
        // نخلي الراوتر على 4G + 5G (أو 4G بس) عشان ما يرجع يعلق عليها
        try {
          const sig = d.getSignal ? await d.getSignal().catch(() => null) : null;
          const cfg = d.getBandConfig ? await d.getBandConfig().catch(() => null) : null;
          const modes = cfg?.modes ?? [];
          if (d.setNetworkMode && cfg?.mode === '08') {
            // «5G فقط (SA)» وبرجك ما يدعمه = بلا خدمة حتى لو فكّينا الترددات — نرجّعه تلقائي
            const pick = ['00', '0803'].find(m => modes.some(x => x.value === m));
            if (pick) { say('الراوتر على «5G فقط» — نرجّعه تلقائي...'); await d.setNetworkMode(pick); }
          } else if (d.setNetworkMode && cfg?.mode && !['00', '0803', '03', '08'].includes(cfg.mode) && /WCDMA|GSM|UMTS/i.test(cfg.mode)) {
            // وضع شبكة 3G/2G فقط (مثلاً علق من تجربة سابقة) = بلا خدمة عندنا — حتى إعادة التشغيل ما تصلحه
            const pick = ['0803', '00', '03'].find(m => modes.some(x => x.value === m));
            if (pick) { say('الراوتر على «3G فقط» — نرجّعه على 4G و 5G...'); await d.setNetworkMode(pick); }
          } else if (d.setNetworkMode && /WCDMA|UMTS|GSM|HSPA|\b[23]G\b/i.test(sig?.network ?? '')) {
            const pick = ['0803', '03'].find(m => modes.some(x => x.value === m));
            if (pick) { say('الراوتر عالق على 3G — نحوّله على 4G و 5G...'); await d.setNetworkMode(pick); }
          }
        } catch {}
      }, 60_000);
      released = true;
    } catch (e) {
      if (await waitIfLocked(e, say)) i--;
    }
  }
  if (released) {
    say('ننتظر الراوتر يلقط أقوى برج...');
    // المودم ياخذ وقت يمسح الأبراج — نعطيه دقيقة ونص قبل ما نعيد التشغيل
    if (await waitOnline(r, 90000, () => false)) return true;
  }
  // التثبيتات انفكّت والراوتر بعده «بدون خدمة» — بعض الموديلات (ZTE MU5001) ما تطلع من هالحالة
  // إلا بإعادة تشغيل. الإعادة ما تغيّر أي إعداد (عكس «الإعدادات الأصلية» اللي تبقى زر يدوي).
  // قبل ١٧ أكتوبر كنا نسويها تلقائي، وشلناها بالغلط — فصار الراوتر يعلق بدون خدمة.
  diag('[release] no service after release — rebooting');
  say('ما رجعت الإشارة — نعيد تشغيل الراوتر...');
  try {
    await withSession(r, async d => { if (d.reboot) await d.reboot(); }, false);
  } catch (e) {
    if (await waitIfLocked(e, say)) {
      try { await withSession(r, async d => { if (d.reboot) await d.reboot(); }, false); } catch {}
    }
  }
  dropSession(r.id);
  await sleep(25000);
  return waitOnline(r, 180000, () => false);
}

/** يربط رسائل العملية بنافذة التقدّم: رسائل معروفة تنقل الخطوة، والباقي يطلع كملاحظة */
function tracked(t: Tracker, say: (s: string) => void, map: [RegExp, number | string][]) {
  return (msg: string) => {
    say(msg);
    const hit = map.find(([re]) => re.test(msg));
    if (hit) t.step(hit[1]); else t.note(msg);
  };
}

/** الإنقاذ: الإعدادات الأصلية + إعادة تشغيل — مع نافذة التقدّم */
export async function rescueRouter(r: SavedRouter, say: (s: string) => void = () => {}, op?: RouterOp): Promise<boolean> {
  return withRouterLock(r, async () => {
    const t = progress.start('نرجّع إعدادات الراوتر الأصلية', ['نفك الأقفال ونرجّع الإعدادات', 'الراوتر يعيد التشغيل ويرجع'], 200);
    try {
      return await rescueRouterImpl(r, tracked(t, say, [[/نفك كل الأقفال/, 0], [/يعيد التشغيل/, 1]]));
    } finally {
      t.end();
    }
  }, { op, label: 'رجّع الإعدادات الأصلية' });
}

/** «رجّع الإشارة» — مع نافذة التقدّم */
/** يحفظ الإعداد قبل الفك: اللقطة اللي عندنا (من قبل التجربة) أو نقرأ الحالي */
async function rememberBeforeRelease(r: SavedRouter, keep?: LockSnapshot) {
  try {
    let s = keep ?? null;
    if (!s) {
      const got = await withTimeout(withSession(r, async d => (d.readLockState ? d.readLockState() : null), false), 30_000);
      s = got === STEP_TIMEOUT ? null : got;
    }
    if (s) {
      await saveReleaseSnap(r.id, s);
      diag(`[release] saved before release: ${s.summary}`);
    }
  } catch (e) {
    diag(`[release] could not save settings: ${String((e as any)?.message ?? e).slice(0, 60)}`);
  }
}

/**
 * keep: إعداد المستخدم من قبل التجربة (يحفظ بدل الحالي — الحالي ممكن يكون إعداد التجربة اللي خرّب).
 */
export async function freeRelease(r: SavedRouter, say: (s: string) => void = () => {}, keep?: LockSnapshot, op?: RouterOp): Promise<boolean> {
  return withRouterLock(r, async () => {
    const t = progress.start('نرجّع الإشارة', ['نفك تثبيت الأبراج والترددات', 'ننتظر الراوتر يلقط أقوى برج'], 100);
    try {
      return await freeReleaseImpl(r, tracked(t, say, [
        [/نفك كل التثبيتات/, 0], [/يلقط أقوى برج\.\.\./, 1], [/نعيد تشغيل الراوتر/, 'نعيد تشغيل الراوتر'],
      ]), keep);
    } finally {
      t.end();
    }
  }, { op, label: 'رجّع الإشارة' });
}

/**
 * «رجّع إعدادي اللي قبل الفك» — زر في صفحة الراوتر.
 * يكتب الإعداد المحفوظ ويتأكد منه بالقراءة، وينتظر الخدمة مهلة الموديل. ما يفك شي من نفسه:
 * لو ما رجع النت، المستخدم يقرر (زر «رجّع الإشارة» موجود).
 */
export async function restoreSavedSettings(
  r: SavedRouter,
  say: (s: string) => void = () => {},
): Promise<{ exact: boolean; items?: string[]; online: boolean }> {
  const snap = await getReleaseSnap(r.id);
  if (!snap) throw new Error('ما فيه إعداد محفوظ');
  if (snap.driver !== r.driverId) throw new Error('الإعداد المحفوظ لنوع راوتر ثاني');
  return withRouterLock(r, async () => {
    say('نرجّع إعدادك المحفوظ...');
    let exact = false;
    let items: string[] | undefined;
    try {
      await withSessionPatient(r, d => {
        if (!d.restoreLockState) throw new Error('هذا النوع ما يدعم الإرجاع');
        return d.restoreLockState(snap);
      }, 90_000);
      exact = true;
    } catch (e) {
      items = mismatchOf(e) ?? undefined;
      if (!items) throw e;
    }
    say('ننتظر الراوتر يتصل على إعدادك...');
    const online = await waitOnline(r, exact ? settleMsFor(r.driverId) : 45_000, () => false);
    if (exact) await clearReleaseSnap(r.id);
    diag(`[restore-saved] ${exact ? 'exact' : 'partial ' + (items ?? []).join(',')} online=${online}`);
    return { exact, items, online };
  }, { label: 'رجّع إعدادي السابق' });
}

/**
 * لقطة إعدادك قبل أي تثبيت (هواوي و ZTE).
 * الراوتر يدعمها وما قدرنا نقرأها ← نرمي خطأ «ما غيّرنا شي» (ما نثبّت وإحنا ما نعرف وش نرجّع).
 * الراوتر ما يدعمها ← null (الإرجاع يرجع لفك تثبيت التقنية نفسها بس).
 */
export async function readSnapOrStop(r: SavedRouter): Promise<LockSnapshot | null> {
  const proto = driverById(r.driverId);
  if (!proto?.readLockState || !proto?.restoreLockState) return null;
  let why = '';
  try {
    const got = await withTimeout(withSession(r, d => d.readLockState!(), false), 45_000);
    if (got !== STEP_TIMEOUT) return got;
    why = 'الراوتر ما رد';
  } catch (e) {
    why = String((e as any)?.message ?? e);
  }
  const err = new Error(`ما قدرنا نقرأ إعدادك الحالي من الراوتر (${why.slice(0, 70)}) — فما ثبّتنا ولا غيّرنا أي شي. جرّب مرة ثانية.`);
  (err as any).noChange = true;
  (err as any).reverted = false;
  throw err;
}

/**
 * يرجّع اللي كان قبل تثبيت سوّته الشاشة نفسها — وبس:
 * فيه لقطة ← نرجّعها ونتأكد منها (تقنية ثانية وأقفال ترددات/قنوات ما تنلمس إلا لو تغيّرت).
 * ما فيه لقطة (ماركات ثانية) ← نفك تثبيت التقنية اللي ثبّتناها بس، مو الكل.
 * لازم تنادى وهي داخل عملية على الراوتر (withRouterLock).
 */
export async function undoPin(r: SavedRouter, snap: LockSnapshot | null, tech: 'LTE' | 'NR'): Promise<{ exact: boolean; items?: string[] }> {
  if (snap) {
    try {
      await withSessionPatient(r, d => d.restoreLockState!(snap), 90_000);
      return { exact: true };
    } catch (e) {
      const items = mismatchOf(e);
      if (items) return { exact: false, items };
      throw e;
    }
  }
  await withSession(r, d => (d.unlockCell ? d.unlockCell(tech) : Promise.resolve()), false);
  return { exact: false };
}

export type TrialVerdict = 'better' | 'same' | 'worse' | 'noconn';

export interface TrialResult {
  verdict: TrialVerdict;
  kept: boolean;
  before: Snapshot | null;
  after: Snapshot | null;
  /** نسبة التغير في السعة (0.3 = أفضل ٣٠٪) */
  change?: number;
  /** رجّعنا الإعداد لكن الراوتر ما رجع أونلاين — يحتاج تدخّل المستخدم */
  restoreFailed?: boolean;
  /** تغيّر البرج الأساسي أثناء القياس — المقارنة صارت تقديرية */
  towerChanged?: boolean;
  /** ثبتنا الجديد بناءً على طلب المستخدم رغم أنه أسوأ */
  userKeptAnyway?: boolean;
  /** فكّينا كل التثبيتات (الراوتر على التلقائي يلقط أقوى برج) */
  freed?: boolean;
  /** رجّعنا إعدادك وتأكدنا منه بالقراءة من الراوتر */
  exact?: boolean;
  /** الإرجاع انكتب بس هذي ما رجعت كما كانت */
  notRestored?: string[];
  /** جملة جاهزة عن نتيجة الإرجاع */
  restoreNote?: string;
  /** noconn: offline = الراوتر ما اتصل أبد، nosignal = اتصل بس ما طلعت قراءة إشارة على الإعداد الجديد */
  reason?: 'offline' | 'nosignal';
}

export interface Trial {
  key: string;
  label: string;
  at: number;
  verdict: TrialVerdict;
  change?: number;
}

/** أقل من كذا نعتبره أسوأ ونرجع — وفوق كذا نعتبره أفضل */
const WORSE = -0.15;
const BETTER = 0.1;

/**
 * يطبق تغيير (قفل تردد/برج) بأمان:
 * يقيس قبل ← يطبق ← ينتظر الاتصال ← يقيس بعد ← لو صار أسوأ يرجع تلقائياً.
 * withNr: نصحّي 5G بتحميل قصير وقت القياس (يستهلك باقة) — للتغييرات اللي تخص 5G.
 */
export interface SafeApplyOpts {
  r: SavedRouter;
  key: string;
  label: string;
  apply: (d: RouterDriver) => Promise<void>;
  revert: (d: RouterDriver) => Promise<void>;
  onStatus?: (s: string) => void;
  isCancelled?: () => boolean;
  withNr?: boolean;
  /** عملية شغالة على الراوتر (فحص فيه كذا تجربة) — التجربة تكمّل جواها بدل ما تنرفض */
  op?: RouterOp;
}

/** يطبّق بأمان، ومقفول لكل راوتر عشان ما تشتغل عمليتان معاً */
export function safeApply(o: SafeApplyOpts): Promise<TrialResult> {
  return withRouterLock(o.r, async op => {
    const t = progress.start(o.label, ['نقيس الوضع الحالي', 'نطبّق التغيير', 'ننتظر الراوتر يتصل', 'نقيس النتيجة'], o.withNr ? 75 : 60);
    const base = o.onStatus ?? (() => {});
    const say = (msg: string) => {
      base(msg);
      if (/ننتظر قرارك/.test(msg)) { t.hide(true); return; }
      t.hide(false);
      if (/نقيس الوضع الحالي/.test(msg)) t.step(0);
      else if (/نطبّق التغيير/.test(msg)) t.step(1);
      else if (/ننتظر الراوتر يتصل/.test(msg)) t.step(2);
      else if (/ننتظر الإشارة تستقر|نقيس بعد التغيير/.test(msg)) t.step(3);
      else if (/نرجع الإعداد السابق|نرجّع إعدادك السابق/.test(msg)) t.step('نرجّع إعدادك السابق');
      else if (/نقرأ إعدادك الحالي/.test(msg)) t.step(0);
      else t.note(msg);
    };
    try {
      return await safeApplyInner({ ...o, op, onStatus: say }, t);
    } finally {
      t.end();
    }
  }, { op: o.op, label: o.label });
}

async function safeApplyInner(o: SafeApplyOpts, track: Tracker = progress.none): Promise<TrialResult> {
  const say0 = o.onStatus ?? (() => {});
  const say = (t: string) => { diag(`[${o.key}] ${t}`); say0(t); };
  diag(`[${o.key}] start: ${o.label}`);
  const cancelled = o.isCancelled ?? (() => false);
  const measure = async () => {
    if (!o.withNr) return snapshot(o.r, false);
    const burst = trafficBurst(11000, 25_000_000, cancelled);
    await sleep(2500);
    const s = await snapshot(o.r, true);
    await burst.catch(() => 0);
    return s;
  };

  // ═══ ١. لقطة إعدادك قبل أي شي (هواوي و ZTE) ═══
  // ما قدرنا نقرأها = ما نجرّب: ما نكتب على الراوتر وإحنا ما نعرف وش نرجّع
  const proto = driverById(o.r.driverId);
  const canSnap = !!(proto?.readLockState && proto?.restoreLockState);
  let snap: LockSnapshot | null = null;
  if (canSnap) {
    say('نقرأ إعدادك الحالي...');
    let why = '';
    try {
      const got = await withTimeout(withSession(o.r, d => d.readLockState!(), false), 45_000);
      if (got === STEP_TIMEOUT) why = 'الراوتر ما رد';
      else snap = got;
    } catch (e) {
      why = String((e as any)?.message ?? e);
    }
    if (!snap) {
      diag(`[${o.key}] snapshot failed: ${why.slice(0, 80)}`);
      const err = new Error(`ما قدرنا نقرأ إعدادك الحالي من الراوتر (${why.slice(0, 70)}) — فما جرّبنا ولا غيّرنا أي شي. تأكد إن جوالك متصل بشبكة الراوتر وجرّب مرة ثانية.`);
      (err as any).noChange = true;
      (err as any).reverted = false;
      throw err;
    }
    diag(`[${o.key}] snapshot: ${snap.summary}`);
  }
  const settleMs = settleMsFor(o.r.driverId);

  /**
   * يرجّع إعدادك ويتأكد منه، وبعدها يقرر:
   * - رجع بالضبط ← ننتظر الخدمة مهلة الموديل كاملة (هواوي دقيقتين، ZTE ٤) — التأخر لحاله مو فشل
   * - ما رجع أو رجع ناقص ← ننتظر شوي، ولو النت مقطوع نفك كل شي (النت أهم) مع حفظ إعدادك
   * - ما نفك أي شي والنت شغال
   */
  type Restored = { exact: boolean; sent: boolean; items?: string[]; error?: string; online: boolean; freed: boolean };
  const restorePrev = async (): Promise<Restored> => {
    say('نرجّع إعدادك السابق...');
    // الإرجاع + انتظار الخدمة على إعدادك (لين مهلة الموديل) — التقدير القديم كان ناقص
    track.extend(Math.round(settleMs / 1000) + 30);
    let exact = false;
    let sent = false;
    let items: string[] | undefined;
    let error: string | undefined;
    try {
      await withSessionPatient(
        o.r,
        snap ? d => d.restoreLockState!(snap!) : o.revert,
        90_000,
        n => n && say('الراوتر مشغول — نحاول ندخل ونرجّع إعدادك...'),
      );
      sent = true;
      exact = !!snap;
    } catch (e) {
      items = mismatchOf(e) ?? undefined;
      error = items ? undefined : String((e as any)?.message ?? e);
      reportError(`${o.key}-revert`, (items ? `mismatch: ${items.join(',')}` : `error: ${error}`).slice(0, 200), o.r);
    }
    diag(`[${o.key}] restore: ${exact ? 'exact' : items ? 'partial ' + items.join(',') : error ? 'error' : 'sent (unverified)'}`);
    const good = exact || (sent && !snap);
    say(good ? 'ننتظر الراوتر يتصل على إعدادك...' : 'ننتظر الراوتر يتصل...');
    let online = await waitOnline(o.r, good ? settleMs : 45_000, () => false);
    let freed = false;
    if (!online) {
      say('ما رجع — نفك التثبيتات عشان يلقط أقوى برج...');
      track.extend(150);
      online = await freeRelease(o.r, say, snap ?? undefined, o.op).catch(() => false);
      freed = true;
    }
    return { exact, sent, items, error, online, freed };
  };
  const restoreText = (rs: Restored): string => {
    const saved = snap ? ' إعدادك اللي كان قبل التجربة محفوظ — تقدر ترجّعه من صفحة الراوتر.' : '';
    if (rs.freed) {
      return rs.online
        ? `↩️ ${rs.exact ? 'رجّعنا إعدادك بس الراوتر ما اتصل عليه' : 'ما قدرنا نرجّع إعدادك بالضبط'}، ففكّينا كل التثبيتات والراوتر رجع يلقط أقوى برج.${saved}`
        : `⚠️ ما رجع الاتصال حتى بعد فك التثبيتات — من صفحة الراوتر اضغط «رجّع الإعدادات الأصلية».${saved}`;
    }
    if (rs.exact) return '✓ رجّعنا إعدادك السابق بالضبط (تأكدنا من قراءة الراوتر).';
    if (rs.items?.length) return `⚠️ رجع جزئياً — هذي ما رجعت كما كانت: ${rs.items.join('، ')}. النت شغال.`;
    if (rs.error) return `⚠️ ما قدرنا نرجّع إعدادك (${rs.error.slice(0, 80)}) — النت شغال بس الإعداد مو مثل قبل.`;
    return '✓ أرسلنا للراوتر إعدادك السابق (هالنوع ما نقدر نتأكد منه بالقراءة) — تأكد من الإشارة بعد دقيقة.';
  };
  const restoreFields = (rs: Restored) => ({
    exact: rs.exact, notRestored: rs.items, restoreNote: restoreText(rs), freed: rs.freed, restoreFailed: !rs.online,
  });

  say('نقيس الوضع الحالي...');
  const b0 = await withTimeout(measure(), 60_000);
  if (b0 === STEP_TIMEOUT) {
    // ما غيّرنا شي للحين — نوقف بأمان بدل ما نعلق
    throw new Error('الراوتر ما رد وقت القياس، وما غيّرنا أي شي. تأكد إن جوالك متصل بشبكة الراوتر وجرّب مرة ثانية.');
  }
  const before = b0;

  say('نطبّق التغيير...');
  // لو الأمر طوّل (مثلاً ZTE يعيد التشغيل بعد تثبيت البرج) ننتظره يخلص بدل ما نرجّع ونفك وهو في النص.
  let wrote = false;
  const step = await runApply<RouterDriver>({
    session: fn => withSession(o.r, fn, false),
    apply: d => o.apply(trackWrites(d, () => { wrote = true; })),
    changed: () => wrote,
    firstMs: 60_000,
    extraMs: 200_000,
    onLong: () => say('الراوتر لسا يطبّق التغيير (ممكن يعيد التشغيل) — ننتظره يخلص...'),
  });
  if (step.kind === 'stillRunning') {
    // انتهت مهلة الانتظار بس الأمر نفسه لسا شغال على الراوتر — ما نرجّع ولا نفك فوقه.
    // ننتظره يخلص فعلاً (والحجز باقي)، وبعدها نكمّل الفحص.
    diag(`[${o.key}] apply still running after wait — waiting for it to finish`);
    say('الراوتر لسا ينفّذ الأمر — ننتظره يخلص قبل أي خطوة...');
    track.extend(120);
    await step.pending;
    diag(`[${o.key}] late apply finished`);
  }
  if (step.kind === 'failed' && step.skipRevert) {
    // الخطأ صار قبل ما نرسل أي أمر — الراوتر على حاله، فما نرجّع ولا نفك أي تثبيت
    const msg = String((step.error as any)?.message ?? step.error);
    diag(`[${o.key}] stopped before any change: ${msg.slice(0, 80)}`);
    const err = new Error(/لم ننفذ|ما غيّرنا/.test(msg) ? msg : `${msg}\n\nما غيّرنا أي شي في الراوتر — إعدادك الحالي على حاله.`);
    (err as any).noChange = true;
    (err as any).reverted = false;
    throw err;
  }
  if (step.kind === 'failed') {
    // الأمر انرفض في النص (ممكن الخطوة الأولى غيّرت شي): نرجّع قبل ما نطلّع الخطأ
    say('الراوتر رفض — نرجّع إعدادك...');
    const msg = String((step.error as any)?.message ?? step.error);
    const rs = await restorePrev();
    const err = new Error(`${msg}\n\n${restoreText(rs)}`);
    (err as any).reverted = rs.exact || (rs.sent && !snap) || (rs.freed && rs.online);
    throw err;
  }

  say('ننتظر الراوتر يتصل...');
  const online = await waitOnline(o.r, 45000, cancelled);
  if (!online) {
    say('ما اتصل — نرجّع إعدادك السابق...');
    const rs = await restorePrev();
    const res: TrialResult = { verdict: 'noconn', kept: false, before, after: null, reason: 'offline', ...restoreFields(rs) };
    await record(o.r.id, o.key, o.label, res);
    return res;
  }

  say('ننتظر الإشارة تستقر...');
  await sleep(6000);
  say('نقيس بعد التغيير...');
  const a0 = await withTimeout(measure(), 60_000);
  const after = a0 === STEP_TIMEOUT ? null : a0;

  const change = before && after && before.cap > 0 ? (after.cap - before.cap) / before.cap : undefined;
  const towerChanged = !!(before?.pci && after?.pci && before.pci !== after.pci);
  let verdict: TrialVerdict = 'same';
  if (!after) verdict = 'noconn';
  else if (change !== undefined && change <= WORSE) verdict = 'worse';
  else if (change !== undefined && change >= BETTER) verdict = 'better';
  let kept = verdict === 'better' || verdict === 'same';
  let userKeptAnyway = false;

  // لو الجديد أسوأ — نسأل المستخدم: يثبت الجديد أم نرجع للسابق؟
  if (verdict === 'worse') {
    say('الجديد أضعف — ننتظر قرارك...');
    const decision = await askUserOnWorse({
      before, after, change, label: o.label,
    });
    if (decision === 'keep') {
      userKeptAnyway = true;
      kept = true;
      say('ثبّتنا الجديد بناءً على طلبك.');
    }
  }

  let extra: Partial<TrialResult> = { restoreFailed: false };
  if (!kept) {
    // خطأ الإرجاع ما ينبلع: النتيجة تقول بالضبط وش رجع ووش ما رجع
    extra = restoreFields(await restorePrev());
  }

  const res: TrialResult = {
    verdict, kept, before, after, change, towerChanged, userKeptAnyway, ...extra,
    ...(verdict === 'noconn' ? { reason: 'nosignal' as const } : {}),
  };
  await record(o.r.id, o.key, o.label, res);
  return res;
}

/** نص تفصيلي لإشارة الـ snapshot */
function fmtSnapFull(s: Snapshot | null): string {
  if (!s) return '—';
  const parts: string[] = [];
  if (s.rsrp !== undefined) parts.push(`RSRP ${Math.round(s.rsrp)} dBm`);
  if (s.sinr !== undefined) parts.push(`SINR ${Math.round(s.sinr)} dB`);
  parts.push(`${s.carriers} نواقل`);
  if (s.bw) parts.push(`${Math.round(s.bw)} MHz`);
  if (s.bands) parts.push(s.bands);
  return parts.join(' · ');
}

/**
 * يسأل المستخدم لما الجديد يطلع أسوأ:
 *  - «موافق — ثبّت الجديد»  → نخليه (المستخدم يعرف مصلحته)
 *  - «رجّعني للسابق»         → نرجع الإعداد
 */
function askUserOnWorse(info: {
  before: Snapshot | null;
  after: Snapshot | null;
  change?: number;
  label: string;
}): Promise<'keep' | 'revert'> {
  return new Promise(resolve => {
    const pct = info.change !== undefined
      ? `${Math.round(Math.abs(info.change) * 100)}٪`
      : 'أضعف';
    const msg =
      `الجديد أضعف بـ ${pct}.\n\n` +
      `⚪ الحالي (قبل):\n${fmtSnapFull(info.before)}\n\n` +
      `🟣 المختار (بعد):\n${fmtSnapFull(info.after)}\n\n` +
      `وش تبي نسوي؟`;
    Alert.alert(
      `⚠️ ${info.label}`,
      msg,
      [
        {
          text: 'رجّعني للسابق',
          style: 'cancel',
          onPress: () => resolve('revert'),
        },
        {
          text: 'موافق — ثبّت الجديد',
          onPress: () => resolve('keep'),
        },
      ],
      { cancelable: false },
    );
  });
}

// ─── ذاكرة التجارب: نتعلم من اللي جربناه قبل ───

const tKey = (id: string) => `lock-trials:${id}`;

export async function loadTrials(routerId: string): Promise<Trial[]> {
  try {
    const raw = await AsyncStorage.getItem(tKey(routerId));
    return raw ? (JSON.parse(raw) as Trial[]) : [];
  } catch {
    return [];
  }
}

async function record(routerId: string, key: string, label: string, res: TrialResult) {
  try {
    const list = await loadTrials(routerId);
    list.unshift({ key, label, at: Date.now(), verdict: res.verdict, change: res.change });
    await AsyncStorage.setItem(tKey(routerId), JSON.stringify(list.slice(0, 60)));
  } catch {}
}

/** آخر تجربة لنفس التغيير — عشان ننبه قبل ما نعيده */
export async function lastTrial(routerId: string, key: string): Promise<Trial | undefined> {
  return (await loadTrials(routerId)).find(t => t.key === key);
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}٪`;

/** جملة مفهومة عن تجربة سابقة */
export function trialNote(t: Trial): string {
  const days = Math.floor((Date.now() - t.at) / 86400000);
  const when = days <= 0 ? 'اليوم' : days === 1 ? 'أمس' : `قبل ${days} أيام`;
  if (t.verdict === 'worse') return `جربناه ${when} وكان أسوأ${t.change !== undefined ? ` بـ ${pct(t.change)}` : ''} فرجعناه.`;
  if (t.verdict === 'noconn') return `جربناه ${when} وما اتصل الراوتر عليه.`;
  if (t.verdict === 'better') return `جربناه ${when} وكان أفضل${t.change !== undefined ? ` بـ ${pct(t.change)}` : ''}.`;
  return `جربناه ${when} وما فرق كثير.`;
}

const fmtSnap = (s: Snapshot | null) =>
  s
    ? `${s.bands || '—'} · ${s.carriers > 1 ? `${s.carriers} نواقل · ` : ''}${Math.round(s.bw)} MHz` +
      `${s.rsrp !== undefined ? ` · ${Math.round(s.rsrp)} dBm` : ''}${s.sinr !== undefined ? ` · SINR ${Math.round(s.sinr)}` : ''}`
    : 'ما قدرنا نقيس';

/** عنوان ونص رسالة النتيجة */
export function trialMessage(res: TrialResult, label: string): { title: string; body: string } {
  const b = `قبل: ${fmtSnap(res.before)}\nبعد: ${fmtSnap(res.after)}`;
  const warn = res.restoreFailed ? '⚠️ ما قدرنا نتأكد إن الراوتر رجع — لو النت مقطوع، افتح الراوتر في التطبيق واضغط «رجّع الإعدادات الأصلية» (بدون إعادة ضبط مصنع).\n\n' : '';
  const tower = res.towerChanged ? '\n\n(لاحظنا تغيّر البرج أثناء القياس — المقارنة تقديرية)' : '';
  switch (res.verdict) {
    case 'better':
      return { title: '✅ صار أفضل', body: `${label} رفع السعة المتوقعة تقريباً ${pct(res.change!)} — خليناه.\n\n${b}${tower}` };
    case 'same':
      return {
        title: '➖ ما فرق كثير',
        body: `${label} ما غيّر شي واضح${res.change !== undefined ? ` (${res.change >= 0 ? '+' : '−'}${pct(res.change)})` : ''} — خليناه، وتقدر تلغيه متى ما بغيت.\n\n${b}`,
      };
    case 'worse':
      if (res.userKeptAnyway) {
        return {
          title: '⚠️ ثبّتنا الجديد (بناءً على طلبك)',
          body: `${label} كان أضعف بـ ${pct(res.change!)} — بس ثبتّناه بأمرك.\n\n${b}${tower}\n\n💡 إذا تبي ترجع للسابق، اذهب لشاشة الأبراج → «رجوع للتلقائي».`,
        };
      }
      return {
        title: res.notRestored?.length ? '⚠️ رجّعنا جزء من إعدادك' : res.freed ? '↩️ فكّينا التثبيتات' : '↩️ رجعنا الإعداد السابق',
        body: `${label} خلّى الاتصال أسوأ بـ ${pct(res.change!)}${res.before && res.after && res.after.carriers < res.before.carriers ? ' — غالباً لأنه أوقف دمج الترددات' : ''}.\n\n${res.restoreNote ?? (warn || 'رجعنا إعدادك.')}\n\n${b}${tower}`,
      };
    default:
      if (res.restoreNote) {
        // الراوتر اتصل بس ما طلعت إشارة على الإعداد الجديد (غالباً البرج مو موجود عندك) ≠ ما اتصل أبد
        const noSig = res.reason === 'nosignal';
        const head = noSig ? 'ما لقينا إشارة عليه' : 'ما اتصل';
        return {
          title: res.exact && !res.freed ? `↩️ ${head} — ورجّعنا إعدادك` : res.freed && !res.restoreFailed ? `↩️ ${head} — ورجّعنا الإشارة` : `⚠️ ${head}`,
          body: (noSig
            ? `ما طلعت إشارة بعد ${label} — غالباً البرج أو التردد مو موجود عندك أو بعيد.`
            : `الراوتر ما اتصل بعد ${label}.`) + `\n\n${res.restoreNote}`,
        };
      }
      if (res.freed && !res.restoreFailed) {
        return { title: '↩️ ما اتصل — ورجّعنا الإشارة', body: `الراوتر ما اتصل بعد ${label}، ففكّينا كل التثبيتات وخليناه يلقط أقوى برج تلقائياً.\n\nالإشارة رجعت — تقدر تجرّب إعداد ثاني براحتك.` };
      }
      return { title: '↩️ ما اتصل', body: `${warn}الراوتر ما اتصل بعد ${label}، فحاولنا نفك كل التثبيتات ونرجّع الإشارة.` };
  }
}
