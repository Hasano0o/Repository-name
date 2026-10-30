/**
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

function router() {
  let valid = '';                       // جلسة وحدة بس
  const keys = new Map<string, Uint8Array>();
  const log: string[] = [];
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, headers: { get: () => null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => JSON.stringify(body) } as any);
  const enc = (key: Uint8Array, obj: unknown) => { const iv = nc.randomBytes(32); return { content: b64(aesCbcEncrypt(key, iv, utf8(JSON.stringify(obj)))), iv: b64(iv) }; };
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = init?.method ?? 'GET';
    log.push(`${m} ${u.pathname}`);
    await new Promise(r => setTimeout(r, 5));   // الراوتر ياخذ وقت ← الطلبات تتداخل فعلاً
    if (u.pathname === '/getBasicInformation') return res(200, { result: 'ZCFG_SUCCESS', ModelName: 'NR5103EV2' });
    if (u.pathname === '/GetInfoNoLogin') return res(200, { result: 'ZCFG_SUCCESS' });
    if (u.pathname === '/getRSAPublickKey') return res(200, { result: 'ZCFG_SUCCESS', RSAPublicKey: publicKey });
    if (u.pathname === '/UserLogin') {
      const b = JSON.parse(String(init.body));
      const aes = unb64(fromUtf8(rsaDecrypt(privateKey, unb64(b.key))));
      const p = JSON.parse(fromUtf8(aesCbcDecrypt(aes, unb64(b.iv), unb64(b.content))));
      if (p.Input_Account !== 'admin' || fromUtf8(unb64(p.Input_Passwd)) !== PW) return res(401, { result: 'Invalid Username or Password' });
      valid = nc.randomBytes(8).toString('hex');
      keys.set(valid, aes);
      return res(200, enc(aes, { result: 'ZCFG_SUCCESS', sessionkey: valid, ThemeColor: 'blue' }));
    }
    if (u.pathname === '/cgi-bin/DAL') {
      const sk = u.searchParams.get('sessionkey') ?? '';
      if (sk !== valid) return res(401, { result: 'Invalid Session' });
      const oid = u.searchParams.get('oid');
      const obj = oid === 'cellwan_status'
        ? { INTF_Current_Access_Technology: 'NR5G-NSA', INTF_RSRP: -92, INTF_RSRQ: -11, INTF_SINR: 14, INTF_Current_Band: 'LTE_BC3', INTF_Cell_ID: '1234', INTF_PhyCell_ID: 134 }
        : oid === 'Traffic_Status' ? { ipIfaceSt: [] } : { lanhosts: [] };
      return res(200, enc(keys.get(sk)!, { result: 'ZCFG_SUCCESS', Object: [obj] }));
    }
    return res(404, {});
  };
  return { log, logins: () => log.filter(x => x === 'POST /UserLogin').length };
}

async function driver() {
  const { ZyxelDriver } = require('../src/drivers/zyxel/index');
  const d = new ZyxelDriver();
  (d as any).host = '192.168.1.1';
  (d as any).user = 'admin';
  (d as any).password = PW;
  return d;
}

test('زيكسل: قراءات متوازية بدون جلسة ← دخول واحد بس وكلها تنجح (كان: ٥ دخولات ← «كلمة غلط» ← 401)', async () => {
  const r = router();
  const d = await driver();
  const out = await Promise.all([d.getSignal(), d.getUsage().catch((e: any) => e), d.getDevices().catch((e: any) => e), d.getSignal()]);
  assert.equal(r.logins(), 1, 'دخول واحد: ' + r.log.join(', '));
  assert.ok(!(out[1] instanceof Error) && !(out[2] instanceof Error), 'ولا قراءة فشلت');
  assert.equal(out[0].rsrp, -92);
  assert.equal(out[3].rsrp, -92);
});

test('زيكسل: login من الشاشة وقراءة بنفس الوقت ← دخول واحد (ما يلغي واحد الثاني)', async () => {
  const r = router();
  const d = await driver();
  (d as any).sessionkey = '';
  const [, sig] = await Promise.all([d.login('192.168.1.1', 'admin', PW), d.getSignal()]);
  assert.equal(r.logins(), 1, r.log.join(', '));
  assert.equal(sig.rsrp, -92);
});

test('زيكسل: الجلسة انتهت (401) والقراءات متوازية ← دخول جديد واحد بس', async () => {
  const r = router();
  const d = await driver();
  await d.getSignal();
  (d as any).sessionkey = 'expired-key';
  await Promise.all([d.getSignal(), d.getSignal(), d.getSignal()]);
  assert.equal(r.logins(), 2, 'الأول + دخول واحد بعد الانتهاء: ' + r.log.join(', '));
});

test('زيكسل: كلمة غلط ← خطأ واضح ومحاولة وحدة حتى مع قراءات متوازية', async () => {
  const r = router();
  const d = await driver();
  (d as any).password = 'wrong-pass';
  const out = await Promise.all([d.getSignal().catch((e: any) => e), d.getSignal().catch((e: any) => e)]);
  assert.ok(out.every((e: any) => /كلمة المرور/.test(String(e?.message))));
  assert.equal(r.logins(), 1);
});
