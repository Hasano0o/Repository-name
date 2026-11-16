/**
 * «باقتي» — الباقة اليدوية (١٦ نوفمبر، فكرة حسن): العضو يكتب حجم باقته ومدتها ويوم اشتراكه،
 * والاستهلاك يتحسب من سجل الاستهلاك اليومي (عدّاد الراوتر — src/utils/usageDays.ts). صافية ومختبرة.
 *  • التجديد تلقائي: بعد ما تخلص المدة تبدأ دورة جديدة من يوم التجديد (لين يعدّلها أو يحذفها).
 *  • أول يوم: نخصم اللي كان مستهلك اليوم قبل ما يضيف الباقة (baseline) — عشان ما نحسب استهلاك قبل الاشتراك.
 *  • الحساب من عدّاد الراوتر مو من الشركة — ممكن يختلف شوي عن رقمها.
 */
import { UsageLog, dayKey } from './usageDays';

/** جيجا الشركات = مليار بايت (نفس fmtBytes) — 1024³ كان يطلّع «باقي 10.74 GB» من باقة 10 */
export const GB = 1e9;
const DAY = 86_400_000;

export interface ManualPlan {
  /** الحجم بالجيجا */
  sizeGB: number;
  /** مدة الدورة بالأيام (٧ أسبوع · ٣٠ شهر · ٩٠ ثلاث شهور) */
  days: number;
  /** بداية أول دورة (منتصف ليل يوم الاشتراك) */
  start: number;
  /** استهلاك يوم البداية قبل ما ينضاف (بايت) — ينخصم من الدورة الأولى بس */
  baseBytes?: number;
  /** آخر تنبيه أرسلناه في الدورة الحالية (80/95/100) ومتى بدأت دورته */
  alert?: { cycle: number; at: number };
}

export function dayStart(t: number): number {
  const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime();
}
/** نضيف أيام بالتقويم (يتحمّل تغيير التوقيت) */
export function addDays(t: number, n: number): number {
  const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime();
}

/** الدورة الحالية: [بداية، نهاية) + رقمها (٠ = الأولى) */
export function cycleOf(p: ManualPlan, now: number): { start: number; end: number; n: number } {
  const len = Math.max(1, Math.round(p.days));
  let n = 0, s = dayStart(p.start);
  if (now >= s) n = Math.floor((dayStart(now) - s) / (len * DAY) + 1e-9);
  // تصحيح بالتقويم (أيام التوقيت الصيفي) — نمشي لين نوصل الدورة اللي فيها اليوم
  s = addDays(dayStart(p.start), n * len);
  while (addDays(s, len) <= now) { n++; s = addDays(s, len); }
  while (n > 0 && s > now) { n--; s = addDays(s, -len); }
  return { start: s, end: addDays(s, len), n };
}

export interface PlanStatus {
  used: number; total: number; left: number; pct: number;
  /** أيام باقية للتجديد (اليوم يحسب) */
  daysLeft: number;
  daysGone: number;
  /** متوسط الاستهلاك اليومي في الدورة */
  avg: number;
  /** بهالمعدل الباقة تخلص بعد كم يوم (undefined = ما نعرف / ما بتخلص) */
  runOutIn?: number;
  /** بتخلص قبل التجديد */
  early: boolean;
  /** فيه أيام بالدورة ما عندنا لها قراءة أو تقديرية */
  partial: boolean;
  renewAt: number;
  cycle: number;
}

export function planStatus(p: ManualPlan, log: UsageLog, now: number): PlanStatus {
  const { start, end, n } = cycleOf(p, now);
  const k0 = dayKey(start), kNow = dayKey(now);
  let used = 0, partial = false, known = 0;
  for (const [k, d] of Object.entries(log.days)) {
    if (k < k0 || k > kNow) continue;
    used += d.bytes; known++;
    if (d.est) partial = true;
  }
  if (n === 0 && p.baseBytes) used = Math.max(0, used - p.baseBytes);
  const total = Math.max(0, p.sizeGB) * GB;
  const daysGone = Math.max(1, Math.round((dayStart(now) - start) / DAY) + 1);
  if (known < daysGone) partial = true;
  const daysLeft = Math.max(0, Math.round((end - dayStart(now)) / DAY));
  const left = Math.max(0, total - used);
  const avg = used / daysGone;
  const runOutIn = avg > 0 && left > 0 ? Math.ceil(left / avg) : left <= 0 ? 0 : undefined;
  return {
    used, total, left, pct: total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0,
    daysLeft, daysGone, avg, runOutIn,
    early: runOutIn !== undefined && runOutIn < daysLeft,
    partial, renewAt: end, cycle: n,
  };
}

/** أعلى عتبة تنبيه وصلها (80/95/100) ولسا ما نبهنا عليها في هالدورة — null = لا شي جديد */
export function dueAlert(p: ManualPlan, st: PlanStatus): 80 | 95 | 100 | null {
  const th = st.pct >= 100 ? 100 : st.pct >= 95 ? 95 : st.pct >= 80 ? 80 : null;
  if (!th) return null;
  const last = p.alert && p.alert.cycle === st.cycle ? p.alert.at : 0;
  return th > last ? th : null;
}
