/**
 * (نسخة من بيئة zteMc801a) استهلاك كل جهاز — ZTE goform userflowInfo.
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

function router(extra: Record<string, string> = {}) {
  let rd = 'R' + Math.random().toString(36).slice(2);
  const st: Record<string, string> = { wa_inner_version: WA, cr_version: '', web_version: WEB, loginfo: 'ok', LD: 'LD1', net_select: 'LTE_AND_5G', ppp_status: 'ppp_connected', ...extra };
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
      if (id === 'USER_FLOW_STATISTIC_SET') st.userflowEnable = p.get('user_flow_enable') ?? '';
      return res(200, '{"result":"success"}');
    }
    const keys = (u.searchParams.get('cmd') ?? '').split(',');
    const o: Record<string, unknown> = {};
    for (const k of keys) o[k] = k === 'RD' ? rd : k === 'station_list' && st[k] ? JSON.parse(st[k]) : st[k] ?? '';
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


test('استهلاك الأجهزة: userflowInfo "MAC,تنزيل,رفع,مجموع" مرتّب من الأكثر · الاسم من station_list', async () => {
  router({ userflowEnable: '1', userflowCount: '3',
    userflowInfo_0: 'aa:bb:cc:00:00:01,100,20,120', userflowInfo_1: 'AA:BB:CC:00:00:02,5000,900,5900', userflowInfo_2: 'bad,1,1,2',
    station_list: JSON.stringify([{ mac_addr: 'AA:BB:CC:00:00:02', hostname: 'PS5', ip_addr: '192.168.0.50' }]) });
  const d = await driver();
  const r = await d.getDeviceUsage();
  assert.equal(r.enabled, true);
  assert.equal(r.list.length, 2);
  assert.deepEqual(r.list[0], { mac: 'AA:BB:CC:00:00:02', name: 'PS5', ip: '192.168.0.50', down: 5000, up: 900, total: 5900 });
  assert.equal(r.list[1].total, 120);
});

test('راوتر بدون عدّاد (الحقول فاضية) ← null · العدّاد مطفي ← نشغّله بـ USER_FLOW_STATISTIC_SET ونتأكد', async () => {
  router();
  let d = await driver();
  assert.equal(await d.getDeviceUsage(), null);
  const r = router({ userflowEnable: '0', userflowCount: '0' });
  d = await driver();
  const rep = await d.getDeviceUsage();
  assert.equal(rep.enabled, false);
  await d.enableDeviceUsage();
  assert.equal(r.st.userflowEnable, '1');
  assert.ok(r.log.some(x => x.id === 'USER_FLOW_STATISTIC_SET' && x.ok));
});
