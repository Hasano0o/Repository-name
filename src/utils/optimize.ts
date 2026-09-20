import { LatencyResult, gamingGrade } from './latency';

export type Tech = 'LTE' | 'NR';

export interface OptTarget { tech: Tech; band: number }

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

/** يبني قائمة المرشحين من الأبراج المرصودة + الترددات المدعومة */
export function buildCandidates(
  cellBands: OptTarget[],
  supported: number[],
  nrSupported: number[],
  max = 6,
): OptTarget[] {
  const seen = new Map<string, OptTarget>();
  for (const c of cellBands) seen.set(c.tech + c.band, c);
  for (const b of nrSupported) if (seen.size < max + 2) seen.set('NR' + b, { tech: 'NR', band: b });
  for (const b of supported) if (seen.size < max + 2) seen.set('LTE' + b, { tech: 'LTE', band: b });
  return [...seen.values()]
    .sort((a, b) => (a.tech === b.tech ? a.band - b.band : a.tech === 'NR' ? -1 : 1))
    .slice(0, max);
}
