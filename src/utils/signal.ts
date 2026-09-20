import { Signal } from '../drivers/types';

export type Level = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export const LEVEL_COLOR: Record<Level, string> = {
  excellent: '#12b76a', good: '#5ba644', fair: '#f79009', poor: '#e5484d', unknown: '#9aa1bd',
};
export const LEVEL_SOFT: Record<Level, string> = {
  excellent: '#e8f8f0', good: '#eef7e8', fair: '#fff6e8', poor: '#ffeef0', unknown: '#f1f2f7',
};
export const LEVEL_LABEL: Record<Level, string> = {
  excellent: 'ممتاز', good: 'جيد', fair: 'متوسط', poor: 'ضعيف', unknown: 'غير معروف',
};

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const grade = (v: number | undefined, a: number, b: number, c: number): Level =>
  v === undefined ? 'unknown' : v >= a ? 'excellent' : v >= b ? 'good' : v >= c ? 'fair' : 'poor';

export const rsrpLevel = (v?: number) => grade(v, -80, -90, -100);
export const rsrqLevel = (v?: number) => grade(v, -10, -15, -20);
export const sinrLevel = (v?: number) => grade(v, 13, 5, 0);
export const rssiLevel = (v?: number) => grade(v, -65, -75, -85);

export const nrBands = (b?: string) => parseBands(b).filter(x => x.startsWith('n'));

const ORDER: Level[] = ['poor', 'fair', 'good', 'excellent'];

export function overallLevel(s?: Pick<Signal, 'rsrp' | 'sinr'> | null): Level {
  if (!s) return 'unknown';
  const ls = [rsrpLevel(s.rsrp), sinrLevel(s.sinr)].filter(l => l !== 'unknown');
  if (!ls.length) return 'unknown';
  return ls.reduce((a, b) => (ORDER.indexOf(a) < ORDER.indexOf(b) ? a : b));
}

export function signalScore(s?: Pick<Signal, 'rsrp' | 'sinr'> | null): number {
  if (!s) return 0;
  const parts: number[] = [];
  if (s.rsrp !== undefined) parts.push(clamp((s.rsrp + 120) / 45));
  if (s.sinr !== undefined) parts.push(clamp((s.sinr + 5) / 25));
  if (!parts.length) return 0;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.min(...parts) * 0.6 + avg * 0.4;
}

export function parseBands(band?: string): string[] {
  if (!band) return [];
  const lte = [...band.matchAll(/\bB(\d+)/gi)].map(m => `B${m[1]}`);
  const nr = [...band.matchAll(/\bn(\d+)/gi)].map(m => `n${m[1]}`);
  const found = [...lte, ...nr];
  if (found.length) return [...new Set(found)];
  const t = band.trim();
  return /^\d+$/.test(t) ? [`B${t}`] : [];
}
