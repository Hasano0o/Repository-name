/**
 * سلام HomeFi Max الخارجي (Asiatelco JW515، /schd/) — راوتر محاكى بنفس ردود الصفحة (ملفات «مو مدعوم؟» ٢٠ نوفمبر، جدة):
 * «/» تسأل WebHeader · GET AccessControl ← SecureToken · POST {Action:Invoke, Username, Password: sha1(كلمة+رمز)} · 403 = قفل.
 * sha1 هنا من node:crypto (مستقل عن الدرايفر).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'react-native') return { Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { __esModule: true, default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;

const sha1 = (s: string) => (ncrypto as any).createHash('sha1').update(s, 'utf8').digest('hex');
const P = require('../src/drivers/atel/parse');
const { AtelSchdDriver, schdSha } = require('../src/drivers/atel/index');

// «/» الحقيقية (مقتطعة) من الملف
const INDEX = `<html><head><script type="text/javascript" src="jquery-1.8.3.min.js"></script><script>
$.ajax({ url : "/rest/1.0/WebHeader/", type : "GET", success : function(data){ top.location.href = '/schd/html/login-admin.html?random='; } });
</script></head></html>`;

function router(o: { password?: string; tech?: string; rsrp?: number; lockAfter?: number } = {}) {
  const st = { token: 'C47A0D76857B6277B628D5328A31E11F', sid: '', fails: 0, posts: 0, seenSid: [] as string[] };
  const res = (status: number, text: string) => ({ ok: status < 400, status, url: 'http://192.168.100.1/', headers: { get: () => null }, text: async () => text } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = (init?.method ?? 'GET').toUpperCase();
    const sid = u.searchParams.get('mifisess') || (/mifisess=([^;]+)/.exec(init?.headers?.Cookie ?? '')?.[1] ?? '');
    const logged = !!st.sid && sid === st.sid;
    if (u.pathname === '/') return res(200, INDEX);
    if (u.pathname === '/rest/1.0/WebHeader/') {
      st.seenSid.push(sid);
      return res(200, JSON.stringify({ Language: 'en', RSRP: logged ? (o.rsrp ?? -92) : 0, RSRQ: logged ? -11 : 0, SINR: logged ? 14 : 0, RSSI: logged ? -63 : 0,
        Login: logged, ConnectStatus: 'CONNECTED', UsimStatus: 'Ready', SignalLevel: '4', Technology: o.tech ?? '5G', PLMN: 'Salam', ActivityStatus: 'updown' }));
    }
    if (u.pathname === '/rest/1.0/AccessControl/') {
      if (m === 'GET') return res(200, JSON.stringify({ SessionIdentifier: '', SecureToken: st.token }));
      st.posts++;
      if (st.fails >= (o.lockAfter ?? 5)) return res(403, '');
      const b = JSON.parse(init.body);
      assert.equal(b.Action, 'Invoke');
      if (b.Username !== 'admin' || b.Password !== sha1((o.password ?? '482913') + st.token)) { st.fails++; return res(401, '{}'); }
      st.sid = '057ae666-1dd2-11b2-9a7a-dfa46553cc1b';
      st.token = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';
      return res(200, JSON.stringify({ SessionIdentifier: st.sid, SecureToken: st.token }));
    }
    if (u.pathname === '/rest/1.0/CellularServiceStatus/') return res(200, JSON.stringify({ currentPrimaryCarrierComponent: '1', CurrentGlobalCellId: 'ABC123', CurrentWirelessTechnology: o.tech ?? '5G' }));
    if (u.pathname === '/rest/1.0/DeviceInfo/') return res(200, JSON.stringify({ DeviceInfoModelNumber: 'JW515', DeviceInfoIMEI: '860000000000001', DeviceInfoModemFwVersion: 'QC50Q_V1.0.4' }));
    return res(404, '');
  };
  return st;
}

test('schd: التعرّف من «/» و WebHeader', () => {
  assert.ok(P.isSchdPage(INDEX));
  assert.equal(P.isSchdPage('<html>/goform/goform_get_cmd_process</html>'), false);
  assert.ok(P.isWebHeader({ Login: false, SignalLevel: '0' }));
  assert.equal(P.isWebHeader({ statusData: {} }), false);
});

test('schd: sha1 مثل sha.min.js (hex صغير ٤٠ خانة)', () => {
  assert.equal(schdSha('admin', 'C47A0D76857B6277B628D5328A31E11F'), sha1('adminC47A0D76857B6277B628D5328A31E11F'));
  assert.match(schdSha('x', 'y'), /^[0-9a-f]{40}$/);
});

test('schd: الإشارة — بطاقة وحدة، الأصفار = ما فيه قراءة، SINR صفر مع إشارة قوية = فاضي', () => {
  assert.deepEqual(P.signalFrom({ RSRP: 0, RSSI: 0, RSRQ: 0, SINR: 0, Technology: 'LTE' }), { network: '4G' });
  // أول تجربة ميدانية (٢١ نوفمبر): RSRP -61 · RSRQ -15 · SINR 0 · 5G
  const s = P.signalFrom({ RSRP: -61, RSRQ: -15, SINR: 0, RSSI: -40, Technology: '5G' });
  assert.equal(s.network, '5G'); assert.equal(s.nrActiveFromStatus, true);
  assert.equal(s.rsrp, -61); assert.equal(s.rsrq, -15); assert.equal(s.sinr, undefined);
  assert.equal(s.nrRsrp, undefined, 'ما نكرر نفس الأرقام في بطاقة 5G');
  const l = P.signalFrom({ RSRP: -101, RSRQ: -13, SINR: 3, RSSI: 'UnKnown', Technology: 'LTE+' });
  assert.equal(l.network, '4G'); assert.equal(l.rsrp, -101); assert.equal(l.sinr, 3); assert.equal(l.rssi, undefined);
  // SINR صفر مع إشارة ضعيفة ممكن يكون حقيقي
  assert.equal(P.signalFrom({ RSRP: -112, SINR: 0, Technology: 'LTE' }).sinr, 0);
});

test('schd: FULL ٢١ نوفمبر — PCI و NR5G-NSA من WebHeader، والأسرار تنحذف من ردود REST', () => {
  const s = P.signalFrom({ RSRP: -61, RSRQ: -16, SINR: 1, RSSI: -25, PCI: '31', Technology: 'NR5G-NSA', Login: true });
  assert.equal(s.network, '5G'); assert.equal(s.pci, '31'); assert.equal(s.sinr, 1);
  const out = P.scrubRest(JSON.stringify({ WiFiSSID: 'JW515_1', WiFiKey: 'abcd1234', WiFiChannel: 0, DeviceInfoIMEI: '860000000000001', DeviceInfoSwVersion: 'QC50Q', SessionIdentifier: 'x-y', SecureToken: 'AB', ok: true }));
  for (const bad of ['abcd1234', '860000000000001', 'JW515_1', 'x-y', '"AB"']) assert.equal(out.includes(bad), false, bad);
  assert.ok(out.includes('QC50Q')); assert.ok(out.includes('"WiFiChannel": 0'));
  const arr = P.scrubRest(JSON.stringify([{ ConnectedDeviceMacAddress: '34:ba:9a:00:00:01', ConnectedDeviceIPv4Address: '192.168.100.112' }]));
  assert.equal(arr.includes('34:ba'), false); assert.ok(arr.includes('192.168.100.112'));
});

test('schd: التردد ورقم الخلية من CellularServiceStatus', () => {
  assert.deepEqual(P.bandFrom('3', 'NR5G-NSA'), { band: 'B3' });
  assert.deepEqual(P.bandFrom('LTE BAND 1', 'LTE'), { band: 'B1' });
  assert.deepEqual(P.bandFrom('78', 'NR5G-SA'), { nrBand: 'n78' });
  assert.deepEqual(P.bandFrom('n41', 'NR5G-NSA'), { nrBand: 'n41' });
  assert.deepEqual(P.bandFrom('UnKnown', 'LTE'), {});
  const m = P.mergeService({ network: '5G', rsrp: -61, pci: '31' }, { currentPrimaryCarrierComponent: '3', CurrentGlobalCellId: '1A2D101', CurrentWirelessTechnology: 'NR5G-NSA', CurrentSignalStrengthInRSRP: -94 });
  assert.equal(m.band, 'B3'); assert.equal(m.cellId, '1A2D101'); assert.equal(m.enodebId, String(Math.floor(0x1A2D101 / 256)));
  assert.equal(m.rsrp, -61, 'WebHeader هو الأساس');
  assert.deepEqual(P.mergeService({ rsrp: -70 }, null), { rsrp: -70 });
});

test('schd: NSA — «B1 / n78» و «-61 / -52» ← بطاقة 4G وبطاقة 5G بأرقامها (AUTH ٢١ نوفمبر)', () => {
  const svc = { CurrentPCI: '31', CurrentGlobalCellId: '3756C0B', CurrentSignalStrengthInRSRP: '-61 / -52', CurrentSignalStrengthInRSRQ: '-16 / -11',
    CurrentSignalToNoiseLevelInSNR: '3 / 24', CurrentWirelessTechnology: 'NR5G-NSA', currentPrimaryCarrierComponent: 'B1 / n78', currentSecondaryCarrierComponent: 'UnKnown', CurrentSignalStrengthInRSSI: -27 };
  assert.deepEqual(P.bandFrom('B1 / n78', 'NR5G-NSA'), { band: 'B1', nrBand: 'n78' });
  const base = P.signalFrom({ RSRP: -61, RSRQ: -16, SINR: 3, RSSI: -27, PCI: '31', Technology: 'NR5G-NSA', Login: true });
  const m = P.mergeService(base, svc);
  assert.equal(m.band, 'B1'); assert.equal(m.nrBand, 'n78');
  assert.equal(m.rsrp, -61); assert.equal(m.nrRsrp, -52); assert.equal(m.nrRsrq, -11); assert.equal(m.nrSinr, 24);
  assert.equal(m.cellId, '3756C0B'); assert.equal(m.pci, '31');
  // 4G بس: ما فيه بطاقة 5G
  const l = P.mergeService({ rsrp: -90 }, { currentPrimaryCarrierComponent: 'B3', CurrentSignalStrengthInRSRP: '-90', CurrentWirelessTechnology: 'LTE' });
  assert.equal(l.band, 'B3'); assert.equal(l.nrRsrp, undefined);
  assert.deepEqual(P.usageFrom({ TotalBytesTransmitted: 60466375062, TotalBytesReceived: 669638085474 }), { downloadBytes: 669638085474, uploadBytes: 60466375062 });
});

test('schd: الدخول ← الجلسة تنرسل ← القراءة والشركة والموديل', async () => {
  const st = router();
  const d = new AtelSchdDriver();
  assert.equal(await d.detect('192.168.100.1'), true);
  await d.login('192.168.100.1', '', '482913');
  assert.equal(st.posts, 1);
  const s = await d.getSignal();
  assert.equal(s.rsrp, -92); assert.equal(s.sinr, 14); assert.equal(s.nrRsrp, undefined);
  assert.equal(s.band, 'B1'); assert.equal(s.cellId, 'ABC123');
  assert.equal(st.seenSid.filter(Boolean).at(-1), '057ae666-1dd2-11b2-9a7a-dfa46553cc1b');
  const n = await d.getNetworkInfo();
  assert.equal(n.operator, 'Salam'); assert.equal(n.connected, true); assert.equal(n.mode, '5G');
  const dd = await d.getDeviceDetails();
  assert.equal(dd.model, 'سلام JW515'); assert.match(String(dd.software), /atel-pages-2$/);
});

test('schd: كلمة غلط ← ما نعيدها بالخلفية · 403 = قفل', async () => {
  router({ password: '111111' });
  const d = new AtelSchdDriver();
  await assert.rejects(d.login('192.168.100.1', 'admin', '222222'), /غلط/);
  // الخلفية (بدون fresh) ما تصرف محاولة ثانية بنفس الكلمة المرفوضة
  await assert.rejects(d.login('192.168.100.1', 'admin', '222222'), /رفضها الراوتر قبل/);
  router({ lockAfter: 0 });
  await assert.rejects(new AtelSchdDriver().login('192.168.100.1', 'admin', '482913', { fresh: true }), /قفل/);
});

test('schd: الجامع ما يفتح الصفحات الخطرة', async () => {
  router();
  const d = new AtelSchdDriver();
  await d.detect('192.168.100.1');
  for (const p of d.afterLoginPages()) assert.equal(/reboot|reset|restore|factory|upload|upgrade|logout|update/i.test(p), false, p);
  assert.equal((await d.fetchAuthPage('/schd/html/updates.html')).ok, false);
});

test('schd: راوتر ZTE goform ما يتعرّف عليه', async () => {
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, url: 'http://192.168.0.1/', headers: { get: () => null }, text: async () => '<html><script src="js/service.js"></script></html>' });
  assert.equal(await new AtelSchdDriver().detect('192.168.0.1'), false);
});
