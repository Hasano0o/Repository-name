/**
 * (الراوتر المحاكى منسوخ من huaweiUpdateCookie.test.ts + net/net-mode)
 * هواوي — ٦ نوفمبر (تقارير add-login + ملفات add-error من H155-383 / 5G CPE 5):
 *  ١. «رمز الجلسة غير صالح (125003)» من أول طلب (٦٤ مرة بالأندرويد ٣–٦ نوفمبر): صفحة الراوتر قبل الدخول تطلب
 *     monitoring/status مع «Update-Cookie: UpdateCookie» (الراوتر يجدد الكوكي)، وبعدها الرمز والتحدي. كنا ما نطلبها.
 *  ٢. «كلمة غلط (108006)» والتحدي سليم: accounts_number=2 ← الراوتر فيه حسابين واسم المستخدم مو دايماً admin
 *     ← رسالة تقول كذا بدل «الكلمة غلط» بس.
 * راوتر محاكى: الجلسة ما تقبل رموز لين تتجدد بـ Update-Cookie — نفس اللي بالتقارير (كل الرموز 125003).
 */
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
const rnd = () => Math.random().toString(36).slice(2, 12);

/**
 * needUpdate: الجلسة ما تقبل أي رمز (125003) لين يجي GET monitoring/status مع Update-Cookie (يفتح جلسة جديدة مقبولة)
 * user: اسم الحساب الصحيح · accounts: accounts_number في state-login
 */
