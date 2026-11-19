/**
 * حساب السرعة من القطع — صافي بدون fetch (له اختبارات في tests/speedCore.test.ts).
 *
 * كل قطعة تنزيل/رفع = {t0 بدايتها, t1 نهايتها, bytes}. نوزّع حجمها بالتساوي على مدتها
 * (بدل ما نحسبه كله لحظة ما تخلص) ← المنحنى ناعم وما فيه قفزات كاذبة.
 *
 * النتيجة مثل الاختبارات المعروفة (Ookla): نتجاهل الإحماء ونقسم القياس لنوافذ ١ ثانية
 * (كل ٢٥٠ms)، والرقم = الشريحة ٩٠٪ من سرعات النوافذ — يعني السرعة اللي خطك
 * يثبت عليها أغلب الوقت، بدون لحظات بداية الاتصال والتذبذب. ما يطلع أبداً أعلى من
 * أسرع نافذة حقيقية، ولا أقل من المتوسط.
 */
export interface Chunk { t0: number; t1: number; bytes: number }

/** ميقابت/ثانية في الفترة [from, to] من القطع */
export function windowMbps(chunks: Chunk[], from: number, to: number): number {
  if (to <= from) return 0;
  let b = 0;
  for (const c of chunks) {
    const d = c.t1 - c.t0;
    if (d <= 0) { if (c.t1 > from && c.t1 <= to) b += c.bytes; continue; }
    const ov = Math.min(to, c.t1) - Math.max(from, c.t0);
    if (ov > 0) b += c.bytes * (ov / d);
  }
  return (b * 8) / ((to - from) / 1000) / 1e6;
}

export interface FinalOpts { warmupMs: number; windowMs?: number; stepMs?: number; pct?: number }

/** الرقم النهائي: الشريحة pct من نوافذ ما بعد الإحماء (ومتوسط لو القياس قصير) */
export function finalMbps(chunks: Chunk[], start: number, o: FinalOpts): number {
  if (!chunks.length) return 0;
  const win = o.windowMs ?? 1000, step = o.stepMs ?? 250, pct = o.pct ?? 0.9;
  const end = Math.max(...chunks.map(c => c.t1));
  const from = start + o.warmupMs;
  const avg = end > from ? windowMbps(chunks, from, end) : windowMbps(chunks, start, end);
  const rates: number[] = [];
  for (let t = from + win; t <= end + 1e-9; t += step) rates.push(windowMbps(chunks, t - win, t));
  if (rates.length < 4) return Math.max(0, avg);
  rates.sort((a, b) => a - b);
  const p = rates[Math.min(rates.length - 1, Math.floor(pct * (rates.length - 1)))];
  return Math.max(0, avg, p);
}

/**
 * كم عامل نشغّل الحين: نبدأ بـ base، ولو السرعة عالية نزيد ٢ ٢ لين max
 * (الخطوط السريعة — 5G — ما تمتلي بأربع اتصالات).
 */
export function wantStreams(cur: number, mbps: number, kind: 'down' | 'up'): number {
  const max = kind === 'down' ? 8 : 6;
  const per = kind === 'down' ? 12 : 5; // فوق كذا لكل اتصال ← نزيد
  if (cur >= max) return cur;
  return mbps / cur > per ? Math.min(max, cur + 2) : cur;
}
