import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Sample {
  t: number;
  rsrp?: number;
  sinr?: number;
  band?: string;
  down?: number;
  up?: number;
}

const KEY = (id: string) => `history:${id}`;
const MAX = 720;
const MIN_GAP_MS = 60_000;

let lastWrite: Record<string, number> = {};

export async function loadHistory(id: string): Promise<Sample[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as Sample[]) : [];
  } catch {
    return [];
  }
}

export async function addSample(id: string, s: Omit<Sample, 't'>): Promise<void> {
  const now = Date.now();
  if (now - (lastWrite[id] ?? 0) < MIN_GAP_MS) return;
  lastWrite[id] = now;
  try {
    const list = await loadHistory(id);
    list.push({ ...s, t: now });
    const trimmed = list.slice(-MAX);
    await AsyncStorage.setItem(KEY(id), JSON.stringify(trimmed));
  } catch {}
}

export async function clearHistory(id: string): Promise<void> {
  try { await AsyncStorage.removeItem(KEY(id)); } catch {}
  delete lastWrite[id];
}

export function summarize(list: Sample[]) {
  const rs = list.map(s => s.rsrp).filter((n): n is number => n !== undefined);
  const ss = list.map(s => s.sinr).filter((n): n is number => n !== undefined);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const round = (v?: number) => (v === undefined ? undefined : Math.round(v * 10) / 10);
  const bands = new Map<string, number>();
  for (const s of list) {
    if (!s.band) continue;
    for (const b of s.band.split('+').map(x => x.trim()).filter(Boolean)) {
      bands.set(b, (bands.get(b) ?? 0) + 1);
    }
  }
  return {
    count: list.length,
    from: list[0]?.t,
    to: list[list.length - 1]?.t,
    rsrpAvg: round(avg(rs)),
    rsrpMin: rs.length ? Math.min(...rs) : undefined,
    rsrpMax: rs.length ? Math.max(...rs) : undefined,
    sinrAvg: round(avg(ss)),
    sinrMin: ss.length ? Math.min(...ss) : undefined,
    topBands: [...bands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
  };
}

/** استقرار الإشارة من 0 إلى 1 — كل ما قلّ التذبذب ارتفع الرقم */
export function stability(list: { rsrp?: number }[], window = 60): number | undefined {
  const rs = list.slice(-window).map(s => s.rsrp).filter((n): n is number => n !== undefined);
  if (rs.length < 4) return undefined;
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const varc = rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length;
  const sd = Math.sqrt(varc);
  return Math.max(0, Math.min(1, 1 - sd / 10));
}
