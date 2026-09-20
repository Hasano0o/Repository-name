import AsyncStorage from '@react-native-async-storage/async-storage';
import { CellTower } from '../drivers/types';
import { bandFreq, nrFreq } from './bands';

/** ترددات منخفضة: تصل أبعد وتخترق الجدران لكن سعتها أقل */
const LOW_LTE = new Set([5, 8, 12, 13, 14, 17, 18, 19, 20, 26, 28, 71]);
const LOW_NR = new Set([5, 8, 20, 28, 71]);

export const isLowBand = (c: Pick<CellTower, 'tech' | 'band'>) =>
  !!c.band && (c.tech === 'NR' ? LOW_NR.has(c.band) : LOW_LTE.has(c.band));

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** جودة الإشارة ٠–١ من القوة والجودة والتشويش معاً — مو من القوة لحالها */
export function cellQuality(c: Pick<CellTower, 'rsrp' | 'rsrq' | 'sinr'>): number | undefined {
  const parts: [number, number][] = [];
  if (c.rsrp !== undefined) parts.push([clamp01((c.rsrp + 125) / 55), 0.4]);
  if (c.rsrq !== undefined) parts.push([clamp01((c.rsrq + 20) / 17), 0.3]);
  if (c.sinr !== undefined) parts.push([clamp01((c.sinr + 5) / 30), 0.3]);
  if (!parts.length) return undefined;
  const w = parts.reduce((a, [, x]) => a + x, 0);
  return parts.reduce((a, [v, x]) => a + v * x, 0) / w;
}

/** للترتيب والتوصية: الجودة × معامل السعة (الترددات المنخفضة أبطأ عادةً) */
export function rankScore(c: CellTower): number {
  const q = cellQuality(c) ?? 0;
  const cap = isLowBand(c) ? 0.8 : c.tech === 'NR' ? 1.05 : 1;
  return q * cap;
}

export type Grade = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';
export const GRADE_LABEL: Record<Grade, string> = {
  excellent: 'ممتاز', good: 'جيد', fair: 'مقبول', poor: 'ضعيف', unknown: 'غير معروف',
};
export const GRADE_COLOR: Record<Grade, string> = {
  excellent: '#12b76a', good: '#5ba644', fair: '#f79009', poor: '#e5484d', unknown: '#9aa1bd',
};
export function grade(q?: number): Grade {
  if (q === undefined) return 'unknown';
  if (q >= 0.7) return 'excellent';
  if (q >= 0.5) return 'good';
  if (q >= 0.32) return 'fair';
  return 'poor';
}

export const bandName = (c: Pick<CellTower, 'tech' | 'band'>) =>
  c.band ? (c.tech === 'NR' ? `n${c.band}` : `B${c.band}`) : c.tech === 'NR' ? '5G' : '4G';

export const freqName = (c: Pick<CellTower, 'tech' | 'band'>) =>
  c.band ? (c.tech === 'NR' ? nrFreq(c.band) : bandFreq(c.band)).replace(' MHz', '') : '';

export type CaBadge = 'active' | 'confirmed' | 'likely' | 'single';

export interface TowerGroup {
  key: string;
  tech: 'LTE' | 'NR';
  pci?: string;
  cells: CellTower[];
  best: CellTower;
  inUse: boolean;
  role: 'primary' | 'helper' | 'neighbor';
  freqCount: number;
  badge: CaBadge;
  score: number;
}

const gKey = (c: CellTower) => `${c.tech}:${c.pci ?? `?${c.arfcn ?? c.band ?? ''}`}`;
const fKey = (c: CellTower) => `${c.arfcn ?? ''}|${c.band ?? ''}`;

/**
 * يجمّع الخلايا في أبراج: نفس رقم PCI على ترددات مختلفة = غالباً نفس البرج.
 * confirmed = أبراج شفنا الراوتر يدمج عليها من قبل (محفوظة).
 */
export function groupTowers(cells: CellTower[], confirmed: Set<string>): TowerGroup[] {
  const aggregating = cells.some(c => c.kind === 'secondary');
  const map = new Map<string, CellTower[]>();
  for (const c of cells) {
    const k = gKey(c);
    const arr = map.get(k) ?? [];
    // نفس الخلية تظهر أحياناً في قسمين (مدمجة ومجاورة) — نبقي نسخة وحدة بأولوية الاستخدام
    const dup = arr.findIndex(x => fKey(x) === fKey(c));
    const rank = (x: CellTower) => (x.kind === 'serving' ? 0 : x.kind === 'secondary' ? 1 : 2);
    if (dup >= 0) {
      if (rank(c) < rank(arr[dup])) arr[dup] = c;
    } else {
      arr.push(c);
    }
    map.set(k, arr);
  }

  const out: TowerGroup[] = [];
  for (const [key, list] of map) {
    const sorted = [...list].sort((a, b) => {
      const r = (x: CellTower) => (x.kind === 'serving' ? 0 : x.kind === 'secondary' ? 1 : 2);
      return r(a) - r(b) || rankScore(b) - rankScore(a);
    });
    const best = [...list].sort((a, b) => rankScore(b) - rankScore(a))[0];
    const hasServing = list.some(c => c.kind === 'serving');
    const hasHelper = list.some(c => c.kind === 'secondary');
    const inUse = hasServing || hasHelper;
    const freqCount = new Set(list.map(fKey)).size;
    const badge: CaBadge = inUse && aggregating
      ? 'active'
      : confirmed.has(key)
        ? 'confirmed'
        : freqCount >= 2 ? 'likely' : 'single';
    out.push({
      key,
      tech: list[0].tech,
      pci: list[0].pci,
      cells: sorted,
      best,
      inUse,
      role: hasServing ? 'primary' : hasHelper ? 'helper' : 'neighbor',
      freqCount,
      badge,
      score: Math.max(...list.map(rankScore)),
    });
  }

  return out.sort((a, b) => {
    const r = (g: TowerGroup) => (g.role === 'primary' ? 0 : g.role === 'helper' ? 1 : 2);
    return r(a) - r(b) || b.score - a.score;
  });
}

export const BADGE_LABEL: Record<CaBadge, string> = {
  active: '✅ مدموج الآن',
  confirmed: '✅ دمج مؤكد',
  likely: '🔗 يدعم الدمج غالباً',
  single: '◻️ تردد واحد',
};

// ─── ذاكرة الأبراج اللي شفنا الدمج عليها ───

const caKey = (routerId: string) => `ca-towers:${routerId}`;

export async function loadConfirmed(routerId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(caKey(routerId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** يحفظ الأبراج اللي عليها دمج فعلي الحين */
export async function rememberActive(routerId: string, cells: CellTower[], known: Set<string>): Promise<Set<string>> {
  if (!cells.some(c => c.kind === 'secondary')) return known;
  const now = new Set(known);
  for (const c of cells) if (c.kind !== 'neighbor') now.add(gKey(c));
  if (now.size !== known.size) {
    try { await AsyncStorage.setItem(caKey(routerId), JSON.stringify([...now].slice(-200))); } catch {}
  }
  return now;
}
