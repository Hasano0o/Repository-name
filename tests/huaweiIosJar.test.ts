import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
let OS = 'android';
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'react-native') return { Platform: { get OS() { return OS; }, select: (o: any) => o[OS] ?? o.default } };
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
const rnd = () => Math.random().toString(36).slice(2, 14);

/**
 * راوتر محاكى: opts.jarOnlyAfterAuth = بعد authentication_login الجلسة اللي دخلت جديدة وتوصل جرة النظام بس
 * (الكوكي اليدوي يبقى على القديمة ← كل قراءة 100003) — نفس تقارير الآيفون ٨ نوفمبر.
 * opts.devLock = lock-freq يرد 100003 ووضع المطوّر مفعّل، ودخول المطوّر (loginflag=2) يرفض.
 */
function router(opts: { jarOnlyAfterAuth?: boolean; devLock?: boolean; doubleCookie?: boolean; singleAdmin?: boolean } = {}) {
  type Sess = { tok: string; logged: boolean; scram?: { first: string; server: string } };
  const sessions = new Map<string, Sess>();
  let jar = '';
  const salt = bytesToHex(utf8ToBytes('salt-salt-salt-1'));
  const log: string[] = [];
  const newSess = () => { const id = rnd(); sessions.set(id, { tok: rnd(), logged: false }); return id; };
  const xml = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><response>${b}</response>`;
  const err = (c: string) => `<?xml version="1.0" encoding="UTF-8"?><error><code>${c}</code><message></message></error>`;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const p = u.pathname.replace(/^\/api\//, '');
    const hdrs = (init?.headers ?? {}) as Record<string, string>;
    log.push(`${method} ${p}`);
    const manual = init?.credentials === 'omit';
    let sid = ((manual ? hdrs.Cookie ?? '' : jar).match(/SessionID=([^;]+)/) ?? [])[1] ?? '';
    const out: Record<string, string> = {};
    const setSid = (id: string, jarOnly = false) => {
      if (!jarOnly) out['set-cookie'] = `SessionID=${id}; path=/; HttpOnly`;
      if (!manual) jar = `SessionID=${id}`;
    };
    const res = (b: string) => ({ ok: true, status: 200, url, headers: { get: (k: string) => out[k.toLowerCase()] ?? null }, text: async () => b } as any);
    if (!sessions.has(sid)) { sid = newSess(); setSid(sid); }
    const s = sessions.get(sid)!;
    if (u.pathname === '/html/home.html') { setSid(newSess()); return res('<html></html>'); }
    if (p === 'webserver/SesTokInfo') return res(xml(`<SesInfo>SessionID=${sid}</SesInfo><TokInfo>${s.tok}</TokInfo>`));
    if (p === 'webserver/token') return res(xml(`<token>${'x'.repeat(32)}${s.tok}</token>`));
    if (p === 'user/state-login') return res(xml(`<State>${s.logged ? '0' : '-1'}</State><password_type>4</password_type><lockstatus>0</lockstatus>`));
    if (method === 'GET') {
      if (p === 'monitoring/status') return res(xml('<CurrentNetworkTypeEx>101</CurrentNetworkTypeEx>'));
      if (!s.logged) return res(err('100003'));
      if (p === 'developer/developermode-featureswitch') return res(xml(`<lockband_enable>${opts.devLock ? 1 : 0}</lockband_enable>`));
      if (p === 'net/lock-freq' && opts.devLock) return res(err('100003'));
      if (p === 'device/signal') return res(xml('<pci>134</pci><rsrp>-95dBm</rsrp><rsrq>-10dB</rsrq><sinr>12dB</sinr><band>3</band>'));
      if (p === 'net/net-mode') return res(xml('<NetworkMode>00</NetworkMode><NetworkBand>3FFFFFFF</NetworkBand><LTEBand>7FFFFFFFFFFFFFFF</LTEBand>'));
      return res(xml(''));
    }
    if (hdrs.__RequestVerificationToken !== s.tok) return res(err('125003'));
    s.tok = rnd();
    out['__requestverificationtoken'] = s.tok;
    const b = String(init?.body ?? '');
    const tg = (n: string) => (b.match(new RegExp(`<${n}>([^<]*)</${n}>`)) ?? [])[1] ?? '';
    if (p === 'user/logout') { s.logged = false; return res(xml('OK')); }
    if (p === 'user/challenge_login') {
      s.scram = { first: tg('firstnonce'), server: tg('firstnonce') + rnd() };
      return res(xml(`<salt>${salt}</salt><iterations>100</iterations><servernonce>${s.scram.server}</servernonce><newType>0</newType><modeselected>1</modeselected>`));
    }
    if (p === 'user/authentication_login') {
      const sc = s.scram;
      if (!sc) return res(err('125002'));
      if (opts.devLock && tg('loginflag') === '2') return res(err('108006'));
      const salted = pbkdf2(sha256, utf8ToBytes(PW), hexToBytes(salt), { c: 100, dkLen: 32 });
      const clientKey = hmac(sha256, utf8ToBytes('Client Key'), salted);
      const storedKey = sha256(clientKey);
      const sig = hmac(sha256, utf8ToBytes(`${sc.first},${sc.server},${sc.server}`), storedKey);
      const ck = hexToBytes(tg('clientproof')).map((x: number, i: number) => x ^ sig[i]);
      if (bytesToHex(sha256(ck)) !== bytesToHex(storedKey)) return res(err('108006'));
      // هواوي: مدير واحد بالمرة
      if (opts.singleAdmin && [...sessions.values()].some(x => x.logged)) return res(err('108003'));
      if (opts.doubleCookie) {
        // الجلسة اللي دخلت جديدة، والرأس فيه القديم ثم الجديد (الآيفون يدمجهم بفاصلة)
        const id2 = newSess();
        sessions.get(id2)!.logged = true;
        out['set-cookie'] = `SessionID=${sid}; path=/; HttpOnly, SessionID=${id2}; path=/; HttpOnly`;
        if (!manual) jar = `SessionID=${id2}`;
        return res(xml('OK'));
      }
      if (opts.jarOnlyAfterAuth) {
        const id2 = newSess();
        sessions.get(id2)!.logged = true;
        setSid(id2, true);
      } else s.logged = true;
      return res(xml('OK'));
    }
    if (p === 'user/login') return res(err('108006'));
    return res(xml('OK'));
  };
  return { log };
}

async function driver(reset = true) {
  const { HuaweiDriver, _resetHuaweiGate } = require('../src/drivers/huawei/index');
  if (reset) _resetHuaweiGate();
  return new HuaweiDriver();
}

test('هواوي آيفون: الكوكي اليدوي يدخل وكل قراءة 100003 ← نرجع لجرة النظام والإشارة تنقرى (كان: طرد)', async () => {
  OS = 'ios';
  router({ jarOnlyAfterAuth: true });
  const d = await driver();
  await d.login('192.168.8.1', 'admin', PW, { fresh: true });
  assert.equal((await d.getSignal()).pci, '134');
  // نسخة درايفر ثانية لنفس الراوتر تبدأ بجرة النظام على طول
  const d2 = await driver(false);
  await d2.login('192.168.8.1', 'admin', PW, { fresh: true });
  assert.equal((await d2.getSignal()).pci, '134');
});

test('هواوي آيفون: راوتر الكوكي اليدوي فيه شغال ← ما يتغيّر شي', async () => {
  OS = 'ios';
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', PW, { fresh: true });
  assert.equal((await d.getSignal()).pci, '134');
  assert.equal(r.log.filter(x => x === 'POST user/authentication_login').length, 1);
});

test('هواوي: دخول وضع المطوّر فشل مرة ← النسخ الثانية ما تسوي logout من جديد (كان: كل نسخة تطرد الجلسة)', async () => {
  OS = 'android';
  const r = router({ devLock: true });
  const d = await driver();
  await d.login('192.168.8.1', 'admin', PW, { fresh: true });
  await d.getCellLocks().catch(() => null);
  const first = r.log.filter(x => x === 'POST user/logout').length;
  const d2 = await driver(false);
  await d2.login('192.168.8.1', 'admin', PW, { fresh: true });
  await d2.getCellLocks().catch(() => null);
  assert.equal(r.log.filter(x => x === 'POST user/logout').length, first, 'logout انعاد في النسخة الثانية');
  assert.equal((await d2.getSignal()).pci, '134');
});

test('هواوي آيفون (B520 زين): set-cookie بعد التحقق فيه SessionID مرتين ← ناخذ الأخير ونقرأ (كان: 100003 ثم 108003)', async () => {
  OS = 'ios';
  router({ doubleCookie: true, singleAdmin: true });
  const d = await driver();
  await d.login('192.168.8.1', 'admin', PW, { fresh: true });
  assert.equal((await d.getSignal()).pci, '134');
});
