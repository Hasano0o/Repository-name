/**
 * هواوي البوابة القديمة (LTE CPE E5172) — من ملفات «مو مدعوم؟» لثلاث أعضاء (٣١ أكتوبر – ٨ نوفمبر):
 * التعرّف · تشفير الكلمة (MyRSAEncryptB64: PKCS#1 v1.5 + مفتاح ثابت) · الدخول والحالة · العدّاد وقفل المحاولات.
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
    return { __esModule: true, default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const crypto = require('crypto');
const P = require('../src/drivers/hwgw/parse');

/** صفحة الدخول بنفس شكل index.html حق E5172 (مختصرة) */
const page = (times = 0) => `<!DOCTYPE html><html><head>
<script type="text/javascript" src="/js/loadbyver.js?ver=V200R001C115SP100"></script>
<script>loadJs("/js/index.js");</script>
<script>var LoginError = "${times}:1074266212"; var Cookieflag = 0;</script></head>
<body id="loginBody"><input type="text" id="txt_Username" /><input type="password" id="txt_Password" /></body></html>`;

test('E5172: التعرّف والعدّاد والنسخة', () => {
  assert.ok(P.isGwLoginPage(page()));
  assert.equal(P.isGwLoginPage('<html>api/webserver/SesTokInfo</html>'), false);
  // صفحة فايبر هواوي (login.cgi + X_HW_Token) مو هي
  assert.equal(P.isGwLoginPage('<form action="/login.cgi"><input id="txt_Password"><input name="x.X_HW_Token"></form>'), false);
  assert.deepEqual(P.gwLoginError(page(2)), { times: 2, code: '1074266212' });
  assert.equal(P.gwVersion(page()), 'V200R001C115SP100');
});

test('E5172: MyRSAEncryptB64 = PKCS#1 v1.5 نوع 2 (ينفك بالمفتاح الخاص) — والمفتاح الثابت ١٠٢٤ بت', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const jwk = publicKey.export({ format: 'jwk' });
  const hex = (b64u: string) => Buffer.from(b64u, 'base64url').toString('hex');
  for (const pw of ['admin', 'Pa$$w0rd!', 'كلمة']) {
    const enc = P.gwRsaB64(pw, (n: number) => Uint8Array.from(crypto.randomBytes(n)), hex(jwk.n), hex(jwk.e));
    const dec = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(enc, 'base64'));
    assert.equal(dec.toString('utf8'), pw);
  }
  const fixed = P.gwRsaB64('admin', (n: number) => Uint8Array.from(crypto.randomBytes(n)));
  assert.ok(Buffer.from(fixed, 'base64').length <= 128 && Buffer.from(fixed, 'base64').length >= 120);
  assert.equal(P.gwLoginBody('admin', 'a+b/c='), 'Username=admin&Password=a%2Bb%2Fc%3D');
});

test('E5172: رد الحالة (getStatusByAjax.cgi)', () => {
  const s = P.gwStatus('<?xml version="1.0"?><response><WIFI>1</WIFI><SIM>1</SIM><SIG>4</SIG><Mode>7</Mode><Roam>0</Roam><SMS>0</SMS><Connect>2</Connect><Connect6>0</Connect6><Connect4>2</Connect4><WanErrCode>0</WanErrCode><ConnectVoice>0</ConnectVoice><Operator>STC</Operator></response>');
  assert.equal(s.sig, 4); assert.equal(s.operator, 'STC'); assert.equal(s.mode, '7');
  assert.equal(P.gwStatus(page()), null);
});

/** راوتر محاكى: كلمة صحيحة ← جلسة والحالة ترد · غلط ← صفحة الدخول والعدّاد يزيد */
function gw(opts: { times?: number } = {}) {
  let times = opts.times ?? 0, logged = false;
  const log: string[] = [];
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = (init?.method ?? 'GET').toUpperCase();
    log.push(`${m} ${u.pathname}`);
    const res = (text: string, sc = '') => ({ ok: true, status: 200, url, headers: { get: (k: string) => (k.toLowerCase() === 'set-cookie' && sc ? sc : null) }, text: async () => text } as any);
    if (u.pathname === '/') return res(page(times));
    if (u.pathname === '/index/login.cgi') {
      const q = new URLSearchParams(String(init?.body ?? ''));
      // المفتاح الثابت ما عندنا خاصه — نتأكد من الشكل بس (base64 ١٢٨ بايت تقريباً) والاسم
      const enc = Buffer.from(q.get('Password') ?? '', 'base64');
      const okShape = enc.length >= 120 && enc.length <= 128;
      const ok = okShape && q.get('Username') === 'admin' && (globalThis as any).__pwOk;
      if (ok) { logged = true; times = 0; return res('<script>top.location="/html/index.asp"</script>', 'SessionID_R3=abc; path=/'); }
      times++;
      return res(page(times));
    }
    if (u.pathname === '/index/getStatusByAjax.cgi') return res(logged ? '<response><SIG>3</SIG><Mode>7</Mode><Connect>2</Connect><SIM>1</SIM><Operator>Zain</Operator></response>' : page(times));
    return res('', '');
  };
  void privateKey;
  return { log };
}
const { HuaweiGwDriver } = require('../src/drivers/hwgw/index');

test('E5172: دخول صحيح ← الحالة (الشركة والأعمدة)', async () => {
  (globalThis as any).__pwOk = true;
  const r = gw();
  const d = new HuaweiGwDriver();
  assert.ok(await d.detect('192.168.1.1'));
  await d.login('192.168.1.1', 'admin', 'admin', { fresh: true });
  assert.equal((await d.getNetworkInfo()).operator, 'Zain');
  assert.equal((await d.getSignal()).network, '4G');
  assert.equal(r.log.filter(x => x === 'POST /index/login.cgi').length, 1);
});

test('E5172: كلمة غلط ← «رفض» والعدّاد · الخلفية ما تعيدها · ٣ محاولات ← ما نرسل', async () => {
  (globalThis as any).__pwOk = false;
  const r = gw();
  const d = new HuaweiGwDriver();
  await assert.rejects(d.login('192.168.1.1', 'admin', 'x', { fresh: true }), /رفض اسم المستخدم أو الكلمة \(محاولة 1/);
  await assert.rejects(d.login('192.168.1.1', 'admin', 'x'), /رفضها الراوتر قبل/);
  assert.equal(r.log.filter(x => x === 'POST /index/login.cgi').length, 1);

  const r3 = gw({ times: 3 });
  const d3 = new HuaweiGwDriver();
  await assert.rejects(d3.login('192.168.1.1', 'admin', 'admin', { fresh: true }), /٣ محاولات/);
  assert.equal(r3.log.filter(x => x === 'POST /index/login.cgi').length, 0);
});

test('E5172: صفحات FULL ما فيها شي خطر', () => {
  const d = new HuaweiGwDriver();
  const pages: string[] = d.afterLoginPages();
  assert.ok(pages.includes('/html/index.asp'));
  assert.ok(!pages.some(p => /reset|reboot|firmware\.asp|logout|cfgfile/i.test(p)));
});
