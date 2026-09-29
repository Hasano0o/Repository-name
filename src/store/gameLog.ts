import AsyncStorage from '@react-native-async-storage/async-storage';

/** سجل فحوصات اللعب — نبني منه «أفضل وقت للعب» */
export interface GameLogEntry {
  at: number;
  region: string;
  score: number;
  median: number;
  jitter: number;
  lossPct: number;
  /** وش كان الإعداد وقت القياس (مثل B3 أو «الوضع الحالي») */
  setup?: string;
}

const KEY = (routerId: string) => `bandly.gamelog.${routerId}`;
const MAX = 300;

export async function listGameLog(routerId: string): Promise<GameLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(routerId));
    const list = raw ? (JSON.parse(raw) as GameLogEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function addGameLog(routerId: string, e: GameLogEntry): Promise<void> {
  const list = await listGameLog(routerId);
  list.push(e);
  try {
    await AsyncStorage.setItem(KEY(routerId), JSON.stringify(list.slice(-MAX)));
  } catch {}
}

/** فترات اليوم بتوقيت الجوال */
export const PERIODS = [
  { id: 'morning', name: 'الصبح', from: 5, to: 12 },
  { id: 'noon', name: 'الظهر والعصر', from: 12, to: 18 },
  { id: 'evening', name: 'المغرب والعشاء', from: 18, to: 23 },
  { id: 'night', name: 'آخر الليل', from: 23, to: 5 },
] as const;

export interface PeriodStat {
  id: string;
  name: string;
  count: number;
  avgScore?: number;
  avgPing?: number;
  avgJitter?: number;
  bestSetup?: string;
}

function periodOf(h: number): string {
  for (const p of PERIODS) {
    if (p.from < p.to ? h >= p.from && h < p.to : h >= p.from || h < p.to) return p.id;
  }
  return 'night';
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined);

/** يرتب فترات اليوم حسب جودة اللعب في آخر 30 يوم */
export function periodStats(list: GameLogEntry[], region?: string): PeriodStat[] {
  const since = Date.now() - 30 * 86400000;
  const rows = list.filter(e => e.at >= since && (!region || e.region === region) && e.score > 0);
  return PERIODS.map(p => {
    const mine = rows.filter(e => periodOf(new Date(e.at).getHours()) === p.id);
    const bySetup = new Map<string, number[]>();
    for (const e of mine) {
      if (!e.setup) continue;
      bySetup.set(e.setup, [...(bySetup.get(e.setup) ?? []), e.score]);
    }
    let bestSetup: string | undefined;
    let bestAvg = -1;
    for (const [k, v] of bySetup) {
      const a = avg(v) ?? 0;
      if (a > bestAvg) { bestAvg = a; bestSetup = k; }
    }
    return {
      id: p.id,
      name: p.name,
      count: mine.length,
      avgScore: avg(mine.map(e => e.score)),
      avgPing: avg(mine.map(e => e.median)),
      avgJitter: avg(mine.map(e => e.jitter)),
      bestSetup: bySetup.size > 1 ? bestSetup : undefined,
    };
  });
}
