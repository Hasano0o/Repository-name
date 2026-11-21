/**
 * ZTE goform — رد الدخول result "4" = داخل (service.js: `"0"!=e.result&&"4"!=e.result` ← فشل، غيره ← isLoggedIn).
 * VORTEX-3 M49 (MF295N، ملف عضو ٢١ نوفمبر): الدخول كان «يدور» — نحسب "4" فشل ونرش باقي الصيغ لين ينقفل.
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
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 500 ? 1 : ms);

const sha = (s: string) => require('crypto').createHash('sha256').update(s).digest('hex').toUpperCase();

/** جيب M49: WEB_ATTR_IF_SUPPORT_SHA256 = 2 ← sha256↑(sha256↑(كلمة) + LD)، والنجاح "4" */
function m49(pw: string, okResult: string) {
  const st: Record<string, string> = { wa_inner_version: 'V3.Mobile.R10', cr_version: '', web_version: '', loginfo: '', LD: 'ABCDEF0123', RD: 'r1', psw_fail_num_str: '5', login_lock_time: '300' };
  const logins: string[] = [];
  const res = (text: string) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => text } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/ubus')) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' } as any;
    if (u.pathname.endsWith('goform_set_cmd_process')) {
      const p = new URLSearchParams(String(init?.body ?? ''));
      if (p.get('goformId') !== 'LOGIN') return res('{"result":"success"}');
      logins.push(p.get('password') ?? '');
      if (p.get('password') === sha(sha(pw) + st.LD)) { st.loginfo = 'ok'; return res(`{"result":"${okResult}"}`); }
      st.psw_fail_num_str = String(Number(st.psw_fail_num_str) - 1);
      return res('{"result":"3"}');
    }
    const o: Record<string, string> = {};
    for (const k of (u.searchParams.get('cmd') ?? '').split(',')) o[k] = st[k] ?? '';
    return res(JSON.stringify(o));
  };
  return { logins };
}

for (const r of ['4', '0']) {
  test(`ZTE: الدخول بـ result "${r}" = نجاح من أول محاولة (ما نرش باقي الصيغ)`, async () => {
    const m = m49('admin', r);
    const { ZteDriver } = require('../src/drivers/zte/index');
    const d = new ZteDriver();
    await d.login('192.168.8.1', 'admin', 'admin', { fresh: true });
    assert.equal(m.logins.length, 1);
  });
}

test('ZTE: result "40" أو "14" مو نجاح (المطابقة على الرقم كامل)', async () => {
  const src = require('fs').readFileSync(require('path').join(process.cwd(), 'src/drivers/zte/index.ts'), 'utf8');
  const re = new RegExp(src.match(/\/"result"\\s\*:\\s\*"\?\[04\]"\?\\s\*\[,}\]\//)![0].slice(1, -1));
  assert.ok(re.test('{"result":"4"}') && re.test('{"result":0,"x":1}'));
  assert.ok(!re.test('{"result":"40"}') && !re.test('{"result":"14"}'));
});
