/** «مزايا تجريبية» — ZTE / Green Packet / هواوي بصيغ صفحاتها (٢٨ نوفمبر). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZteLabs, parseNetList, macList, joinMacs } from '../src/drivers/zte/labs';
import { turboKey, flipValue, gpLabs, gpRunLab } from '../src/drivers/greenpacket/labs';
import { field, hwLabs, hwRunLab } from '../src/drivers/huawei/labs';

(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

function zteRouter(st: Record<string, string>) {
  const acts: Record<string, string>[] = [];
  return {
    acts,
    io: {
      get: async (f: string[]) => Object.fromEntries(f.map(k => [k, st[k] ?? ''])),
      act: async (b: Record<string, string>) => {
        acts.push(b);
        if (b.goformId === 'SET_WIFI_SPEED') { st.wifi_speed_control_enable = b.wifi_speed_control_enable; st.wifi_speed_high_mac_list = b.wifi_speed_high_mac_list; st.wifi_speed_low_mac_list = b.wifi_speed_low_mac_list; }
        if (b.goformId === 'WAN_ANT_SWITCH_SET') st.ant_switch_enable = b.ant_switch_enable;
        if (b.goformId === 'SCAN_NETWORK') { st.m_netselect_status = 'manual_selected'; st.network_m_netselect_contents = '2,STC,42001,7;1,Zain,42004,7;3,Mobily,42003,12'; }
        if (b.goformId === 'SET_NETWORK') st.m_netselect_result = 'manual_success';
        return '{"result":"success"}';
      },
    },
  };
}

test('ZTE labs: قائمة الشبكات بنفس regex الصفحة', () => {
  const l = parseNetList('2,"STC",42001,7;1,Zain,42004,7;1,Zain,42004,12');
  assert.equal(l.length, 3);
  assert.deepEqual(l[0], { state: 2, name: 'STC', numeric: '42001', rat: 7 });
  assert.equal(l[2].rat, 12);
});

test('ZTE labs: قوائم MAC تحافظ على الفاصل', () => {
  assert.deepEqual(macList('aa:bb:cc:dd:ee:ff;11:22:33:44:55:66;'), ['AA:BB:CC:DD:EE:FF', '11:22:33:44:55:66']);
  assert.equal(joinMacs(['AA:BB:CC:DD:EE:FF'], 'x,y'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(joinMacs(['A', 'B'], '11;22;'), 'A;B;');
  assert.equal(joinMacs([], '11;'), '');
});

test('ZTE labs: أولوية السرعة لجهاز ← SET_WIFI_SPEED بالقوائم الصح والتحقق', async () => {
  const r = zteRouter({ wifi_speed_control_enable: '1', wifi_speed_high_mac_list: '', wifi_speed_low_mac_list: '11:22:33:44:55:66;' });
  const labs = new ZteLabs(r.io, async () => [{ mac: 'aa:bb:cc:dd:ee:ff', name: 'PS5' }, { mac: '11:22:33:44:55:66' }]);
  const items = await labs.list();
  const ps5 = items.find(i => i.id === 'speed:AA:BB:CC:DD:EE:FF')!;
  assert.equal(ps5.value, 'normal');
  assert.equal(items.find(i => i.id === 'speed:11:22:33:44:55:66')!.value, 'low');
  await labs.run(ps5.id, 'high');
  const b = r.acts.at(-1)!;
  assert.equal(b.goformId, 'SET_WIFI_SPEED');
  assert.equal(b.wifi_speed_high_mac_list, 'AA:BB:CC:DD:EE:FF');
  assert.equal(b.wifi_speed_low_mac_list, '11:22:33:44:55:66;');
});

test('ZTE labs: تبديل الأنتنا + بحث واختيار الشبكة + رجوع تلقائي', async () => {
  const r = zteRouter({ ant_switch_enable: '0', network_net_select_mode: 'auto_select', net_select: 'NETWORK_auto' });
  const labs = new ZteLabs(r.io, async () => []);
  assert.ok((await labs.list()).some(i => i.id === 'ant-switch'));
  await labs.run('ant-switch', '1');
  assert.equal(r.acts.at(-1)!.ant_switch_enable, '1');
  assert.match(String(await labs.run('net-scan')), /3/);
  const pick = (await labs.list()).find(i => i.id === 'net-pick')!;
  assert.equal(pick.value, '42001|7');
  await labs.run('net-pick', '42004|7');
  assert.deepEqual(r.acts.at(-1), { goformId: 'SET_NETWORK', NetworkNumber: '42004', Rat: '7' });
  await labs.run('net-pick', 'auto');
  assert.deepEqual(r.acts.at(-1), { goformId: 'SET_BEARER_PREFERENCE', BearerPreference: 'NETWORK_auto' });
});

test('ZTE labs: رفض الراوتر يطلع باسم الأمر', async () => {
  const r = zteRouter({ ant_switch_enable: '0' });
  r.io.act = async () => '{"result":"failure"}';
  await assert.rejects(new ZteLabs(r.io, async () => []).run('ant-switch', '1'), /WAN_ANT_SWITCH_SET/);
});

test('Green Packet labs: مفتاح Gaming Turbo ونوع القيمة', () => {
  assert.deepEqual(turboKey({ GamingTurboEnable: false, Other: 'x' }), { key: 'GamingTurboEnable', on: false });
  assert.deepEqual(turboKey({ Status: 'Enable' }), { key: 'Status', on: true });
  assert.equal(turboKey({ Name: 'x' }), null);
  assert.equal(flipValue(false, true), true);
  assert.equal(flipValue('Disable', true), 'Enable');
  assert.equal(flipValue(0, true), 1);
});

test('Green Packet labs: حمل الراوتر + Gaming Turbo يرسل نفس الرد مع قلب المفتاح', async () => {
  const st: any = { turbo: { GamingTurboEnable: '0', Mode: 'Auto' } };
  const posts: any[] = [];
  const io = {
    get: async (p: string) => {
      if (p === '/status/statistics') return { CpuUsage: { Current: '37' }, MemoryUsage: { Current: '61' }, Bandwidth: { Dl: '12 Mbps', Ul: '' } };
      if (p.endsWith('gamingturbo')) return st.turbo;
      throw new Error('501');
    },
    post: async (p: string, b: any) => { posts.push(b); st.turbo = b; return {}; },
  };
  const l = await gpLabs(io);
  assert.deepEqual(l.find(x => x.id === 'gp-load')!.rows!.slice(0, 2), [{ label: 'المعالج', value: '37٪' }, { label: 'الذاكرة', value: '61٪' }]);
  assert.equal(l.find(x => x.id === 'gp-turbo')!.value, '0');
  await gpRunLab(io, 'gp-turbo', '1');
  assert.deepEqual(posts[0], { GamingTurboEnable: '1', Mode: 'Auto' });
});

test('هواوي labs: HiGame JSON أو XML + الأمر', async () => {
  assert.equal(field('{"HiGameControlEnable":true,"DevList":[]}', 'HiGameControlEnable'), 'true');
  assert.equal(field('<response><HiGameControlEnable>0</HiGameControlEnable></response>', 'HiGameControlEnable'), '0');
  let on = false;
  const posts: any[] = [];
  const io = {
    get: async (p: string) => p === 'hilink/higame' ? JSON.stringify({ HiGameControlEnable: on, DevList: [] })
      : '<response><connection_status>901</connection_status><modemdialup_err>0</modemdialup_err></response>',
    postJson: async (_p: string, b: any) => { posts.push(b); on = b.data.HiGameControlEnable; return '{"response":"OK"}'; },
  };
  const l = await hwLabs(io);
  assert.equal(l.find(x => x.id === 'hw-higame')!.value, '0');
  assert.equal(l.find(x => x.id === 'hw-onekey')!.rows![0].label, 'connection_status');
  await hwRunLab(io, 'hw-higame', '1');
  assert.deepEqual(posts[0], { data: { HiGameControlEnable: true } });
});

import { tryVariants, orderVariants } from '../src/drivers/labVariants';
import { pendingFixes } from '../src/utils/labFixCore';

test('الإصلاح الذاتي: الصيغة المفضلة أول، والبدائل لين وحدة تنجح', async () => {
  assert.deepEqual(orderVariants(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(orderVariants(['a', 'b'], 'zz'), ['a', 'b']);
  const seen: string[] = [];
  const r = await tryVariants(['a', 'b', 'c'], undefined, async v => { seen.push(v); if (v !== 'b') throw new Error('no'); return 'ok'; });
  assert.equal(r.variant, 'b');
  assert.deepEqual(seen, ['a', 'b']);
  await assert.rejects(tryVariants(['a', 'b'], undefined, async () => { throw new Error('x'); }), /جرّبنا: a,b/);
  // unsupported يوقف البدائل
  let n = 0;
  await assert.rejects(tryVariants(['a', 'b'], undefined, async () => { n++; const e: any = new Error('u'); e.unsupported = true; throw e; }));
  assert.equal(n, 1);
});

test('الإصلاح الذاتي: ZTE يجرّب فاصل ثاني لو القراءة ما تطابقت، ويرجّع الصيغة', async () => {
  const st: Record<string, string> = { wifi_speed_control_enable: '1', wifi_speed_high_mac_list: '', wifi_speed_low_mac_list: '' };
  const acts: any[] = [];
  const io = {
    get: async (f: string[]) => Object.fromEntries(f.map(k => [k, st[k] ?? ''])),
    act: async (b: any) => {
      acts.push(b);
      // راوتر يحفظ بس لو الفاصل فاصلة
      if (/;/.test(b.wifi_speed_high_mac_list)) return '{"result":"success"}';
      st.wifi_speed_high_mac_list = b.wifi_speed_high_mac_list; return '{"result":"success"}';
    },
  };
  const labs = new ZteLabs(io, async () => []);
  st.wifi_speed_high_mac_list = '';
  const r: any = await labs.run('speed:AA:BB:CC:DD:EE:01', 'high', 'semiEnd');
  // semiEnd أول (المفضّلة من الرسيفر) ← القراءة ما تطابقت ← auto (بدون ; في الآخر) تنحفظ
  assert.equal(r.variant, 'auto');
  assert.deepEqual(r.tried, ['semiEnd', 'auto']);
  assert.equal(acts[0].wifi_speed_high_mac_list, 'AA:BB:CC:DD:EE:01;');
});

test('«انصلحت — جرّبها»: بس اللي فشل قبل الإصلاح وما انشاف', () => {
  const fixes = { 'zte:speed': { at: '2026-11-29', note: 'n' } };
  const before = Date.parse('2026-11-28T12:00:00+03:00'), after = Date.parse('2026-11-30T12:00:00+03:00');
  const fails = { 'r1|zte:speed': before, 'r1|zte:ant-switch': before, 'r2|zte:speed': after };
  assert.deepEqual(pendingFixes('r1', 'zte', fails, {}, fixes).map(x => x.lab), ['speed']);
  assert.deepEqual(pendingFixes('r2', 'zte', fails, {}, fixes), []);
  assert.deepEqual(pendingFixes('r1', 'zte', fails, { 'r1|zte:speed': 1 }, fixes), []);
});