const NM: Record<string, string> = {};
/** fullIgnoresOpt: الجسم الكامل يغيّر كل شي إلا networkOption/LTEBandOption (مثل التقارير) */
let fullIgnoresOpt = true;
function router(opts: { needUpdate?: boolean; user?: string; accounts?: string } = {}) {
  type Sess = { tok: string[]; ok: boolean; logged: boolean; scram?: { first: string; server: string; user: string } };
  const sessions = new Map<string, Sess>();
  let jar = '';
  const salt = bytesToHex(utf8ToBytes('salt-salt-salt-1'));
  const log: string[] = [];
  const user = opts.user ?? 'admin';
  const newSess = (ok: boolean) => { const id = rnd(); sessions.set(id, { tok: [rnd()], ok, logged: false }); return id; };
  const xml = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><response>${b}</response>`;
  const err = (c: string) => `<?xml version="1.0" encoding="UTF-8"?><error><code>${c}</code><message></message></error>`;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const p = u.pathname.replace(/^\/api\//, '');
    const hdrs = (init?.headers ?? {}) as Record<string, string>;
    log.push(`${method} ${p}${hdrs['Update-Cookie'] ? ' [Update-Cookie]' : ''}`);
    const sentCookie = init?.credentials === 'omit' ? hdrs.Cookie ?? '' : jar;
    let sid = (sentCookie.match(/SessionID=([^;]+)/) ?? [])[1] ?? '';
    const out: Record<string, string> = {};
    const setSid = (id: string) => { out['set-cookie'] = `SessionID=${id}; path=/; HttpOnly`; if (init?.credentials !== 'omit') jar = `SessionID=${id}`; };
    const res = (body: string) => ({ ok: true, status: 200, url, headers: { get: (k: string) => out[k.toLowerCase()] ?? null }, text: async () => body } as any);
    if (!sessions.has(sid)) { sid = newSess(!opts.needUpdate); setSid(sid); }
    const s = sessions.get(sid)!;
    if (u.pathname === '/html/home.html') { setSid(newSess(!opts.needUpdate)); return res('<html></html>'); }
    if (p === 'webserver/SesTokInfo') return res(xml(`<SesInfo>SessionID=${sid}</SesInfo><TokInfo>${s.tok[0]}</TokInfo>`));
    if (p === 'webserver/token') return res(xml(`<token>${'x'.repeat(32)}${s.tok[0]}</token>`));
    if (p === 'user/state-login') return res(xml(`<State>${s.logged ? '0' : '-1'}</State><password_type>4</password_type><accounts_number>${opts.accounts ?? '1'}</accounts_number><lockstatus>0</lockstatus><remainwaittime>0</remainwaittime>`));
    if (method === 'GET') {
      if (p === 'monitoring/status' && hdrs['Update-Cookie'] === 'UpdateCookie') {
        // الراوتر يجدد الكوكي: جلسة جديدة مقبولة (set-cookie)
        setSid(newSess(true));
        return res(xml('<CurrentNetworkTypeEx>101</CurrentNetworkTypeEx>'));
      }
      if (!s.logged) return res(err('100003'));
      if (p === 'device/signal') return res(xml('<pci>134</pci><rsrp>-95dBm</rsrp><rsrq>-10dB</rsrq><sinr>12dB</sinr><band>3</band>'));
      if (p === 'monitoring/status') return res(xml('<CurrentNetworkTypeEx>101</CurrentNetworkTypeEx>'));
      if (p === 'net/net-mode') return res(xml(Object.entries(NM).map(([k, v]) => `<${k}>${v}</${k}>`).join('')));
      if (p === 'net/lock-freq') return res(err('100002'));
      return res(xml(''));
    }
    const tok = hdrs.__RequestVerificationToken;
    if (!s.ok || !s.tok.includes(tok)) return res(err('125003'));
    s.tok = [rnd(), rnd()];
    out['__requestverificationtokenone'] = s.tok[0];
    out['__requestverificationtokentwo'] = s.tok[1];
    const body = String(init?.body ?? '');
    const tg = (n: string) => (body.match(new RegExp(`<${n}>([^<]*)</${n}>`)) ?? [])[1] ?? '';
    if (p === 'user/challenge_login') {
      // هواوي يرد على التحدي حتى لو الاسم غلط (ما يكشف الحسابات)
      s.scram = { first: tg('firstnonce'), server: tg('firstnonce') + rnd(), user: tg('username') };
      return res(xml(`<salt>${salt}</salt><iterations>100</iterations><servernonce>${s.scram.server}</servernonce><newType>0</newType><modeselected>1</modeselected>`));
    }
    if (p === 'user/authentication_login') {
      const sc = s.scram;
      if (!sc) return res(err('125002'));
      if (tg('finalnonce') !== sc.server) return res(err('108006'));
      const salted = pbkdf2(sha256, utf8ToBytes(PW), hexToBytes(salt), { c: 100, dkLen: 32 });
      const clientKey = hmac(sha256, utf8ToBytes('Client Key'), salted);
      const storedKey = sha256(clientKey);
      const sig = hmac(sha256, utf8ToBytes(`${sc.first},${sc.server},${sc.server}`), storedKey);
      const ck = hexToBytes(tg('clientproof')).map((b: number, i: number) => b ^ sig[i]);
      if (sc.user !== user || bytesToHex(sha256(ck)) !== bytesToHex(storedKey)) return res(err('108006'));
      s.logged = true;
      return res(xml('OK'));
    }
    if (p === 'user/login') return res(err('108006'));
    if (p === 'net/net-mode') {
      const f = [...body.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
      const two = f.length === 2;
      for (const [k, v] of f) if (two || !fullIgnoresOpt || !/Option$/.test(k)) NM[k] = v;
      return res(xml('OK'));
    }
    return res(xml('OK'));
  };
  return { log };
}

async function driver() {
  const { HuaweiDriver, _resetHuaweiGate } = require('../src/drivers/huawei/index');
  _resetHuaweiGate();
  return new HuaweiDriver();
}


const FULL0: [string, string][] = [['NetworkMode', '00'], ['NetworkBand', '3FFFFFFF'], ['LTEBand', '7FFFFFFFFFFFFFFF'], ['networkOption', '0'], ['LTEBandOption', '0']];

async function setup() {
  OS = 'ios';
  router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', PW, { fresh: true });
  return d;
}

test('هواوي: إرجاع «نوع 5G» بعد تجربة SA — الجسم الكامل يتجاهله ← طلب الحقلين (كان: mismatch نوع 5G)', async () => {
  const d = await setup();
  Object.assign(NM, Object.fromEntries(FULL0), { networkOption: '1' });   // التجربة حطته SA
  await d.restoreLockState({ driver: d.id, at: 1, summary: '', data: { netMode: FULL0, lockFreq: null } });
  assert.equal(NM.networkOption, '0');
});

test('هواوي: إرجاع «4G FDD/TDD» (LTEBandOption) على وضع 4G فقط', async () => {
  const d = await setup();
  const snap: [string, string][] = FULL0.map(([k, v]) => [k, k === 'NetworkMode' ? '03' : v]);
  Object.assign(NM, Object.fromEntries(snap), { LTEBandOption: '2' });
  await d.restoreLockState({ driver: d.id, at: 1, summary: '', data: { netMode: snap, lockFreq: null } });
  assert.equal(NM.LTEBandOption, '0');
});

test('هواوي: كل شي مطابق ← ما نرسل طلب الحقلين', async () => {
  const d = await setup();
  Object.assign(NM, Object.fromEntries(FULL0));
  await d.restoreLockState({ driver: d.id, at: 1, summary: '', data: { netMode: FULL0, lockFreq: null } });
  assert.equal(NM.networkOption, '0');
});
