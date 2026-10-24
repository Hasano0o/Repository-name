import { LatencyResult, gamingGrade } from './latency';

export type Tech = 'LTE' | 'NR';

/** combo: دمج أكثر من تردد (4G مع 4G، ومعها 5G) — band = أول تردد للعرض */
export interface OptTarget { tech: Tech; band: number; lte?: number[]; nr?: number[] }

/** اسم المرشّح: B3 / n78 / B1+B3+n78 */
export function targetName(t: OptTarget): string {
  if (t.lte || t.nr) return [...(t.lte ?? []).map(b => 'B' + b), ...(t.nr ?? []).map(b => 'n' + b)].join('+');
  return (t.tech === 'NR' ? 'n' : 'B') + t.band;
}
export const targetKey = (t: OptTarget) => (t.lte || t.nr ? 'C' + targetName(t) : t.tech + t.band);

// الأهم بالسعودية أول: n78 هو 5G الأساسي عند STC/زين/موبايلي
const NR_PRI = [78, 41, 28, 77, 1, 3, 8, 40, 7, 20, 79];
const LTE_PRI = [3, 1, 28, 8, 20, 7, 40, 38, 41];
const byPri = (pri: number[]) => (a: number, b: number) =>
  (pri.includes(a) ? pri.indexOf(a) : 99) - (pri.includes(b) ? pri.indexOf(b) : 99) || a - b;

export interface OptRow extends OptTarget {
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;
  rsrp?: number;
  sinr?: number;
  latency?: LatencyResult;
  score?: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** درجة من 0 إلى 1: 40% قوة، 30% نقاء، 30% استجابة */
export function totalScore(rsrp?: number, sinr?: number, lat?: LatencyResult): number {
  const p = rsrp === undefined ? 0.35 : clamp01((rsrp + 120) / 45);
  const s = sinr === undefined ? 0.35 : clamp01((sinr + 5) / 30);
  const l = lat ? gamingGrade(lat).score : 0.35;
  return Math.round((p * 0.4 + s * 0.3 + l * 0.3) * 100) / 100;
}

export function scoreLabel(score: number): string {
  if (score >= 0.8) return 'ممتاز';
  if (score >= 0.62) return 'جيد جداً';
  if (score >= 0.45) return 'جيد';
  if (score >= 0.3) return 'مقبول';
  return 'ضعيف';
}

export function rankRows(rows: OptRow[]): OptRow[] {
  return rows
    .filter(r => r.status === 'done' && r.score !== undefined)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * يبني قائمة المرشحين: ترددات الأبراج اللي حولك أول، بعدها الأهم.
 * 5G بحد أقصى ٣ ومن قائمة الراوتر بس (لو نعرفها) — كانت تطلع n1/n3/n7 وتطير n78 من القائمة.
 */
export function buildCandidates(
  cellBands: OptTarget[],
  supported: number[],
  nrSupported: number[],
  max = 6,
): OptTarget[] {
  // 5G بس من قائمة الراوتر — لو فاضية (مثل H158: ما يقبل تثبيت 5G) ما نجرّب 5G أبد
  const nrOk = (b: number) => nrSupported.includes(b);
  const nrCells = cellBands.filter(c => c.tech === 'NR' && nrOk(c.band)).map(c => c.band);
  const nr = [...new Set([...nrCells, ...[...nrSupported].sort(byPri(NR_PRI))])].slice(0, Math.min(3, Math.max(1, max - 3)));
  const lteCells = cellBands.filter(c => c.tech === 'LTE').map(c => c.band);
  const lte = [...new Set([...lteCells, ...[...supported].sort(byPri(LTE_PRI))])].slice(0, Math.max(0, max - nr.length));
  return [
    ...lte.map(band => ({ tech: 'LTE' as Tech, band })),
    ...nr.map(band => ({ tech: 'NR' as Tech, band })),
  ];
}
