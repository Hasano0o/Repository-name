/**
 * ZTE U30 Pro: تشفير الرسائل مثل service.js (ملف ٢٧ أكتوبر):
 *   web_crt_get ← مفتاح عام · web_http_enstr_set بـ RSA PKCS#1(Ko hex) · SEND_SMS: Number و MessageBody = base64(iv ‖ tag ‖ AES-256-GCM)
 * الراوتر المحاكى يفك بـ node:crypto (مستقل عن كود التطبيق).
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
const C: any = ncrypto;

const { aesGcmEncrypt, u30Enc } = require('../src/drivers/zte/u30crypto');

test('U30: AES-256-GCM يطابق node — والصيغة base64(iv ‖ tag ‖ ct)', () => {
  for (const len of [0, 5, 16, 33, 100]) {
    const key = C.randomBytes(32), iv = C.randomBytes(12), pt = C.randomBytes(len);
    const mine = aesGcmEncrypt(Uint8Array.from(key), Uint8Array.from(iv), Uint8Array.from(pt));
    const c = C.createCipheriv('aes-256-gcm', key, iv);
    const ref = Buffer.concat([c.update(pt), c.final()]);
    assert.equal(Buffer.from(mine.ct).toString('hex'), ref.toString('hex'), 'ct len ' + len);
    assert.equal(Buffer.from(mine.tag).toString('hex'), c.getAuthTag().toString('hex'), 'tag len ' + len);
  }
  const keyHex = C.randomBytes(32).toString('hex');
  const b = Buffer.from(u30Enc(keyHex, '0550123456', (n: number) => Uint8Array.from(C.randomBytes(n))), 'base64');
  const d = C.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  assert.equal(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(), '0550123456');
});

// ═══ الدرايفر ═══
const kp = C.generateKeyPairSync('rsa', { modulusLength: 1024, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
function rsaDec(b64s: string): string {
  const jwk: any = C.createPrivateKey(kp.privateKey).export({ format: 'jwk' });
  const big = (s: string) => BigInt('0x' + Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex'));
  const n = big(jwk.n), dd = big(jwk.d);
  let r = 1n, x = BigInt('0x' + Buffer.from(b64s, 'base64').toString('hex')) % n, e = dd;
  while (e > 0n) { if (e & 1n) r = (r * x) % n; x = (x * x) % n; e >>= 1n; }
  const em = Buffer.from(r.toString(16).padStart(256, '0'), 'hex');
  return em.subarray(em.indexOf(0, 2) + 1).toString();
}
function dec(keyHex: string, v: string): string {
  const b = Buffer.from(v, 'base64');
  const d = C.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString();
}
const { sha256 } = require(require.resolve('@noble/hashes/sha2', { paths: [process.cwd()] }));
const { bytesToHex, utf8ToBytes } = require(require.resolve('@noble/hashes/utils', { paths: [process.cwd()] }));
const SHA = (s: string) => bytesToHex(sha256(utf8ToBytes(s))).toUpperCase();
const WA = 'U30Pro_GEN_MEASV1.0.0B07', CR = 'MU5358_GEN_MEASV1.0.0B07', RD = 'rd123';

function router(opts: { forgetKeyOnce?: boolean } = {}) {
  const st: any = { key: '', sent: [] as any[], posts: [] as string[], forget: !!opts.forgetKeyOnce };
  const goodAd = SHA(SHA(WA + CR) + RD);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const reply = (o: unknown) => ({ ok: true, status: 200, url, headers: { get: () => null }, text: async () => JSON.stringify(o) } as any);
    if (u.pathname.endsWith('goform_set_cmd_process')) {
      const f = new URLSearchParams(String(init?.body ?? ''));
      const id = f.get('goformId') ?? '?';
      st.posts.push(id);
      if (f.get('AD') !== goodAd) return reply({ result: 'failure' });
      if (id === 'web_http_enstr_set') { st.key = rsaDec(f.get('web_enstr') ?? ''); return reply({ result: 'success' }); }
      if (id === 'SEND_SMS') {
        // الراوتر نسي المفتاح (أعيد تشغيله) ← ما يفك ← failure
        if (st.forget) { st.forget = false; st.key = 'x'; return reply({ result: 'failure' }); }
        try { st.sent.push({ to: dec(st.key, f.get('Number') ?? ''), body: dec(st.key, f.get('MessageBody') ?? ''), enc: f.get('encode_type') }); }
        catch { return reply({ result: 'failure' }); }
        return reply({ result: 'success' });
      }
      return reply({ result: 'success' });
    }
    const keys = (u.searchParams.get('cmd') ?? '').split(',');
    if (keys[0] === 'web_crt_get') return reply({ result: kp.publicKey, wa_inner_version: WA, cr_version: CR });
    const vers: Record<string, string> = { wa_inner_version: WA, cr_version: CR, web_version: WA, RD };
    const o: Record<string, string> = {};
    for (const k of keys) o[k] = vers[k] ?? '';
    return reply(o);
  };
  return st;
}
function driver() {
  const { ZteDriver } = require('../src/drivers/zte/index');
  const d = new ZteDriver();
  (d as any).host = '192.168.0.1'; (d as any).password = 'x'; (d as any).ensure = async () => {};
  return d;
}

test('U30 Pro (درايفر): مفتاح الجلسة ← الرقم والنص مشفّرين والراوتر يفكهم', async () => {
  const st = router();
  const d = driver();
  await d.sendSms('0550123456', 'رصيد');
  assert.equal(st.posts.filter((x: string) => x === 'SEND_SMS').length, 1);
  assert.ok(st.posts.indexOf('web_http_enstr_set') < st.posts.indexOf('SEND_SMS'), 'المفتاح قبل الرسالة');
  assert.equal(st.sent[0].to, '0550123456');
  assert.equal(st.sent[0].body, '06310635064A062F');
  assert.equal(st.sent[0].enc, 'UNICODE');
  const keys = st.posts.filter((x: string) => x === 'web_http_enstr_set').length;
  await d.sendSms('900', 'Hi');
  assert.equal(st.posts.filter((x: string) => x === 'web_http_enstr_set').length, keys, 'المفتاح مرة وحدة للجلسة');
  assert.equal(st.sent[1].body, '00480069');
});

test('U30 Pro (درايفر): الراوتر نسي المفتاح ← مفتاح جديد ونرسل مرة وحدة بس (ما تنرسل مرتين)', async () => {
  const st = router({ forgetKeyOnce: true });
  const d = driver();
  await d.sendSms('900', 'Hi');
  assert.equal(st.sent.length, 1);
  assert.equal(st.posts.filter((x: string) => x === 'SEND_SMS').length, 2, 'الأولى انرفضت (ما انرسلت) والثانية انرسلت');
});
