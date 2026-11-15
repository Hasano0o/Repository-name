/** شريط الإشارة الضوئية في صفحة الفايبر */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiberPos, fiberAgo, FIBER_ZONES, FIBER_MIN, FIBER_MAX } from '../src/utils/fiberBar';

test('الشريط: المناطق متصلة من البداية للنهاية، والمؤشر محصور', () => {
  assert.equal(FIBER_ZONES[0].from, FIBER_MIN);
  assert.equal(FIBER_ZONES[FIBER_ZONES.length - 1].to, FIBER_MAX);
  for (let i = 1; i < FIBER_ZONES.length; i++) assert.equal(FIBER_ZONES[i].from, FIBER_ZONES[i - 1].to);
  assert.equal(fiberPos(-40), 0);
  assert.equal(fiberPos(0), 1);
  assert.ok(fiberPos(-18.4) > fiberPos(-24) && fiberPos(-18.4) < fiberPos(-8));
});

test('آخر تحديث', () => {
  const now = 1_000_000_000;
  assert.equal(fiberAgo(undefined, now), '—');
  assert.equal(fiberAgo(now - 10_000, now), 'الحين');
  assert.equal(fiberAgo(now - 60_000, now), 'منذ دقيقة');
  assert.equal(fiberAgo(now - 5 * 60_000, now), 'منذ 5 دقيقة');
  assert.equal(fiberAgo(now - 2 * 3600_000, now), 'منذ ساعتين');
});
