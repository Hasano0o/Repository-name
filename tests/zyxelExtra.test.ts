/**
 * زيكسل — ميزات الصفحة (ملفات FULL لـ NR5103E و FWA505، ٣١ أكتوبر): الواي فاي، الرسائل، حظر الأجهزة، البوصلة.
 * دوال صافية + الدرايفر على راوتر محاكى (بدون مفتاح RSA ← JSON عادي، نفس مسار الصفحة لما RSAPublicKey = None).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'expo-crypto') return { getRandomBytes: (n: number) => Uint8Array.from(require('crypto').randomBytes(n)) };
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

const X = require('../src/drivers/zyxel/extra');

const W = (i: number, o: any = {}) => ({ Index: i, wlEnable: true, oneSsidEnable: false, SSID: 'Net' + i, wlHide: false, SecurityMode: 'WPA2-Personal', AutoGenPSK: true, PskDisplay: 'oldpass11', RekeyingInterval: 3600, PossibleChannels: '1,6,11', channel: 6, AutoChannelEnable: false, ...o });

test('زيكسل: مصفوفة الواي فاي نفس الصفحة — النطاقين منفصلين، شبكة وحدة، وبدون 5G', () => {
  const list = [W(1), W(2, { SSID: 'Guest' }), W(3), W(4), W(5, { SecurityMode: 'WPA2-WPA3-Personal' }), W(6, { SSID: 'Guest5' })];
  const p: any[] = X.zxWlanPayload(list, true, [{ index: '1', name: 'Bandly' }], 'newpass99');
  assert.equal(p.length, 4);
  assert.deepEqual(p[0], { Index: 1, wlEnable: true, oneSsidEnable: false, SSID: 'Bandly', wlHide: false, securityLevel: 'MoreSecure', wpaMode: 'wpa2psk', encryp: 'aes', AutoGenPSK: false, psk_value: 'newpass99', RekeyingInterval: 3600 });
  assert.deepEqual(p[1], { Index: 2, SSID: 'Guest' });
  assert.equal(p[2].SSID, 'Net5'); assert.equal(p[2].wpaMode, 'wpa2wpa3psk'); assert.equal(p[2].psk_value, 'newpass99');
  assert.deepEqual(p[3], { Index: 6, SSID: 'Guest5' });
  const one: any[] = X.zxWlanPayload([W(1, { oneSsidEnable: true }), W(2), W(3), W(4), W(5, { wlEnable: false })], true, [{ index: '1', name: 'A' }]);
  assert.deepEqual(one[1], { Index: 5, wlEnable: false, oneSsidEnable: true });
  assert.equal(one[0].psk_value, 'oldpass11'); assert.equal(one[0].AutoGenPSK, true);
  const single: any = X.zxWlanPayload([W(1)], false, [], 'x12345678');
  assert.equal(single.Index, 1); assert.equal('oneSsidEnable' in single, false);
});

test('زيكسل: الرسائل — UCS2 والـ GSM (hex) والتاريخ، والإرسال IRA/UCS2 بحدود رسالة وحدة', () => {
  const o = { SMS_Inbox: [
    { ObjIndex: 3, From: '959', FromType: 129, TimeStamp: '26/10/31,12:05:44+12', CharacterSet: 2, Content: '0631063506360020', State: 0 },
    { ObjIndex: 4, From: 'Zain', FromType: 208, TimeStamp: '26/10/30,09:00:00+12', CharacterSet: 1, Content: 'Hello', State: 1 },
    { ObjIndex: 5, From: '0550', FromType: 129, TimeStamp: '26/10/29,09:00:00+12', CharacterSet: 0, Content: '486921', State: 2 },
  ] };
  const inbox = X.zxSmsList(o, 'inbox', true);
  assert.equal(inbox.length, 2);
  assert.deepEqual(inbox[0], { index: '3', phone: '959', content: 'رصض ', date: '2026-10-31 12:05:44', unread: true });
  assert.equal(inbox[1].content, 'Hello'); assert.equal(inbox[1].unread, false);
  const sent = X.zxSmsList(o, 'sent', true);
  assert.equal(sent[0].content, 'Hi!');
  assert.equal(X.gsmHexDecode('1B65'), '€');
  const b = X.zxSmsBody('+966 55', 'رصيد', true);
  assert.equal(b.SMS_CharacterSet, 'UCS2'); assert.equal(b.SMS_Content, '06310635064a062f'); assert.equal(b.SMS_To, '96655');
  assert.deepEqual(b.SMS_Content_divData, ['06310635064a062f']); assert.deepEqual(b.SMS_Content_divLen, [4]);
  const a = X.zxSmsBody('900', 'Hi', false);
  assert.equal(a.SMS_CharacterSet, 'IRA'); assert.equal(a.SMS_Content, '4869'); assert.equal('SMS_Content_divData' in a, false);
  assert.equal(X.zxSmsBody('900', 'ع'.repeat(71), true), null);
});

test('زيكسل: حظر الأجهزة — ADD / EDIT / DELE بالـ Index، والقائمة المسموحة ما تنحسب حظر', () => {
  const o = { MAC: { Filter_Enable: false, Restrict: false }, whitelist: [{ List_Enable: false, HostName: 'TV', MACAddress: 'AA:00:00:00:00:01' }] };
  assert.deepEqual(X.zxBlocked(o), []);
  assert.deepEqual(X.zxBlockPayload(o, 'aa:00:00:00:00:02', true, 'Phone'), [{ Filter_Enable: true, Restrict: true }, { Action: 'ADD', Index: 0, List_Enable: true, HostName: 'Phone', MACAddress: 'AA:00:00:00:00:02' }]);
  assert.deepEqual(X.zxBlockPayload(o, 'AA:00:00:00:00:01', true), [{ Filter_Enable: true, Restrict: true }, { Action: 'EDIT', Index: 1, HostName: 'TV', MACAddress: 'AA:00:00:00:00:01', List_Enable: true }]);
  const on = { MAC: { Filter_Enable: true, Restrict: true }, whitelist: [{ List_Enable: true, HostName: 'TV', MACAddress: 'AA:00:00:00:00:01' }] };
  assert.deepEqual(X.zxBlocked(on).map((d: any) => d.mac), ['AA:00:00:00:00:01']);
  assert.deepEqual(X.zxBlockPayload(on, 'AA:00:00:00:00:01', false), [{ Filter_Enable: true, Restrict: true }, { Action: 'DELE', Index: 1 }]);
  assert.equal(X.zxBlockPayload(on, 'AA:00:00:00:00:01', true), null);
  assert.deepEqual(X.zxBlocked({ MAC: { Filter_Enable: true, Restrict: false }, whitelist: on.whitelist }), []);
});

test('زيكسل FWA505: البوصلة — الزاوية والدقة والتعويض والاتجاه المحفوظ، وأثناء المعايرة ما فيه قراءة', () => {
  assert.deepEqual(X.zxAzimuth({ AzimuthStatus: 'RetrieveDate', mag: [{ angle: '212', accuracy: '3', compStatus: '1', AngleAfterCompensation: '215', lockStatus: '1', lockAngle: '200' }] }),
    { deg: 212, accuracy: 3, compensated: 215, lockDeg: 200 });
  assert.deepEqual(X.zxAzimuth({ AzimuthStatus: 'RetrieveDate', mag: [{ angle: 90, accuracy: 1, compStatus: '0', lockStatus: '0' }] }), { deg: 90, accuracy: 1 });
  assert.equal(X.zxAzimuth({ AzimuthStatus: 'Calibrating', CalibProgress: [{ Progress: 40 }] }), null);
});

// ═══ الدرايفر على راوتر محاكى ═══
function router(flags: any = { Support5G: true, supportSmsCmd: true }, model = 'FWA505') {
  const st: any = {
    wlan: [W(1), W(2, { SSID: 'Guest' }), W(3), W(4), W(5), W(6, { SSID: 'G5' })],
    sms: { SMS_Enable: true, SMS_Inbox: [{ ObjIndex: 7, From: '959', FromType: 129, TimeStamp: '26/10/31,10:00:00+12', CharacterSet: 1, Content: 'Balance &amp; more', State: 0 }] },
    mac: { MAC: { Filter_Enable: false, Restrict: false }, whitelist: [] as any[] },
    puts: [] as any[], posts: [] as any[], dels: [] as string[], checks: 0,
  };
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as any);
  const ok = (Object?: unknown) => res(200, { result: 'ZCFG_SUCCESS', ...(Object ? { Object } : {}) });
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = init?.method ?? 'GET';
    const oid = u.searchParams.get('oid');
    if (u.pathname === '/getBasicInformation') return res(200, { result: 'ZCFG_SUCCESS', ModelName: model });
    if (u.pathname === '/GetInfoNoLogin') return res(200, { result: 'ZCFG_SUCCESS' });
    if (u.pathname === '/getRSAPublickKey') return res(200, { result: 'ZCFG_SUCCESS', RSAPublicKey: 'None' });
    if (u.pathname === '/getWebGuiFlag') return res(200, flags);
    if (u.pathname === '/UserLogin') return res(200, { result: 'ZCFG_SUCCESS', sessionkey: 'SK1' });
    if (u.pathname === '/cgi-bin/Wireless') { st.checks++; return res(200, { result: 'ZCFG_SUCCESS' }); }
    if (u.pathname !== '/cgi-bin/DAL') return res(404, {});
    assert.equal(u.searchParams.get('sessionkey'), 'SK1');
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (oid === 'wlan') {
      if (m === 'GET') return ok(st.wlan);
      st.puts.push(body);
      for (const e of Array.isArray(body) ? body : [body]) {
        const t = st.wlan.find((x: any) => x.Index === e.Index);
        if (e.SSID !== undefined) t.SSID = e.SSID;
        if (e.psk_value !== undefined) t.PskDisplay = e.psk_value;
        if (e.wlEnable !== undefined) t.wlEnable = e.wlEnable;
        if (e.channel !== undefined) { t.channel = e.channel; t.AutoChannelEnable = e.channel === 0; }
      }
      return ok();
    }
    if (oid === 'cellwan_sms') {
      if (m === 'GET') return ok([st.sms]);
      if (m === 'DELETE') { st.dels.push(u.searchParams.get('objIndex')); return ok(); }
      if (m === 'POST') { st.posts.push(body); return ok(); }
      if (m === 'PUT') { st.puts.push(body); return ok(); }
    }
    if (oid === 'macfilter') {
      if (m === 'GET') return ok([st.mac]);
      st.puts.push(body);
      const [head, row] = body;
      st.mac.MAC = { Filter_Enable: head.Filter_Enable, Restrict: head.Restrict };
      if (row.Action === 'ADD') st.mac.whitelist.push({ List_Enable: row.List_Enable, HostName: row.HostName, MACAddress: row.MACAddress });
      if (row.Action === 'DELE') st.mac.whitelist.splice(row.Index - 1, 1);
      return ok();
    }
    if (oid === 'azimuth') return ok([{ AzimuthStatus: 'RetrieveDate', mag: [{ angle: '133', accuracy: '2', compStatus: '0', lockStatus: '0' }] }]);
    return res(200, { result: 'ZCFG_ERROR' });
  };
  return st;
}
const driver = async () => { const { ZyxelDriver } = require('../src/drivers/zyxel/index'); const d = new ZyxelDriver(); await d.login('192.168.1.1', 'admin', 'pw', { fresh: true }); return d; };

test('زيكسل (درايفر): الواي فاي — الشبكات في مركز التحكم، تغيير الاسم والكلمة، وإطفاء 5G، والقناة للعرض بس', async () => {
  const st = router();
  const d = await driver();
  const ex = await d.getExtras();
  assert.deepEqual(ex.wifiNets.map((n: any) => `${n.index}:${n.band}:${n.name}`), ['1:2.4:Net1', '5:5:Net5']);
  await d.setWifiNames([{ index: '5', name: 'Bandly5' }], 'brandnew1');
  assert.equal(st.wlan[4].SSID, 'Bandly5'); assert.equal(st.wlan[4].PskDisplay, 'brandnew1'); assert.equal(st.wlan[0].SSID, 'Net1');
  assert.equal(st.checks, 1);
  await d.setBandOn('5', false);
  assert.deepEqual(st.puts.at(-1), { Index: 5, wlEnable: false });
  await assert.rejects(d.setWifiNames([], 'short'), (e: any) => e.noChange === true);
  const radios = await d.getWifiRadios();
  assert.deepEqual(radios[0], { band: '2.4', channel: '6', allowed: ['1', '6', '11'], writable: true });
});

test('زيكسل (درايفر): الرسائل — قراءة (رموز HTML تنفك)، مقروءة، حذف، إرسال · وحظر وفك جهاز · والبوصلة', async () => {
  const st = router();
  const d = await driver();
  const l = await d.listSms('inbox');
  assert.equal(l[0].content, 'Balance & more');
  await d.markSmsRead('7');
  assert.deepEqual(st.puts.at(-1), { setSmsState: 1, SMS_InboxObjId: 7 });
  await d.deleteSms('7');
  assert.deepEqual(st.dels, ['7']);
  await d.sendSms('959', 'رصيد');
  assert.equal(st.posts[0].SMS_CharacterSet, 'UCS2');
  await d.blockDevice('aa:bb:cc:00:00:01', true, 'Phone');
  assert.deepEqual((await d.getBlockedDevices()).map((x: any) => x.mac), ['AA:BB:CC:00:00:01']);
  await d.blockDevice('AA:BB:CC:00:00:01', false);
  assert.deepEqual(await d.getBlockedDevices(), []);
  assert.deepEqual(await d.getAzimuth(), { deg: 133, accuracy: 2 });
});

test('زيكسل (درايفر): بدون supportSmsCmd ما نرسل أمر «مقروءة» · القائمة المسموحة ← ما نحظر', async () => {
  const st = router({ Support5G: false });
  const d = await driver();
  await d.markSmsRead('7');
  assert.equal(st.puts.length, 0);
  st.mac.MAC = { Filter_Enable: true, Restrict: false };
  await assert.rejects(d.blockDevice('AA:BB:CC:00:00:09', true), (e: any) => e.noChange === true);
  const ex = await d.getExtras();
  assert.equal(ex.wifiNets.length, 1); assert.equal(ex.bands.length, 1);
});

test('زيكسل: قناة الواي فاي — نفس doWifiApply (الحماية والكلمة كما هي)، والقنوات حسب العرض، وكل موديل بصيغته', () => {
  const o2 = W(1, { band: '2.4GHz', bandwidth: '40MHz', X_ZYXEL_OBSS_coex: true, extcha: 2, PossibleChannels: '1,2,3,4,5,6,7,8,9,10,11,12,13',
    X_ZYXEL_LowerChannels: '1,2,3,4,5,6,7,8,9', X_ZYXEL_UpperChannels: '5,6,7,8,9,10,11,12,13', AutoGenPSK: false, encryp: 'aes',
    upRate: 0, downRate: 0, MaxAssociatedDevices: 32, X_ZYXEL_Multicast_Fwd: true });
  const o5 = W(5, { band: '5GHz', bandwidth: '80MHz', X_ZYXEL_AC80_Channels: '36,40,44,48', SecurityMode: 'WPA2-WPA3-Personal' });
  const list = [o2, W(2, { SSID: 'G2' }), W(3), W(4), o5, W(6, { SSID: 'G6' })];
  assert.equal(X.zxBw(o2, '2.4'), '0');
  assert.deepEqual(X.zxChannels(o2, '2.4'), ['5', '6', '7', '8', '9', '10', '11', '12', '13']);
  assert.deepEqual(X.zxChannels(o5, '5'), ['36', '40', '44', '48']);
  const a: any[] = X.zxChannelPayload(list, '2.4', '11', 'nr5103e');
  assert.equal(a.length, 2);
  assert.equal(a[0].Index, 1); assert.equal(a[0].channel, 11); assert.equal(a[0].bandwidth, '0'); assert.equal(a[0].extcha, '2');
  assert.equal(a[0].secMode, 255); assert.equal(a[0].wpaMode, 'wpa2psk'); assert.equal(a[0].encryp, 'aes');
  assert.equal(a[0].psk_value, 'oldpass11'); assert.equal(a[0].SSID, 'Net1'); assert.equal(a[0].upRate, ''); assert.equal(a[0].div_wifiAdvance, true);
  assert.deepEqual(a[1], { Index: 5, SSID: 'Net5', oneSsidEnable: false });
  const b: any = X.zxChannelPayload(list, '5', '44', 'nr5103e');
  assert.equal(b.Index, 5); assert.equal(b.wpaMode, 'wpa2wpa3psk'); assert.equal(b.bandwidth, '80'); assert.equal(b.extcha, '0');
  const c: any[] = X.zxChannelPayload(list, '5', '0', 'fwa505');
  assert.deepEqual(c.slice(1), [{ Index: 2, SSID: 'G2', oneSsidEnable: false }, { Index: 6, SSID: 'G6', oneSsidEnable: false }]);
  assert.equal(c[0].channel, 0);
  const d: any[] = X.zxChannelPayload(list, '2.4', '6', 'fwa505');
  assert.deepEqual(d.map((x: any) => x.Index), [1, 5, 2, 6]);
});

test('زيكسل (درايفر): تغيير القناة — يتأكد بالقراءة، يرفض قناة مو بالقائمة، وموديل ما عندنا صفحته ← ما نرسل', async () => {
  const st = router();
  const d = await driver();
  await d.setWifiChannel('2.4', '11');
  assert.equal(st.wlan[0].channel, 11); assert.equal(st.wlan[0].SSID, 'Net1'); assert.equal(st.wlan[0].PskDisplay, 'oldpass11');
  const p = st.puts.at(-1);
  assert.deepEqual(p.map((x: any) => x.Index), [1, 5, 2, 6]);
  await d.setWifiChannel('2.4', '0');
  assert.equal(st.wlan[0].AutoChannelEnable, true);
  await assert.rejects(d.setWifiChannel('2.4', '14'), (e: any) => e.noChange === true);
  const st2 = router(undefined, 'NR7101');
  const d2 = await driver();
  assert.equal((await d2.getWifiRadios())[0].writable, false);
  await assert.rejects(d2.setWifiChannel('2.4', '6'), (e: any) => e.noChange === true);
  assert.equal(st2.puts.length, 0);
});
