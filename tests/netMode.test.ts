/** وضع الشبكة (٢١ نوفمبر): كانت ٤٥ ثانية لكل الراوترات ← نرجّع الوضع قبل ما هواوي/ZTE يكمّلون التسجيل */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const { modeWaitMs, leftLabel } = require('../src/utils/netMode');

test('المهلة حسب الراوتر (نفس مهل الإنقاذ)', () => {
  assert.equal(modeWaitMs('huawei-lte'), 120_000);
  assert.equal(modeWaitMs('hwgw'), 120_000);
  assert.equal(modeWaitMs('zte'), 240_000);
  assert.equal(modeWaitMs('zte-ng'), 240_000);
  assert.equal(modeWaitMs('zte-ufi'), 240_000);
  assert.equal(modeWaitMs('tplink-mr'), 90_000);
  assert.equal(modeWaitMs(undefined), 90_000);
  assert.ok(modeWaitMs('zte') > 45_000 && modeWaitMs('huawei-lte') > 45_000);
});

test('العدّاد', () => {
  assert.equal(leftLabel(90_000), '1:30');
  assert.equal(leftLabel(4_100), '0:05');
  assert.equal(leftLabel(-5), '0:00');
});
