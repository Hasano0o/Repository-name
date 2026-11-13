/**
 * الاستهلاك اليومي والأسبوعي — من عدّاد الشهر حق الراوتر (أغلب الراوترات ما تعطي «اليوم» جاهز).
 * كل ما نقرأ العدّاد نحسب الفرق عن آخر قراءة ونوزّعه على الأيام اللي بينهم بالتناسب مع الوقت.
 * - العدّاد نقص (شهر جديد / تصفير من الراوتر) ← اللي بعد التصفير = القراءة نفسها.
 * - فجوة طويلة بين قراءتين (التطبيق ما انفتح) ← الأيام اللي فيها تقديرية (est) ونقولها للعضو.
 * صافية بدون react-native — مختبرة في tests/usageDays.test.ts.
 */

export interface UsageDay { bytes: number; est?: boolean }
export interface UsageLog {
  lastTotal?: number;
  lastAt?: number;
  /** مفتاح اليوم (YYYY-MM-DD بالتوقيت المحلي) ← الاستهلاك */
  days: Record<string, UsageDay>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** فجوة أطول من كذا = توزيعنا تقدير */
const EST_GAP = 3 * HOUR;
/** فجوة أطول من كذا = ما نوزّع (ما نعرف وش صار) — نبدأ من جديد */
const MAX_GAP = 10 * DAY;
const KEEP_DAYS = 40;

export function dayKey(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfNextDay(t: number): number {
  const d = new Date(t);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export function emptyLog(): UsageLog {
  return { days: {} };
}

/** يضيف قراءة جديدة للعدّاد (تنزيل + رفع بالبايت) ويرجع السجل الجديد */
export function addReading(log: UsageLog, total: number, at: number): UsageLog {
  if (!Number.isFinite(total) || total < 0) return log;
  const days = { ...log.days };
  const out: UsageLog = { lastTotal: total, lastAt: at, days };
  const { lastTotal, lastAt } = log;
  if (lastTotal === undefined || lastAt === undefined || at <= lastAt || at - lastAt > MAX_GAP) return prune(out, at);

  let delta = total - lastTotal;
  if (delta < 0) delta = total;           // تصفير — اللي بعده كله جديد

  const est = at - lastAt > EST_GAP;
  // نوزّع على الأيام بين القراءتين بالتناسب مع الوقت
  const span = at - lastAt;
  let t0 = lastAt;
  let given = 0;
  while (t0 < at) {
    const t1 = Math.min(startOfNextDay(t0), at);
    const part = t1 >= at ? delta - given : Math.round((delta * (t1 - t0)) / span);
    given += part;
    const k = dayKey(t0);
    const cur = days[k] ?? { bytes: 0 };
    days[k] = { bytes: cur.bytes + part, ...(cur.est || est ? { est: true } : {}) };
    t0 = t1;
  }
  return prune(out, at);
}

function prune(log: UsageLog, now: number): UsageLog {
  const oldest = dayKey(now - KEEP_DAYS * DAY);
  for (const k of Object.keys(log.days)) if (k < oldest) delete log.days[k];
  return log;
}

export interface UsageSummary {
  today: number;
  week: number;
  /** آخر ٧ أيام، الأقدم أول — اليوم آخر وحدة */
  last7: { key: string; bytes: number; est: boolean; known: boolean }[];
  /** متوسط اليوم على الأيام اللي عندنا لها قراءة (بدون اليوم لأنه ما خلص) */
  avg: number;
  /** فيه يوم من الأسبوع تقديري أو ناقص */
  partial: boolean;
  /** كم يوم عندنا له بيانات */
  daysKnown: number;
}

export function summarize(log: UsageLog, now: number): UsageSummary {
  const last7: UsageSummary['last7'] = [];
  for (let i = 6; i >= 0; i--) {
    const key = dayKey(now - i * DAY);
    const d = log.days[key];
    last7.push({ key, bytes: d?.bytes ?? 0, est: !!d?.est, known: !!d });
  }
  const today = last7[6].bytes;
  const week = last7.reduce((a, d) => a + d.bytes, 0);
  const full = last7.slice(0, 6).filter(d => d.known);
  const avg = full.length ? Math.round(full.reduce((a, d) => a + d.bytes, 0) / full.length) : 0;
  const daysKnown = last7.filter(d => d.known).length;
  const partial = last7.some(d => d.est) || daysKnown < 7;
  return { today, week, last7, avg, partial, daysKnown };
}
