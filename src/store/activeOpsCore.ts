/**
 * «العملية الحالية» — اقتراح عضو (٧ نوفمبر): يكون على عملية (تجربة تركيبات، بحث أبراج…) والشاشة تقفل أو يطلع
 * «حدّث الحين»، يرجع والعملية اختفت وهي تكمّل بالخلفية — وما يقدر يرجع لها ولا يشوف نتيجتها.
 * هنا نتتبع العمليات (من نفس طبقة الحجز withRouterLock) + المكان اللي بدأت منه + آخر نتيجة،
 * وزر عائم (OpPill) يرجّعه لها. بدون react-native عشان ينختبر.
 */
export interface OpInfo {
  id: number;
  label: string;
  /** المسار اللي بدأت منه (/towers/abc) — الزر يرجع له */
  route: string;
  startedAt: number;
}
export interface OpResult extends OpInfo {
  ok: boolean;
  /** نص الخطأ المختصر لو فشلت */
  msg?: string;
  endedAt: number;
  /** انقطعت: التطبيق تحدّث أو انقفل وهي شغالة (نعرفها من العلامة المحفوظة عند الإقلاع) */
  interrupted?: boolean;
  seen?: boolean;
}
export interface OpStore {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
  remove(k: string): Promise<void>;
}
const RUN_KEY = 'bandly.op.running';
const LAST_KEY = 'bandly.op.last';
/** النتيجة تبقى ظاهرة هالمدة */
export const RESULT_TTL = 20 * 60_000;

export function createActiveOps(store: OpStore, now: () => number = () => Date.now()) {
  let seq = 0;
  let route = '/';
  const running = new Map<number, OpInfo>();
  let last: OpResult | null = null;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach(f => { try { f(); } catch {} });
  const save = () => {
    const r = [...running.values()][0];
    (r ? store.set(RUN_KEY, JSON.stringify(r)) : store.remove(RUN_KEY)).catch(() => {});
  };

  return {
    setRoute(p: string) { route = p || '/'; },
    begin(label: string): (res: { ok: boolean; msg?: string }) => void {
      const op: OpInfo = { id: ++seq, label, route, startedAt: now() };
      running.set(op.id, op);
      save();
      emit();
      let done = false;
      return ({ ok, msg }) => {
        if (done) return;
        done = true;
        running.delete(op.id);
        last = { ...op, ok, msg: msg ? msg.replace(/\s+/g, ' ').slice(0, 140) : undefined, endedAt: now() };
        store.set(LAST_KEY, JSON.stringify(last)).catch(() => {});
        save();
        emit();
      };
    },
    /** عند الإقلاع: عملية محفوظة «شغالة» = انقطعت (التطبيق انقفل/تحدّث في النص) */
    async restore(): Promise<void> {
      try {
        const r = await store.get(RUN_KEY);
        if (r && !running.size) {
          const op = JSON.parse(r) as OpInfo;
          last = { ...op, ok: false, interrupted: true, endedAt: now() };
          await store.remove(RUN_KEY);
          await store.set(LAST_KEY, JSON.stringify(last));
        } else if (!last) {
          const l = await store.get(LAST_KEY);
          if (l) last = JSON.parse(l) as OpResult;
        }
      } catch {}
      emit();
    },
    current: (): OpInfo | null => [...running.values()][0] ?? null,
    isRunning: () => running.size > 0,
    /** آخر نتيجة لسا ما شافها ولسا جديدة */
    lastResult: (): OpResult | null => (last && !last.seen && now() - last.endedAt < RESULT_TTL ? last : null),
    markSeen() {
      if (!last || last.seen) return;
      last = { ...last, seen: true };
      store.set(LAST_KEY, JSON.stringify(last)).catch(() => {});
      emit();
    },
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  };
}
export type ActiveOps = ReturnType<typeof createActiveOps>;

/** الزر يطلع؟ — العملية شغالة وهو بشاشة ثانية · أو خلصت/انقطعت وما شافها وهو مو بشاشتها */
export function pillFor(ops: ActiveOps, path: string): { kind: 'running' | 'done' | 'failed' | 'interrupted'; op: OpInfo | OpResult } | null {
  const cur = ops.current();
  if (cur) return cur.route !== path ? { kind: 'running', op: cur } : null;
  const r = ops.lastResult();
  if (!r) return null;
  if (r.route === path && !r.interrupted) return null;
  return { kind: r.interrupted ? 'interrupted' : r.ok ? 'done' : 'failed', op: r };
}
