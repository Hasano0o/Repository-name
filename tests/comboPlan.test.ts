import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboPlan } from '../src/utils/comboPlan';

const base = { extra: [] as number[], supported: [1, 3, 7, 8, 20, 28, 40], bandRoles: true, nr: [] as number[], nrPrimary: null };

test('«أي ثانوي»: B1 أساسي + كل الباقي ثانوي بس (الدمج مفتوح)', () => {
  const p = comboPlan({ ...base, primary: 1, auto: true });
  assert.deepEqual(p.lte, [1, 3, 7, 8, 20, 28, 40]);
  assert.deepEqual(p.roles, { lteScell: [3, 7, 8, 20, 28, 40] });
});

test('بدون «أي ثانوي» وبدون إضافي ← الأساسي لحاله (مثل قبل)', () => {
  const p = comboPlan({ ...base, primary: 1, auto: false });
  assert.deepEqual(p.lte, [1]);
  assert.deepEqual(p.roles, { lteScell: [] });
});

test('راوتر بدون أدوار: «أي ثانوي» ما ينطبق', () => {
  const p = comboPlan({ ...base, bandRoles: false, primary: 3, auto: true, extra: [1] });
  assert.deepEqual(p.lte, [3, 1]);
  assert.equal(p.roles, undefined);
});

test('أساسي 5G: n78 ⭐ + n41 ثانوي بس', () => {
  const p = comboPlan({ ...base, primary: 1, auto: true, nr: [41, 78], nrPrimary: 78 });
  assert.equal(p.nrPrimary, 78);
  assert.deepEqual(p.roles?.nrScell, [41]);
  // تردد 5G واحد / أساسي مو من المختارة ← بدون أدوار 5G
  assert.equal(comboPlan({ ...base, primary: 1, auto: true, nr: [78], nrPrimary: 78 }).nrPrimary, null);
  assert.equal(comboPlan({ ...base, primary: 1, auto: true, nr: [41, 78], nrPrimary: 1 }).roles?.nrScell, undefined);
});
