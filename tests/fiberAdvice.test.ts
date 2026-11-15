import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviseFiber, fiberLevel, usualRx, addFiberSample } from '../src/utils/fiberAdvice';

test('مستشار الفايبر: التقييم والنصيحة', () => {
  assert.equal(fiberLevel(-17), 'excellent');
  assert.equal(fiberLevel(-22.44), 'good');
  assert.equal(fiberLevel(-25), 'fair');
  assert.equal(fiberLevel(-28), 'poor');
  assert.equal(fiberLevel(-6), 'poor');
  assert.equal(adviseFiber(-22.44, 2.31).title, 'الفايبر جيد');
  assert.equal(adviseFiber(-28, 2).title, 'الخط فيه عطل');
  assert.equal(adviseFiber(undefined, undefined).title, 'ما فيه قراءة ضوء');
});

test('مستشار الفايبر: النزول المفاجئ عن المعتاد', () => {
  const now = 1_800_000_000_000;
  const hist = [-19, -19.2, -18.8, -19.1].map((rx, i) => ({ t: now - (4 - i) * 3600e3, rx }));
  assert.equal(usualRx(hist, now), -19.05);
  const a = adviseFiber(-23, 2, hist, now);
  assert.equal(a.drop, 4);
  assert.match(a.title, /نزل 4 dB/);
  assert.equal(adviseFiber(-20, 2, hist, now).drop, undefined);
  // قراءة وحدة كل ١٠ دقايق
  assert.equal(addFiberSample(hist, -19, hist[3].t + 60_000).length, 4);
  assert.equal(addFiberSample(hist, -19, now).length, 5);
});
