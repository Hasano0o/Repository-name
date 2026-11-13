/** «دمج 4G + 5G» — اختيار العضو وعرض النواقل (src/utils/nsaPick.ts) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const { squashBands, manualCombos } = require('../src/utils/nsaPick');

test('B3 + B3 + n78 ← B3×2 + n78 (صورة عضو ١٣ نوفمبر)', () => {
  assert.equal(squashBands('B3 + B3 + n78'), 'B3×2 + n78');
  assert.equal(squashBands('B3 + B1 + n78'), 'B3 + B1 + n78');
  assert.equal(squashBands('B3+B3+B3'), 'B3×3');
  assert.equal(squashBands('—'), '—');
});

test('اختيار العضو: كل 5G مع كل الـ4G المختارة، وبدون واحد منهم ما فيه تركيبة', () => {
  assert.deepEqual(manualCombos([3], [78, 41]), [{ lte: [3], nr: [41] }, { lte: [3], nr: [78] }]);
  assert.deepEqual(manualCombos([3, 1], [78]), [{ lte: [1, 3], nr: [78] }]);
  assert.deepEqual(manualCombos([], [78]), []);
  assert.deepEqual(manualCombos([3], []), []);
  assert.equal(manualCombos([3], [1, 3, 5, 8, 28, 41, 77, 78]).length, 6);
});
