/**
 * Nokia FastMile 6.1 على راوتر محاكى بنفس بروتوكول الصفحة الجديدة:
 * nonce (POST userName) ← salt (alati) ← sha256 مكرر على alati+كلمة ← login · ubus JSON service_function_web_app.cgi ·
 * إعادة التشغيل POST_CSRF مشفّر (AES-CBC + RSA PKCS#1 مثل JSEncrypt). الحسبة هنا مستقلة بـ node:crypto.
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

const C: any = ncrypto;
const esc = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');
const h = (a: string, b: string) => C.createHash('sha256').update(`${a}:${b}`).digest('base64');
const hu = (a: string, b: string) => esc(h(a, b));
const kp = C.generateKeyPairSync('rsa', { modulusLength: 1024, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

/** فك RSA PKCS#1 v1.5 يدوي (node الجديد قافل PKCS1 في privateDecrypt) */
function rsaDec(ct: any): any {
  const jwk: any = C.createPrivateKey(kp.privateKey).export({ format: 'jwk' });
  const big = (s: string) => BigInt('0x' + Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex'));
  const n = big(jwk.n), d = big(jwk.d);
  let r = 1n, b = BigInt('0x' + Buffer.from(ct).toString('hex')) % n, e = d;
  while (e > 0n) { if (e & 1n) r = (r * b) % n; b = (b * b) % n; e >>= 1n; }
  const em = Buffer.from(r.toString(16).padStart(256, '0'), 'hex');
  return em.subarray(em.indexOf(0, 2) + 1);
}
function decPost(body: string): string {
  const q = new URLSearchParams(body);
  assert.equal(q.get('encrypted'), '1');
  const ck = rsaDec(Buffer.from(String(q.get('ck')).replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '='), 'base64')).toString();
  const [k, iv] = ck.split(' ').map((x: string) => Buffer.from(x, 'base64'));
  const ct = Buffer.from(String(q.get('ct')).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const d = C.createDecipheriv('aes-128-cbc', k, iv);
  return Buffer.concat([d.update(ct), d.final()]).toString();
}

const STATUS = {
  cell_LTE_stats_cfg: [{ stat: { RSRPCurrent: -101, RSRQCurrent: -12, SNRCurrent: 9, RSSICurrent: -70, PhysicalCellID: 33, Band: 'B3', DownlinkEarfcn: 1849 } }],
  cell_5G_stats_cfg: [{ stat: { RSRPCurrent: -90, RSRQCurrent: -11, SNRCurrent: 15, PhysicalCellID: 400, Band: 'n78', Downlink_NR_ARFCN: 643334 } }],
  cell_5GPS_stats_cfg: [{ stat: { RSRPCurrent: -32768 } }],
  cellular_stats: [{ BytesReceived: 5000, BytesSent: 600 }],
  apn_cfg: [{ APN: 'zain', X_ALU_COM_IPAddressV4: '10.9.8.7' }],
};

function router(opts: { password?: string; mode?: string } = {}) {
  const st: any = {
    nonce: 'N0n+ce/=', randomKey: 'RKx', salt: 'S4LT', iters: 3, token: '', posts: [] as string[], rebooted: false,
    access: 1,
    bands: {
      BandLockMode: opts.mode ?? 'String_based',
      Bands4G: [{ Band: 'B1', Enable: true }, { Band: 'B3', Enable: true }, { Band: 'B28', Enable: true }],
      Bands5G: [{ Band: 'n78', ForNSA: true, ForSA: true }, { Band: 'n41', ForNSA: true, ForSA: false }],
    },
  };
  const res = (status: number, text: string) => ({ ok: status < 400, status, url: 'http://192.168.1.1/', headers: { get: () => null }, text: async () => text } as any);
  const J = (o: unknown) => res(200, JSON.stringify(o));
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const p = u.pathname.slice(1) + (u.search || '');
    const m = (init?.method ?? 'GET').toUpperCase();
    const body = String(init?.body ?? '');
    const q = new URLSearchParams(body);
    if (p === '') return res(200, '<!doctype html><!-- Code version : 2502.27.06.A17 --><base href="/web_whw/"><script src="main.da0b4dbf51457d52.js" type="module"></script>');
    if (p === 'login_web_app.cgi?nonce') return J({ nonce: st.nonce, randomKey: st.randomKey, iterations: st.iters, pubkey: kp.publicKey });
    if (p === 'main_web_app.cgi') return J({ gwmodel: '5G19-12W-A' });
    if (p === 'login_web_app.cgi?salt' && m === 'POST') {
      assert.equal(q.get('userhash'), hu('admin', st.nonce)); assert.equal(q.get('nonce'), esc(st.nonce));
      return J({ alati: st.salt });
    }
    if (p === 'login_web_app.cgi' && m === 'POST') {
      let x = C.createHash('sha256').update(st.salt + (opts.password ?? 'pw')).digest('hex');
      for (let i = 1; i < st.iters; i++) x = C.createHash('sha256').update(Buffer.from(x, 'hex')).digest('hex');
      const ok = q.get('userhash') === hu('admin', st.nonce) && q.get('RandomKeyhash') === hu(st.randomKey, st.nonce) && q.get('response') === hu(h('admin', x), st.nonce);
      if (!ok) return J({ result: -1, failurecount: 1 });
      st.token = 'T0K';
      return J({ result: 0, token: 'T0K', sid: 'SID' });
    }
    if (!st.token) return res(200, '<!doctype html><html></html>');
    if (p === 'status_get_web_app.cgi') return J(STATUS);
    if (p === 'fastmile_statistics_status_web_app.cgi') return J({ sim_cfg: [{ Status: 'Ready' }], network_cfg: [{ IMEI: '35111' }] });
    if (p === 'service_function_web_app.cgi' && m === 'POST') {
      const b = JSON.parse(body);
      assert.equal(b.csrf_token, 'T0K'); assert.equal(b.interface, 'Nokia.GenericService'); assert.equal(b.service, 'OAM');
      st.posts.push(b.function);
      switch (b.function) {
        case 'GetCAState': return J({ result: 0, LTEDLCA: [{ ScellBand: 'B1', DownlinkEarfcn: 100, PhysicalCellID: 12 }], NRDLCA: [] });
        case 'GetSupportedCellularBands': return J({ result: 0, FunctionResult: JSON.parse(JSON.stringify(st.bands)) });
        case 'SetSupportedCellularBands': {
          const pl = b.paralist[0];
          if (pl.Bands4G) st.bands.Bands4G = pl.Bands4G;
          if (pl.Bands5G) st.bands.Bands5G = pl.Bands5G;
          return J({ result: 0 });
        }
        case 'GetCellularAccessConfig': return J({ result: 0, FunctionResult: { AccessModeNo: st.access } });
        case 'SetCellularAccessConfig': st.access = b.paralist[0].AccessModeNo; return J({ result: 0 });
      }
      return J({ result: 1, reason: 'unknown function' });
    }
    if (p === 'reboot_web_app.cgi' && m === 'POST') { st.rebooted = decPost(body) === 'csrf_token=T0K'; return J({ result: 0 }); }
    return res(404, 'nf');
  };
  return st;
}
const driver = () => { const { NokiaFwaDriver } = require('../src/drivers/nokia/fwa'); return new NokiaFwaDriver(); };
const det31 = () => { const { NokiaDriver } = require('../src/drivers/nokia/index'); return new NokiaDriver(); };

