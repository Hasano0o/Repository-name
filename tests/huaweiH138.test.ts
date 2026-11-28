/** هواوي H138-380 (11.0.5.51، جهاز حسن ٢٨ نوفمبر): band = "20" رقم بس، و nrearfcn = «DL:0 UL:0» */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carriersFrom, nrChan } from '../src/drivers/huawei/carriers';

test('H138: band رقم بس ← الأساسي B20 يطلع', () => {
  const ca = carriersFrom('', { band: '20', pci: '199', rsrp: -91, rsrq: -14, sinr: 4, dlBandwidth: '20MHz' });
  assert.equal(ca.length, 1);
  assert.deepEqual([ca[0].role, ca[0].tech, ca[0].band, ca[0].pci, ca[0].rsrp], ['PCC', 'LTE', 20, '199', -91]);
});

test('band العادي ما تغيّر', () => {
  assert.deepEqual(carriersFrom('', { band: 'B3' }).map(c => c.band), [3]);
  assert.deepEqual(carriersFrom('', { band: '15MHz@124(B1) + 20MHz@1650(B3)' }).map(c => `${c.role}:${c.band}`), ['PCC:1', 'SCC:3']);
});

test('nrChan: «DL:0 UL:0» = فاضي', () => {
  assert.equal(nrChan('DL:0 UL:0'), undefined);
  assert.equal(nrChan('0'), undefined);
  assert.equal(nrChan(''), undefined);
  assert.equal(nrChan('DL:627264 UL:627264'), 'DL:627264 UL:627264');
  assert.equal(nrChan('627264'), '627264');
});
