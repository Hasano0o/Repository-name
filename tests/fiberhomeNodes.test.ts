import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNodeFile, missing, NEED, paths, RF_FIELDS, signalFrom, neighborsFrom, parseBands, joinBands, loginError, FH_TO_CODE, CODE_TO_FH } from '../src/drivers/fiberhome/nodes';

test('FiberHome: ملف الأسماء — نص، ونص + اسم، وأسماء معتمدة على أسماء بعدها، وبدون تنفيذ كود', () => {
  const n = parseNodeFile(`
    var x_NetworkSettings_obj = x_Root + "X_FH_MobileNetwork.NetworkSettings.", x_Root="InternetGatewayDevice.";
    x_NetworkSet_LTELockBAND='LTELockBAND';
    window.x_NetworkSet_NRLockBAND = "NRLockBAND";
    x_LockCellList_LockCell = "LockCell.";
    x_evil = alert(1);
  `);
  assert.equal(n.x_Root, 'InternetGatewayDevice.');
  assert.equal(n.x_NetworkSettings_obj, 'InternetGatewayDevice.X_FH_MobileNetwork.NetworkSettings.');
  assert.equal(n.x_NetworkSet_LTELockBAND, 'LTELockBAND');
  assert.equal(n.x_NetworkSet_NRLockBAND, 'NRLockBAND');
  assert.equal(n.x_evil, undefined);
  assert.deepEqual(missing(n, NEED.band), ['x_NetworkSet_LockBandEnable']);
});

test('FiberHome: مسارات الإشارة — الخانة اللي اسمها ناقص تنتخطى بدل ما يطيح الطلب', () => {
  const p = paths({ x_RadioSignalParameter_obj: 'R.', x_RadioSignal_RSRP: 'RSRP', x_RadioSignal_SINR: 'SINR' }, RF_FIELDS);
  assert.deepEqual(p, { RSRP: 'R.RSRP', SINR: 'R.SINR' });
});

test('FiberHome: الإشارة — NSA فيه 4G و5G، SA فيه 5G بس، LTE فيه 4G بس', () => {
  const nsa = signalFrom({ WorkMode: 'NSA', BAND: '3', PCI: '120', RSRP: '-95', SINR: '12', SSB_RSRP: '-88', SSB_SINR: '9', NR_BAND: '78', NR_PCI: '33' });
  assert.equal(nsa.network, '5G NSA');
  assert.equal(nsa.band, 'B3'); assert.equal(nsa.rsrp, -95);
  assert.equal(nsa.nrBand, 'n78'); assert.equal(nsa.nrRsrp, -88);
  const sa = signalFrom({ WorkMode: 'SA', RSRP: '-95', SSB_RSRP: '-80', NR_BAND: '78' });
  assert.equal(sa.rsrp, undefined); assert.equal(sa.nrRsrp, -80);
  const lte = signalFrom({ WorkMode: 'LTE', RSRP: '-100', SSB_RSRP: '-' });
  assert.equal(lte.network, '4G'); assert.equal(lte.nrRsrp, undefined);
  // قيم «-» أو خارج المعقول ما تنحسب
  assert.equal(signalFrom({ WorkMode: 'LTE', RSRP: '-' }).rsrp, undefined);
  assert.equal(signalFrom({ WorkMode: 'LTE', RSRP: '0' }).rsrp, undefined);
});

test('FiberHome: الجيران من القوائم المفصولة', () => {
  const n = neighborsFrom({ EARFCN_NBR: '1300,1850', PCI_NBR: '10,20', RSRP_NBR: '-101,-110', BAND_NBR: '3,3' });
  assert.equal(n.length, 2);
  assert.equal(n[1].pci, '20'); assert.equal(n[1].rsrp, -110); assert.equal(n[1].band, 3);
});

test('FiberHome: الترددات ووضع الشبكة والدخول', () => {
  assert.deepEqual(parseBands('3,1, 28,3'), [1, 3, 28]);
  assert.equal(joinBands([28, 1, 3]), '1,3,28');
  assert.equal(FH_TO_CODE['0'], '03'); assert.equal(CODE_TO_FH['08'], '2'); assert.equal(CODE_TO_FH['00'], '3');
  assert.equal(loginError('0|abc'), null);
  assert.match(loginError('4|')!, /غلط/);
  assert.match(loginError('1')!, /جهاز ثاني/);
});
