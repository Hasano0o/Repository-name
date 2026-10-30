/**
 * ZTE MC801A Pro (فيرموير G5) — نسخة من جهاز حسن (٣٠ أكتوبر، زين):
 *   wa_inner_version = BD_XCBZHKMC801A ProV1.0.0B03 · cr_version فاضي · web_version = WEB_XCBZHKG5BV1.0.0B03
 *   /ubus/ = 404 · الكتابة goform وتقبل AD = SHA256↑(SHA256↑(wa+cr)+RD) بس (أي صيغة ثانية ← failure)
 * قبل: فحص G5 كان قبل تجربة صيغ التوقيع ← كل تغيير يوقف برسالة «ZTE G5». الحين لازم ينجح.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
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

const { sha256 } = require('@noble/hashes/sha256');
const hex = (u: Uint8Array) => Array.from(u, (x: number) => x.toString(16).padStart(2, '0')).join('');
const SHA = (s: string) => hex(sha256(new TextEncoder().encode(s))).toUpperCase();

const WA = 'BD_XCBZHKMC801A ProV1.0.0B03';
const WEB = 'WEB_XCBZHKG5BV1.0.0B03';

function router() {
  let rd = 'R' + Math.random().toString(36).slice(2);
  const st: Record<string, string> = {
    wa_inner_version: WA, cr_version: '', web_version: WEB, loginfo: 'ok', LD: 'LD1',
    net_select: 'WL_AND_5G', lte_band_lock: '0x7a0880800dd', nr5g_band_lock: '1,3,7,8,20,28,38,40,41,75,77,78',
    nr5g_nsa_band_lock: '1,3,7,8,20,28,38,40,41,75,77,78', nr5g_sa_band_lock: '1,3,7,8,20,28,38,40,41,75,77,78',
    network_type: 'LTE-NSA', lte_ca_pcell_band: '3', lte_pci: '134', lte_rsrp: '-110',
  };
  const log: { id: string; ok: boolean; ad?: string }[] = [];
  const res = (status: number, text: string) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => text } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/ubus')) return res(404, 'Site or Page Not Found');
    if (u.pathname.endsWith('goform_set_cmd_process')) {
      const p = new URLSearchParams(String(init?.body ?? ''));
      const id = p.get('goformId') ?? '?';
      if (id === 'LOGIN') { log.push({ id, ok: true }); return res(200, '{"result":"0"}'); }
      const want = SHA(SHA(WA + '') + rd);
      const ok = p.get('AD') === want;
      log.push({ id, ok, ad: p.get('AD') ?? '' });
      rd = 'R' + Math.random().toString(36).slice(2);   // RD يتغيّر بعد كل أمر
      if (!ok) return res(200, '{"result":"failure"}');
      if (id === 'SET_BEARER_PREFERENCE') st.net_select = p.get('BearerPreference') ?? st.net_select;
      if (id === 'BAND_SELECT') st.lte_band_lock = p.get('lte_band_mask') ?? st.lte_band_lock;
      if (id === 'setWiFiChipAdvancedInfo') { st['ch' + p.get('ChipIndex')] = p.get('Channel') ?? ''; st['wm' + p.get('ChipIndex')] = p.get('WirelessMode') ?? ''; }
      return res(200, '{"result":"success"}');
    }
    const keys = (u.searchParams.get('cmd') ?? '').split(',');
    // الواي فاي بشريحتين (G5): نقاط الوصول بدون Band/Channel — القنوات في queryWiFiChipAdvancedInfo بس
    if (keys[0] === 'queryAccessPointInfo') return res(200, JSON.stringify({ ResponseList: [
      { ChipIndex: '0', AccessPointIndex: '0', AccessPointSwitchStatus: '1', SSID: 'ZTE_X' },
      { ChipIndex: '1', AccessPointIndex: '0', AccessPointSwitchStatus: '1', SSID: 'ZTE_X_5G' }] }));
    if (keys[0] === 'queryWiFiChipAdvancedInfo') return res(200, JSON.stringify({ ResponseList: [
      { ChipIndex: '0', CountryCode: 'SA', WirelessMode: '7', Channel: st.ch0 ?? '0', BandWidth: '2', Band: 'b' },
      { ChipIndex: '1', CountryCode: 'SA', WirelessMode: '8', Channel: st.ch1 ?? '44', BandWidth: '4', Band: 'a' }] }));
    const o: Record<string, string> = {};
    for (const k of keys) o[k] = k === 'RD' ? rd : st[k] ?? '';
    return res(200, JSON.stringify(keys.length === 1 && !u.searchParams.get('multi_data') ? o : o));
  };
  return { st, log };
}

async function driver() {
  const { ZteDriver } = require('../src/drivers/zte/index');
  const d = new ZteDriver();
  (d as any).host = '192.168.0.1';
  (d as any).password = 'x';
  (d as any).loggedIn = true;
  (d as any).ensure = async () => {};
  return d;
}

test('MC801A Pro (G5): يتعرف كـ goform مو ubus', async () => {
  router();
  const d = await driver();
  const m = await d.identify();
  assert.equal(m.id, 'mc801a-pro');
  assert.equal(m.write, 'goform');
});

test('MC801A Pro (G5): وضع الشبكة — يلقى توقيع sha:wa+cr ويتغيّر فعلاً (قبل: رسالة «ZTE G5»)', async () => {
  const r = router();
  const d = await driver();
  await d.setNetworkMode('03');   // 4G فقط
  assert.equal(r.st.net_select, 'Only_LTE', 'وضع الشبكة تغيّر في الراوتر');
  const okOne = r.log.find(x => x.id === 'SET_BEARER_PREFERENCE' && x.ok);
  assert.ok(okOne, 'أمر وضع الشبكة انقبل');
  // الأمر الجاي يستخدم الصيغة اللي انحفظت على طول (بدون دورة صيغ ثانية)
  const before = r.log.length;
  await d.setNetworkMode('0803');
  const next = r.log.slice(before).filter(x => x.id === 'SET_BEARER_PREFERENCE');
  assert.equal(next.length, 1, 'مرة وحدة بالصيغة المحفوظة');
  assert.ok(next[0].ok);
});

test('MC801A Pro (G5): ما يطلع رسالة G5 وما فيه ubus — ولو الراوتر رفض كل الصيغ نرجّع رده الحقيقي', async () => {
  const r = router();
  const d = await driver();
  // الراوتر يرفض كل شي (نكسر RD عشان ولا صيغة تطابق)
  (globalThis as any).fetch = ((orig: any) => async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.pathname.endsWith('goform_set_cmd_process') && !/goformId=LOGIN/.test(String(init?.body))) {
      r.log.push({ id: 'X', ok: false });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"result":"failure"}' } as any;
    }
    return orig(url, init);
  })((globalThis as any).fetch);
  let err: any;
  try { await d.setNetworkMode('03'); } catch (e) { err = e; }
  assert.ok(err);
  assert.ok(!/G5/.test(String(err.message)), 'ما فيه ubus ← ما نقول «G5»: ' + err.message);
});

test('MC801A Pro (G5): قناة الواي فاي — تنقرا من queryWiFiChipAdvancedInfo وتتغيّر بإعدادات الشريحة نفسها (قبل: «ما قدرنا نقرأ»)', async () => {
  const r = router();
  const d = await driver();
  const radios = await d.getWifiRadios();
  assert.deepEqual(radios.map((x: any) => [x.band, x.channel]), [['2.4', '0'], ['5', '44']]);
  await d.setWifiChannel('2.4', '6');
  assert.equal(r.st.ch0, '6', 'قناة الشريحة ٠ (2.4) تغيّرت');
  assert.equal(r.st.wm0, '7', 'نفس WirelessMode اللي في الراوتر');
  assert.equal(r.st.ch1 ?? '44', '44', 'شريحة الـ5 ما انلمست');
});
