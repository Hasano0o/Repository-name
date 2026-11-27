/**
 * ZTE TopFlow MU5252 — مركز التحكم يطلع لهالموديل بس (MU5250/U60 Pro ما تتغيّر)، وكل تغيير يتأكد بالقراءة.
 * الأوامر من صفحة الجهاز (FULL ٩ نوفمبر): power_supply.js · system_setting.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'expo-crypto') return { getRandomBytes: (n: number) => Uint8Array.from(require('crypto').randomBytes(n)) };
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { __esModule: true, default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 100 ? 1 : ms);

const nc = require('node:crypto');
const sha = (s: string) => nc.createHash('sha256').update(s).digest('hex').toUpperCase();
const PW = 'Admin#5252';
const SALT = 'a1b2c3d4';

function router(model: string) {
  const good = new Set<string>();
  const log: string[] = [];
  const st = { power: '0', reboot: { reboot_schedule_enable: '0', reboot_schedule_mode: '2', reboot_hour2: '4', reboot_min2: '0', reboot_hour1: '3', reboot_min1: '0', reboot_dow: '1', reboot_dod: '1', reboot_timeframe_hours1: '0', reboot_timeframe_hours2: '0' } as Record<string, string>, wd: { enable: '0', url: 'www.google.com', url2: '', ping_times: '3', time_gap: '60' } as Record<string, string> };
  const res = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as any);
  (globalThis as any).fetch = async (_url: string, init?: any) => {
    const [{ params: [sess, obj, method, p] }] = JSON.parse(String(init.body));
    log.push(`${obj}.${method}`);
    const ok = (o: unknown) => res([{ jsonrpc: '2.0', id: 1, result: [0, o] }]);
    const denied = () => res([{ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Access denied' } }]);
    if (method === 'web_info') return ok({ model });
    if (method === 'web_login_info') return ok({ zte_web_sault: SALT });
    if (method === 'web_login') {
      const s = nc.randomBytes(16).toString('hex');
      if (p.password === sha(sha(PW) + SALT)) { good.add(s); return ok({ result: 0, ubus_rpc_session: s }); }
      return ok({ result: 1, ubus_rpc_session: s });
    }
    if (method === 'get_device_info') return ok({ bat_online: '1', bat_percent: '72', bat_charger_connect: '1', bat_charger_status: '1', bat_temperature: '36' });
    if (method === 'get_cpu_temp') return ok({ cpuss_temp: '48' });
    if (method === 'zwrt_deviceui_direct_power_mode_get') return ok({ enable: st.power });
    if (!good.has(sess)) return denied();
    if (method === 'get' && p.config === 'zwrt_zte_mc') return ok({ values: st.reboot });
    if (method === 'get' && p.config === 'zwrt_router') return ok({ values: st.wd });
    if (obj === 'zwrt_bsp.charger' && method === 'set') { st.power = p.direct_power_supply_mode === 'enable' ? '1' : '0'; return ok({ result: 'success' }); }
    if (method === 'set_device_info') { Object.assign(st.reboot, p.deviceInfoList); return ok({ result: 'success' }); }
    if (method === 'router_set_watchdog') { st.wd.enable = String(p.enable); if (p.enable) assert.equal(p.url, 'www.google.com'); return ok({ result: 'success' }); }
    return ok({});
  };
  return { log, st };
}

const { ZteNgDriver } = require('../src/drivers/zteng/index');

test('MU5250 (مو TopFlow) ← بدون مركز تحكم', async () => {
  router('MU5250');
  const d = new ZteNgDriver();
  await d.login('192.168.0.11', 'admin', PW);
  assert.equal(d.getExtras, undefined);
  assert.equal(d.setDirectPower, undefined);
});

test('TopFlow MU5252: مركز التحكم يقرأ ويغيّر ويتأكد', async () => {
  const r = router('ZTE TOPFLOW MU5252');
  const d = new ZteNgDriver();
  await d.login('192.168.0.12', 'admin', PW);
  assert.equal(typeof d.getExtras, 'function');
  const x = await d.getExtras();
  assert.deepEqual(x.health, { battery: 72, charging: true, tempC: 48 });
  assert.equal(x.directPower, false);
  assert.deepEqual(x.autoReboot, { on: false, everyDays: 1, from: 240, to: 240 });
  assert.deepEqual(x.netWatch, { on: false, url: 'www.google.com', times: 3, gapSec: 60 });

  await d.setDirectPower(true);
  assert.equal(r.st.power, '1');
  await d.setAutoReboot(true);
  assert.equal(r.st.reboot.reboot_schedule_enable, '1');
  assert.equal(r.st.reboot.reboot_hour2, '4');
  await d.setNetWatch(true);
  assert.equal(r.st.wd.enable, '1');
  await d.setNetWatch(false);
  assert.equal(r.st.wd.enable, '0');
});

test('TopFlow: إعادة تشغيل ما انضبط وقتها قبل ← ما نرسل شي', async () => {
  const r = router('MU5252');
  r.st.reboot = { reboot_schedule_enable: '0', reboot_schedule_mode: '' };
  const d = new ZteNgDriver();
  await d.login('192.168.0.13', 'admin', PW);
  await assert.rejects(d.setAutoReboot(true), /اضبط وقت إعادة التشغيل أول مرة/);
  assert.equal(r.log.filter(x => x.endsWith('set_device_info')).length, 0);
});
