import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStatus, cycleOf, dueAlert, dayStart, addDays, GB, ManualPlan } from '../src/utils/manualPlan';
import { dayKey, UsageLog } from '../src/utils/usageDays';

const t0 = new Date(2026, 10, 1, 15, 0).getTime(); // ١ نوفمبر ٣ العصر
const logOf = (days: [number, number][]): UsageLog => ({ days: Object.fromEntries(days.map(([i, gb]) => [dayKey(addDays(dayStart(t0), i)), { bytes: gb * GB }])) });

test('باقتي: الاستهلاك من يوم الاشتراك مع خصم اللي قبله في نفس اليوم', () => {
  const p: ManualPlan = { sizeGB: 100, days: 30, start: dayStart(t0), baseBytes: 2 * GB };
  const log = logOf([[-1, 50], [0, 5], [1, 10], [2, 10]]);
  const st = planStatus(p, log, addDays(t0, 2));
  assert.equal(Math.round(st.used / GB), 23); // 5-2 + 10 + 10 (اليوم اللي قبل ما ينحسب)
  assert.equal(st.pct, 23);
  assert.equal(st.daysGone, 3);
  assert.equal(st.daysLeft, 28);
  assert.equal(Math.round(st.left / GB), 77);
  assert.equal(st.runOutIn, 11); // ~٧٫٧ جيجا باليوم ← ٧٧ تخلص بعد ١١ يوم (قبل التجديد)
  assert.ok(st.early);
});

test('باقتي: تخلص قبل التجديد بهالمعدل + تنبيهات ٨٠/٩٥/١٠٠ مرة لكل دورة', () => {
  const p: ManualPlan = { sizeGB: 50, days: 30, start: dayStart(t0) };
  const st = planStatus(p, logOf([[0, 15], [1, 15], [2, 12]]), addDays(t0, 2));
  assert.equal(st.pct, 84);
  assert.ok(st.early);
  assert.equal(dueAlert(p, st), 80);
  assert.equal(dueAlert({ ...p, alert: { cycle: 0, at: 80 } }, st), null);
  const full = planStatus(p, logOf([[0, 30], [1, 25]]), addDays(t0, 1));
  assert.equal(full.pct, 100);
  assert.equal(dueAlert({ ...p, alert: { cycle: 0, at: 80 } }, full), 100);
});

test('باقتي: التجديد التلقائي يبدأ دورة جديدة ويصفّر الاستهلاك والتنبيهات', () => {
  const p: ManualPlan = { sizeGB: 100, days: 7, start: dayStart(t0), baseBytes: 3 * GB, alert: { cycle: 0, at: 95 } };
  const c = cycleOf(p, addDays(t0, 8));
  assert.equal(c.n, 1);
  assert.equal(c.start, addDays(dayStart(t0), 7));
  const st = planStatus(p, logOf([[0, 40], [6, 40], [7, 4], [8, 6]]), addDays(t0, 8));
  assert.equal(Math.round(st.used / GB), 10); // الدورة الثانية بس، بدون baseBytes
  assert.equal(st.cycle, 1);
  assert.equal(dueAlert(p, { ...st, pct: 85 }), 80);
});
