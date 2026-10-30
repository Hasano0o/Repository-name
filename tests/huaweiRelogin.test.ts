/**
 * هواوي — إعادة الدخول بعد الطرد (أخطاء ٢٣–٣٠ أكتوبر: ٦٤ «الراوتر يطلّع التطبيق»):
 *  ١. «100003 → sig:100003…» (٢١ مرة): بعد الطرد state-login يقول State=0 («فيه جلسة») والتطبيق يصدّقه
 *     ويرجع بدون دخول ← كل قراءة 100003. الحين markStale ← دخول حقيقي.
 *  ٢. «… → 125003 ×3» (٣٣ مرة): الراوتر غيّر الجلسة؛ أول SCRAM يرد 125003 فكنا نطفي SCRAM للأبد ونرجع
 *     للدخول القديم (جلسة ناقصة). الحين نجدد الجلسة ونعيد SCRAM.
 * راوتر محاكى: جلسات بالكوكي، رموز تتدوّر، SCRAM حقيقي (PBKDF2/HMAC) — للآيفون (كوكي يدوي) والأندرويد (جرة).
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

const { sha256 } = require('@noble/hashes/sha2');
const { hmac } = require('@noble/hashes/hmac');
const { pbkdf2 } = require('@noble/hashes/pbkdf2');
const { bytesToHex, hexToBytes, utf8ToBytes } = require('@noble/hashes/utils');

const PW = 'Pass1234';
const rnd = () => Math.random().toString(36).slice(2, 12);

function router(opts: { noScram?: boolean } = {}) {
  // logged: 'full' = SCRAM · 'limited' = الدخول القديم user/login (جلسة ناقصة: net/lock-freq ← 100003، تعليق الدرايفر)
  type Sess = { tok: string[]; logged: false | 'full' | 'limited'; scram?: { first: string; server: string } };
  const sessions = new Map<string, Sess>();
  let jar = '';                       // جرة الأندرويد
  let ghost = false;                  // بعد الطرد: state-login يقول «داخل» وهو مو
  let busy = 0;                       // بعد الطرد/تغيير الترددات الراوتر يرفض أول كم POST بـ 125003 (لسا يعيد الاتصال)
  const salt = bytesToHex(utf8ToBytes('salt-salt-salt-1'));
  const log: string[] = [];
  const newSess = () => { const id = rnd(); sessions.set(id, { tok: [rnd()], logged: false }); return id; };
  const xml = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><response>${b}</response>`;
  const err = (c: string) => `<?xml version="1.0" encoding="UTF-8"?><error><code>${c}</code><message></message></error>`;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const p = u.pathname.replace(/^\/api\//, '');
    log.push(`${method} ${p}`);
    const hdrs = (init?.headers ?? {}) as Record<string, string>;
    const sentCookie = init?.credentials === 'omit' ? hdrs.Cookie ?? '' : jar;
    let sid = (sentCookie.match(/SessionID=([^;]+)/) ?? [])[1] ?? '';
    const out: Record<string, string> = {};
    const setSid = (id: string) => { out['set-cookie'] = `SessionID=${id}; path=/; HttpOnly`; if (init?.credentials !== 'omit') jar = `SessionID=${id}`; };
    const res = (body: string) => ({ ok: true, status: 200, url, headers: { get: (k: string) => out[k.toLowerCase()] ?? null }, text: async () => body } as any);
    if (!sessions.has(sid)) { sid = newSess(); setSid(sid); }
    const s = sessions.get(sid)!;
    if (u.pathname === '/html/home.html') { const id = newSess(); setSid(id); return res('<html></html>'); }
    // SesTokInfo يرجّع الجلسة الحالية (مو جديدة) — جلسة جديدة بس من الصفحة أو لو الكوكي مو معروف
    if (p === 'webserver/SesTokInfo') return res(xml(`<SesInfo>SessionID=${sid}</SesInfo><TokInfo>${s.tok[0]}</TokInfo>`));
    if (p === 'webserver/token') return res(xml(`<token>${'x'.repeat(32)}${s.tok[0]}</token>`));
    if (p === 'user/state-login') return res(xml(`<State>${ghost || s.logged ? '0' : '-1'}</State><password_type>4</password_type><username>admin</username>`));
    if (method === 'GET') {
      if (!s.logged) return res(err('100003'));
      if (p === 'net/lock-freq') return s.logged === 'full' ? res(xml('<NetworkMode>03</NetworkMode>')) : res(err('100003'));
      if (p === 'device/signal') return res(xml('<pci>134</pci><rsrp>-95dBm</rsrp><rsrq>-10dB</rsrq><sinr>12dB</sinr><band>3</band>'));
      if (p === 'monitoring/status') return res(xml('<CurrentNetworkTypeEx>101</CurrentNetworkTypeEx>'));
      return res(xml(''));
    }
    // POST: الرمز لازم يطابق جلسة هالكوكي
    const tok = hdrs.__RequestVerificationToken;
    if (busy > 0) { busy--; return res(err('125003')); }
    if (!s.tok.includes(tok)) return res(err('125003'));
    s.tok = [rnd(), rnd()];
    out['__requestverificationtokenone'] = s.tok[0];
    out['__requestverificationtokentwo'] = s.tok[1];
    const body = String(init?.body ?? '');
    const tg = (n: string) => (body.match(new RegExp(`<${n}>([^<]*)</${n}>`)) ?? [])[1] ?? '';
    if (p === 'user/challenge_login') {
      if (opts.noScram) return res(err('125003'));
      s.scram = { first: tg('firstnonce'), server: tg('firstnonce') + rnd() };
      return res(xml(`<salt>${salt}</salt><servernonce>${s.scram.server}</servernonce><iterations>100</iterations>`));
    }
    if (p === 'user/authentication_login') {
      const sc = s.scram;
      if (!sc) return res(err('125002'));
      const salted = pbkdf2(sha256, utf8ToBytes(PW), hexToBytes(salt), { c: 100, dkLen: 32 });
      const clientKey = hmac(sha256, utf8ToBytes('Client Key'), salted);
      const storedKey = sha256(clientKey);
      const sig = hmac(sha256, utf8ToBytes(`${sc.first},${sc.server},${sc.server}`), storedKey);
      const proof = hexToBytes(tg('clientproof'));
      const ck = proof.map((b: number, i: number) => b ^ sig[i]);
      if (bytesToHex(sha256(ck)) !== bytesToHex(storedKey)) return res(err('108006'));
      s.logged = 'full'; ghost = false;
      return res(xml('OK'));
    }
    if (p === 'user/logout') { s.logged = false; return res(xml('OK')); }
    if (p === 'user/login') { s.logged = 'limited'; ghost = false; return res(xml('OK')); }
    return res(xml('OK'));
  };
  return {
    log,
    /** طرد: كل الجلسات تنتهي، بس state-login يقول «داخل» (شبح) */
    kick() { for (const v of sessions.values()) v.logged = false; ghost = true; },
    /** طرد وهو لسا يعيد الاتصال: أول n طلبات POST ترجع 125003 (المحاولة الأولى للدخول ورجعتها الداخلية) */
    rotate(n = 3) { for (const v of sessions.values()) v.logged = false; busy = n; },
  };
}

