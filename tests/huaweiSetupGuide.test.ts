/**
 * هواوي — راوتر على «إعدادات المصنع» (معالج الإعداد الأولي ما اكتمل):
 * تقارير session/add-login ١٢–١٣ نوفمبر (H155-382 / H155-383 / B535-933، آيفون + أندرويد + ويندوز): الدخول ينقبل
 * وبعدها كل قراءة محمية 100003 — كنا نبدّل طريقة الكوكي (← «رمز الجلسة غير صالح 125003») أو نقول «الراوتر يطلّع
 * التطبيق… AI Life». ملفات الصفحات: restore_default_status=1، والصفحة نفسها تحوّل لـ guide.
 * الحين: نقرأ device/basic_information ← رسالة «كمّل الإعداد من المتصفح» ونطلع من الراوتر. راوتر يشتغل ما يتغيّر عليه شي.
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

/**
 * rds: قيمة restore_default_status · guide: المعالج ما اكتمل ← الراوتر يمنع القراءات المحمية حتى بعد الدخول
 * (monitoring/status و device/information تبقى مفتوحة — مثل التقارير)
 */
function router(st: { rds: '0' | '1'; guide: boolean }) {
  type Sess = { tok: string[]; logged: boolean; scram?: { first: string; server: string } };
  const sessions = new Map<string, Sess>();
  let jar = '';
  const salt = bytesToHex(utf8ToBytes('salt-salt-salt-1'));
  const log: string[] = [];
  const newSess = () => { const id = rnd(); sessions.set(id, { tok: [rnd()], logged: false }); return id; };
  const xml = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><response>${b}</response>`;
  const err = (c: string) => `<?xml version="1.0" encoding="UTF-8"?><error><code>${c}</code><message></message></error>`;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const p = u.pathname.replace(/^\/api\//, '');
    const hdrs = (init?.headers ?? {}) as Record<string, string>;
    const sentCookie = init?.credentials === 'omit' ? hdrs.Cookie ?? '' : jar;
    let sid = (sentCookie.match(/SessionID=([^;]+)/) ?? [])[1] ?? '';
    const out: Record<string, string> = {};
    const setSid = (id: string) => { out['set-cookie'] = `SessionID=${id}; path=/; HttpOnly`; if (init?.credentials !== 'omit') jar = `SessionID=${id}`; };
    const res = (body: string) => { log.push(`${method} ${p} → ${(body.match(/<code>(\d+)/) ?? [])[1] ?? 'ok'}`); return { ok: true, status: 200, url, headers: { get: (k: string) => out[k.toLowerCase()] ?? null }, text: async () => body } as any; };
    if (!sessions.has(sid)) { sid = newSess(); setSid(sid); }
    const s = sessions.get(sid)!;
    if (u.pathname === '/html/home.html') { const id = newSess(); setSid(id); return res('<html></html>'); }
    if (p === 'webserver/SesTokInfo') return res(xml(`<SesInfo>SessionID=${sid}</SesInfo><TokInfo>${s.tok[0]}</TokInfo>`));
    if (p === 'webserver/token') return res(xml(`<token>${'x'.repeat(32)}${s.tok[0]}</token>`));
    if (p === 'user/state-login') return res(xml(`<State>${s.logged ? '0' : '-1'}</State><password_type>4</password_type><firstlogin>0</firstlogin>`));
    // بدون دخول — نفس رد الراوتر في ملفات add-error
    if (p === 'device/basic_information') return res(xml(`<classify>cpe</classify><multimode>0</multimode><restore_default_status>${st.rds}</restore_default_status><devicename>H155-383</devicename>`));
    if (method === 'GET') {
      if (p === 'monitoring/status') return res(xml('<CurrentNetworkTypeEx>101</CurrentNetworkTypeEx>'));
      if (p === 'device/information') return s.logged ? res(xml('<DeviceName>H155-383</DeviceName>')) : res(err('100003'));
      if (!s.logged || st.guide) return res(err('100003'));
      if (p === 'device/signal') return res(xml('<pci>134</pci><rsrp>-95dBm</rsrp><rsrq>-10dB</rsrq><sinr>12dB</sinr><band>3</band>'));
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
      s.scram = { first: tg('firstnonce'), server: tg('firstnonce') + rnd() };
      return res(xml(`<salt>${salt}</salt><iterations>100</iterations><servernonce>${s.scram.server}</servernonce><modeselected>1</modeselected>`));
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
      const id = newSess();
      sessions.get(id)!.logged = true;
      sessions.get(id)!.tok = s.tok;
      setSid(id);
      return res(xml('OK'));
    }
    if (p === 'user/logout') { s.logged = false; return res(xml('OK')); }
    return res(xml('OK'));
  };
  return {
    log, st,
    count: (x: string) => log.filter(l => l.startsWith(x)).length,
    kick() { for (const v of sessions.values()) v.logged = false; },
    anyLogged: () => [...sessions.values()].some(v => v.logged),
  };
}

async function driver() {
  const { HuaweiDriver, _resetHuaweiGate } = require('../src/drivers/huawei/index');
  _resetHuaweiGate();
  return new HuaweiDriver();
}
const SETUP = /إعدادات المصنع/;

for (const os of ['ios', 'android']) {
  test(`هواوي (${os}): إعدادات المصنع ← إضافة الراوتر توقف برسالة «كمّل الإعداد» (كان 125003 / «يطلّع التطبيق»)`, async () => {
    OS = os;
    const r = router({ rds: '1', guide: true });
    const d = await driver();
    await assert.rejects(d.login('192.168.8.1', 'admin', PW, { fresh: true }), (e: any) => {
      assert.match(e.message, SETUP, e.message + '\n' + r.log.join('\n'));
      assert.match(e.message, /192\.168\.8\.1/);
      // ما تنحسب «كلمة غلط» ولا «طرد» في الشاشات وطبقة الجلسات
      assert.ok(!/كلمة المرور|غلط|100003|125003|ما عندك صلاحية|رمز الجلسة/.test(e.message), e.message);
      return true;
    });
    assert.equal(r.count('POST user/authentication_login'), 1, 'دخول واحد — ما نبدّل طريقة الكوكي ولا نعيد: ' + r.log.join(', '));
    assert.equal(r.count('POST user/challenge_login'), 1);
    assert.equal(r.anyLogged(), false, 'طلعنا من الراوتر — العضو يقدر يدخل من المتصفح (هواوي مدير واحد)');
  });

  test(`هواوي (${os}): راوتر محفوظ رجع لإعدادات المصنع ← القراءة تقول «كمّل الإعداد» بدل الطرد`, async () => {
    OS = os;
    const r = router({ rds: '0', guide: false });
    const d = await driver();
    await d.login('192.168.8.1', 'admin', PW);
    assert.equal((await d.getSignal()).pci, '134');
    // ضبط مصنع: الجلسات تروح والمعالج يرجع
    r.kick(); r.st.rds = '1'; r.st.guide = true;
    await assert.rejects(d.getSignal(), /100003/, 'أول رفض = جلسة راحت (عادي)');
    d.markStale?.();
    // دخول الخلفية (مو fresh): آيفون يتأكد بقراءته، وأندرويد تطلع من أول قراءة محمية
    let msg = '';
    try { await d.login('192.168.8.1', 'admin', PW); await d.getSignal(); } catch (e: any) { msg = e.message; }
    assert.match(msg, SETUP, msg + '\n' + r.log.join('\n'));
  });

  test(`هواوي (${os}): بعد ما يكمّل العضو الإعداد ← يدخل ويقرأ عادي`, async () => {
    OS = os;
    const r = router({ rds: '1', guide: true });
    const d = await driver();
    await assert.rejects(d.login('192.168.8.1', 'admin', PW, { fresh: true }), SETUP);
    r.st.rds = '0'; r.st.guide = false;
    await d.login('192.168.8.1', 'admin', PW, { fresh: true });
    assert.equal((await d.getSignal()).pci, '134');
  });

  test(`هواوي (${os}): راوتر يشتغل وعلمه restore_default_status=1 ← ما يتغيّر عليه شي، والطرد الحقيقي يبقى طرد`, async () => {
    OS = os;
    const r = router({ rds: '1', guide: false });
    const d = await driver();
    await d.login('192.168.8.1', 'admin', PW, { fresh: true });
    assert.equal((await d.getSignal()).pci, '134');
    assert.equal(r.count('GET device/basic_information'), 0, 'ما نقرأ الحالة على راوتر قراءاته شغالة');
    r.kick();
    await assert.rejects(d.getSignal(), (e: any) => { assert.match(e.message, /100003/); assert.ok(!SETUP.test(e.message), e.message); return true; });
    d.markStale?.();
    await d.login('192.168.8.1', 'admin', PW);
    assert.equal((await d.getSignal()).pci, '134', 'إعادة الدخول بعد الطرد شغالة مثل قبل');
  });
}

test('هواوي: راوتر مو على إعدادات المصنع والقراءة ترد 100003 ← نفس السلوك القديم (ما نقول «كمّل الإعداد»)', async () => {
  OS = 'android';
  const r = router({ rds: '0', guide: true });   // يمنع القراءة لسبب ثاني
  const d = await driver();
  await d.login('192.168.8.1', 'admin', PW, { fresh: true });
  await assert.rejects(d.getSignal(), (e: any) => { assert.match(e.message, /100003/); assert.ok(!SETUP.test(e.message), e.message); return true; });
  assert.equal(r.count('GET device/basic_information'), 1, 'فحص واحد لكل دخول');
});
