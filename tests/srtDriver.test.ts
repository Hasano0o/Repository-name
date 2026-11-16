/**
 * زين SRT858M — التشفير والدخول مطابقين لكود الراوتر نفسه (encryption.js و md5.js من ملفات «مو مدعوم؟» ينشغلون هنا في vm).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { __esModule: true, default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('../src/drivers/srt/parse');

/** كود الراوتر الأصلي — Date مثبّت عشان نقارن */
function routerJs(nowMs: number) {
  const RealDate: any = Date;
  const ctx: any = { Date: class extends RealDate { constructor(...a: any[]) { super(...(a.length ? a : [nowMs]) as []); } } };
  vm.createContext(ctx);
  for (const f of ['encryption.js', 'md5.js']) vm.runInContext(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/srt858m', f), 'utf8'), ctx);
  return ctx;
}

test('SRT858M: hex_hmac_md5 مطابق لـ md5.js', () => {
  const r = routerJs(Date.now());
  for (const v of ['admin', 'admin@5GCPE', 'P@ss w0rd!']) assert.equal(P.hmacMd5Hex('0123456789', v), r.hex_hmac_md5('0123456789', v));
  const b = JSON.parse(P.srtLoginBody('admin', 'admin@5GCPE'));
  assert.equal(b.username, r.hex_hmac_md5('0123456789', 'admin'));
  assert.equal(b.password, r.hex_hmac_md5('0123456789', 'admin@5GCPE'));
});

test('SRT858M: password_encode / password_decode مطابقين لـ encryption.js (أسرار كبيرة وصغيرة)', () => {
  const nowSec = 1794870000;
  const r = routerJs(nowSec * 1000);
  for (const [secret, ts] of [['a3f91c07', '6738f2a1'], ['ffffffff', '1'], ['12', 'abc'], ['9e3779b97f4a7c15', '6738f2a1']]) {
    const k = { secret, ts, start: nowSec - 7 };
    for (const data of ['{"keys":["mnet_sig_level"]}', '{"username":"x","password":"y"}', 'عربي ✓']) {
      const mine = P.mgEncode(data, k, nowSec);
      const theirs = r.password_encode(data, secret, ts, nowSec - 7);
      assert.equal(mine, theirs, `${secret} ${data}`);
      assert.equal(P.mgDecode(mine, secret), r.password_decode(mine, secret));
      assert.ok(P.mgDecode(mine, secret).endsWith(':' + data));
    }
  }
});

test('SRT858M: التعرّف · config.xml · المفتاح · الشبكة', () => {
  const idx = '<script src="../js/encryption.js?r=1"></script><script src="../js/languagemanage.js?r=1"></script><script>loadNewPage("../html/settings.html#status");</script>';
  assert.ok(P.isSrtPage(idx));
  assert.equal(P.isSrtPage('<html>api/webserver/SesTokInfo</html>'), false);
  assert.equal(P.srtEncryptOn('<config><encrypt>1</encrypt></config>'), true);
  assert.equal(P.srtEncryptOn('<config><encrypt>0</encrypt></config>'), false);
  assert.equal(P.srtEncryptOn('<config></config>'), false);
  assert.deepEqual(P.parseMgKey('a3f91c07x6738f2a1', 5), { secret: 'a3f91c07', ts: '6738f2a1', start: 5 });
  assert.equal(P.parseMgKey(null, 5), null);
  assert.equal(P.srtNetwork('nsa'), '5G NSA');
  assert.equal(P.srtNetwork('lte'), '4G');
  assert.equal(P.srtNetwork('no service'), undefined);
});

/** راوتر محاكى (بتشفير) — يفك الطلبات بكود الراوتر نفسه */
function srt(opts: { pw: string; enc: boolean }) {
  const log: string[] = [];
  let logged = false, remain = 5;
  const secret = 'a3f91c07', ts = '6738f2a1';
  const r = routerJs(Date.now());
  const hdr = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    log.push(`${init?.method ?? 'GET'} ${u.pathname}`);
    const res = (text: string, h: Record<string, string> = {}) => ({ ok: true, status: 200, url, headers: hdr(h), text: async () => text } as any);
    const key = { 'x-mg-private': `${secret}x${ts}` };
    const reply = (o: any) => res(opts.enc ? r.password_encode(JSON.stringify(o), secret, ts, Math.floor(Date.now() / 1000)) : JSON.stringify(o), key);
    const body = () => { const b = String(init?.body ?? ''); if (!opts.enc) return JSON.parse(b || '{}'); const d = r.password_decode(b, secret); return JSON.parse(d.slice(d.indexOf(':') + 1)); };
    if (u.pathname === '/') return res('<script src="../js/encryption.js"></script><script src="../js/languagemanage.js"></script>settings.html#status');
    if (u.pathname === '/config/global/config.xml') return res(`<config><encrypt>${opts.enc ? 1 : 0}</encrypt></config>`);
    if (u.pathname === '/goform/sync') return res('', key);
    if (u.pathname === '/goform/login') {
      const b = body();
      if (b.username === r.hex_hmac_md5('0123456789', 'admin') && b.password === r.hex_hmac_md5('0123456789', opts.pw)) { logged = true; return reply({ retcode: 0 }); }
      remain--;
      return reply({ retcode: 1, remain_times: remain });
    }
    if (u.pathname === '/goform/get_login_info') return reply({ retcode: 0, loginStatus: logged ? 1 : 0 });
    if (u.pathname === '/action/get_mgdb_params') {
      if (!logged) return res('<html>login</html>');
      const b = body();
      assert.ok(Array.isArray(b.keys));
      return reply({ retcode: 0, data: { mnet_sig_level: 4, mnet_sysmode: 'nsa', mnet_operator_name: 'Zain KSA', dialup_dial_status: 'connected', mnet_sim_status: 'ready' } });
    }
    return res('', {});
  };
  return { log };
}
const { SrtDriver } = require('../src/drivers/srt/index');

for (const enc of [true, false]) {
  test(`SRT858M (${enc ? 'مشفّر' : 'JSON'}): دخول صحيح ← الشركة والشبكة`, async () => {
    srt({ pw: 'admin@5GCPE', enc });
    const d = new SrtDriver();
    assert.ok(await d.detect('192.168.1.1'));
    await d.login('192.168.1.1', 'admin', 'admin@5GCPE', { fresh: true });
    assert.equal((await d.getSignal()).network, '5G NSA');
    const n = await d.getNetworkInfo();
    assert.equal(n.operator, 'Zain KSA'); assert.equal(n.connected, true);
  });
}

test('SRT858M: كلمة غلط ← «رفض» + باقي المحاولات · الخلفية ما تعيد', async () => {
  const r = srt({ pw: 'admin@5GCPE', enc: true });
  const d = new SrtDriver();
  await assert.rejects(d.login('192.168.1.1', 'admin', 'wrong', { fresh: true }), /رفض اسم المستخدم أو الكلمة \(باقي 4/);
  await assert.rejects(d.login('192.168.1.1', 'admin', 'wrong'), /رفضها الراوتر قبل/);
  assert.equal(r.log.filter(x => x === 'POST /goform/login').length, 1);
});

test('SRT858M: صفحات FULL ما فيها شي خطر', () => {
  const pages: string[] = new SrtDriver().afterLoginPages();
  assert.ok(pages.includes('/html/rfparamters.html') && pages.includes('/js/bandlock.js'));
  assert.ok(!pages.some(p => /reboot|reset|upgrade|logout|backup/i.test(p)));
});
