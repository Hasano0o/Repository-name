/** سيرفر المسرّع يقيس نفس مناطق التطبيق — accel/regions.json لازم يطابق src/utils/latency.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const path = require('path');
const root = path.resolve(process.cwd());
const { regions } = require(path.join(root, 'accel/regions.cjs'));
const saved = require(path.join(root, 'accel/regions.json'));

test('accel/regions.json مطابق لمناطق التطبيق (لو فشل: node accel/regions.cjs > accel/regions.json)', () => {
  const now = regions();
  assert.ok(Object.keys(now).length >= 10);
  assert.deepEqual(saved, now);
});
