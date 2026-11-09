import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huntTargets, huntStop, huntBest, huntHit, HuntTry } from '../src/utils/ipHunt';

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
