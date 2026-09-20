import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * تقدير زحمة البرج من RSRQ:
 * البرج الفاضي يعطي RSRQ قريب من ‎-3، والمليان تماماً ينزل لحوالي ‎-11 (مع إشارة نظيفة).
 * يصلح فقط لما SINR كويس — لو فيه تشويش، RSRQ ينزل بسبب التشويش مو الزحمة.
 */
export function estimateLoad(rsrq?: number, sinr?: number): number | undefined {
  if (rsrq === undefined || sinr === undefined || sinr < 3) return undefined;
  const EMPTY = -3.5;
  const FULL = -11;
  const x = (EMPTY - rsrq) / (EMPTY - FULL);
  return Math.max(0, Math.min(1, x));
}

export type LoadLevel = 'free' | 'normal' | 'busy' | 'packed';
export const LOAD_LABEL: Record<LoadLevel, string> = { free: 'فاضي', normal: 'طبيعي', busy: 'مزحوم', packed: 'مزحوم جداً' };
export const LOAD_COLOR: Record<LoadLevel, string> = { free: '#12b76a', normal: '#5ba644', busy: '#f79009', packed: '#e5484d' };
export const loadLevel = (x: number): LoadLevel => (x < 0.35 ? 'free' : x < 0.6 ? 'normal' : x < 0.85 ? 'busy' : 'packed');

// ─── السجل حسب الساعة ───

export interface LoadSample { t: number; load: number; pci?: string }
const key = (id: string) => `load:${id}`;
const EVERY = 4 * 60 * 1000; // عينة كل ٤ دقائق كحد أقصى
const KEEP_DAYS = 14;

export async function loadSamples(routerId: string): Promise<LoadSample[]> {
  try {
    const raw = await AsyncStorage.getItem(key(routerId));
    return raw ? (JSON.parse(raw) as LoadSample[]) : [];
  } catch {
    return [];
  }
}

/** يسجّل عينة لو مر وقت كافي على آخر وحدة — يرجع القائمة المحدّثة */
export async function recordLoad(routerId: string, s: LoadSample, list?: LoadSample[]): Promise<LoadSample[]> {
  const cur = list ?? await loadSamples(routerId);
  const last = cur[cur.length - 1];
  if (last && s.t - last.t < EVERY) return cur;
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const next = [...cur.filter(x => x.t >= cutoff), s].slice(-3000);
  try { await AsyncStorage.setItem(key(routerId), JSON.stringify(next)); } catch {}
  return next;
}

/** متوسط الزحمة لكل ساعة (٠–٢٣) — undefined للساعة اللي ما فيها عينات */
export function hourlyProfile(list: LoadSample[]): { avg: (number | undefined)[]; count: number[] } {
  const sum = Array(24).fill(0);
  const count = Array(24).fill(0);
  for (const s of list) {
    const h = new Date(s.t).getHours();
    sum[h] += s.load;
    count[h] += 1;
  }
  return { avg: sum.map((v, i) => (count[i] ? v / count[i] : undefined)), count };
}

const hourName = (h: number) => {
  const hh = h % 12 === 0 ? 12 : h % 12;
  const part = h < 3 ? 'الليل' : h < 5 ? 'الفجر' : h < 12 ? 'الصبح' : h < 16 ? 'الظهر' : h < 19 ? 'العصر' : 'الليل';
  return `${hh} ${part}`;
};

/** جملة عن أوقات الزحمة — تحتاج عينات كافية */
export function peakSentence(list: LoadSample[]): string | undefined {
  const { avg, count } = hourlyProfile(list);
  const covered = count.filter(c => c > 0).length;
  if (list.length < 12 || covered < 4) return undefined;
  // أطول فترة زحمة متصلة (الساعات بدون قياس ما تقطعها، وتلف بعد منتصف الليل)
  let best: [number, number] | null = null;
  let start = -1;
  let end = -1;
  for (let k = 0; k < 48; k++) {
    const h = k % 24;
    const v = avg[h];
    if (v === undefined) continue;
    if (v >= 0.6) {
      if (start < 0) start = k;
      end = k;
    } else if (start >= 0) {
      if (end - start < 24 && (!best || end - start > best[1] - best[0])) best = [start, end];
      start = -1;
    }
  }
  if (start >= 0 && end - start < 24 && (!best || end - start > best[1] - best[0])) best = [start, end];
  const quiet = avg
    .map((v, h) => ({ v, h }))
    .filter((x): x is { v: number; h: number } => x.v !== undefined)
    .sort((a, b) => a.v - b.v)[0];
  const parts: string[] = [];
  if (best) parts.push(`البرج يزدحم من ${hourName(best[0] % 24)} لين ${hourName((best[1] + 1) % 24)}`);
  if (quiet && quiet.v < 0.45) parts.push(`${best ? 'و' : ''}أفضل وقت للتحميل الثقيل حوالي ${hourName(quiet.h)}`);
  return parts.length ? parts.join('، ') + '.' : 'ما لاحظنا أوقات زحمة واضحة للحين.';
}