async function driver() {
  const { HuaweiDriver } = require('../src/drivers/huawei/index');
  return new HuaweiDriver();
}
/** نفس اللي يسويه withSession بعد الطرد: markStale ← login ← نكمّل */
async function relogin(d: any) {
  d.markStale?.();
  await d.login('192.168.8.1', 'admin', PW);
}

for (const os of ['ios', 'android']) {
  test(`هواوي (${os}): بعد الطرد state-login يكذب «داخل» ← دخول حقيقي والقراءة ترجع (كان: 100003 → sig:100003…)`, async () => {
    OS = os;
    const r = router();
    const d = await driver();
    await d.login('192.168.8.1', 'admin', PW);
    assert.equal((await d.getSignal()).pci, '134');
    r.kick();
    // أول رد فشل جا من طلب مو أساسي (الشاشة) ← الدرايفر ما علّم الجلسة خربانة بنفسه
    await assert.rejects((d as any).get('net/lock-freq'), /100003/);
    await relogin(d);
    assert.equal((await d.getSignal()).pci, '134', 'القراءة رجعت بعد إعادة الدخول');
    await (d as any).get('net/lock-freq');
  });

  test(`هواوي (${os}): الراوتر غيّر الجلسة ← SCRAM 125003 ← صفحة جديدة ونكمّل SCRAM (بدون الدخول القديم)`, async () => {
    OS = os;
    const r = router();
    const d = await driver();
    await d.login('192.168.8.1', 'admin', PW);
    r.rotate();
    await assert.rejects(d.getSignal(), /100003/);
    const before = r.log.length;
    await relogin(d);
    assert.equal((await d.getSignal()).pci, '134');
    await (d as any).get('net/lock-freq');   // جلسة كاملة (مو الدخول القديم الناقص)
    const after = r.log.slice(before);
    assert.ok(!after.includes('POST user/login'), 'ما نرجع للدخول القديم (جلسة ناقصة الصلاحيات): ' + after.join(', '));
    assert.equal((d as any).scram, true, 'SCRAM باقي شغّال');
  });
}

test('هواوي: كلمة غلط بعد الطرد ← نوقف على طول (ما نزيد محاولات ونقفل الراوتر)', async () => {
  OS = 'ios';
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', PW);
  r.kick();
  d.markStale?.();
  const before = r.log.length;
  await assert.rejects(d.login('192.168.8.1', 'admin', 'wrong-pass'), /108006|كلمة المرور/);
  const auths = r.log.slice(before).filter(x => x === 'POST user/authentication_login');
  assert.equal(auths.length, 1, 'محاولة وحدة بس');
});

test('هواوي: راوتر يرد على SCRAM بـ 125003 دايماً ← الدخول القديم ينجح (ما كسرنا الأجهزة القديمة) وSCRAM ما ينطفي للأبد', async () => {
  OS = 'android';
  const r = router({ noScram: true });
  const d = await driver();
  await d.login('192.168.8.1', 'admin', PW);
  assert.equal((await d.getSignal()).pci, '134');
  assert.ok(r.log.includes('POST user/login'), 'دخل بالطريقة القديمة');
  assert.ok((d as any).scram !== false, 'الدخول الجاي يجرّب SCRAM أول');
});
