/**
 * (الترويسة والمحاكاة منسوخة من zyxelLogin.test.ts)
 * زيكسل — دخول متوازي (تقرير setup-login من NR5103EV2، ٣٠ أكتوبر، أندرويد):
 *   13:55:01 خمس «POST /UserLogin → 200» بنفس اللحظة ← «كلمة المرور غلط» ← «GET /cgi-bin/DAL → 401».
 *   السبب: كل قراءة كانت تدخل لحالها لو ما فيه جلسة؛ القراءات المتوازية = دخولات متوازية، كل وحدة تغيّر مفتاح AES
 *   المشترك (الرد ما ينفك ← نحسبه كلمة غلط) والراوتر يلغي الجلسة اللي قبلها (401).
 * راوتر محاكى: نفس تشفير الصفحة (RSA PKCS#1 لمفتاح AES-256-CBC)، جلسة وحدة بس (الدخول الجديد يلغي القديم).
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

const nc = require('node:crypto');
const { aesCbcEncrypt, aesCbcDecrypt, b64, unb64, utf8, fromUtf8 } = require('../src/drivers/zyxel/crypto');

/** فك RSA PKCS#1 v1.5 للاختبار بس (node السيرفر ما يسمح بـ privateDecrypt مع PKCS#1) */
function rsaDecrypt(privPem: string, ct: Uint8Array): Uint8Array {
  const jwk: any = nc.createPrivateKey(privPem).export({ format: 'jwk' });
  const B = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const n = BigInt('0x' + B(jwk.n).toString('hex')), d = BigInt('0x' + B(jwk.d).toString('hex'));
  let base = BigInt('0x' + Buffer.from(ct).toString('hex')) % n, e = d, r = 1n;
  while (e > 0n) { if (e & 1n) r = (r * base) % n; base = (base * base) % n; e >>= 1n; }
  const w = B(jwk.n).length;
  const block = Buffer.from(r.toString(16).padStart(w * 2, '0'), 'hex');
  return block.subarray(block.indexOf(0, 2) + 1);
}

const PW = 'Secret123';
const { publicKey, privateKey } = nc.generateKeyPairSync('rsa', { modulusLength: 1024, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });

async function driver() {
  const { ZyxelDriver } = require('../src/drivers/zyxel/index');
  const d = new ZyxelDriver();
  (d as any).host = '192.168.1.1';
  (d as any).user = 'admin';
  (d as any).password = PW;
  return d;
}


/**
 * NR5103EV2 — المفتاح يتبدّل مع كل PUT (app.js: «if(v.sessionkey) setItem("zySessionKey", …)»).
 * تقرير nrdual ١٢ نوفمبر: PUT 200 ← PUT 403 بالمفتاح القديم ← دخول force ← PUT 200.
 * والترددات المفضلة ممكن تكون «Auto» (الصفحة تكتبها كذا لما «اختيار تلقائي»).
 */
const SUP = 'B1,B3,B7,B8,B20,B28,B38,B40,B41,n1,n28,n41,n78';
function v2(prefInit = 'Auto') {
  let valid = '';
  const keys = new Map<string, Uint8Array>();
  const log: string[] = [];
  const band: Record<string, any> = { INTF_Supported_Access_Technologies: 'Auto,LTE,NR5G-SA,NR5G-NSA', INTF_Preferred_Access_Technology: 'Auto',
    INTF_Supported_Bands: SUP, INTF_Preferred_Bands: prefInit, INTF_Current_Band: 'LTE_BC3' };
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, headers: { get: () => null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => JSON.stringify(body) } as any);
  const enc = (key: Uint8Array, obj: unknown) => { const iv = nc.randomBytes(32); return { content: b64(aesCbcEncrypt(key, iv, utf8(JSON.stringify(obj)))), iv: b64(iv) }; };
  const dec = (key: Uint8Array, b: any) => JSON.parse(fromUtf8(aesCbcDecrypt(key, unb64(b.iv), unb64(b.content))));
  let aesOf = new Uint8Array();
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = init?.method ?? 'GET';
    if (u.pathname === '/getRSAPublickKey') return res(200, { result: 'ZCFG_SUCCESS', RSAPublicKey: publicKey });
    if (u.pathname === '/UserLogin') {
      log.push('LOGIN');
      const b = JSON.parse(String(init.body));
      const aes = unb64(fromUtf8(rsaDecrypt(privateKey, unb64(b.key))));
      aesOf = aes;
      valid = nc.randomBytes(8).toString('hex');
      keys.set(valid, aes);
      return res(200, enc(aes, { result: 'ZCFG_SUCCESS', sessionkey: valid }));
    }
    if (u.pathname === '/cgi-bin/DAL') {
      const sk = u.searchParams.get('sessionkey') ?? '';
      const oid = u.searchParams.get('oid');
      if (m === 'PUT') {
        if (sk !== valid) { log.push('PUT 403'); return res(403, ''); }
        const p = dec(aesOf, JSON.parse(String(init.body)));
        Object.assign(band, p);
        log.push('PUT ' + JSON.stringify(p));
        const old = valid;
        valid = nc.randomBytes(8).toString('hex');      // المفتاح يتبدّل
        keys.set(valid, keys.get(old)!);
        return res(200, enc(aesOf, { result: 'ZCFG_SUCCESS', sessionkey: valid }));
      }
      if (!keys.has(sk)) return res(401, { result: 'Invalid Session' });   // القراءة تقبل أي مفتاح من هالجلسة
      return res(200, enc(aesOf, { result: 'ZCFG_SUCCESS', Object: [oid === 'cellwan_band' ? { ...band } : {}] }));
    }
    return res(404, {});
  };
  return { log, band, logins: () => log.filter(x => x === 'LOGIN').length, puts: () => log.filter(x => x.startsWith('PUT {')) };
}

