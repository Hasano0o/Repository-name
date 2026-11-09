import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huntTargets, huntStop, huntBest, huntHit, huntFastest, autoTarget, HuntTry } from '../src/utils/ipHunt';

const T = (n: number, median?: number, changed = true, loss = 0): HuntTry => ({ n, ip: `10.0.0.${n}`, median, loss, changed });

test('الأهداف: ٨٠٪ من الحالي + الثابتة الأقل منه', () => {
  assert.deepEqual(huntTargets(100), [40, 60, 80]);
  assert.deepEqual(huntTargets(90), [40, 60, 70, 80]);
  assert.deepEqual(huntTargets(undefined), [40, 60, 80]);
});

test('نوقف لما نوصل الهدف (والفقد أقل من ٢٠٪)', () => {
  assert.equal(huntStop([T(1, 90), T(2, 55)], 60, 8), 'hit');
  assert.equal(huntHit(T(1, 50, true, 30), 60), false);
  assert.equal(huntStop([T(1, 90)], 60, 8), null);
});

test('الشركة ترجّع نفس الآي بي مرتين ← stuck · خلصت المحاولات ← max', () => {
  assert.equal(huntStop([T(1, 90, false), T(2, 92, false)], 60, 8), 'stuck');
  assert.equal(huntStop([T(1, 90), T(2, 80), T(3, 70)], 60, 3), 'max');
});

test('أفضل محاولة', () => {
  assert.equal(huntBest([T(1, 90), T(2, 65), T(3, 80)])?.n, 2);
  assert.equal(huntBest([T(1, undefined)]), null);
});

test('ما قرينا الآي بي (changed غير معروف) ← مو «نفسه» وما يوقف stuck', () => {
  const u: HuntTry = { n: 3, loss: 0, median: 135 };
  assert.equal(huntStop([T(1, 150, false), u], 60, 8), null);
});

test('أسرع تنزيل بين المحاولات', () => {
  assert.equal(huntFastest([{ ...T(1, 90), down: 20 }, { ...T(2, 80), down: 45.5 }, T(3, 70)])?.n, 2);
  assert.equal(huntFastest([T(1, 90)]), null);
});

test('تلقائي: صورة العضو (الحين 156ms) ← يوقف على 135؟ لا (الهدف 125) · على 83 إيه', () => {
  const g = { auto: true as const, base: 156 };
  assert.equal(autoTarget(g), 125);
  assert.equal(huntHit(T(3, 135), g), false);
  assert.equal(huntStop([T(1, 155), T(2, 177), T(3, 135), T(4, 180), T(5, 164), T(6, 83)], g, 8), 'hit');
});

test('تلقائي مع السرعة: بنق أحسن بس السرعة نزلت كثير ← نكمّل', () => {
  const g = { auto: true as const, base: 100, baseDown: 50 };
  assert.equal(huntHit({ ...T(1, 70), down: 30 }, g), false);
  assert.equal(huntHit({ ...T(1, 70), down: 47 }, g), true);
  // بنق قليل أصلاً: الهدف ما يطلع فوق base-5
  assert.equal(autoTarget({ auto: true, base: 20 }), 15);
});
