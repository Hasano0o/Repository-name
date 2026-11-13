/** «أوقات الزحمة» — src/utils/rushHours.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const { rushReport, hourLabel } = require('../src/utils/rushHours');

const NOW = new Date(2026, 10, 14, 12, 0).getTime();
const at = (daysAgo: number, h: number) => new Date(2026, 10, 14 - daysAgo, h, 10).getTime();

function week(pingAt: (h: number) => number, hours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) {
  const out: any[] = [];
  for (let d = 1; d <= 3; d++) for (const h of hours) out.push({ at: at(d, h), region: 'ae', median: pingAt(h), jitter: 3, lossPct: 0 });
  return out;
}

test('الزحمة ٩–١١ م والأهدى الصبح، والارتفاع بالنسبة', () => {
  const r = rushReport(week(h => (h === 21 || h === 22 ? 90 : h <= 10 ? 40 : 50)), NOW, 'ae');
  // أول نافذة بأقل ضغط (٦–٨ ص)
  assert.ok(r.ready);
  assert.deepEqual([r.worst.from, r.worst.to], [21, 23]);
  assert.equal(r.worst.ping, 90);
  assert.equal(r.best.ping, 40);
  assert.equal(r.risePct, 125);
});

test('بيانات قليلة ← ما نحكم (ready=false) ونعطي العدّاد', () => {
  const r = rushReport(week(() => 50, [20, 21]), NOW, 'ae');
  assert.equal(r.ready, false);
  assert.equal(r.samples, 6);
  assert.equal(r.hoursCovered, 2);
  assert.equal(r.worst, undefined);
});

test('منطقة ثانية وقياسات أقدم من ١٤ يوم ما تدخل', () => {
  const l = [...week(() => 50), { at: at(20, 21), region: 'ae', median: 999, jitter: 0, lossPct: 0 }, { at: at(1, 21), region: 'eu', median: 999, jitter: 0, lossPct: 0 }];
  const r = rushReport(l, NOW, 'ae');
  assert.ok(r.hours.every((h: any) => (h.ping ?? 0) < 999));
});

test('قياس شاذ واحد ما يخرب الساعة (الوسيط)', () => {
  const l = week(() => 50);
  l.push({ at: at(1, 14), region: 'ae', median: 2000, jitter: 0, lossPct: 0 });
  const r = rushReport(l, NOW, 'ae');
  assert.equal(r.hours[14].ping, 50);
});

test('النافذة تلف حول منتصف الليل', () => {
  const hours = [0, 1, 2, 3, 4, 5, 6, 7, 8, 20, 21, 22, 23];
  const r = rushReport(week(h => (h === 23 || h === 0 ? 100 : 45), hours), NOW, 'ae');
  assert.ok(r.ready);
  assert.deepEqual([r.worst.from, r.worst.to], [23, 1]);
});

test('hourLabel', () => {
  assert.equal(hourLabel(0), '12 ص');
  assert.equal(hourLabel(9), '9 ص');
  assert.equal(hourLabel(12), '12 م');
  assert.equal(hourLabel(21), '9 م');
});
