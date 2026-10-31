/**
 * ZTE MC801A العادي (فيرموير Elisa — ملف FULL من عضو، ٣١ أكتوبر، stc):
 *   wa_inner_version = MC801A1_Elisa1_B06 · cr_version فاضي · web_version = WEB_FIELSMC801A1V1.0.0B05 · /ubus/ = 404
 *   service.js: AD = hex_md5(hex_md5(rd0 + rd1) + RD) ← rd0/rd1 = wa_inner_version / cr_version (= صيغة 'wa+cr' عندنا)
 *   أخطاء ٣ أيام: «آي بي جديد» بس ← DISCONNECT_NETWORK = failure. الصفحة ما تعرض قطع/وصل إلا ببعض أوضاع WAN.
 * قبل: الرفض يدوّر ٨ صيغ على قطع الاتصال ثم يعلّم الراوتر «يرفض كل أوامر التغيير» — والأوامر الثانية تطلع بنفس الرسالة.
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
    return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 500 ? 1 : ms);

const md5 = (s: string) => require('crypto').createHash('md5').update(s).digest('hex');
const WA = 'MC801A1_Elisa1_B06', WEB = 'WEB_FIELSMC801A1V1.0.0B05';

function router() {
  let rd = 'R' + Math.random().toString(36).slice(2);
  const st: Record<string, string> = { wa_inner_version: WA, cr_version: '', web_version: WEB, loginfo: 'ok', LD: 'LD1', net_select: 'LTE_AND_5G', ppp_status: 'ppp_connected' };
  const log: { id: string; ok: boolean }[] = [];
  const res = (status: number, text: string) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => text } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/ubus')) return res(404, 'Site or Page Not Found');
    if (u.pathname.endsWith('goform_set_cmd_process')) {
      const p = new URLSearchParams(String(init?.body ?? ''));
      const id = p.get('goformId') ?? '?';
      if (id === 'LOGIN') return res(200, '{"result":"0"}');
      const ok = p.get('AD') === md5(md5(WA + '') + rd);   // نفس service.js
      rd = 'R' + Math.random().toString(36).slice(2);
      log.push({ id, ok });
      if (!ok || id === 'DISCONNECT_NETWORK') return res(200, '{"result":"failure"}');
      if (id === 'SET_BEARER_PREFERENCE') st.net_select = p.get('BearerPreference') ?? st.net_select;
      return res(200, '{"result":"success"}');
    }
    const keys = (u.searchParams.get('cmd') ?? '').split(',');
    const o: Record<string, string> = {};
    for (const k of keys) o[k] = k === 'RD' ? rd : st[k] ?? '';
    return res(200, JSON.stringify(o));
  };
  return { st, log };
}

async function driver() {
  const { ZteDriver } = require('../src/drivers/zte/index');
  const d = new ZteDriver();
  (d as any).host = '192.168.7.1';
  (d as any).password = 'x';
  (d as any).loggedIn = true;
  (d as any).ensure = async () => {};
  return d;
}

test('MC801A العادي (Elisa): يتعرف كـ mc801a goform', async () => {
  router();
  const d = await driver();
  const m = await d.identify();
  assert.equal(m.id, 'mc801a');
  assert.equal(m.write, 'goform');
});

test('MC801A العادي: الراوتر يرفض قطع الاتصال ← noChange (ما انقطع شي) بمحاولة وحدة، بدون دورة الصيغ', async () => {
  const r = router();
  const d = await driver();
  let err: any;
  try { await d.reconnectData({ holdSecs: 1 }); } catch (e) { err = e; }
  assert.ok(err, 'لازم يرجع خطأ');
  assert.equal(err.noChange, true, 'ما تغيّر شي');
  assert.equal(err.quickUnsupported, true, '«آي بي جديد» يروح لإعادة التشغيل');
  assert.ok(!/يرفض كل أوامر/.test(err.message), err.message);
  const disc = r.log.filter(x => x.id === 'DISCONNECT_NETWORK');
  assert.ok(disc.length <= 2, `محاولة (وإعادة بعد الدخول) بس — مو ٨ صيغ: ${disc.length}`);
  assert.ok(disc.every(x => x.ok), 'التوقيع نفسه صحيح (wa+cr)');
});

test('MC801A العادي: بعد رفض قطع الاتصال، وضع الشبكة يشتغل عادي (قبل: «يرفض كل أوامر التغيير»)', async () => {
  const r = router();
  const d = await driver();
  await d.reconnectData({ holdSecs: 1 }).catch(() => {});
  await d.setNetworkMode('03');
  assert.equal(r.st.net_select, 'Only_LTE');
  assert.ok(r.log.some(x => x.id === 'SET_BEARER_PREFERENCE' && x.ok));
});
