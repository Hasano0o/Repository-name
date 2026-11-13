/**
 * هواوي — إعادة الدخول بوضع المطوّر والقراءات شغالة (تقارير session ١٣ نوفمبر ٢:٤٠ م و٤:٢٧ م، آيفون):
 *   lock-freq 100003 ← logout ← دخول المطوّر، والشاشة عندها قراءات (signal / status / net-mode) طالعة بنفس اللحظة.
 *   اللي توصل الراوتر بين الخروج والدخول ترد 125002/100003 ← طبقة الجلسات تحسبها «طرد» وتدخل من جديد فوق دخول
 *   المطوّر ← «الراوتر يطلّع التطبيق» [125002 → 125003 → 125003 → 125003] — والراوتر ما طرد أحد.
 * الحين: القراءات تنتظر إعادة الدخول، واللي انرفضت بسببها تنعاد مرة — وطلبين lock-freq مع بعض = إعادة دخول وحدة.
 * راوتر محاكى: جلسات بالكوكي، SCRAM حقيقي، كل طلب ياخذ وقت (الرد ينحسب لحظة ما يوصل، مو لحظة ما انرسل).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
let OS = 'ios';
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
const wait = (ms: number) => new Promise(r => realSet(r, ms));

const { sha256 } = require('@noble/hashes/sha2');
const { hmac } = require('@noble/hashes/hmac');
const { pbkdf2 } = require('@noble/hashes/pbkdf2');
const { bytesToHex, hexToBytes, utf8ToBytes } = require('@noble/hashes/utils');

const PW = 'Pass1234';
const rnd = () => Math.random().toString(36).slice(2, 12);

/** devFail: الراوتر يرفض دخول المطوّر (loginflag=2) ← نرجع للجلسة العادية */
function router(opts: { devFail?: boolean } = {}) {
  // logged: false = ما دخلت · 'out' = طلعت (logout) ← قراءاتها 125002 مثل التقارير · 'full' = عادية · 'dev' = مطوّر
  type Sess = { tok: string[]; logged: false | 'out' | 'full' | 'dev'; scram?: { first: string; server: string; dev: boolean } };
  const sessions = new Map<string, Sess>();
  let jar = '';
  const salt = bytesToHex(utf8ToBytes('salt-salt-salt-1'));
  const log: string[] = [];
  const newSess = () => { const id = rnd(); sessions.set(id, { tok: [rnd()], logged: false }); return id; };
  const xml = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><response>${b}</response>`;
  const err = (c: string) => `<?xml version="1.0" encoding="UTF-8"?><error><code>${c}</code><message></message></error>`;
  // القراءات الثقيلة أبطأ من أوامر الدخول — عشان توصل الراوتر بعد الخروج وقبل الدخول الجديد
  const COST: Record<string, number> = { 'device/signal': 25, 'monitoring/status': 12, 'net/net-mode': 18, 'net/lock-freq': 3 };
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const p = u.pathname.replace(/^\/api\//, '');
    const hdrs = (init?.headers ?? {}) as Record<string, string>;
    // الكوكي ينمسك لحظة الإرسال (الجرة أو ترويستنا)
    const sentCookie = init?.credentials === 'omit' ? hdrs.Cookie ?? '' : jar;
    let sid = (sentCookie.match(/SessionID=([^;]+)/) ?? [])[1] ?? '';
    await wait(COST[p] ?? 2);
    const out: Record<string, string> = {};
    const setSid = (id: string) => { out['set-cookie'] = `SessionID=${id}; path=/; HttpOnly`; if (init?.credentials !== 'omit') jar = `SessionID=${id}`; };
    const res = (body: string) => { log.push(`${method} ${p} → ${(body.match(/<code>(\d+)/) ?? [])[1] ?? 'ok'}`); return { ok: true, status: 200, url, headers: { get: (k: string) => out[k.toLowerCase()] ?? null }, text: async () => body } as any; };
    if (!sessions.has(sid)) { sid = newSess(); setSid(sid); }
    const s = sessions.get(sid)!;
    if (u.pathname === '/html/home.html') { const id = newSess(); setSid(id); return res('<html></html>'); }
    if (p === 'webserver/SesTokInfo') return res(xml(`<SesInfo>SessionID=${sid}</SesInfo><TokInfo>${s.tok[0]}</TokInfo>`));
    if (p === 'webserver/token') return res(xml(`<token>${'x'.repeat(32)}${s.tok[0]}</token>`));
    if (p === 'user/state-login') return res(xml(`<State>${s.logged === 'full' || s.logged === 'dev' ? '0' : '-1'}</State><password_type>4</password_type>`));
    if (method === 'GET') {
      if (s.logged === 'out') return res(err('125002'));
      if (!s.logged) return res(err('100003'));
      if (p === 'developer/developermode-featureswitch') return res(xml('<lockband_enable>1</lockband_enable>'));
      if (p === 'net/lock-freq') return s.logged === 'dev' ? res(xml('<NetworkMode>03</NetworkMode>')) : res(err('100003'));
      if (p === 'device/signal') return res(xml('<pci>134</pci><rsrp>-95dBm</rsrp><rsrq>-10dB</rsrq><sinr>12dB</sinr><band>3</band>'));
      if (p === 'monitoring/status') return res(xml('<CurrentNetworkTypeEx>101</CurrentNetworkTypeEx>'));
      if (p === 'net/net-mode') return res(xml('<NetworkMode>00</NetworkMode>'));
      return res(xml(''));
    }
    const tok = hdrs.__RequestVerificationToken;
    if (!s.tok.includes(tok)) return res(err('125003'));
    s.tok = [rnd(), rnd()];
    out['__requestverificationtokenone'] = s.tok[0];
    out['__requestverificationtokentwo'] = s.tok[1];
    const body = String(init?.body ?? '');
    const tg = (n: string) => (body.match(new RegExp(`<${n}>([^<]*)</${n}>`)) ?? [])[1] ?? '';
    if (p === 'user/challenge_login') {
      const dev = tg('loginflag') === '2';
      if (dev && opts.devFail) return res(err('108006'));
      s.scram = { first: tg('firstnonce'), server: tg('firstnonce') + rnd(), dev };
      return res(xml(`<salt>${salt}</salt><iterations>100</iterations><servernonce>${s.scram.server}</servernonce><modeselected>1</modeselected>`));
    }
    if (p === 'user/authentication_login') {
      const sc = s.scram;
      if (!sc) return res(err('125002'));
      if (tg('finalnonce') !== sc.server) return res(err('108006'));
      const salted = pbkdf2(sha256, utf8ToBytes(PW), hexToBytes(salt), { c: 100, dkLen: 32 });
      const clientKey = hmac(sha256, utf8ToBytes('Client Key'), salted);
      const storedKey = sha256(clientKey);
      const sig = hmac(sha256, utf8ToBytes(`${sc.first},${sc.server},${sc.server}`), storedKey);
      const proof = hexToBytes(tg('clientproof'));
      const ck = proof.map((b: number, i: number) => b ^ sig[i]);
      if (bytesToHex(sha256(ck)) !== bytesToHex(storedKey)) return res(err('108006'));
      // الدخول يرجّع جلسة جديدة (مثل الراوتر: set-cookie بعد التحقق)
      const id = newSess();
      sessions.get(id)!.logged = sc.dev ? 'dev' : 'full';
      sessions.get(id)!.tok = s.tok;
      setSid(id);
      return res(xml('OK'));
    }
    if (p === 'user/logout') { s.logged = 'out'; return res(xml('OK')); }
    return res(xml('OK'));
  };
  return { log, count: (x: string) => log.filter(l => l.startsWith(x)).length };
}

async function driver() {
  const { HuaweiDriver, _resetHuaweiGate } = require('../src/drivers/huawei/index');
  _resetHuaweiGate();
  return new HuaweiDriver();
}

for (const os of ['ios', 'android']) {
  test(`هواوي (${os}): دخول المطوّر والقراءات شغالة ← ولا قراءة تفشل (كان 125002 ← «الراوتر يطلّع التطبيق»)`, async () => {
    OS = os;
    const r = router();
    const d = await driver();
    await d.login('192.168.8.1', 'admin', PW);
    const before = r.log.length;
    // نفس الشاشة: قراءات ثقيلة طالعة + lock-freq مرتين مع بعض (مثل التقرير)
    const all = await Promise.allSettled([
      d.getSignal(),
      (d as any).get('net/lock-freq'),
      (d as any).get('net/lock-freq'),
      (d as any).get('net/net-mode'),
      d.getSignal(),
      // قراءة تبدأ وإعادة الدخول شغالة (بين الخروج والدخول)
      wait(8).then(() => d.getSignal()),
    ]);
    const bad = all.map((x, i) => (x.status === 'rejected' ? `${i}: ${(x as any).reason?.message ?? x.reason}` : '')).filter(Boolean);
    assert.deepEqual(bad, [], 'قراءات فشلت: ' + bad.join(' | ') + '\n' + r.log.slice(before).join('\n'));
    assert.equal((all[0] as any).value.pci, '134');
    const after = r.log.slice(before);
    assert.equal(after.filter(x => x.startsWith('POST user/logout')).length, 1, 'خروج واحد (إعادة دخول وحدة للطلبين): ' + after.join(', '));
    assert.equal(after.filter(x => x === 'POST user/authentication_login → ok').length, 1, 'دخول مطوّر واحد');
    // بعدها الجلسة جلسة مطوّر والقراءة عادية
    await (d as any).get('net/lock-freq');
    assert.equal((await d.getSignal()).pci, '134');
  });

  test(`هواوي (${os}): دخول المطوّر انرفض ← نرجع للجلسة العادية والقراءات اللي كانت شغالة تكمّل`, async () => {
    OS = os;
    const r = router({ devFail: true });
    const d = await driver();
    await d.login('192.168.8.1', 'admin', PW);
    const before = r.log.length;
    const [sig, lf, nm, late] = await Promise.allSettled([
      d.getSignal(),
      (d as any).get('net/lock-freq'),
      (d as any).get('net/net-mode'),
      wait(8).then(() => d.getSignal()),
    ]);
    const after = r.log.slice(before).join('\n');
    assert.equal(sig.status, 'fulfilled', 'الإشارة تكمّل: ' + ((sig as any).reason?.message ?? '') + '\n' + after);
    assert.equal(nm.status, 'fulfilled', 'وضع الشبكة يكمّل: ' + ((nm as any).reason?.message ?? '') + '\n' + after);
    assert.equal(late.status, 'fulfilled', 'القراءة اللي بدأت وقتها تكمّل\n' + after);
    assert.equal(lf.status, 'rejected', 'lock-freq نفسه غير مدعوم (100003) — مو طرد');
    assert.match(String((lf as any).reason?.code ?? (lf as any).reason?.message), /100003/);
    // ما نعيد دخول المطوّر على هالراوتر
    const n = r.count('POST user/logout');
    await assert.rejects((d as any).get('net/lock-freq'));
    assert.equal(r.count('POST user/logout'), n, 'ما فيه خروج ثاني');
    assert.equal((await d.getSignal()).pci, '134');
  });
}
