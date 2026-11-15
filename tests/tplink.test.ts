/**
 * TP-Link NX200 (نسخة GDPR — ١٥ نوفمبر): التشفير مطابق لكود الراوتر نفسه (tpEncrypt.js + encrypt.js + cryptoJS شغّلناها في node
 * بنفس المفتاح والبيانات وطلّعنا القيم تحت) + قراءة صفحة الدخول الحقيقية.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TpState } from '../src/drivers/tplink/crypto';

declare const require: any;
// @noble من مجلد المشروع (الاختبارات تتحوّل لمجلد مؤقت برا node_modules)
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
const { tpAesEncrypt, tpAesDecrypt, tpSign, tpHash, tpJson, tpB64, tpParm, tpBody } = require('../src/drivers/tplink/crypto');
const { tpIsLoginPage, tpIsWelcome, tpPageVars, tpLoginUser, tpRet, tpBusy, tpSignalGuess, tpToken, tpCells, tpSignal, tpTowers, tpCarriers } = require('../src/drivers/tplink/parse');

const NN = 'E422748A3E13513CE024E69C1ACA13D2CA9E8D995E470634B2A3B7ED153E2EE29F2A892AC8CA84AE884E909624C2B76B4DACAEC85EDD9B69B2615E0E1E8670A9';
const ST: TpState = { keys: { key: '1731672345123456', iv: '1731672345654321' }, hash: tpHash('user', 'secret123'), seq: 787162459, nn: NN, ee: '010001' };
const LOGIN = tpJson('cgi', '/cgi/login', { UserName: tpB64('user'), Passwd: tpB64('secret123'), Action: '1', stack: '0,0,0,0,0,0', pstack: '0,0,0,0,0,0' });
const fx = (f: string) => fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'tplink-nx200', f), 'utf8');

test('TP-Link: AES + التوقيع نفس كود الراوتر بالضبط', () => {
  assert.equal(ST.hash, "eadbde7ea6fd7ad1433a786058af4a91");
  const data = tpAesEncrypt(LOGIN, ST.keys);
  assert.equal(data, "0PDSw3szVLSRLD800X1TuMsGLDjdZn+1vq59YK+1cfGhCoYh0yCmKhgWs2YCK++V6XCHfI6/oiiT2+gSbrwYGfpig6hapOs1WRDKOENzXjJ2R9GIbUSlOiREOL1Ql8EKfdMcrxbCK/ezh+dBSQb19B2wbMXap+4gJtpBYYXutfD9FV92wgiHttXqXrYWHH8T9SHZoKO2qc2odq40O/FCRw==");
  assert.equal(tpSign(ST, data.length, true), "82977c96305eec302bbb03d4da40171ead1032c6c8c9f753dbff1d3a52d7a122e5494c0556f6030cc94717234d88c414cc9048d9cb52c88c6bcba445d4eef50329b39db7088af2707a0ef0ba584bfd32b61e7668708c25aaae1f288edef573db908a686997c4c43ef812cd405b087840a2822a6141928da464ee5c80719b6460");
  assert.equal(tpSign(ST, data.length, false), "3646cfdef99f754276199b0021604a88b1f13a6c2ceba163daa2e266261babd828f2832b82223ffa81cc74769c43543efce129e49fea1a7a91f594d95fb0a9cd");
  assert.equal(tpAesDecrypt(data, ST.keys), LOGIN);
  const b = tpBody(LOGIN, ST, true);
  assert.ok(b.startsWith('sign=') && b.includes('\r\ndata=' + data + '\r\n'));
});

test('TP-Link: getGDPRParm وصفحة الدخول', () => {
  const p = tpParm('var adminSetting=0;\nvar ee="010001";\nvar nn="' + NN + '";\nvar seq="598502224";\n$.ret=0;');
  assert.deepEqual(p, { nn: NN, ee: '010001', seq: 598502224 });
  const page = fx('login.html');
  assert.ok(tpIsLoginPage(page));
  assert.ok(!tpIsWelcome(page));
  assert.ok(tpIsWelcome(fx('welcome.html')));
  const v = tpPageVars(page);
  assert.equal(v.model, 'Archer NX200');
  assert.equal(v.adminType, 'user');
  assert.equal(v.forbidFlag, false);
  assert.equal(tpLoginUser(v.adminType, 'admin'), 'user');
  assert.equal(tpLoginUser(undefined, ''), 'admin');
});

test('TP-Link: ردود cgi والإشارة', () => {
  assert.equal(tpRet('$.ret=0;'), 0);
  assert.equal(tpRet('$.ret=71233;'), 71233);
  assert.equal(tpRet(''), null);
  assert.deepEqual(tpBusy('var isLogined=1;\nvar isBusy=0;'), { logined: true, busy: false });
  assert.equal(tpToken('<script>var token="a1b2c3d4e5f6";</script>'), 'a1b2c3d4e5f6');
  const s = tpSignalGuess([{ rsrp: '-95', rsrq: '-11', sinr: '12', nrRsrp: '-88', band: '3' }]);
  assert.equal(s.rsrp, -95); assert.equal(s.rsrq, -11); assert.equal(s.sinr, 12); assert.equal(s.nrRsrp, -88);
  assert.equal(s.network, '5G NSA');
  // قيم مو معقولة ← ما ناخذها
  assert.equal(tpSignalGuess([{ rsrp: '0' }]).rsrp, undefined);
});

// شكل رد gl DEV2_LTE_SERVING_CELL_INFO من FULL العضو (١٥ نوفمبر ٤:١٦ م) — أرقام البرج متغيّرة
const EMPTY = { networkType: '-1', cellConnectionStatus: '0', band: '0', cid: '', PCI: '', TAC: '', downBandWidth: '0', SSRSRP: '0', SSRSRQ: '0', SSSINR: '0', ARFCN: '0', RSRP: '0', RSRQ: '0', SNR: '0', RSSI: '0', CQI: '0', downMCS: '0', upMCS: '0', nodeBId: '' };
const LIST = [
  { ...EMPTY, stack: '1,1,0,0,0,0' },
  { ...EMPTY, networkType: '3', cellConnectionStatus: '1', band: '3', cid: '12345678', PCI: '117', TAC: '1111', upBandWidth: '20000', downBandWidth: '20000', ARFCN: '1850', RSRP: '-93', RSRQ: '-10', SNR: '47', RSSI: '-83', CQI: '8', downMCS: '2', upMCS: '17', nodeBId: '2369D', stack: '1,2,0,0,0,0' },
  { ...EMPTY, networkType: '3', cellConnectionStatus: '2', band: '1', ARFCN: '300', RSSI: '-113', stack: '1,40,0,0,0,0' },
  { ...EMPTY, networkType: '0', stack: '1,41,0,0,0,0' },
];

test('TP-Link: الإشارة والدمج من SERVING_CELL_INFO (FULL العضو)', () => {
  const cells = tpCells(LIST);
  assert.equal(cells.length, 2);
  const s = tpSignal(cells, { endcStatus: '-1', networkType: '7', connectedBand: 'B3;B1' });
  assert.equal(s.band, 'B3'); assert.equal(s.pci, '117'); assert.equal(s.earfcn, '1850');
  assert.equal(s.rsrp, -93); assert.equal(s.rsrq, -10); assert.equal(s.sinr, 4.7); assert.equal(s.rssi, -83);
  assert.equal(s.cqi, 8); assert.equal(s.enodebId, String(0x2369d)); assert.equal(s.dlBandwidth, '20MHz');
  assert.equal(s.caCount, 2); assert.equal(s.network, '4G+');
  assert.equal(s.nrRsrp, undefined);
  const car = tpCarriers(cells);
  assert.deepEqual(car.map((c: any) => `${c.role}:B${c.band}`), ['PCC:B3', 'SCC:B1']);
  assert.equal(car[1].rsrp, undefined); // B1 الثانوي بدون RSRP (صفر) — ما نعرض صفر
  assert.deepEqual(tpTowers(cells).map((c: any) => c.kind), ['serving', 'secondary']);
});

test('TP-Link: 5G (networkType 8) يقرأ SSRSRP/SSSINR', () => {
  const cells = tpCells([
    { ...EMPTY, networkType: '3', cellConnectionStatus: '1', band: '3', RSRP: '-90', RSRQ: '-9', SNR: '120' },
    { ...EMPTY, networkType: '8', cellConnectionStatus: '1', band: '78', ARFCN: '632448', PCI: '50', SSRSRP: '-98', SSRSRQ: '-11', SSSINR: '85', downBandWidth: '100000' },
  ]);
  const s = tpSignal(cells, { endcStatus: '1' });
  assert.equal(s.nrBand, 'n78'); assert.equal(s.nrRsrp, -98); assert.equal(s.nrSinr, 8.5); assert.equal(s.nrDlBandwidth, '100MHz');
  assert.equal(s.network, '5G NSA');
  assert.equal(s.caBandwidthMhz, 100);
});
