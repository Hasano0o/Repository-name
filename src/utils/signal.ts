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

// ═══ مصدر واحد للتقييم في كل التطبيق ═══
// كل شاشة (الرئيسية، الأبراج، الأنتنا، التوجيه، التقرير...) تستخدم هذي الدوال فقط،
// عشان نفس الإشارة تاخذ نفس التقييم في كل مكان.

/** تقييم كل مؤشر لحاله (جداول LTE المعتمدة) */
export const rsrpLevel = (v?: number) => grade(v, -80, -90, -100);
export const rsrqLevel = (v?: number) => grade(v, -10, -15, -20);
export const sinrLevel = (v?: number) => grade(v, 20, 13, 0);
export const rssiLevel = (v?: number) => grade(v, -65, -75, -85);

export const nrBands = (b?: string) => parseBands(b).filter(x => x.startsWith('n'));

type Reading = { rsrp?: number; rsrq?: number; sinr?: number } | null | undefined;

/** درجة الاتصال ٠–١: القوة (RSRP) + النظافة (SINR) + الجودة (RSRQ إن وجدت) — الأضعف يوزن أكثر */
export function signalScore(s?: Reading): number {
  if (!s) return 0;
  const parts: number[] = [];
  if (s.rsrp !== undefined) parts.push(clamp((s.rsrp + 120) / 45));
  if (s.sinr !== undefined) parts.push(clamp((s.sinr + 5) / 25));
  if (s.rsrq !== undefined) parts.push(clamp((s.rsrq + 20) / 12));
  if (!parts.length) return 0;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.min(...parts) * 0.6 + avg * 0.4;
}

/** تحويل الدرجة لمستوى — نفس الحدود للرقم (٠–١٠٠) والكلمة */
export function scoreLevel(score: number): Level {
  if (score >= 0.8) return 'excellent';
  if (score >= 0.6) return 'good';
  if (score >= 0.4) return 'fair';
  return 'poor';
}

/** التقييم العام للاتصال أو لأي برج */
export function overallLevel(s?: Reading): Level {
  if (!s || (s.rsrp === undefined && s.sinr === undefined)) return 'unknown';
  return scoreLevel(signalScore(s));
}

/** ترددات 5G من حقل قد يجي بدون حرف n (مثل "78" أو "n78" أو "n41+n78") */
export function parseNrBands(nrBand?: string): string[] {
  if (!nrBand) return [];
  const found = [...String(nrBand).matchAll(/n?(\d+)/gi)].map(m => `n${m[1]}`);
  return [...new Set(found)];
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
