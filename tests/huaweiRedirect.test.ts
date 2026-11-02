/**
 * H112-370 (Three، ٣١ أكتوبر ٢٠٢٦): http://192.168.8.1/html/... يتحوّل لـ https://hirouter.net/...
 * الدخول كان ينجح على hirouter.net والقراءات تروح لـ 192.168.8.1 (جرة كوكي ثانية) ← 100003 «الراوتر يطلّع التطبيق».
 * الحين الدرايفر يكمّل على الأصل اللي انتهى له التحويل. راوتر بدون تحويل ما يتغيّر عليه شي.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'react-native') return { Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
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
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 500 ? 1 : ms);

const { sha256 } = require('@noble/hashes/sha2');
const { hmac } = require('@noble/hashes/hmac');
const { pbkdf2 } = require('@noble/hashes/pbkdf2');
const { bytesToHex, hexToBytes, utf8ToBytes } = require('@noble/hashes/utils');
const PW = 'Pass1234';
const rnd = () => Math.random().toString(36).slice(2, 12);

function router(redirect: boolean, iosAts = false) {
  const sessions = new Map<string, { tok: string; logged: boolean; scram?: { first: string; server: string } }>();
  const jars: Record<string, string> = {};               // جرة أندرويد لكل اسم (OkHttp)
  const salt = bytesToHex(utf8ToBytes('salt-salt-salt-1'));
  const xml = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><response>${b}</response>`;
  const err = (c: string) => `<?xml version="1.0" encoding="UTF-8"?><error><code>${c}</code></error>`;
  const hosts: string[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    let u = new URL(url);
    // الصفحات وstate-login يتحوّلون لـ https://hirouter.net — باقي /api/ يرد على العنوان عادي
    if (redirect && u.protocol === 'http:' && u.host === '192.168.8.1' && (u.pathname.startsWith('/html/') || u.pathname === '/api/user/state-login')) u = new URL(`https://hirouter.net${u.pathname}`);
    // الآيفون: شهادة hirouter.net الذاتية مرفوضة (ATS) — https://192.168.8.1 مسموح
    if (iosAts && u.host === 'hirouter.net') throw new Error('A TLS error caused the secure connection to fail.');
    hosts.push(`${u.protocol}//${u.host}`.replace('http://', ''));
    const method = init?.method ?? 'GET';
    const p = u.pathname.replace(/^\/api\//, '');
    let sid = ((jars[u.host] ?? '').match(/SessionID=([^;]+)/) ?? [])[1] ?? '';
    const out: Record<string, string> = {};
    const res = (body: string) => ({ ok: true, status: 200, url: u.toString(), headers: { get: (k: string) => out[k.toLowerCase()] ?? null }, text: async () => body } as any);
    const fresh = () => { sid = rnd(); sessions.set(sid, { tok: rnd(), logged: false }); jars[u.host] = `SessionID=${sid}`; };
    if (!sessions.has(sid) || u.pathname === '/html/home.html') fresh();
    const s = sessions.get(sid)!;
    if (u.pathname === '/html/home.html') return res('<html></html>');
    if (p === 'webserver/SesTokInfo') return res(xml(`<SesInfo>SessionID=${sid}</SesInfo><TokInfo>${s.tok}</TokInfo>`));
    if (p === 'webserver/token') return res(xml(`<token>${'x'.repeat(32)}${s.tok}</token>`));
    if (p === 'user/state-login') return res(xml(`<State>${s.logged ? '0' : '-1'}</State><password_type>4</password_type>`));
    if (method === 'GET') {
      if (!s.logged) return res(err('100003'));
      if (p === 'device/signal') return res(xml('<pci>134</pci><rsrp>-95dBm</rsrp><rsrq>-10dB</rsrq><sinr>12dB</sinr><band>3</band>'));
      return res(xml(''));
    }
    const hdrs = (init?.headers ?? {}) as Record<string, string>;
    if (hdrs.__RequestVerificationToken !== s.tok) return res(err('125003'));
    s.tok = rnd();
    out['__requestverificationtoken'] = s.tok;
    const body = String(init?.body ?? '');
    const tg = (n: string) => (body.match(new RegExp(`<${n}>([^<]*)</${n}>`)) ?? [])[1] ?? '';
    if (p === 'user/challenge_login') {
      s.scram = { first: tg('firstnonce'), server: tg('firstnonce') + rnd() };
      return res(xml(`<salt>${salt}</salt><servernonce>${s.scram.server}</servernonce><iterations>100</iterations>`));
    }
    if (p === 'user/authentication_login') {
      const sc = s.scram!;
      const salted = pbkdf2(sha256, utf8ToBytes(PW), hexToBytes(salt), { c: 100, dkLen: 32 });
      const clientKey = hmac(sha256, utf8ToBytes('Client Key'), salted);
      const storedKey = sha256(clientKey);
      const sig = hmac(sha256, utf8ToBytes(`${sc.first},${sc.server},${sc.server}`), storedKey);
      const ck = hexToBytes(tg('clientproof')).map((b: number, i: number) => b ^ sig[i]);
      if (bytesToHex(sha256(ck)) !== bytesToHex(storedKey)) return res(err('108006'));
      s.logged = true;
      return res(xml('OK'));
    }
    return res(xml('OK'));
  };
  return { hosts };
}

test('الراوتر يحوّل لـ https://hirouter.net: الدخول والقراءة على نفس الأصل (ما ينطرد)', async () => {
  const r = router(true);
  const { HuaweiDriver, _resetHuaweiGate } = require('../src/drivers/huawei/index');
  _resetHuaweiGate(); // كل اختبار = راوتر جديد (البوابة المشتركة في الذاكرة)
  const d = new HuaweiDriver();
  await d.login('192.168.8.1', 'admin', PW, { fresh: true });
  const sig = await d.getSignal();
  assert.equal(String(sig.pci), '134');
  const after = r.hosts.slice(r.hosts.indexOf('https://hirouter.net'));
  assert.ok(after.length > 1 && after.every(h => h === 'https://hirouter.net'), `كل الطلبات بعد التحويل على hirouter.net: ${after.join(',')}`);
});

test('راوتر بدون تحويل: كل شي على http://192.168.8.1 مثل قبل', async () => {
  const r = router(false);
  const { HuaweiDriver, _resetHuaweiGate } = require('../src/drivers/huawei/index');
  _resetHuaweiGate(); // كل اختبار = راوتر جديد (البوابة المشتركة في الذاكرة)
  const d = new HuaweiDriver();
  await d.login('192.168.8.1', 'admin', PW, { fresh: true });
  assert.equal(String((await d.getSignal()).pci), '134');
  assert.ok(r.hosts.every(h => h === '192.168.8.1'));
});

test('الآيفون: hirouter.net مرفوض (ATS) ← نكمّل على https://192.168.8.1', async () => {
  const r = router(true, true);
  const { HuaweiDriver, _resetHuaweiGate } = require('../src/drivers/huawei/index');
  _resetHuaweiGate(); // كل اختبار = راوتر جديد (البوابة المشتركة في الذاكرة)
  const d = new HuaweiDriver();
  await d.login('192.168.8.1', 'admin', PW, { fresh: true });
  assert.equal(String((await d.getSignal()).pci), '134');
  const last = r.hosts.slice(-3);
  assert.ok(last.every(h => h === 'https://192.168.8.1'), `آخر الطلبات على https بالعنوان: ${last.join(',')}`);
});
