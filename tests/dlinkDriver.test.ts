/**
 * درايفر D-Link DWR-2000M / DWR-3000M على راوتر محاكى بنفس بروتوكول الصفحة (cpe-webui، /acfun/):
 * getLoginKey ← HMAC-MD5(PublicKey+كلمة، Challenge)↑ ← HMAC-MD5(المفتاح، Challenge)↑ — الحسبة هنا مستقلة بـ node:crypto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';

declare const require: any;
(globalThis as any).__DEV__ = false;

const hm = (k: string, m: string) => (ncrypto as any).createHmac('md5', Buffer.from(k, 'utf8')).update(Buffer.from(m, 'utf8')).digest('hex').toUpperCase();
declare const Buffer: any;

const RF_2000 = {
  basic: { fabricator: 'D-Link', productType: 'DWR-2000M', imei: '356000000000009', hardwareVersion: 'A1', softwareVersion: 'V1.0.3' },
  rf: [
    { rsrp: '-95', rsrq: '-11', rssi: '-65', sinr: '12', pcid: '211', cellid: '173634354', enodebid: '678259', earfcn: '1650/19650', bandwidth: '20MHz', CQI: '10', DLMCS: '17', RANK: '2', plmn: '42004' },
    { rsrp: '-101', rsrq: '-13', sinr: '6', pcid: '77', earfcn: '6300/24300', bandwidth: '10MHz' },
  ],
};
const RF_3000 = {
  basic: { productType: 'DWR-3000M', softwareVersion: 'V2' },
  rf: [
    { rsrp: '-90', rsrq: '-10', sinr: '15', pcid: '33', earfcn: '1300', frequencyBand: 'B3', bandwidth: '20' },
    { rsrp: '-84', rsrq: '-11', sinr: '20', pcid: '501', earfcn: '636666', frequencyBand: 'n78', bandwidth: '100' },
  ],
};

function router(opts: { model?: string; password?: string; rf?: any } = {}) {
  const st: any = { pub: 'PK9f', ch: 'CH+=&"x', session: false, posts: [] as any[], fails: 0, lastUser: '' };
  const res = (status: number, text: string) =>
    ({ ok: status < 400, status, url: 'http://192.168.0.1/', headers: { get: () => null }, text: async () => text } as any);
  const J = (o: unknown) => res(200, JSON.stringify(o));
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = (init?.method ?? 'GET').toUpperCase();
    const p = u.pathname;
    if (!p.startsWith('/acfun/')) return res(200, '<!doctype html><html>cpe-webui</html>');
    assert.equal(init?.headers?.['content-type'], 'application/json');
    const name = p.slice(7);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (name === 'getProductModelInfo') return J({ errcode: 0, info: { model: opts.model ?? 'DWR-2000M', boardID: 'X', lang: 'en' } });
    if (name === 'getLoginKey') { st.lastUser = u.searchParams.get('username'); return J({ errcode: 0, info: { PublicKey: st.pub, Challenge: st.ch } }); }
    if (name === 'login' && m === 'POST') {
      const good = hm(hm(st.pub + (opts.password ?? 'pw'), st.ch), st.ch);
      if (body?.username !== 'admin' || body?.password !== good) { st.fails++; return J(st.fails >= 5 ? { errcode: 22, waitime: 60 } : { errcode: 3, msg: 'Password error' }); }
      st.session = true;
      return J({ errcode: 0, info: { username: 'admin', role: 'administrator' } });
    }
    if (!st.session) return J({ errcode: 6, msg: 'not login' });
    if (name === 'getMobileNetStatusParams') return J({ errcode: 0, info: opts.rf ?? RF_2000 });
    if (name === 'InternetStatus') return J({ errcode: 0, info: { systemMode: 'Router', MobileNetwork: { operators: 'Zain KSA', networkStatus: 'Connected', netType: '4G', ipAddress: '10.2.3.4', primary_dns_server: '8.8.8.8', imei: '356000000000009' } } });
    if (name === 'ConnectedClients') return J({ errcode: 0, info: { clients: [
      { macAddress: 'AA:BB:CC:00:00:01', ipv4Address: '192.168.0.20', interfaceName: 'wlan0' },
      { macAddress: 'bad', ipv4Address: '192.168.0.21' },
    ] } });
    if (name === 'getBandLockInfo') return J({ errcode: 0, info: { bandLockEnabled: true, netType: '4G', '4G': { allBands: '1,3,7,8,20,28,40,41', enabledBand: '3,20' }, '5G': { allBands: '78,41', enabledBand: '' } } });
    if (name === 'reboot' && m === 'POST') { st.posts.push({ name, body: init.body }); return J({ errcode: 0, waitime: 90 }); }
    if (m === 'POST') { st.posts.push({ name, body }); return J({ errcode: 0 }); }
    return res(200, '<!doctype html><html>cpe-webui</html>');
  };
  return st;
}
const driver = () => { const { DlinkDriver } = require('../src/drivers/dlink/index'); return new DlinkDriver(); };

test('D-Link crypto: HMAC-MD5 مطابق لـ node (عربي + مفتاح أطول من ٦٤)', () => {
  const { hmacMd5Hex, dlLoginHash } = require('../src/drivers/dlink/crypto');
  for (const [k, msg] of [['', ''], ['key', 'The quick brown fox'], ['كلمة🔑', 'تحدي'], ['k'.repeat(100), 'x'.repeat(200)]]) {
    assert.equal(hmacMd5Hex(k, msg), (ncrypto as any).createHmac('md5', Buffer.from(k, 'utf8')).update(Buffer.from(msg, 'utf8')).digest('hex'));
  }
  const r = dlLoginHash('PK', 'pass', 'CH');
  assert.equal(r.key, hm('PKpass', 'CH'));
  assert.equal(r.password, hm(r.key, 'CH'));
});

test('D-Link: يتعرّف عليه، يدخل بنفس حسبة الصفحة، ويقرأ 4G والدمج والأجهزة', async () => {
  const st = router();
  const d = driver();
  assert.equal(await d.detect('192.168.0.1'), true);
  const prof = await d.identify();
  assert.equal(prof.label, 'D-Link DWR-2000M');
  assert.equal(prof.tech, '4G');
  assert.equal(prof.writeUnverified, true);
  await assert.rejects(d.getSignal(), /انتهت الجلسة/);
  await d.login('192.168.0.1', '', 'pw');
  assert.equal(st.lastUser, 'admin');
  const s = await d.getSignal();
  assert.equal(s.band, 'B3');
  assert.equal(s.earfcn, '1650');
  assert.equal(s.rsrp, -95);
  assert.equal(s.sinr, 12);
  assert.equal(s.pci, '211');
  assert.equal(s.enodebId, '678259');
  assert.equal(s.network, '4G');
  assert.equal(s.caCount, 2);
  assert.equal(s.caBandwidthMhz, 30);
  assert.equal(s.nrRsrp, undefined);
  const ca = await d.getCarriers();
  assert.deepEqual(ca.map((c: any) => `${c.role}:B${c.band}`), ['PCC:B3', 'SCC:B20']);
  const net = await d.getNetworkInfo();
  assert.equal(net.operator, 'Zain KSA');
  assert.equal(net.connected, true);
  assert.equal(net.supports5g, false);
  const dev = await d.getDevices();
  assert.deepEqual(dev, [{ mac: 'aa:bb:cc:00:00:01', ip: '192.168.0.20', name: 'wlan0' }]);
  const det = await d.getDeviceDetails();
  assert.equal(det.software, 'V1.0.3');
  assert.equal(det.wanIp, '10.2.3.4');
  const snap = await d.getSnapshot();
  assert.equal(snap.lte?.rsrp, -95);
  const bc = await d.getBandConfig();
  assert.deepEqual(bc.locked, [3, 20]);
  assert.deepEqual(bc.supported, [1, 3, 7, 8, 20, 28, 40, 41]);
  assert.deepEqual(bc.nrSupported, [78, 41]);
});

test('D-Link DWR-3000M: 5G NSA من frequencyBand (n78) + 4G', async () => {
  router({ model: 'DWR-3000M', rf: RF_3000 });
  const d = driver();
  assert.equal(await d.detect('192.168.0.1'), true);
  assert.equal((await d.identify()).tech, '5G');
  await d.login('192.168.0.1', 'admin', 'pw');
  const s = await d.getSignal();
  assert.equal(s.band, 'B3');
  assert.equal(s.nrBand, 'n78');
  assert.equal(s.nrRsrp, -84);
  assert.equal(s.nrArfcn, '636666');
  assert.equal(s.network, '5G NSA');
  assert.equal((await d.getNetworkInfo()).supports5g, true);
});

test('D-Link: كلمة غلط ← رسالة واضحة، ٥ محاولات ← قفل، والكتابة مقفولة بدون أي أمر', async () => {
  const st = router({ password: 'right' });
  const d = driver();
  await d.detect('192.168.0.1');
  await assert.rejects(d.login('192.168.0.1', 'admin', 'wrong'), /كلمة المرور غلط/);
  for (let i = 0; i < 3; i++) await d.login('192.168.0.1', 'admin', 'wrong').catch(() => {});
  await assert.rejects(d.login('192.168.0.1', 'admin', 'wrong'), /قفل الدخول/);
  st.fails = 0;
  await d.login('192.168.0.1', 'admin', 'right');
  await assert.rejects(d.setBand([3]), (e: any) => /ما غيّرنا شي/.test(e.message));
  assert.equal(st.posts.length, 0);
  await d.reboot();
  assert.deepEqual(st.posts, [{ name: 'reboot', body: '""' }]);
});

test('D-Link: راوتر ثاني يرجّع صفحة HTML ← ما يتعرّف عليه', async () => {
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, url: 'http://192.168.8.1/', headers: { get: () => null }, text: async () => '<!doctype html><html>huawei</html>' });
  assert.equal(await driver().detect('192.168.8.1'), false);
});
