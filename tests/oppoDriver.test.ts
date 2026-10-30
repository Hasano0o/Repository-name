/**
 * درايفر OPPO 5G CPE كامل على راوتر محاكى بنفس بروتوكول الصفحة الحقيقية:
 * RSA-OAEP للمفتاح، AES-256-CTR للطلب والرد، sum = sha256، BatchRequest، ErrorCode 5 لمفتاح ما ينفهم.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';

declare const require: any;
declare const process: any;
declare const Buffer: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'expo-crypto') return { getRandomBytes: (n: number) => Uint8Array.from((ncrypto as any).randomBytes(n)) };
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

const kp = (ncrypto as any).generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const sha = (s: string) => (ncrypto as any).createHash('sha256').update(s).digest('hex');
const ctr = (key: string, iv: string, buf: any) => {
  const c = (ncrypto as any).createCipheriv('aes-256-ctr', Buffer.from(key), Buffer.from(iv).subarray(0, 16));
  return Buffer.concat([c.update(buf), c.final()]);
};

function router(opts: { password?: string; pkcs1Only?: boolean } = {}) {
  const st: any = {
    netMode: 1, led: 1, upnp: 0, dmz: { Enable: 0, IpAddr: '' }, macEnable: 0, macMode: 1, black: [] as any[], nextId: 1,
    iface: {
      iface10: { SSID: 'OPPO_2.4', Key: 'oldpass11', Encryption: 'wpa2', Enable: 1, Hide: 0, EncType: 'aes' },
      iface00: { SSID: 'OPPO_5G', Key: 'oldpass11', Encryption: 'wpa2', Enable: 1, Hide: 0, EncType: 'aes' },
    },
    guest: { SSID: 'OPPO_Guest', Key: '', Enable: 0, Hide: 1, Encryption: 'none', GuestList: ['iface11'] },
    dev: { wifi0: { Strength: 1, Channel: 0, Width: '80', Mode: '11axa' }, wifi1: { Strength: 1, Channel: 6, Width: '40', Mode: '11axg' } },
    sms: [{ SrcAddr: '700', UnReadNum: 1, SmsList: [
      { SmsSn: 11, Data: 'رصيدك 50', Type: 1, TimeStamp: '20261026101500' },
      { SmsSn: 10, Data: 'قديمة', Type: 1, TimeStamp: '20261025090000' },
      { SmsSn: 12, Data: 'رصيد', Type: 2, TimeStamp: '20261026101400' },
    ] }],
    sent: [] as any[], cmds: [] as string[], writes: 0, logged: false,
  };
  const keys = new Map<string, { key: string; iv: string }>();
  const res = (status: number, text: string, headers: Record<string, string> = {}) =>
    ({ ok: status < 400, status, url: 'http://192.168.0.1/', headers: { get: (h: string) => headers[h.toLowerCase()] ?? null }, text: async () => text } as any);
  const modesList = { ErrorCode: 0, List: [{ Key: 'Auto', Value: 1 }, { Key: 'AutoSA', Value: 2 }, { Key: 'Only5G', Value: 3 }, { Key: 'OnlySA5G', Value: 4 }, { Key: 'Only4G', Value: 6 }] };
  const handle = (path: string, d: any): any => {
    const W = (x: any) => { st.writes++; return x; };
    switch (path) {
      case '/userLoginCgi/userLogin':
        st.logged = d.username === 'admin' && d.password === sha(opts.password ?? 'pw');
        return st.logged ? { ErrorCode: 0, isCheckedPass: true } : { ErrorCode: 2, isCheckedPass: false, LeftCount: 2 };
      case '/userLogin/loginOut': return { ErrorCode: 0 };
    }
    if (!st.logged) return { ErrorCode: 401 };
    switch (path) {
      case '/webCgi/BatchRequest': {
        const results: any = {};
        for (const j of d) results[j.name] = handle(`/${j.apiService}/${j.apiName}`, j.data);
        return { ErrorCode: 0, results };
      }
      case '/NasMng/GetSysInfo': return { ErrorCode: 0, SrvStatus: 2, NetMode: '4G', Plmn: 'Zain KSA', RoamStatus: 0 };
      case '/NasMng/GetSignal': return { ErrorCode: 0, NetMode: '4G', '4G': { Rsrp: -95, Rsrq: -11, Sinr: 14 } };
      case '/NasService/GetSignal':
        assert.equal(d?.Type, 1);
        return { ErrorCode: 0, SCG: 1, '4G_RSRP': -96, '4G_RSRQ': -10, '4G_SINR': 13, '5G_RSRP': -88, '5G_RSRQ': -12, '5G_SINR': 9, '5G_RSRPValid': 1, '5G_RSRQValid': 1, '5G_SINRValid': 0 };
      case '/NasMng/GetCellInfo': return { ErrorCode: 0, PhyCellId: 301 };
      case '/NasService/GetCellInfo': return { ErrorCode: 0, NetMode: 1, LtePhyCellId: 301, NrPhyCellId: 77 };
      case '/NasMng/GetBandInfo': return { ErrorCode: 0, Band: ['B3', 'n78'], CaBand: ['B1'] };
      case '/NasMng/GetCaInfo': return { ErrorCode: 0, Status: 1 };
      case '/NasMng/GetNetModeList': return modesList;
      case '/NasMng/GetNetMode': return { ErrorCode: 0, NetMode: st.netMode };
      case '/NasMng/SetNetMode': W(0); st.netMode = d.NetMode; return { ErrorCode: 0 };
      case '/ommng/GetDeviceInfo': return { ErrorCode: 0, deviceName: 'OPPO 5G CPE T1a', vendor: 'OPPO' };
      case '/ommng/GetSysInfo': return { ErrorCode: 0, CumulationUptime: 93784 };
      case '/UpgMng/QueryVersion': return { ErrorCode: 0, DisplayVersion: 'T1a_11.A.20', HardwareVersion: 'V1.0' };
      case '/DialupMng/GetStatus': return { ErrorCode: 0, IpAddr: '10.1.2.3' };
      case '/NetStats/GetStats': return { ErrorCode: 0, Stats: [{ BytesReceived: 5000, BytesSent: 700, RateReceived: 8000, RateSent: 800 }] };
      case '/ommng/Reboot': st.cmds.push('reboot'); assert.equal(d, undefined); return { ErrorCode: 0 };
      case '/ommng/Reset': st.cmds.push('reset'); return { ErrorCode: 0 };
      case '/TerminalMgr/GetOnlineTerminal': return { ErrorCode: 0, OnlineTerminal: [{ Mac: 'aa:bb:cc:dd:ee:01', Name: 'PS5', IpAddr: '192.168.0.20', ConnectionType: 1 }, { Mac: 'aa:bb:cc:dd:ee:02', Name: '*', IpAddr: '192.168.0.21', ConnectionType: 3 }] };
      case '/MacFilter/GetEnable': return { ErrorCode: 0, Enable: st.macEnable };
      case '/MacFilter/GetMode': return { ErrorCode: 0, Mode: st.macMode };
      case '/MacFilter/GetMacList': return { ErrorCode: 0, BlackList: st.macMode === 0 ? st.black : [], WhiteList: st.macMode === 1 ? [] : [] };
      case '/MacFilter/ModeChange': W(0); st.macMode = d.Mode; return { ErrorCode: 0 };
      case '/MacFilter/SetEnable': W(0); st.macEnable = d.Enable; return { ErrorCode: 0 };
      case '/MacFilter/AddMac': W(0); st.black.push({ ID: st.nextId++, MacAddr: d.MacAddr }); return { ErrorCode: 0 };
      case '/MacFilter/DelMac': W(0); st.black = st.black.filter((x: any) => x.ID !== d.ID); return { ErrorCode: 0 };
      case '/Sms/GetSmsSession': return { ErrorCode: 0, PageIndex: 1, SessionNum: st.sms.length, SessionList: st.sms.map((x: any) => ({ ...x, SmsList: x.SmsList.slice(0, 1) })) };
      case '/Sms/GetSessionContext': return { ErrorCode: 0, TotalNum: 3, SmsList: (st.sms.find((x: any) => x.SrcAddr === d.SrcAddr)?.SmsList ?? []) };
      case '/Sms/SetReadStatus': W(0); for (const x of st.sms) if (d.SrcAddr.includes(x.SrcAddr)) x.UnReadNum = 0; return { ErrorCode: 0 };
      case '/Sms/DelSms': W(0); for (const x of st.sms) if (x.SrcAddr === d.SrcAddr) x.SmsList = x.SmsList.filter((m: any) => !d.SmsSn.includes(m.SmsSn)); return { ErrorCode: 0 };
      case '/Sms/GetStorageStatus': return { ErrorCode: 0, StorageStatus: 0 };
      case '/Sms/SendSms': W(0); st.sent.push(d); return { ErrorCode: 0 };
      case '/LedMng/GetEnable': return { ErrorCode: 0, Enable: st.led };
      case '/LedMng/SetEnable': W(0); st.led = d.Enable; return { ErrorCode: 0 };
      case '/Upnp/GetConfig': return { ErrorCode: 0, Enable: st.upnp };
      case '/Upnp/SetConfig': W(0); st.upnp = d.Enable; return { ErrorCode: 0 };
      case '/Upnp/GetRuleList': return { ErrorCode: 0, UpnpPortMap: [{ AppDesp: 'Xbox', LocalIP: '192.168.0.20', WanPort: 3074, Protocol: 'UDP' }] };
      case '/Dmz/GetConfig': return { ErrorCode: 0, ...st.dmz };
      case '/Dmz/SetConfig': W(0); st.dmz = { Enable: d.Enable, IpAddr: d.IpAddr }; return { ErrorCode: 0 };
      case '/Wifi/Get5gPerfConfig': return { ErrorCode: 0, '5GPerf': 0 };
      case '/Wifi/GetIfaceConfig': return { ErrorCode: 0, ...JSON.parse(JSON.stringify(st.iface)) };
      case '/Wifi/SetIfaceConfig':
        W(0);
        for (const k of ['iface10', 'iface00']) { assert.deepEqual(Object.keys(d[k]).sort(), ['Enable', 'EncType', 'Encryption', 'Hide', 'Key', 'SSID']); st.iface[k] = d[k]; }
        return { ErrorCode: 0 };
      case '/Wifi/GetGuestConfig': return { ErrorCode: 0, ...st.guest };
      case '/Wifi/SetGuestConfig': W(0); st.guest = d; return { ErrorCode: 0 };
      case '/Wifi/ApplyOver': return { ErrorCode: 0, Over: 1 };
      case '/Wifi/GetDevConfig': return { ErrorCode: 0, ...JSON.parse(JSON.stringify(st.dev)) };
      case '/Wifi/GetAllChannelList': return { ErrorCode: 0, Channel: [{ Type: '24G', ChannelList: [1, 6, 11] }, { Type: '5G', ChannelList: [36, 149] }] };
      case '/Wifi/SetDevConfig': W(0); st.dev = d; return { ErrorCode: 0 };
    }
    return { ErrorCode: 99 };
  };
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.pathname === '/api/webCgi/GetPemKey') return res(200, JSON.stringify({ data: { pem: kp.publicKey } }));
    if (!u.pathname.startsWith('/api/') || init?.method !== 'POST') return res(404, '');
    const body = JSON.parse(init.body);
    let k = keys.get(body.AES);
    if (!k) {
      try {
        const plain = testPrivateDecrypt(
          opts.pkcs1Only ? { key: kp.privateKey, padding: (ncrypto as any).constants.RSA_PKCS1_PADDING }
            : { key: kp.privateKey, padding: (ncrypto as any).constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
          Buffer.from(body.AES, 'base64')).toString();
        // node يرجّع بايتات عشوائية بدل الخطأ لو الحشو غلط (implicit rejection) — نتأكد من الشكل
        if (!/^[0-9A-F]{32}\.[0-9A-F]{32}$/.test(plain)) throw new Error('bad');
        const [key, iv] = plain.split('.');
        k = { key, iv }; keys.set(body.AES, k);
      } catch { return res(200, JSON.stringify({ ErrorCode: 5 })); }
    }
    const inner = JSON.parse(ctr(k.key, k.iv, Buffer.from(body.data, 'base64')).toString());
    assert.equal(body.sum, sha(body.data + inner.randomToken + body.JWT), 'sum صحيح');
    const out = handle(u.pathname.slice(4), inner.data);
    if (out.ErrorCode === 401) return res(401, '');
    return res(200, ctr(k.key, k.iv, Buffer.from(JSON.stringify({ data: out }))).toString('base64'));
  };
  return st;
}

const driver = () => { const { OppoDriver } = require('../src/drivers/oppo/index'); return new OppoDriver(); };


function testPrivateDecrypt(opts: any, ciphertext: any): any {
  const crypto: any = require('node:crypto');
  if (opts.padding !== crypto.constants.RSA_PKCS1_PADDING) {
    return crypto.privateDecrypt(opts, ciphertext);
  }

  // Test-only PKCS#1 v1.5 decoding using the private RSA operation.
  const jwk: any = crypto.createPrivateKey(opts.key).export({ format: 'jwk' });
  const fromB64Url = (s: string) =>
    Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  const n = BigInt('0x' + fromB64Url(jwk.n).toString('hex'));
  const d = BigInt('0x' + fromB64Url(jwk.d).toString('hex'));
  const c = BigInt('0x' + Buffer.from(ciphertext).toString('hex'));

  function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    base %= mod;
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % mod;
      base = (base * base) % mod;
      exp >>= 1n;
    }
    return result;
  }

  const width = fromB64Url(jwk.n).length;
  let hex = modPow(c, d, n).toString(16).padStart(width * 2, '0');
  if (hex.length > width * 2) throw new Error('RSA test block too long');

  const block = Buffer.from(hex, 'hex');
  if (block[0] !== 0 || block[1] !== 2) {
    throw new Error('Invalid PKCS#1 v1.5 test padding');
  }

  const separator = block.indexOf(0, 2);
  if (separator < 10) throw new Error('Invalid PKCS#1 v1.5 padding separator');
  return block.subarray(separator + 1);
}

test('OPPO: يتعرف عليه، يدخل، ويقرأ الإشارة 4G + 5G NSA والترددات والدمج', async () => {
  router();
  const d = driver();
  assert.equal(await d.detect('192.168.0.1'), true);
  await d.login('192.168.0.1', '', 'pw');
  const s = await d.getSignal();
  assert.equal(s.network, '5G NSA');
  assert.equal(s.rsrp, -96); assert.equal(s.sinr, 13); assert.equal(s.pci, '301');
  assert.equal(s.nrRsrp, -88); assert.equal(s.nrSinr, undefined); assert.equal(s.nrPci, '77');
  assert.equal(s.band, 'B3'); assert.equal(s.nrBand, 'n78'); assert.equal(s.caCount, 3);
  const cells = await d.getCells();
  assert.deepEqual(cells.map((c: any) => [c.kind, c.tech, c.pci]), [['serving', 'LTE', '301'], ['secondary', 'NR', '77']]);
  const ca = await d.getCarriers();
  assert.deepEqual(ca.map((c: any) => [c.tech, c.band, c.role]), [['LTE', 3, 'PCC'], ['NR', 78, 'PCC'], ['LTE', 1, 'SCC']]);
  const m = await d.identify();
  assert.equal(m.brand, 'oppo'); assert.match(m.label, /T1a/);
  const det = await d.getDeviceDetails();
  assert.equal(det.software, 'T1a_11.A.20'); assert.equal(det.wanIp, '10.1.2.3');
  assert.deepEqual(await d.getUsage(), { downloadBytes: 5000, uploadBytes: 700 });
});

test('OPPO: كلمة مرور غلط ← رسالة فيها المحاولات الباقية', async () => {
  router({ password: 'right' });
  const d = driver();
  await assert.rejects(d.login('192.168.0.1', 'admin', 'wrong'), /غلط.*باقي 2/);
});

test('OPPO: الراوتر ما يفهم OAEP ← نتحوّل لـ PKCS#1 لحالنا ونكمّل', async () => {
  router({ pkcs1Only: true });
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'pw');
  assert.equal((await d.getSignal()).pci, '301');
});

test('OPPO: وضع الشبكة من قائمة الراوتر — 4G فقط و SA فقط، وتثبيت الترددات يوقف قبل أي أمر', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'pw');
  const c = await d.getBandConfig();
  assert.equal(c.mode, '00');
  assert.deepEqual(c.modes.map((m: any) => m.value), ['00', '0803', 'nsa', '08', '03']);
  assert.equal(c.supported.length + c.nrSupported.length, 0);
  await d.setNetworkMode('03');
  assert.equal(st.netMode, 6);
  assert.equal((await d.getBandConfig()).mode, '03');
  await d.setNetworkMode('08');
  assert.equal(st.netMode, 4);
  const n = st.writes;
  await assert.rejects(d.setBand([3]), (e: any) => e.noChange === true && /OPPO/.test(e.message));
  await assert.rejects(d.setNetworkMode('xx'), (e: any) => e.noChange === true);
  assert.equal(st.writes, n);
});

test('OPPO: الأجهزة والحظر بالقائمة السوداء (يحوّل الوضع لو الفلتر طافي)، وفك الحظر', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'pw');
  const devs = await d.getDevices();
  assert.deepEqual(devs.map((x: any) => [x.mac, x.name, x.blocked]), [['AA:BB:CC:DD:EE:01', 'PS5', false], ['AA:BB:CC:DD:EE:02', undefined, false]]);
  await d.blockDevice('aa:bb:cc:dd:ee:02', true);
  assert.equal(st.macMode, 0); assert.equal(st.macEnable, 1);
  assert.deepEqual((await d.getBlockedDevices()).map((x: any) => x.mac), ['AA:BB:CC:DD:EE:02']);
  assert.equal((await d.getDevices())[1].blocked, true);
  await d.blockDevice('AA:BB:CC:DD:EE:02', false);
  assert.equal(st.black.length, 0);
  // القائمة البيضاء شغالة ← ما نلمسها
  st.macMode = 1; st.macEnable = 1;
  const n = st.writes;
  await assert.rejects(d.blockDevice('AA:BB:CC:DD:EE:01', true), (e: any) => e.noChange === true);
  assert.equal(st.writes, n);
});

test('OPPO: الرسائل — الواردة والمرسلة، غير المقروءة، القراءة والحذف والإرسال', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'pw');
  const inbox = await d.listSms('inbox');
  assert.deepEqual(inbox.map((m: any) => [m.content, m.unread, m.date]), [['رصيدك 50', true, '2026-10-26 10:15:00'], ['قديمة', false, '2026-10-25 09:00:00']]);
  assert.deepEqual((await d.listSms('sent')).map((m: any) => m.content), ['رصيد']);
  await d.markSmsRead(inbox[0].index);
  assert.equal(st.sms[0].UnReadNum, 0);
  await d.deleteSms(inbox[1].index);
  assert.equal(st.sms[0].SmsList.length, 2);
  await d.sendSms('700', 'رصيد');
  assert.deepEqual(st.sent, [{ PhoneNum: '700', Data: 'رصيد', Hide: 0 }]);
});

test('OPPO: إعادة التشغيل بدون بيانات (مثل الصفحة) وضبط المصنع', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'pw');
  await d.reboot();
  await d.factoryReset();
  assert.deepEqual(st.cmds, ['reboot', 'reset']);
});

test('OPPO مركز التحكم: القراءة — الأنوار، UPnP، DMZ، الشبكتين، الضيوف، مدة التشغيل', async () => {
  router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'pw');
  const ex = await d.getExtras();
  assert.equal(ex.led, true); assert.equal(ex.upnp, false);
  assert.deepEqual(ex.dmz, { on: false, ip: '' });
  assert.deepEqual(ex.bands, [{ band: '2.4', on: true }, { band: '5', on: true }]);
  assert.deepEqual(ex.wifiNets.map((n: any) => [n.index, n.name]), [['iface10', 'OPPO_2.4'], ['iface00', 'OPPO_5G']]);
  assert.deepEqual(ex.guest, { on: false, name: 'OPPO_Guest', open: true, offHours: 0, noTimer: true });
  assert.equal(ex.uptime, '26:03:04');
  assert.ok(!JSON.stringify(ex).includes('oldpass11'), 'كلمة مرور الواي فاي ما تطلع للشاشة');
});

test('OPPO مركز التحكم: التغييرات — الأنوار، UPnP (والمنافذ)، DMZ، إطفاء 5G، الضيوف', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'pw');
  await d.setLed(false); assert.equal(st.led, 0);
  await d.setUpnp(true);
  const ex = await d.getExtras();
  assert.deepEqual(ex.upnpMaps, [{ app: 'Xbox', ip: '192.168.0.20', port: '3074', proto: 'UDP' }]);
  await d.setDmz(true, '192.168.0.20'); assert.deepEqual(st.dmz, { Enable: 1, IpAddr: '192.168.0.20' });
  await d.setDmz(false, '192.168.0.20'); assert.deepEqual(st.dmz, { Enable: 0, IpAddr: '' });
  await d.setBandOn('5', false);
  assert.equal(st.iface.iface00.Enable, 0); assert.equal(st.iface.iface10.Enable, 1);
  assert.equal(st.iface.iface10.Key, 'oldpass11'); // كلمة المرور الحالية ترجع مثل ما هي
  await d.setGuest(true);
  assert.equal(st.guest.Enable, 1); assert.deepEqual(st.guest.GuestList, ['iface11']);
});

test('OPPO مركز التحكم: اسم الواي فاي وكلمته — والشروط توقف قبل أي أمر', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'pw');
  await d.setWifiNames([{ index: 'iface10', name: 'Bandly' }, { index: 'iface00', name: 'Bandly_5G' }], 'NewPass123');
  assert.equal(st.iface.iface10.SSID, 'Bandly'); assert.equal(st.iface.iface00.SSID, 'Bandly_5G');
  assert.equal(st.iface.iface10.Key, 'NewPass123'); assert.equal(st.iface.iface00.Key, 'NewPass123');
  const n = st.writes;
  await assert.rejects(d.setWifiNames([{ index: 'iface10', name: 'x' }], 'short'), (e: any) => e.noChange === true);
  await assert.rejects(d.setWifiNames([{ index: 'iface10', name: 'a'.repeat(33) }]), (e: any) => e.noChange === true);
  assert.equal(st.writes, n);
});

test('OPPO: قناة الواي فاي — wifi0 = 5G و wifi1 = 2.4G، و0 = تلقائي', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'pw');
  const r = await d.getWifiRadios();
  assert.deepEqual(r.map((x: any) => [x.band, x.channel, x.allowed.join(',')]), [['2.4', '6', '1,6,11'], ['5', '0', '36,149']]);
  await d.setWifiChannel('5', '149');
  assert.equal(st.dev.wifi0.Channel, 149); assert.equal(st.dev.wifi1.Channel, 6);
  assert.deepEqual(Object.keys(st.dev.wifi0).sort(), ['Channel', 'Mode', 'Strength', 'Width']);
});
