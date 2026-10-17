/**
 * قلب طبقة التحكم الموحّدة (الحجز) — بدون react-native عشان ينختبر في Node.
 * sessions.ts يربطه بـ AsyncStorage وبهوية الراوتر (نوعه + عنوانه).
 *
 * القواعد:
 * - عملية تعديل وحدة لكل راوتر فعلي في نفس الوقت.
 * - فيه عملية شغالة؟ نرفض الثانية **فوراً** (ما ننتظر — أمر قديم ما يتنفّذ بعد ما الوضع تغيّر).
 * - الخطوات اللي جوا عملية شغالة تمرر op وتكمّل (ما تنرفض).
 * - الحجز ما يفك بمهلة: يبقى لين العملية (أو الوعد المحجوز) يخلص فعلاً.
 * - علامة محفوظة (تتجدد) عشان تشغيل ثاني للتطبيق (مهمة خلفية) يعرف إن الراوتر محجوز؛
 *   تنتهي لحالها لو التطبيق انقفل في النص.
 */

/** عملية تعديل شغالة على راوتر */
export interface RouterOp {
  readonly key: string;
  readonly label: string;
}

export interface BusyStore {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
  remove(k: string): Promise<void>;
}

/** الراوتر عليه عملية ثانية — ما بدأنا شي ولا كتبنا شي */
export function routerBusyError(label?: string): Error {
  const e = new Error(`فيه عملية ثانية شغالة على الراوتر${label ? ` («${label}»)` : ''} — انتظرها تخلص وجرّب مرة ثانية. ما غيّرنا أي شي.`);
  (e as any).noChange = true;
  (e as any).busy = true;
  (e as any).reverted = false;
  return e;
}
export const isRouterBusyError = (e: unknown) => !!(e && typeof e === 'object' && (e as any).busy === true);

export const BUSY_PREFIX = 'bandly.busy:';

export function createRouterLocks(store: BusyStore, o: {
  /** عمر العلامة المحفوظة */
  ttlMs?: number;
  /** كل كم نجدد العلامة وقت الحجز */
  beatMs?: number;
  now?: () => number;
  log?: (s: string) => void;
} = {}) {
  const ttl = o.ttlMs ?? 3 * 60_000;
  const beat = o.beatMs ?? 60_000;
  const now = o.now ?? (() => Date.now());
  const log = o.log ?? (() => {});
  const holds = new Map<string, number>();
  const beats = new Map<string, ReturnType<typeof setInterval>>();
  const active = new Map<string, RouterOp>();

  const mark = (k: string) => { store.set(BUSY_PREFIX + k, String(now() + ttl)).catch(() => {}); };

  function hold(k: string): () => void {
    const n = (holds.get(k) ?? 0) + 1;
    holds.set(k, n);
    if (n === 1) {
      mark(k);
      beats.set(k, setInterval(() => mark(k), beat));
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const left = (holds.get(k) ?? 1) - 1;
      if (left > 0) { holds.set(k, left); return; }
      holds.delete(k);
      const b = beats.get(k);
      if (b) clearInterval(b);
      beats.delete(k);
      store.remove(BUSY_PREFIX + k).catch(() => {});
    };
  }

  /** يبقي الراوتر محجوز لين الوعد يخلص (نجح أو فشل) */
  function holdPromise(k: string, p: Promise<unknown>): void {
    const release = hold(k);
    p.then(release, release);
  }

  const isBusy = (k: string) => (holds.get(k) ?? 0) > 0;

  async function isBusyAnywhere(k: string): Promise<boolean> {
    if (isBusy(k)) return true;
    try {
      const v = Number(await store.get(BUSY_PREFIX + k));
      return Number.isFinite(v) && v > now();
    } catch {
      return false;
    }
  }

  async function withLock<T>(k: string, fn: (op: RouterOp) => Promise<T>, opts: { op?: RouterOp; label?: string } = {}): Promise<T> {
    if (opts.op) {
      if (opts.op.key !== k) throw new Error('عملية لراوتر ثاني');
      return fn(opts.op);
    }
    // علامة من تشغيل ثاني للتطبيق — الفحص هذا فيه انتظار، فيجي قبل الفحص اللحظي
    if (!isBusy(k) && (await isBusyAnywhere(k))) throw routerBusyError();
    // الفحص والحجز بنفس اللحظة (بدون await بينهم) — ما تدخل عملية ثانية في النص
    if (isBusy(k)) throw routerBusyError(active.get(k)?.label);
    const op: RouterOp = { key: k, label: opts.label ?? '' };
    const release = hold(k);
    active.set(k, op);
    log(`[op] start ${op.label || '-'}`);
    try {
      return await fn(op);
    } finally {
      if (active.get(k) === op) active.delete(k);
      release();
      log(`[op] end ${op.label || '-'}`);
    }
  }

  return { hold, holdPromise, isBusy, isBusyAnywhere, withLock };
}
