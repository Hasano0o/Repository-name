/** إشارة كل ناقل ثانوي ZTE — صيغ حقيقية من تقارير ca-sig (٢٨ نوفمبر). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sccSigRows } from '../src/drivers/zte/caSig';

test('ZTE caSig: U50 Pro — ٣ نواقل بنفس الترتيب', () => {
  const r = sccSigRows('-104.9,-11.2,13.5,-73.7,0,2;-104.2,-12.5,12.6,-73.0,0,2;-111.7,-15.2,11.5,-76.6,0,2;');
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { rsrp: -104.9, rsrq: -11.2, sinr: 13.5, rssi: -73.7 });
  assert.equal(r[2].rsrp, -111.7);
});

test('ZTE caSig: فاضي أو قيم صفر ← بدون أرقام', () => {
  assert.deepEqual(sccSigRows(''), []);
  assert.deepEqual(sccSigRows(undefined), []);
  const r = sccSigRows('0,0,0,0,0,0;');
  assert.equal(r.length, 1);
  assert.equal(r[0].rsrp, undefined);
  assert.equal(r[0].sinr, undefined);
});
