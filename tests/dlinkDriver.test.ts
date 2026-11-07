/**
 * درايفر D-Link DWR-2000M / DWR-3000M على راوتر محاكى بنفس بروتوكول الصفحة (cpe-webui، /acfun/):
 * getLoginKey ← HMAC-MD5(PublicKey+كلمة، Challenge)↑ ← HMAC-MD5(المفتاح، Challenge)↑ — الحسبة هنا مستقلة بـ node:crypto.
 * تشفير الخانات مقارن بمتجهات طلعت من كود الصفحة نفسه (موديول 567) — tests/fixtures/dlink-cipher.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';

declare const require: any;
declare const Buffer: any;
declare const process: any;
(globalThis as any).__DEV__ = false;

const hm = (k: string, m: string) => (ncrypto as any).createHmac('md5', Buffer.from(k, 'utf8')).update(Buffer.from(m, 'utf8')).digest('hex').toUpperCase();

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

function router(opts: { model?: string; board?: string; password?: string; rf?: any; ignoreBand?: boolean; ctrlMode?: string } = {}) {
  const st: any = {
    pub: 'PK9f', ch: 'CH+=&"x', session: false, posts: [] as any[], fails: 0, lastUser: '', key: '',
    band: { bandLockEnabled: false, netType: '4G', '4G': { allBands: '1,3,7,8,20,28,40,41', enabledBand: '' }, '5GNAS': { allBands: '', enabledBand: '' } },
    cell: { cellLockEnabled: false, netType: '4G', pcid: '', arfcn: '' },
    mobile: { enable: true, netType: 'AUTO', authType: 'AUTO', ipVersion: 'IPv4', mtu: 1500, manualApnEnable: true, apn: 'zain', userName: '', password: '', dialNumber: '*99#', bridgeEnable: false, natEnable: true },
    sms: { 1: [{ id: 3, number: '+966500000001', content: 'رصيدك &amp; باقتك', time: '2026-11-07 01:00' }], 2: [] as any[] },
    wlan: { '2.4GHz': { wirelessDisable: false, ssid: 'DLink_24', channelNumber: 'Auto', channelWidth: '20MHz', wifiMode: 'b/g/n' }, '5GHz': { wirelessDisable: false, ssid: 'DLink_5', channelNumber: '36', channelWidth: '80MHz' } } as any,
    sec: { '2.4GHz': { currentId: 'ap0', aps: [{ apId: 'ap0', encryption: 'WPA2', authType: 'PSK', encryptionKey: '', wpaCipher: 'AES' }] }, '5GHz': { currentId: 'ap0', aps: [{ apId: 'ap0', encryption: 'WPA2', authType: 'PSK', encryptionKey: '', wpaCipher: 'AES' }] } } as any,
    ctrl: { '2.4GHz': { mode: opts.ctrlMode ?? 'disable', list: [] as string[] }, '5GHz': { mode: opts.ctrlMode ?? 'disable', list: [] as string[] } } as any,
  };
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
    const q = (k: string) => u.searchParams.get(k) ?? '';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (m === 'POST' && !['login', 'getsmsList'].includes(name)) st.posts.push({ name, body });
    if (name === 'getProductModelInfo') return J({ errcode: 0, info: { model: opts.model ?? 'DWR-2000M', boardID: opts.board ?? (opts.model ? 'X' : '96755REF1_4G'), lang: 'en' } });
    if (name === 'getLoginKey') { st.lastUser = q('username'); return J({ errcode: 0, info: { PublicKey: st.pub, Challenge: st.ch } }); }
    if (name === 'login' && m === 'POST') {
      const key = hm(st.pub + (opts.password ?? 'pw'), st.ch);
      if (body?.username !== 'admin' || body?.password !== hm(key, st.ch)) { st.fails++; return J(st.fails >= 5 ? { errcode: 22, waitime: 60 } : { errcode: 3, msg: 'Password error' }); }
      st.session = true; st.key = key;
      return J({ errcode: 0, info: { username: 'admin', role: 'administrator' } });
    }
    if (!st.session) return J({ errcode: 6, msg: 'not login' });
    const ok = (extra: object = {}) => J({ errcode: 0, waitime: 5, ...extra });
    switch (name) {
      case 'getMobileNetStatusParams': return J({ errcode: 0, info: opts.rf ?? RF_2000 });
      case 'InternetStatus': return J({ errcode: 0, info: { systemMode: 'Router', MobileNetwork: { operators: 'Zain KSA', networkStatus: 'Connected', netType: '4G', ipAddress: '10.2.3.4', primary_dns_server: '8.8.8.8', imei: '356000000000009' } } });
      case 'ConnectedClients': return J({ errcode: 0, info: { clients: [
        { macAddress: 'AA:BB:CC:00:00:01', ipv4Address: '192.168.0.20', interfaceName: 'wlan0' },
        { macAddress: 'bad', ipv4Address: '192.168.0.21' },
      ] } });
      case 'getBandLockInfo': return J({ errcode: 0, info: JSON.parse(JSON.stringify(st.band)) });
      case 'bandLockSetup':
        if (!opts.ignoreBand) { st.band.bandLockEnabled = body.bandLockEnabled; st.band.netType = body.netType; if (st.band[body.netType]) st.band[body.netType].enabledBand = body.enabledBand; }
        return ok();
      case 'getCellLockInfo': return J({ errcode: 0, info: { ...st.cell } });
      case 'cellLockSetup': st.cell = { ...body }; return ok();
      case 'getMobileNetworkBasicConfig': return J({ errcode: 0, info: { ...st.mobile } });
      case 'mobileNetworkBasicSetting': st.mobile = { ...body }; return ok();
      case 'getsmsList': return J({ errcode: 0, info: { smsList: st.sms[body.type], total: st.sms[body.type].length } });
      case 'sendsms': st.sms[2].push({ id: 9, number: body.countryCode + body.contacts, content: body.content }); return ok();
      case 'delsms': st.sms[1] = st.sms[1].filter((x: any) => !String(body.id).split(',').includes(String(x.id))); return ok();
      case 'getWlanBasicConfig': return J({ errcode: 0, info: { ...st.wlan[q('bandType')] } });
      case 'wlanBasicSetting': { const { bandType, ...rest } = body; st.wlan[bandType] = rest; return ok(); }
      case 'getWlanSecurity': return J({ errcode: 0, info: JSON.parse(JSON.stringify(st.sec[q('bandType')])) });
      case 'wlanSecuritySetting': { const { bandType, ...rest } = body; st.sec[bandType].aps = [rest]; return ok(); }
      case 'getWlanCtrlConfig': return J({ errcode: 0, info: { wlanCtrlMode: st.ctrl[q('bandType')].mode, macAddress: '', comment: '' } });
      case 'getWlanCtrlList': return J({ errcode: 0, info: { list: st.ctrl[q('bandType')].list.map((x: string) => ({ macAddress: x })) } });
      case 'wlanCtrlSetting': { const c = st.ctrl[body.bandType]; c.mode = body.wlanCtrlMode; if (!c.list.includes(body.macAddress)) c.list.push(body.macAddress); return ok(); }
      case 'wlanCtrlDel': for (const b of ['2.4GHz', '5GHz']) st.ctrl[b].list = st.ctrl[b].list.filter((x: string) => x !== body.macAddress); return ok();
      case 'reboot': return ok({ waitime: 90 });
      case 'reset': return ok();
    }
    return res(200, '<!doctype html><html>cpe-webui</html>');
  };
  return st;
}
const driver = () => { const { DlinkDriver } = require('../src/drivers/dlink/index'); const d = new DlinkDriver(); d.waitScale = 0; return d; };
async function ready(o: any = {}) { const st = router(o); const d = driver(); await d.detect('192.168.0.1'); await d.login('192.168.0.1', 'admin', o.password ?? 'pw'); st.posts.length = 0; return { st, d }; }

test('D-Link crypto: HMAC-MD5 مطابق لـ node + تشفير الخانات مطابق لكود الصفحة', () => {
  const { hmacMd5Hex, dlLoginHash, dlEncrypt, dlDecrypt } = require('../src/drivers/dlink/crypto');
  for (const [k, msg] of [['', ''], ['key', 'The quick brown fox'], ['كلمة🔑', 'تحدي'], ['k'.repeat(100), 'x'.repeat(200)]]) {
    assert.equal(hmacMd5Hex(k, msg), (ncrypto as any).createHmac('md5', Buffer.from(k, 'utf8')).update(Buffer.from(msg, 'utf8')).digest('hex'));
  }
  const r = dlLoginHash('PK', 'pass', 'CH');
  assert.equal(r.key, hm('PKpass', 'CH'));
  assert.equal(r.password, hm(r.key, 'CH'));
  const fs = require('fs'), path = require('path');
  const vec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'dlink-cipher.json'), 'utf8'));
  for (const v of vec) {
    assert.equal(dlEncrypt(v.p, v.k), v.c, `encrypt ${v.p}`);
    assert.equal(dlDecrypt(v.c, v.k), v.d, `decrypt ${v.p}`);
  }
});

test('D-Link: يتعرّف عليه، يدخل بنفس حسبة الصفحة، ويقرأ 4G والدمج والأجهزة', async () => {
  const st = router();
  const d = driver();
  assert.equal(await d.detect('192.168.0.1'), true);
  const prof = await d.identify();
  assert.equal(prof.label, 'D-Link DWR-2000M');
  assert.equal(prof.tech, '4G');
  assert.equal(prof.writeUnverified, undefined);
  await assert.rejects(d.getSignal(), /انتهت الجلسة/);
  await d.login('192.168.0.1', '', 'pw');
  assert.equal(st.lastUser, 'admin');
  const s = await d.getSignal();
  assert.equal(s.band, 'B3');
  assert.equal(s.earfcn, '1650');
  assert.equal(s.rsrp, -95);
  assert.equal(s.sinr, 12);
  assert.equal(s.enodebId, '678259');
  assert.equal(s.network, '4G');
  assert.equal(s.caCount, 2);
  assert.equal(s.caBandwidthMhz, 30);
  assert.deepEqual((await d.getCarriers()).map((c: any) => `${c.role}:B${c.band}`), ['PCC:B3', 'SCC:B20']);
  const net = await d.getNetworkInfo();
  assert.equal(net.operator, 'Zain KSA');
  assert.equal(net.connected, true);
  assert.equal(net.supports5g, false);
  assert.deepEqual(await d.getDevices(), [{ mac: 'aa:bb:cc:00:00:01', ip: '192.168.0.20', name: 'wlan0', blocked: false }]);
  assert.equal((await d.getDeviceDetails()).software, 'V1.0.3');
  assert.equal((await d.getSnapshot()).lte?.rsrp, -95);
});

test('D-Link DWR-3000M: 5G NSA من frequencyBand (n78) + 4G', async () => {
  router({ model: 'DWR-3000M', rf: RF_3000 });
  const d = driver();
  assert.equal(await d.detect('192.168.0.1'), true);
  assert.equal((await d.identify()).tech, '5G');
  await d.login('192.168.0.1', 'admin', 'pw');
  const s = await d.getSignal();
  assert.equal(s.nrBand, 'n78');
  assert.equal(s.nrRsrp, -84);
  assert.equal(s.network, '5G NSA');
});

test('D-Link: تثبيت ترددات 4G بنفس جسم الصفحة + تأكيد بالقراءة + فك', async () => {
  const { st, d } = await ready();
  let c = await d.getBandConfig();
  assert.deepEqual(c.supported, [1, 3, 7, 8, 20, 28, 40, 41]);
  assert.deepEqual(c.locked, []);
  assert.equal(c.mode, '00');
  assert.deepEqual(c.modes.map((m: any) => m.value), ['00', '03', '02']);
  await d.setBand([3, 20, 99]);
  assert.deepEqual(st.posts, [{ name: 'bandLockSetup', body: { bandLockEnabled: true, netType: '4G', enabledBand: '3,20' } }]);
  c = await d.getBandConfig();
  assert.deepEqual(c.locked, [3, 20]);
  st.posts.length = 0;
  await d.setBand([20, 3]);
  assert.equal(st.posts.length, 0, 'نفس الترددات = ما نرسل شي');
  await d.setBand([]);
  assert.deepEqual(st.posts[0], { name: 'bandLockSetup', body: { bandLockEnabled: false, netType: '4G', enabledBand: '3,20' } });
  assert.deepEqual((await d.getBandConfig()).locked, []);
  await assert.rejects(d.setBand([66]), (e: any) => /ما غيّرنا شي/.test(e.message));
});

test('D-Link: الراوتر قال تمام بس ما ثبّت ← خطأ (ما ندّعي نجاح)', async () => {
  const { d } = await ready({ ignoreBand: true });
  await assert.rejects(d.setBand([3]), /القراءة بعده مختلفة/);
});

test('D-Link: تثبيت البرج 4G ثم فكّه + وضع الشبكة مع APN مشفّر يرجع بنفس القيمة', async () => {
  const { st, d } = await ready();
  await d.lockCell({ tech: 'LTE', pci: '211', arfcn: '1650', band: 3 });
  assert.deepEqual(st.posts[0], { name: 'cellLockSetup', body: { cellLockEnabled: true, netType: '4G', pcid: '211', arfcn: '1650' } });
  assert.deepEqual(await d.getCellLock(), { tech: 'LTE', pci: '211', arfcn: '1650', band: undefined });
  await assert.rejects(d.lockCell({ tech: 'NR', pci: '1', arfcn: '636666', band: 78 }), (e: any) => /راوترك 4G/.test(e.message));
  await d.unlockCell();
  assert.equal(st.cell.cellLockEnabled, false);
  assert.equal(st.cell.pcid, '211', 'الفك يرسل نفس البرج مع cellLockEnabled=false مثل الصفحة');

  // APN باسم وكلمة مشفّرة بمفتاح الجلسة — الوضع يتغيّر والخانات ترجع نفس الشي بعد فك/تشفير
  const { dlEncrypt, dlDecrypt } = require('../src/drivers/dlink/crypto');
  st.mobile.userName = dlEncrypt('zainuser', st.key);
  st.mobile.password = dlEncrypt('zain@pw', st.key);
  st.posts.length = 0;
  await d.setNetworkMode('03');
  const b = st.posts[0].body;
  assert.equal(st.posts[0].name, 'mobileNetworkBasicSetting');
  assert.equal(b.netType, '4G');
  assert.equal(dlDecrypt(b.userName, st.key), 'zainuser');
  assert.equal(dlDecrypt(b.password, st.key), 'zain@pw');
  assert.equal(b.apn, 'zain');
  assert.equal(b.dialNumber, '*99#');
  assert.equal((await d.getBandConfig()).mode, '03');
  await assert.rejects(d.setNetworkMode('dl:5G'), (e: any) => /ما غيّرنا شي/.test(e.message));
});

test('D-Link: لقطة ← تجارب ← إرجاع متحقق منه (ترددات + برج + وضع)', async () => {
  const { st, d } = await ready();
  await d.setBand([3]);
  const snap = await d.readLockState();
  assert.match(snap.summary, /4G: 3/);
  await d.setBand([20]);
  await d.lockCell({ tech: 'LTE', pci: '77', arfcn: '6300' });
  await d.setNetworkMode('03');
  await d.restoreLockState(snap);
  assert.equal(st.band.bandLockEnabled, true);
  assert.equal(st.band['4G'].enabledBand, '3');
  assert.equal(st.cell.cellLockEnabled, false);
  assert.equal(st.mobile.netType, 'AUTO');
  await d.restoreAll();
  assert.equal(st.band.bandLockEnabled, false);
  assert.equal(await d.getActiveLock(), null);
});

test('D-Link: الرسائل (قراءة · إرسال بالرمز والرقم · حذف)', async () => {
  const { st, d } = await ready();
  const inbox = await d.listSms('inbox');
  assert.deepEqual(inbox.map((x: any) => [x.index, x.content]), [['3', 'رصيدك & باقتك']]);
  await d.sendSms('0551234567', 'هلا');
  assert.deepEqual(st.posts.find((x: any) => x.name === 'sendsms').body, { countryCode: '+966', contacts: '551234567', content: 'هلا' });
  await d.sendSms('+218912345678', 'x');
  assert.deepEqual(st.posts.filter((x: any) => x.name === 'sendsms')[1].body, { countryCode: '+218', contacts: '912345678', content: 'x' });
  await d.sendSms('1415', 'رصيد');
  assert.equal(st.posts.filter((x: any) => x.name === 'sendsms')[2].body.contacts, '1415');
  await assert.rejects(d.sendSms('abc', 'x'), (e: any) => /ما انرسل/.test(e.message));
  await d.deleteSms('3');
  assert.equal((await d.listSms('inbox')).length, 0);
});

test('D-Link: الواي فاي (القناة · الاسم · الكلمة مشفّرة · إطفاء نطاق) والحظر', async () => {
  const { st, d } = await ready();
  assert.deepEqual((await d.getWifiRadios()).map((r: any) => [r.band, r.channel]), [['2.4', '0'], ['5', '36']]);
  await d.setWifiChannel('2.4', '6');
  assert.equal(st.wlan['2.4GHz'].channelNumber, '6');
  assert.equal(st.wlan['2.4GHz'].ssid, 'DLink_24', 'باقي الإعدادات تنرسل كما هي');
  assert.equal(st.wlan['2.4GHz'].channelWidth, '20MHz');
  await d.setWifiChannel('2.4', '0');
  assert.equal(st.wlan['2.4GHz'].channelNumber, 'Auto');

  const ex = await d.getExtras();
  assert.deepEqual(ex.wifiNets?.map((n: any) => [n.index, n.name, n.secured]), [['2.4', 'DLink_24', true], ['5', 'DLink_5', true]]);
  await d.setWifiNames([{ index: '2.4', name: 'بيتنا' }], 'NewPass123');
  assert.equal(st.wlan['2.4GHz'].ssid, 'بيتنا');
  const { dlDecrypt } = require('../src/drivers/dlink/crypto');
  assert.equal(dlDecrypt(st.sec['2.4GHz'].aps[0].encryptionKey, st.key), 'NewPass123');
  assert.equal(dlDecrypt(st.sec['5GHz'].aps[0].encryptionKey, st.key), 'NewPass123');
  await assert.rejects(d.setWifiNames([], 'short'), (e: any) => /ما غيّرنا شي/.test(e.message));
  await d.setBandOn('5', false);
  assert.equal(st.wlan['5GHz'].wirelessDisable, true);

  await d.blockDevice('aa:bb:cc:00:00:01', true, 'iPhone');
  assert.equal(st.ctrl['2.4GHz'].mode, 'deny');
  assert.deepEqual(st.ctrl['5GHz'].list, ['AA:BB:CC:00:00:01']);
  assert.equal((await d.getDevices())[0].blocked, true);
  await d.blockDevice('AA:BB:CC:00:00:01', false);
  assert.deepEqual(st.ctrl['2.4GHz'].list, []);
  assert.equal((await d.getDevices())[0].blocked, false);
});

test('D-Link: الحظر على «المسموح بس» ← ما نلمسه', async () => {
  const { st, d } = await ready({ ctrlMode: 'allow' });
  await assert.rejects(d.blockDevice('aa:bb:cc:00:00:01', true), (e: any) => /ما غيّرنا شي/.test(e.message));
  assert.equal(st.posts.length, 0);
  const r2 = await ready();
  r2.st.ctrl['2.4GHz'].list = ['11:22:33:44:55:66'];
  await assert.rejects(r2.d.blockDevice('aa:bb:cc:00:00:01', true), (e: any) => /أجهزة قديمة/.test(e.message));
  assert.equal(r2.st.posts.length, 0);
});

test('D-Link: كلمة غلط ← رسالة واضحة، ٥ محاولات ← قفل، وإعادة التشغيل', async () => {
  const st = router({ password: 'right' });
  const d = driver();
  await d.detect('192.168.0.1');
  await assert.rejects(d.login('192.168.0.1', 'admin', 'wrong'), /كلمة المرور غلط/);
  for (let i = 0; i < 3; i++) await d.login('192.168.0.1', 'admin', 'wrong').catch(() => {});
  await assert.rejects(d.login('192.168.0.1', 'admin', 'wrong'), /قفل الدخول/);
  st.fails = 0;
  await d.login('192.168.0.1', 'admin', 'right');
  await d.reboot();
  assert.deepEqual(st.posts, [{ name: 'reboot', body: '' }]);
});

test('D-Link: راوتر ثاني يرجّع صفحة HTML ← ما يتعرّف عليه', async () => {
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, url: 'http://192.168.8.1/', headers: { get: () => null }, text: async () => '<!doctype html><html>huawei</html>' });
  assert.equal(await driver().detect('192.168.8.1'), false);
});

test('D-Link parse: صيغ ثانية للإشارة (بادئة nr/lte · كائنات lte/nr · NR5G-NSA بدون قراءات) — حالة عضو DWR-2000M ٧ نوفمبر', () => {
  const { signalFrom, rowsFrom } = require('../src/drivers/dlink/parse');
  // صف واحد فيه 4G و 5G بالبادئة
  let s = signalFrom({ rf: [{ lteRsrp: '-97', lteSinr: '9', ltePcid: '120', lteEarfcn: '1300', nrRsrp: '-88', nr_sinr: '14', nrPcid: '501', nrArfcn: '636666', plmn: '42003' }] }, { netType: 'NR5G-NSA' });
  assert.equal(s.rsrp, -97);
  assert.equal(s.band, 'B3');
  assert.equal(s.nrRsrp, -88);
  assert.equal(s.nrBand, 'n78');
  assert.equal(s.network, '5G NSA');
  // كائنات متداخلة بدل rf[]
  s = signalFrom({ basic: { imei: 'x' }, lte: { RSRP: '-101 dBm', SINR: '4', PCI: '77', EARFCN: '6300' }, nr5g: { ss_rsrp: '-90', ss_sinr: '11', pci: '33', arfcn: '636666' } }, { netType: 'NR5G-NSA' });
  assert.equal(s.rsrp, -101);
  assert.equal(s.band, 'B20');
  assert.equal(s.nrRsrp, -90);
  // rf فاضي/أصفار والراوتر على NR5G-NSA ← ما نخترع أرقام، بس نوع الشبكة صح
  s = signalFrom({ rf: [{ rsrp: '0', rsrq: '', sinr: '', pcid: '', earfcn: '' }] }, { netType: 'NR5G-NSA' });
  assert.equal(s.rsrp, undefined);
  assert.equal(s.network, '5G NSA');
  assert.equal(s.nrActiveFromStatus, true);
  assert.equal(rowsFrom({ rf: [] }).length, 0);
});

test('D-Link: شكل الرد في التشخيص بدون IMEI/IMSI/CCID/IP', () => {
  const { dlShape } = require('../src/drivers/dlink/index');
  const t = dlShape({ basic: { imei: '356000000000009', imsi: '420040000', ccid: '8996', softwareVersion: 'V1' }, rf: [{ rsrp: '-95', pcid: '211' }], MobileNetwork: { ipAddress: '10.1.1.1', netType: 'NR5G-NSA' } });
  assert.equal(/356000000000009|420040000|8996|10\.1\.1\.1/.test(t), false);
  assert.match(t, /rsrp:-95/);
  assert.match(t, /netType:NR5G-NSA/);
});

test('D-Link DWR-2000M بلوحة 5G (boardID بدون _4G) ← 5G: الوضع «5G فقط» يطلع وتثبيت برج 5G مسموح', async () => {
  const st = router({ board: 'MT7621_5G' });
  st.band['5GNAS'] = { allBands: '78,41', enabledBand: '' };
  const d = driver();
  await d.detect('192.168.0.1');
  assert.equal((await d.identify()).tech, '5G');
  await d.login('192.168.0.1', 'admin', 'pw');
  assert.equal((await d.getNetworkInfo()).supports5g, true);
  assert.ok((await d.getBandConfig()).modes.some((m: any) => m.value === 'dl:5G'));
  await d.lockCell({ tech: 'NR', pci: '501', arfcn: '636666', band: 78 });
  assert.deepEqual(st.cell, { cellLockEnabled: true, netType: '5GNAS', pcid: '501', arfcn: '636666', band: '78', scs: '30' });
});

test('D-Link parse: أوامر AT — QENG (NSA/LTE/SA) و CESQ', () => {
  const { parseQeng, parseCesq } = require('../src/drivers/dlink/parse');
  const nsa = '+QENG: "servingcell","NOCONN"\r\n+QENG: "LTE","FDD",420,03,A5D9C02,211,1650,3,5,5,25F,-97,-11,-66,12,9,230,-\r\n+QENG: "NR5G-NSA",420,03,501,-88,15,-11,636666,78,12,1\r\n\r\nOK';
  const r = parseQeng(nsa);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].tech, r[0].band, r[0].pci, r[0].arfcn, r[0].rsrp, r[0].sinr, r[0].bandwidth, r[0].enodebId], ['LTE', 3, '211', '1650', -97, 12, 20, String(Math.floor(0xA5D9C02 / 256))]);
  assert.deepEqual([r[1].tech, r[1].band, r[1].pci, r[1].rsrp, r[1].sinr, r[1].bandwidth], ['NR', 78, '501', -88, 15, 100]);
  const sa = parseQeng('+QENG: &quot;servingcell&quot;,&quot;CONNECT&quot;,&quot;NR5G-SA&quot;,&quot;TDD&quot;,420,04,1A2B3C4D5,77,1F4,636666,78,12,-85,-10,18,1,-');
  assert.deepEqual([sa[0].tech, sa[0].band, sa[0].pci, sa[0].rsrp, sa[0].sinr], ['NR', 78, '77', -85, 18]);
  assert.equal(parseQeng('ERROR').length, 0);
  const c = parseCesq('+CESQ: 99,99,255,255,20,44,40,70,60\r\nOK');
  assert.deepEqual(c.map((x: any) => [x.tech, x.rsrp, x.rsrq, x.sinr]), [['LTE', -97, -10, undefined], ['NR', -87, -23, 7]]);
});

test('D-Link: rf[] فاضي (حالة العضو) ← الإشارة من AT+QENG، ولو ERROR ← AT+CESQ', async () => {
  const EMPTY = { basic: { ledLevel: 3 }, rf: [{ netType: '', rsrq: '', rsrp: '', rssi: '-', sinr: '', pcid: '', enodebid: '115097', earfcn: '', frequencyBand: '', bandwidth: '' }] };
  for (const quectel of [true, false]) {
    const st = router({ board: 'MT_5G', rf: EMPTY });
    const ats: string[] = [];
    const orig = (globalThis as any).fetch;
    (globalThis as any).fetch = async (url: string, init?: any) => {
      if (url.includes('/acfun/atCommand')) {
        const cmd = JSON.parse(init.body).atCommand; ats.push(cmd);
        const content = cmd.startsWith('AT+QENG') ? (quectel ? '+QENG: "servingcell","NOCONN"\n+QENG: "LTE","FDD",420,03,A5D9C02,211,1650,3,5,5,25F,-97,-11,-66,12,9,230,-\n+QENG: "NR5G-NSA",420,03,501,-88,15,-11,636666,78,12,1\nOK' : 'ERROR')
          : '+CESQ: 99,99,255,255,20,44,40,70,60\nOK';
        return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => JSON.stringify({ errcode: 0, info: { content } }) };
      }
      return orig(url, init);
    };
    const d = driver();
    await d.detect('192.168.0.1');
    await d.login('192.168.0.1', 'admin', 'pw');
    const s = await d.getSignal();
    if (quectel) {
      assert.deepEqual([s.band, s.rsrp, s.pci, s.nrBand, s.nrRsrp, s.network], ['B3', -97, '211', 'n78', -88, '5G NSA']);
      assert.ok(s.enodebId);
    } else {
      assert.deepEqual([s.rsrp, s.rsrq, s.nrRsrp, s.nrSinr], [-97, -10, -87, 7]);
      assert.equal(s.enodebId, '115097', 'رقم الموقع من rf لو AT ما يعطيه');
      await d.getSignal();
      assert.equal(ats.filter(a => a.startsWith('AT+QENG')).length, 1, 'QENG فشل مرة ← ما نعيده');
    }
    assert.ok(ats.every(a => /^AT\+(QENG="servingcell"|CESQ)$/.test(a)), 'أوامر قراءة بس');
    void st;
  }
});
