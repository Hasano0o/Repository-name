/**
 * الاستهلاك اليومي والأسبوعي من عدّاد الشهر (اقتراح عضو ١٣ نوفمبر) — src/utils/usageDays.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
const { addReading, emptyLog, summarize, dayKey } = require('../src/utils/usageDays');

const GB = 1e9;
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();   // نوفمبر ٢٠٢٦ بالتوقيت المحلي

test('قراءات بنفس اليوم ← الفرق كله لليوم', () => {
  let l = emptyLog();
  l = addReading(l, 10 * GB, at(13, 8));
  l = addReading(l, 11 * GB, at(13, 9));
  l = addReading(l, 13 * GB, at(13, 20));
  const s = summarize(l, at(13, 21));
  assert.equal(s.today, 3 * GB);
  assert.equal(s.week, 3 * GB);
});

test('أول قراءة بس ← ما نعرف شي (ما نحسب العدّاد كله على اليوم)', () => {
  const l = addReading(emptyLog(), 50 * GB, at(13, 8));
  const s = summarize(l, at(13, 9));
  assert.equal(s.today, 0);
  assert.equal(s.daysKnown, 0);
});

test('فجوة عبر منتصف الليل ← نوزّع بالتناسب مع الوقت، ونعلّمها تقديرية', () => {
  let l = emptyLog();
  l = addReading(l, 0.5 * GB, at(12, 22));
  l = addReading(l, 4.5 * GB, at(13, 6));      // ٨ ساعات: ساعتين أمس + ٦ اليوم
  assert.equal(l.days[dayKey(at(12, 23))].bytes, 1 * GB);
  assert.equal(l.days[dayKey(at(13, 1))].bytes, 3 * GB);
  assert.ok(l.days[dayKey(at(13, 1))].est);
  const s = summarize(l, at(13, 7));
  assert.equal(s.week, 4 * GB);
  assert.ok(s.partial);
});

test('العدّاد تصفّر (شهر جديد) ← اللي بعد التصفير بس، بدون أرقام سالبة', () => {
  let l = emptyLog();
  l = addReading(l, 300 * GB, at(30, 23));
  l = addReading(l, 300.2 * GB, at(30, 23, 50));
  l = addReading(l, 0.3 * GB, at(31, 0, 30));    // ١ ديسمبر؟ (نوفمبر ٣٠ يوم ← يتحوّل لـ ١ ديسمبر)
  const vals = Object.values(l.days).map((d: any) => d.bytes);
  assert.ok(vals.every((b: number) => b >= 0));
  const total = vals.reduce((a: number, b: number) => a + b, 0);
  assert.ok(Math.abs(total - 0.5 * GB) < 1e6, String(total));
});

test('فجوة أطول من ١٠ أيام ← نبدأ من جديد بدون ما نوزّع شي', () => {
  let l = emptyLog();
  l = addReading(l, 1 * GB, at(1, 10));
  l = addReading(l, 80 * GB, at(13, 10));
  assert.equal(Object.keys(l.days).length, 0);
  l = addReading(l, 81 * GB, at(13, 11));
  assert.equal(summarize(l, at(13, 12)).today, 1 * GB);
});

test('آخر ٧ أيام: الترتيب والمتوسط (بدون اليوم لأنه ما خلص)', () => {
  let l = emptyLog();
  let t = 0;
  for (let d = 7; d <= 13; d++) {
    l = addReading(l, t, at(d, 0, 5));
    t += (d === 13 ? 1 : 2) * GB;
    l = addReading(l, t, at(d, 23, 55));
  }
  const s = summarize(l, at(13, 23, 58));
  assert.equal(s.last7.length, 7);
  assert.equal(s.last7[6].key, dayKey(at(13, 12)));
  assert.equal(s.today, 1 * GB);
  assert.ok(Math.abs(s.avg - 2 * GB) < 0.1 * GB, String(s.avg));   // فيه شوية من الفجوات الليلية بين ٢٣:٥٥ و ٠٠:٠٥
  assert.equal(s.daysKnown, 7);
});

test('قراءة أقدم من آخر وحدة (ساعة الجوال رجعت) ← نتجاهل التوزيع', () => {
  let l = emptyLog();
  l = addReading(l, 5 * GB, at(13, 10));
  l = addReading(l, 6 * GB, at(13, 9));
  assert.equal(Object.keys(l.days).length, 0);
});