test('Nokia 6.1: يتعرّف عليه (و 3.1 ما يمسكه) · يدخل بـ salt + iterations · الإشارة 5G NSA والدمج من GetCAState', async () => {
  router();
  assert.equal(await det31().detect('192.168.1.1'), false);
  const d = driver();
  assert.equal(await d.detect('192.168.1.1'), true);
  await d.login('192.168.1.1', 'admin', 'pw');
  const s = await d.getSignal();
  assert.equal(s.network, '5G NSA'); assert.equal(s.rsrp, -101); assert.equal(s.band, 'B3'); assert.equal(s.nrBand, 'n78'); assert.equal(s.caCount, 2);
  assert.deepEqual((await d.getCarriers()).map((x: any) => `${x.tech}${x.band}${x.role}`), ['LTE3PCC', 'LTE1SCC', 'NR78SCC']);
  assert.match((await d.identify()).label, /5G19-12W-A/);
  assert.equal((await d.getDeviceDetails()).imei, '35111');
});

test('Nokia 6.1: كلمة غلط ← رسالة واضحة', async () => {
  router();
  await assert.rejects(driver().login('192.168.1.1', 'admin', 'غلط'), /كلمة المرور غلط/);
});

test('Nokia 6.1: الترددات — قراءة، تثبيت 4G و5G (NSA+SA)، الرجوع للكل، وما نطفي كل 4G', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'pw');
  let c = await d.getBandConfig();
  assert.deepEqual(c.supported, [1, 3, 28]); assert.deepEqual(c.locked, []); assert.deepEqual(c.nrSupported, [78, 41]);
  assert.equal(c.mode, '00');
  await d.setBand([3], [78]);
  assert.deepEqual(st.bands.Bands4G.map((x: any) => x.Enable), [false, true, false]);
  assert.deepEqual(st.bands.Bands5G, [{ Band: 'n78', ForNSA: true, ForSA: true }, { Band: 'n41', ForNSA: false, ForSA: false }]);
  c = await d.getBandConfig();
  assert.deepEqual(c.locked, [3]); assert.deepEqual(c.nrLocked, [78]);
  await d.setBand('keep', []);
  assert.deepEqual(st.bands.Bands4G.map((x: any) => x.Enable), [false, true, false]);
  assert.ok(st.bands.Bands5G.every((x: any) => x.ForNSA && x.ForSA));
  await d.setBand([], undefined);
  assert.ok(st.bands.Bands4G.every((x: any) => x.Enable));
  await assert.rejects(d.setBand([66]), (e: any) => e.noChange === true);
});

test('Nokia 6.1: Object_based (القائمة للعرض بس) ← ما نرسل أمر ترددات', async () => {
  const st = router({ mode: 'Object_based' });
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'pw');
  assert.equal((await d.getBandConfig()).nrLockable, false);
  await assert.rejects(d.setBand([3]), (e: any) => e.noChange === true);
  assert.ok(!st.posts.includes('SetSupportedCellularBands'));
});

test('Nokia 6.1: وضع الشبكة 4G فقط ← AccessModeNo 4 · إعادة التشغيل مشفّرة بمفتاح الراوتر وفيها csrf_token', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.1.1', 'admin', 'pw');
  await d.setNetworkMode('03');
  assert.equal(st.access, 4);
  assert.equal((await d.getBandConfig()).mode, '03');
  await d.reboot();
  assert.equal(st.rebooted, true);
});
