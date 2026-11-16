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
const { tpIsLoginPage, tpIsWelcome, tpPageVars, tpLoginUser, tpRet, tpBusy, tpSignalGuess, tpToken, tpCells, tpSignal, tpTowers, tpCarriers, tpBands, tpLocked, tpBandPlan, tpModeHas } = require('../src/drivers/tplink/parse');

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

test('TP-Link: فيرموير EU/2.20 — صفحة getParm/proxy.js تتعرّف، والمفتاح من getParm', () => {
  // فيرموير NX200 EU/2.20 (حسن ١٦ نوفمبر): getGDPRParm يرد 406، والصفحة تستخدم /cgi/getParm + proxy.js
  assert.ok(tpIsLoginPage('<script src="js/proxy.js"></script><script src="js/tpEncrypt.js"></script>'));
  assert.ok(tpIsLoginPage('oid: "/cgi/getParm"'));
  // نفس صيغة المفتاح من المسارين — tpParm يفكّها (ويشترط seq فما نمشي بمفتاح ناقص)
  assert.deepEqual(tpParm('var ee="010001";var nn="' + NN + '";var seq="123456";'), { nn: NN, ee: '010001', seq: 123456 });
  assert.equal(tpParm('var ee="010001";var nn="' + NN + '";'), null);
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

// رد DEV2_LTE_BAND_SEARCH و DEV2_LTE_WAN_CFG من راوتر العضو (AUTH ١٥ نوفمبر ٤:٣٨ م)
const BS = { supportModeList: '1;2', selectedMode: '2', selectedBand: 'B1;B3', supportBandList: 'W1;W5;W8;B1;B3;B5;B7;B8;B20;B28;B38;B40;B41;B42;B43;N1;N3;N5;N7;N8;N20;N28;N38;N40;N41;N77;N78' };
const WAN = { networkPreferredModeSelected: '4G Only', networkPreferredModeOptionList: '5G Preferred,5G Only,4G Preferred,4G Only,3G Only' };
const SUP_L = [1, 3, 5, 7, 8, 20, 28, 38, 40, 41, 42, 43];
const SUP_N = [1, 3, 5, 7, 8, 20, 28, 38, 40, 41, 77, 78];

test('TP-Link: قراءة الترددات (يدوي B1+B3 على 4G فقط)', () => {
  const b = tpBands(BS, WAN);
  assert.equal(b.manual, true);
  assert.deepEqual(b.lte, [1, 3]); assert.deepEqual(b.nr, []);
  assert.deepEqual(b.supLte, SUP_L); assert.deepEqual(b.supNr, SUP_N);
  assert.equal(b.mode, '4G Only');
  assert.deepEqual(b.modes, ['5G Preferred', '5G Only', '4G Preferred', '4G Only', '3G Only']);
  assert.deepEqual(tpLocked(b), { lte: [1, 3], nr: [] });
  // كل المدعوم مختار = تلقائي
  assert.deepEqual(tpLocked(tpBands({ ...BS, selectedBand: SUP_L.map(n => 'B' + n).join(';') }, WAN)).lte, []);
  // لاحقة 5G (N78N / N78S) تنشال
  assert.deepEqual(tpBands({ ...BS, selectedBand: 'B3;N78N;N1S' }, WAN).nr, [1, 78]);
});

test('TP-Link: خطة الحفظ نفس advanceLte.htm', () => {
  const b4 = tpBands(BS, WAN);
  // 4G فقط: ترددات 4G بس
  assert.deepEqual(tpBandPlan(b4, [3], []), { mode: '2', band: 'B3' });
  assert.deepEqual(tpBandPlan(b4, [], []), { mode: '1', band: '' });
  assert.ok('error' in tpBandPlan(b4, [], [78]));         // 5G مطفي بهالوضع
  assert.ok('error' in tpBandPlan(b4, [99], []));         // مو مدعوم
  // 5G Preferred: تثبيت 4G يخلي 5G تلقائي (كل المدعوم)
  const b5 = tpBands(BS, { ...WAN, networkPreferredModeSelected: '5G Preferred' });
  const p = tpBandPlan(b5, [1, 3], []);
  assert.deepEqual(p, { mode: '2', band: 'B1;B3;' + SUP_N.map(n => 'N' + n).join(';') });
  assert.deepEqual(tpBandPlan(b5, [], [78]), { mode: '2', band: SUP_L.map(n => 'B' + n).join(';') + ';N78' });
  // 5G فقط: 5G بس، و4G ممنوع
  const b5o = tpBands(BS, { ...WAN, networkPreferredModeSelected: '5G Only' });
  assert.deepEqual(tpBandPlan(b5o, [], [78]), { mode: '2', band: 'N78' });
  assert.ok('error' in tpBandPlan(b5o, [3], []));
  assert.deepEqual(tpModeHas('4G Preferred'), { lte: true, nr: false });
});
