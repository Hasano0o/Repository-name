/** راوتر جيب 4G بفيرموير ZTE القديم (UFI) على راوتر محاكى بنفس goform الصفحة */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

function router(opts: { password?: string; newZte?: boolean; ignoreWrites?: boolean } = {}) {
  const st: any = {
    logged: false, fail: 5, posts: [] as any[],
    db: {
      cr_version: 'MF971R_V1.0.0B05', wa_inner_version: opts.newZte ? 'BD_MU5001' : '', hw_version: 'V1',
      network_type: 'LTE', network_provider: 'Zain KSA', nv_rsrp: '-97', nv_rsrq: '-11', lte_sinr: '12', nv_pci: '301', nv_arfcn: '1650',
      lte_band: '3', nv_cellid: '1234567', nv_enodebid: '4822', rssi: '-70', ppp_status: 'ppp_connected', wan_ipaddr: '10.9.8.7',
      lockband1: '1', lockband3: '1', lockband5: '', lockband7: '', lockband8: '', lockband20: '', lockband28: '1', lockband38: '', lockband39: '', lockband40: '', lockband41: '1',
      ACL_mode: '0', wifi_mac_black_list: '', wifi_mac_white_list: '',
    } as Record<string, string>,
  };
  const res = (body: unknown) => ({ ok: true, status: 200, url: 'http://192.168.0.1/', headers: { get: () => null }, text: async () => JSON.stringify(body) } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.pathname === '/goform/goform_get_cmd_process') {
      const cmd = u.searchParams.get('cmd')!;
      if (cmd === 'station_list') return res({ station_list: [{ mac_addr: 'aa:bb:cc:00:00:09', hostname: 'Phone', ip_addr: '192.168.0.100' }] });
      if (cmd === 'lan_station_list') return res({ lan_station_list: [] });
      const out: any = {};
      for (const k of cmd.split(',')) out[k] = k === 'loginfo' ? (st.logged ? 'ok' : '') : k === 'psw_fail_num_str' ? String(st.fail) : (st.db[k] ?? '');
      return res(out);
    }
    const b: Record<string, string> = Object.fromEntries(new URLSearchParams(init.body));
    st.posts.push(b.goformId);
    if (b.goformId === 'LOGIN') {
      const ok = atob(b.username) === 'admin' && atob(b.password) === (opts.password ?? 'admin');
      if (!ok) st.fail--;
      st.logged = ok;
      return res({ result: ok ? '0' : '3' });
    }
    if (!st.logged) return res({ result: 'failure' });
    if (b.goformId === 'SET_BAND_LOCK') {
      if (!opts.ignoreWrites) for (const [k, v] of Object.entries(b)) { const m = k.match(/^band(\d+)_lock$/); if (m && st.db['lockband' + m[1]] !== '') st.db['lockband' + m[1]] = v; }
      return res({ result: 'success' });
    }
    if (b.goformId === 'WIFI_MAC_FILTER') { st.db.ACL_mode = b.ACL_mode; st.db.wifi_mac_black_list = b.wifi_mac_black_list ?? ''; return res({ result: 'success' }); }
    if (['DISCONNECT_NETWORK', 'CONNECT_NETWORK', 'RESTORE_FACTORY_SETTINGS', 'REBOOT_DEVICE'].includes(b.goformId)) return res({ result: 'success' });
    return res({ result: 'failure' });
  };
  return st;
}
const driver = () => { const { ZteUfiDriver } = require('../src/drivers/zteufi/index'); return new ZteUfiDriver(); };

test('ZTE جيب 4G: يتعرف عليه (والـ ZTE الجديد ما ينسرق منه)، ويدخل بـ base64، ويقرأ الإشارة', async () => {
  router({ newZte: true });
  assert.equal(await driver().detect('192.168.0.1'), false);
  router();
  const d = driver();
  assert.equal(await d.detect('192.168.0.1'), true);
  assert.match((await d.identify()).label, /MF971R/);
  await d.login('192.168.0.1', '', 'admin', { fresh: true });
  const s = await d.getSignal();
  assert.equal(s.network, '4G'); assert.equal(s.band, 'B3'); assert.equal(s.rsrp, -97); assert.equal(s.sinr, 12); assert.equal(s.pci, '301'); assert.equal(s.earfcn, '1650');
  assert.equal((await d.getNetworkInfo()).connected, true);
});

test('ZTE جيب 4G: كلمة غلط ← رسالة، وباقي محاولة وحدة ← نوقف قبل ما نحرقها', async () => {
  const st = router({ password: 'right' });
  const d = driver();
  await assert.rejects(d.login('192.168.0.1', 'admin', 'wrong', { fresh: true }), /غلط/);
  st.fail = 1;
  const n = st.posts.length;
  await assert.rejects(d.login('192.168.0.1', 'admin', 'wrong', { fresh: true }), (e: any) => e.code === 'LAST_TRY');
  assert.equal(st.posts.length, n);
});

test('ZTE جيب 4G: الترددات — الكل مفعّل = تلقائي، التثبيت على B3، والفك يرجّع الكل', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin', { fresh: true });
  const c = await d.getBandConfig();
  assert.deepEqual(c.supported, [1, 3, 28, 41]); assert.deepEqual(c.locked, []);
  const snap = await d.readLockState();
  await d.setBand([3]);
  assert.deepEqual([st.db.lockband1, st.db.lockband3, st.db.lockband28, st.db.lockband41], ['0', '1', '0', '0']);
  assert.deepEqual((await d.getBandConfig()).locked, [3]);
  await d.restoreLockState(snap);
  assert.deepEqual([st.db.lockband1, st.db.lockband3, st.db.lockband28, st.db.lockband41], ['1', '1', '1', '1']);
  const n = st.posts.length;
  await assert.rejects(d.setBand([66]), (e: any) => e.noChange === true);
  assert.equal(st.posts.length, n);
});

test('ZTE جيب 4G: الراوتر يقول نجح وما تغيّر ← نقول الحقيقة', async () => {
  router({ ignoreWrites: true });
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin', { fresh: true });
  await assert.rejects(d.setBand([3]), /القراءة بعده مختلفة/);
});

test('ZTE جيب 4G: الأجهزة والحظر بالقائمة السوداء، وآي بي جديد', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin', { fresh: true });
  assert.deepEqual((await d.getDevices()).map((x: any) => [x.mac, x.name, x.blocked]), [['AA:BB:CC:00:00:09', 'Phone', false]]);
  await d.blockDevice('aa:bb:cc:00:00:09', true);
  assert.equal(st.db.ACL_mode, '2'); assert.equal(st.db.wifi_mac_black_list, 'AA:BB:CC:00:00:09');
  assert.equal((await d.getDevices())[0].blocked, true);
  await d.blockDevice('AA:BB:CC:00:00:09', false);
  assert.equal(st.db.wifi_mac_black_list, '');
  await d.reconnectData({ holdSecs: 2 });
  assert.deepEqual(st.posts.slice(-2), ['DISCONNECT_NETWORK', 'CONNECT_NETWORK']);
});
