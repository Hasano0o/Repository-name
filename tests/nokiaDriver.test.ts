/**
 * درايفر Nokia FastMile 5G Gateway على راوتر محاكى بنفس بروتوكول الصفحة (crypto_page.js + login() في main-es2015):
 * nonce/randomKey ← userhash/RandomKeyhash/response بـ sha256 base64 «a:b» مع الهروب (+→- /→_ =→.)، كوكي الجلسة، csrf_token في الكتابة.
 * الحسبة هنا مستقلة بـ node:crypto (مو نفس كود التطبيق).
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

const esc = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');
const h = (a: string, b: string) => (ncrypto as any).createHash('sha256').update(`${a}:${b}`).digest('base64');
const hu = (a: string, b: string) => esc(h(a, b));

const RADIO = {
  cell_LTE_stats_cfg: [{ stat: { RSRPCurrent: -95, RSRQCurrent: -11, SNRCurrent: 12, RSSICurrent: -67, PhysicalCellID: 211, Band: 'B3', DownlinkEarfcn: 1650, RSRPStrengthIndexCurrent: 3 } }],
  cell_5G_stats_cfg: [{ stat: { RSRPCurrent: -88, RSRQCurrent: -10, SNRCurrent: 18, PhysicalCellID: 501, Band: 'n78', Downlink_NR_ARFCN: 636666, RSRPStrengthIndexCurrent: 4 } }],
  cell_CA_stats_cfg: [{ ca: { X_ALU_COM_DLCarrierAggregationNumberOfEntries: 1, 1: { PhysicalCellID: 77, ScellBand: 'B1', ScellChannel: 100 } } }],
  cellular_stats: [{ BytesReceived: 9000, BytesSent: 800 }],
  apn_cfg: [{ APN: 'zain', X_ALU_COM_IPAddressV4: '10.1.2.3' }],
};

function router(opts: { password?: string; noLte?: boolean; iterations?: number } = {}) {
  const st: any = { nonce: 'abc+/=XYZ', randomKey: 'RK123', sid: '', posts: [] as string[], rebooted: false, fails: 0 };
  const res = (status: number, text: string, headers: Record<string, string> = {}) =>
    ({ ok: status < 400, status, url: 'http://192.168.1.1/', headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, text: async () => text } as any);
  const J = (o: unknown) => res(200, JSON.stringify(o));
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const p = u.pathname.slice(1) + (u.search || '');
    const m = (init?.method ?? 'GET').toUpperCase();
    const body = String(init?.body ?? '');
    const q = new URLSearchParams(body);
    if (p === '') return res(200, '<!doctype html><title>FastMile 5G Gateway</title><base href="/web_whw/">');
    if (p === 'login_web_app.cgi?nonce') return J({ nonce: st.nonce, randomKey: st.randomKey, pubkey: '---', ...(opts.iterations ? { iterations: opts.iterations } : {}) });
    if (p === 'login_web_app.cgi' && m === 'POST') {
      let pass = opts.password ?? 'pw';
      if (opts.iterations) {
        // نفس صفحة تغيير الكلمة: hex(SHA256) ثم SHA256 على bytes الـ hex
        let x = (ncrypto as any).createHash('sha256').update(pass).digest('hex');
        for (let i = 1; i < opts.iterations; i++) x = (ncrypto as any).createHash('sha256').update(Buffer.from(x, 'hex')).digest('hex');
        pass = x;
      }
      const ok = q.get('userhash') === hu('admin', st.nonce) && q.get('RandomKeyhash') === hu(st.randomKey, st.nonce)
        && q.get('response') === hu(h('admin', pass), st.nonce) && q.get('nonce') === esc(st.nonce)
        && /^[A-Za-z0-9_-]{22}\.\.$/.test(q.get('enckey') ?? '') && /^[A-Za-z0-9_-]{22}\.\.$/.test(q.get('enciv') ?? '');
      if (!ok) { st.fails++; return J({ result: st.fails >= 3 ? -2 : -1 }); }
      st.sid = 'S1';
      return J({ result: 0, sid: 'S1', token: 'TOK9' });
    }
    if (!st.sid) return res(200, '<!doctype html><html>login</html>');
    if (p === 'fastmile_radio_status_web_app.cgi') return J(opts.noLte ? { ...RADIO, cell_LTE_stats_cfg: [{ stat: { RSRPCurrent: -32768 } }], cell_CA_stats_cfg: [{ ca: { X_ALU_COM_DLCarrierAggregationNumberOfEntries: 0 } }] } : RADIO);
    if (p === 'dashboard_device_info_status_web_app.cgi') return J({
      device_app_status: [{ Description: 'FastMile 5G Gateway 3.1', SerialNumber: 'X', HardwareVersion: 'HW1', SoftwareVersion: 'SW2', UpTime: 100 }],
      device_cfg: [
        { HostName: 'iPhone', MACAddress: 'aa:bb:cc:00:00:01', IPAddress: '192.168.1.20', InterfaceType: '802.11ac', Active: 1, X_ALU_COM_IsBeacon: 0 },
        { HostName: 'Old', MACAddress: 'aa:bb:cc:00:00:02', IPAddress: '192.168.1.21', InterfaceType: '802.11', Active: 0, X_ALU_COM_IsBeacon: 0 },
        { HostName: 'Beacon', MACAddress: 'aa:bb:cc:00:00:03', IPAddress: '192.168.1.200', InterfaceType: 'Ethernet', Active: 1, X_ALU_COM_IsBeacon: 1 },
      ],
    });
    if (p === 'fastmile_statistics_status_web_app.cgi') return J({ sim_cfg: [{ Status: 'Ready', IMSI: 'x' }], network_cfg: [{ IMEI: '356000000000001' }] });
    if (p === 'reboot_web_app.cgi' && m === 'POST') { st.posts.push(body); st.rebooted = q.get('csrf_token') === 'TOK9'; return J({ result: 0 }); }
    return res(404, 'not found');
  };
  return st;
}
const driver = () => { const { NokiaDriver } = require('../src/drivers/nokia/index'); return new NokiaDriver(); };

test('Nokia: يتعرّف عليه من الصفحة، يدخل بنفس حسبة الصفحة، ويقرأ 5G NSA + 4G والدمج', async () => {
  router();
  const d = driver();
  assert.equal(await d.detect('192.168.1.1'), true);
  await d.login('192.168.1.1', 'admin', 'pw');
  const s = await d.getSignal();
  assert.equal(s.network, '5G NSA');
  assert.equal(s.rsrp, -95); assert.equal(s.sinr, 12); assert.equal(s.band, 'B3'); assert.equal(s.pci, '211'); assert.equal(s.earfcn, '1650');
  assert.equal(s.nrRsrp, -88); assert.equal(s.nrBand, 'n78'); assert.equal(s.nrArfcn, '636666'); assert.equal(s.caCount, 2);
  const c = await d.getCarriers();
  assert.deepEqual(c.map((x: any) => `${x.tech}${x.band}${x.role}`), ['LTE3PCC', 'LTE1SCC', 'NR78SCC']);
  assert.equal((await d.getUsage()).downloadBytes, 9000);
  const m = await d.identify();
  assert.equal(m.brand, 'nokia'); assert.match(m.label, /3\.1/);
});

test('Nokia: 5G SA بدون 4G — قراءة 4G خارج المدى (‎-32768) ما تنعرض', async () => {
  router({ noLte: true });
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'pw');
  const s = await d.getSignal();
  assert.equal(s.network, '5G SA'); assert.equal(s.rsrp, undefined); assert.equal(s.band, undefined);
  assert.deepEqual((await d.getCarriers()).map((x: any) => `${x.tech}${x.band}${x.role}`), ['NR78PCC']);
});

test('Nokia: كلمة غلط ← رسالة واضحة، والقفل (‎-2) ← «محاولات كثيرة»', async () => {
  router();
  const d = driver();
  await assert.rejects(d.login('192.168.1.1', 'admin', 'غلط'), /كلمة المرور غلط/);
  await assert.rejects(d.login('192.168.1.1', 'admin', 'غلط'), /كلمة المرور غلط/);
  await assert.rejects(d.login('192.168.1.1', 'admin', 'غلط'), /محاولات كثيرة/);
});

test('Nokia: الأجهزة المتصلة (Active ومو مقوّي) · المعلومات · إعادة التشغيل فيها csrf_token · الجلسة الضايعة = «انتهت الجلسة»', async () => {
  const st = router();
  const d = driver();
  await assert.rejects(d.getSignal.call(Object.assign(driver(), { host: '192.168.1.1' })), /انتهت الجلسة/);
  await d.login('192.168.1.1', 'admin', 'pw');
  assert.deepEqual(await d.getDevices(), [{ mac: 'AA:BB:CC:00:00:01', ip: '192.168.1.20', name: 'iPhone' }]);
  const det = await d.getDeviceDetails();
  assert.equal(det.imei, '356000000000001'); assert.equal(det.software, 'SW2'); assert.equal(det.wanIp, '10.1.2.3');
  await d.reboot();
  assert.equal(st.rebooted, true);
  await assert.rejects(d.setBand([3]), (e: any) => e.noChange === true);
});

test('Nokia: الفيرموير الأحدث يرسل iterations ← الكلمة تتحول قبل الحسبة (والقديم بدونها يبقى نفسه)', async () => {
  router({ iterations: 1000 });
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'pw');
  assert.equal((await d.getSignal()).network, '5G NSA');
  router({ iterations: 1 });
  await driver().login('192.168.1.1', 'admin', 'pw');
});