test('NR5103EV2: ثلاث كتابات ورا بعض ← دخول واحد، ولا 403 (كان: الثانية 403)', async () => {
  const r = v2('B1,B3,B7,B8,B20,B28,B38,B40,B41,n1,n28,n41,n78');
  const d = await driver();
  await d.setBand([3], undefined);
  await d.setBand([1, 3], undefined);
  await d.setNetworkMode('03');
  assert.equal(r.logins(), 1, r.log.join(' | '));
  assert.ok(!r.log.includes('PUT 403'), r.log.join(' | '));
  assert.equal(r.band.INTF_Preferred_Access_Technology, 'LTE');
});

test('NR5103EV2: مفتاح قديم لأي سبب (403) ← دخول جديد ومحاولة وحدة تنجح', async () => {
  const r = v2('B1,B3,B7,B8,B20,B28,B38,B40,B41,n1,n28,n41,n78');
  const d = await driver();
  await d.getBandConfig();
  const saved = (d as any).sessionkey;
  await d.setBand([3], undefined);              // يبدّل المفتاح عند الراوتر
  (d as any).sessionkey = saved;                // كأن الرد ضاع — معنا المفتاح القديم
  await d.setBand([1, 3], undefined);
  assert.ok(r.log.includes('PUT 403'));
  assert.equal(r.band.INTF_Preferred_Bands, 'B1,B3,n1,n28,n41,n78');
});

test('NR5103EV2: الترددات «Auto» ← تلقائي، والتثبيت على 4G يخلي كل 5G (ما يمسحها)', async () => {
  const r = v2('Auto');
  const d = await driver();
  const c = await d.getBandConfig();
  assert.deepEqual(c.locked, []);
  assert.deepEqual(c.nrLocked, []);
  assert.equal(await d.getActiveLock(), null);
  await d.setBand([1, 3], undefined);
  assert.equal(r.band.INTF_Preferred_Bands, 'B1,B3,n1,n28,n41,n78', 'كان: «B1,B3» بدون أي 5G — والصفحة ترفض هالتركيبة في Auto/NSA');
  const snap = await d.readLockState();
  r.band.INTF_Preferred_Bands = 'Auto';
  await d.restoreLockState(snap);                // يرجّع B1,B3 + كل 5G ويتأكد
  assert.equal(r.band.INTF_Preferred_Bands, 'B1,B3,n1,n28,n41,n78');
});

test('NR5103EV2: لقطة «Auto» ← الإرجاع يكتب Auto ويتأكد بدون «ما رجع»', async () => {
  const r = v2('Auto');
  const d = await driver();
  const snap = await d.readLockState();
  assert.match(snap.summary, /4G: تلقائي · 5G: تلقائي/);
  await d.setBand([3], undefined);
  await d.restoreLockState(snap);
  assert.equal(r.band.INTF_Preferred_Bands, 'Auto');
});

test('NR5103EV2: SCC_Info — الخانة المطفية أو بقيم افتراضية ما تطلع ناقل، والشغالة تطلع', async () => {
  const r = v2('B3,n78');
  const d = await driver();
  const status = {
    INTF_Current_Band: 'LTE_BC3', INTF_RFCN: 1300, INTF_PhyCell_ID: 10, INTF_RSRP: -90, INTF_RSRQ: -10,
    SCC_Info: [
      { Enable: true, Band: 'LTE_BC1', RFCN: 100, PhysicalCellID: 5, RSRP: -95 },
      { Enable: false, Band: 'LTE_BC40', RFCN: 38950, PhysicalCellID: 7, RSRP: -99 },
      { Band: 'LTE_BC20', RFCN: 6300, PhysicalCellID: 0, RSRP: -140 },
    ],
    NSA_Enable: true, NSA_Band: 'n78', NSA_RFCN: 636666, NSA_PCI: 1, NSA_RSRP: -100,
  };
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (new URL(url).searchParams.get('oid') === 'cellwan_status') {
      const resp = await realFetch(url.replace('cellwan_status', 'cellwan_band'), init);
      const j = await resp.json();
      const aes = (d as any).aesKey;
      const iv = nc.randomBytes(32);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: b64(aesCbcEncrypt(aes, iv, utf8(JSON.stringify({ result: 'ZCFG_SUCCESS', Object: [status] })))), iv: b64(iv) }) } as any;
    }
    return realFetch(url, init);
  };
  try {
    const ca = await d.getCarriers();
    assert.deepEqual(ca.map((c: any) => `${c.role}:${c.tech}${c.band}`), ['PCC:LTE3', 'SCC:LTE1', 'SCC:NR78']);
  } finally { (globalThis as any).fetch = realFetch; }
  void r;
});
