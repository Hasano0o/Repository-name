import AsyncStorage from '@react-native-async-storage/async-storage';
import { listGameLog, periodStats } from '../store/gameLog';
import { listLagSessions, CAUSE_TEXT, Cause } from './lagDetector';

/** ملخص أسبوعي من فحوصات اللعب وجلسات كاشف اللاق */
export interface Weekly {
  checks: number;
  avgScore?: number;
  prevScore?: number;
  avgPing?: number;
  avgJitter?: number;
  bestPeriod?: string;
  worstPeriod?: string;
  sessions: number;
  incidents: number;
  lagMins: number;
  topCause?: Cause;
}

const WEEK = 7 * 86400000;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined);

export async function buildWeekly(routerId: string): Promise<Weekly> {
  const now = Date.now();
  const log = (await listGameLog(routerId)).filter(e => e.score > 0);
  const week = log.filter(e => e.at >= now - WEEK);
  const prev = log.filter(e => e.at < now - WEEK && e.at >= now - 2 * WEEK);
  const periods = periodStats(week).filter(p => p.count >= 2 && p.avgScore !== undefined).sort((a, b) => b.avgScore! - a.avgScore!);

  const sessions = (await listLagSessions(routerId)).filter(s => s.startedAt >= now - WEEK);
  const causes: Partial<Record<Cause, number>> = {};
  let incidents = 0;
  let lagSecs = 0;
  for (const s of sessions) {
    incidents += s.incidents.length;
    lagSecs += s.lagSecs;
    for (const [c, n] of Object.entries(s.causes)) causes[c as Cause] = (causes[c as Cause] ?? 0) + (n ?? 0);
  }
  const topCause = (Object.keys(causes) as Cause[]).sort((a, b) => (causes[b] ?? 0) - (causes[a] ?? 0))[0];

  return {
    checks: week.length,
    avgScore: avg(week.map(e => e.score)),
    prevScore: avg(prev.map(e => e.score)),
    avgPing: avg(week.map(e => e.median)),
    avgJitter: avg(week.map(e => e.jitter)),
    bestPeriod: periods.length > 1 ? periods[0].name : undefined,
    worstPeriod: periods.length > 1 ? periods[periods.length - 1].name : undefined,
    sessions: sessions.length,
    incidents,
    lagMins: Math.round(lagSecs / 60),
    topCause,
  };
}

export function weeklyLines(w: Weekly): string[] {
  const out: string[] = [];
  if (w.avgScore !== undefined) {
    let trend = '';
    if (w.prevScore !== undefined) {
      const d = w.avgScore - w.prevScore;
      trend = d >= 5 ? ` (أحسن من الأسبوع اللي قبل بـ${d} 📈)` : d <= -5 ? ` (أسوأ من الأسبوع اللي قبل بـ${-d} 📉)` : ' (نفس الأسبوع اللي قبل)';
    }
    out.push(`درجة اللعب: ${w.avgScore}/100${trend}`);
  }
  if (w.avgPing !== undefined) out.push(`البنق ${w.avgPing}ms والتذبذب ${w.avgJitter}ms بالمتوسط`);
  if (w.bestPeriod && w.worstPeriod) out.push(`أفضل وقت: ${w.bestPeriod} · أسوأ وقت: ${w.worstPeriod}`);
  if (w.sessions) {
    out.push(`${w.sessions} جلسة لعب انراقبت · ${w.incidents} حادثة لاق${w.lagMins ? ` (${w.lagMins} دقيقة)` : ''}`);
    if (w.topCause) out.push(`أكثر سبب: ${CAUSE_TEXT[w.topCause].title}`);
  }
  return out;
}

/* ═══ إشعار أسبوعي — يطلع مرة بالأسبوع لو فيه بيانات ═══ */
const SENT_KEY = (id: string) => `bandly.weekly.sent.${id}`;

export async function weeklyDue(routerId: string): Promise<boolean> {
  try {
    const v = Number(await AsyncStorage.getItem(SENT_KEY(routerId)) ?? 0);
    return Date.now() - v >= WEEK - 3600000;
  } catch {
    return false;
  }
}

export async function markWeeklySent(routerId: string): Promise<void> {
  try { await AsyncStorage.setItem(SENT_KEY(routerId), String(Date.now())); } catch {}
}
