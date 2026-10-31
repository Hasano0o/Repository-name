/**
 * درايفر FiberHome كامل على راوتر محاكى يرد بنفس بروتوكول صفحة الراوتر الحقيقية
 * (AES-128-CBC بمفتاح من sessionid، /api/tmp/FHAPIS، /api/sign/DO_WEB_LOGIN، get_xmlnode_js_file).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';
import { FH_IV } from '../src/drivers/fiberhome/crypto';

declare const require: any;
declare const Buffer: any;
(globalThis as any).__DEV__ = false;

const NODES = `var x_NetworkSettings_obj="IGD.X_FH_MobileNetwork.NetworkSettings.";
var x_NetworkSet_LTELockBAND="LTELockBAND",x_NetworkSet_NRLockBAND="NRLockBAND",x_NetworkSet_LockBandEnable="LockBandEnable";
var x_NetworkSet_NetworkMode="NetworkMode";var x_NetworkSet_ENDC="ENDC";
var x_RadioSignalParameter_obj="IGD.X_FH_MobileNetwork.RadioSignalParameter.";
var x_RadioSignal_WorkMode="WorkMode",x_RadioSignal_RSRP="RSRP",x_RadioSignal_SINR="SINR",x_RadioSignal_BAND="BAND",x_RadioSignal_PCI="PCI";
var x_RadioSignal_SSB_RSRP="SSB_RSRP",x_RadioSignal_NR_Band="NR_Band",x_RadioSignal_NR_PCI="NR_PCI";
var x_LockCellList_obj="IGD.X_FH_MobileNetwork.LockCellList.";var x_LockCellList_LockCell="LockCell.";var x_LockCellList_LockEnable="Enable";
var x_LockCellList_act="act",x_LockCellList_arfcn="arfcn",x_LockCellList_pci="pci";
var x_DeviceInfo_obj="IGD.DeviceInfo.";var x_UPNP_Enable="X_FH_UPNP.Enable",x_UPNP_Request="X_FH_UPNP.Request",x_UPNPRULE_Obj="X_FH_UPNP.Rule.";
var x_UPNPRULE_IPAddress="IPAddress",x_UPNPRULE_Protocol="Protocol",x_UPNPRULE_ExternalPort="ExternalPort",x_UPNPRULE_Description="Description";
var x_DeviceInfo_LedSwitch="X_FH_LedSwitch";var x_Firewall_obj="IGD.X_FH_Firewall.";var x_Firewall_DMZEnable="DMZEnable",x_Firewall_DMZIP="DMZIP",x_Firewall_NATType="NATType";
var x_TimedReboot_obj="IGD.X_FH_TimedReboot.";var x_TimedReboot_enable="Enable",x_TimedReboot_repeatdays="RepeatDays",x_TimedReboot_time="Time";
var x_Temperature_obj="IGD.X_FH_Temperature.";var x_Modem5GTemperature="Modem5G";
var x_WLANConfiguration_obj="IGD.LANDevice.1.WLANConfiguration.";var x_wifi_RadioEnabled="RadioEnabled",x_wifi_SSID="SSID",x_wifi_BeaconType="BeaconType",x_wifi_Enable="Enable",x_wifi_PreSharedKey="PreSharedKey.1.PreSharedKey";
var x_MainSSIDIndex_58G_obj="IGD.X_FH_MainSSIDIndex_58G";var x_wifi_WifiBandSteering_obj="IGD.X_FH_BandSteering.";var x_BandSteering_Enable="Enable";`;

function router(opts: { password?: string; ignoreWrites?: boolean; model?: string; noEncryptApi?: boolean } = {}) {
  const db: Record<string, string> = {
    'IGD.X_FH_MobileNetwork.NetworkSettings.LTELockBAND': '', 'IGD.X_FH_MobileNetwork.NetworkSettings.NRLockBAND': '',
    'IGD.X_FH_MobileNetwork.NetworkSettings.LockBandEnable': '0', 'IGD.X_FH_MobileNetwork.NetworkSettings.NetworkMode': '3',
    'IGD.X_FH_MobileNetwork.NetworkSettings.ENDC': '2', 'IGD.X_FH_MobileNetwork.LockCellList.Enable': '0',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.WorkMode': 'NSA', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.RSRP': '-97',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.SINR': '11', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.BAND': '3',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.PCI': '214', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.SSB_RSRP': '-85',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.NR_Band': '78', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.NR_PCI': '41',
  };
  const cells: { act: string; arfcn: string; pci: string }[] = [];
  const W = 'IGD.LANDevice.1.WLANConfiguration.';
  Object.assign(db, {
    'IGD.DeviceInfo.X_FH_UPNP.Enable': '0', 'IGD.X_FH_Firewall.DMZEnable': '0', 'IGD.X_FH_Firewall.DMZIP': '', 'IGD.X_FH_Firewall.NATType': '1',
    'IGD.DeviceInfo.X_FH_LedSwitch': '1', 'IGD.X_FH_TimedReboot.Enable': '0', 'IGD.X_FH_TimedReboot.RepeatDays': 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday',
    'IGD.X_FH_TimedReboot.Time': '00:00', 'IGD.X_FH_Temperature.Modem5G': '47000', 'IGD.X_FH_MainSSIDIndex_58G': '9', 'IGD.X_FH_BandSteering.Enable': '0',
    [W + '1.RadioEnabled']: '1', [W + '1.SSID']: 'STC_ECD00', [W + '1.BeaconType']: 'WPA2', [W + '1.Enable']: '1', [W + '1.PreSharedKey.1.PreSharedKey']: 'old-pass1',
    [W + '2.RadioEnabled']: '1', [W + '2.SSID']: 'extra', [W + '2.BeaconType']: 'WPA2', [W + '2.Enable']: '0',
    [W + '9.RadioEnabled']: '1', [W + '9.SSID']: 'STC_ECD00_5G', [W + '9.BeaconType']: 'WPA2', [W + '9.Enable']: '1', [W + '9.PreSharedKey.1.PreSharedKey']: 'old-pass1',
  });
  const cmds: string[] = [];
  let sid = '';
  let logged = false;
  const writes: string[] = [];
  const aes = (mode: 'enc' | 'dec', key: string, data: string) => {
    const c = mode === 'enc' ? (ncrypto as any).createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(FH_IV)) : (ncrypto as any).createDecipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(FH_IV));
    return Buffer.concat([c.update(Buffer.from(data, mode === 'enc' ? 'utf8' : 'hex')), c.final()]).toString(mode === 'enc' ? 'hex' : 'utf8');
  };
  const res = (status: number, text: string) => ({ ok: status < 400, status, url: 'http://192.168.8.1/', headers: { get: () => null }, text: async () => text } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    // فيرموير قديم: ما فيه مسارات /fh_api/ (هذي للفيرموير الجديد — fiberhomeV2.test.ts)
    if (u.pathname.startsWith('/fh_api/')) return res(404, '');
    if (init?.method !== 'POST') {
      const m = u.searchParams.get('ajaxmethod');
      if (u.pathname === '/login.html') return res(200, '<script src="/plugins/checkBrowser.js"></script><script src="lang/login_res.js"></script><script>_0xdx2m04ej1p623_("/js/login.js")</script>');
      if (m === 'is_encrypt') return opts.noEncryptApi ? res(404, '') : res(200, '{"enable":1}');
      if (m === 'get_refresh_sessionid') { sid = Math.random().toString(36).slice(2).padEnd(20, 'x'); return res(200, JSON.stringify({ sessionid: sid })); }
      if (m === 'set_developer_mode') return res(200, '{}');
      return res(404, '');
    }
    const key = sid.slice(0, 16);
    const body = JSON.parse(aes('dec', key, init.body));
    assert.equal(body.sessionid, sid, 'كل طلب لازم يحمل sessionid الجديد');
    if (u.pathname === '/api/sign/DO_WEB_LOGIN') {
      const ok = body.dataObj.password === (opts.password ?? 'pw') && body.dataObj.username === 'admin';
      logged = ok;
      return res(200, ok ? '0|' : '4|');
    }
    const api = u.pathname.split('/').pop();
    if (api === 'FHAPIS' && !logged) return res(418, '');
    const m = body.ajaxmethod, d = body.dataObj;
    let out: any = {};
    if (m === 'get_device_info') out = { model_name: opts.model ?? 'LG6121F', operator_name: 'SA_STC' };
    else if (m === 'get_xmlnode_js_file') out = { xml: NODES };
    else if (m === 'get_value_by_xmlnode') for (const [k, p] of Object.entries(d)) out[k] = db[p as string] ?? '';
    else if (m === 'set_value_by_xmlnode') { writes.push(JSON.stringify(d.value)); if (!opts.ignoreWrites) for (const k of Object.keys(d.url)) db[d.url[k]] = String(d.value[k]); out = { success: 'true' }; }
    else if (m === 'set_single_by_xmlnode') { writes.push(d.url + '=' + d.value); if (!opts.ignoreWrites) db[d.url] = String(d.value); out = { success: 'true' }; }
    else if (m === 'get_cmd_result_web') out = d.key === 'UPTIME' ? { result: '93784' } : {};
    else if (m === 'do_cmd_web') { cmds.push(d.key); out = { success: 'true' }; }
    else if (m === 'get_xml_childnode_value' && d.url === W) {
      // نتأكد إن الدرايفر ما يطلب كلمة المرور أبداً
      assert.ok(!Object.values(d.node).some(v => /PreSharedKey/.test(String(v))), 'ما نطلب كلمة مرور الواي فاي');
      out = { data: ['1', '2', '9'].map(i => ({ child_node_idx: i, ...Object.fromEntries(Object.entries(d.node).map(([k, f]) => [k, db[W + i + '.' + f] ?? ''])) })) };
    }
    else if (m === 'get_xml_childnode_value' && /UPNP/.test(d.url)) out = { data: db['IGD.DeviceInfo.X_FH_UPNP.Request'] === 'Request' ? [{ child_node_idx: '1', IPAddress: '192.168.8.20', Protocol: 'UDP', ExternalPort: '3074', Description: 'Xbox' }] : [] };
    else if (m === 'get_xml_childnode_value') out = { data: cells.map((c, i) => ({ ...c, child_node_idx: String(i + 1) })) };
    else if (m === 'add_set_xmlnode') { writes.push('add'); cells.push({ act: String(d.setNode.value.act), arfcn: String(d.setNode.value.arfcn), pci: String(d.setNode.value.pci) }); }
    else if (m === 'del_xmlnode') { writes.push('del'); cells.splice(Number(d.index) - 1, 1); }
    return res(200, aes('enc', key, JSON.stringify(out)));
  };
  return { db, cells, writes, cmds };
}

async function driver() {
  const { FiberhomeDriver } = require('../src/drivers/fiberhome/index');
  return new FiberhomeDriver();
}
// الدرايفر ينتظر ٣ ث بعد كل تغيير (مثل الصفحة) — نسرّعها في الاختبار
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

test('FiberHome: يتعرف عليه، ويدخل، ويقرأ الإشارة (4G + 5G NSA)', async () => {
  router();
  const d = await driver();
  assert.equal(await d.detect('192.168.8.1'), true);
  const m = await d.identify();
  assert.equal(m.label, 'FiberHome LG6121F');
  await d.login('192.168.8.1', '', 'pw');
  const s = await d.getSignal();
  assert.equal(s.network, '5G NSA');
  assert.equal(s.band, 'B3'); assert.equal(s.rsrp, -97); assert.equal(s.pci, '214');
  assert.equal(s.nrBand, 'n78'); assert.equal(s.nrRsrp, -85);
});

test('FiberHome: كلمة مرور غلط ← رسالة واضحة فيها «كلمة المرور»', async () => {
  router({ password: 'right' });
  const d = await driver();
  await assert.rejects(d.login('192.168.8.1', 'admin', 'wrong'), /كلمة المرور/);
});

test('FiberHome: تثبيت الترددات + التحقق، وفك التثبيت', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.setBand([3, 1], [78]);
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.LTELockBAND'], '1,3');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.NRLockBAND'], '78');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.LockBandEnable'], '1');
  const c = await d.getBandConfig();
  assert.deepEqual(c.locked, [1, 3]); assert.deepEqual(c.nrLocked, [78]);
  await d.setBand([], []);
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.LockBandEnable'], '0');
});

test('FiberHome: الراوتر يقول نجح وما تغيّر ← نقول الحقيقة', async () => {
  router({ ignoreWrites: true });
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await assert.rejects(d.setBand([3]), /القراءة بعده مختلفة/);
});

test('FiberHome: B32 لحاله ما ينرسل (noChange)', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await assert.rejects(d.setBand([32]), (e: any) => e.noChange === true);
  assert.equal(r.writes.length, 0);
});

test('FiberHome: وضع الشبكة 4G فقط ← 0 مع إبقاء ENDC', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.setNetworkMode('03');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.NetworkMode'], '0');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.ENDC'], '2');
  assert.equal((await d.getBandConfig()).mode, '03');
});

test('FiberHome: لقطة ← تثبيت برج وترددات ← إرجاع بالضبط (والبرج المضاف ينشال)', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  const snap = await d.readLockState();
  await d.setBand([3]);
  await d.lockCell({ tech: 'LTE', pci: '214', arfcn: '1300' });
  assert.equal(r.cells.length, 1);
  assert.equal(r.db['IGD.X_FH_MobileNetwork.LockCellList.Enable'], '1');
  await d.restoreLockState(snap);
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.LockBandEnable'], '0');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.LockCellList.Enable'], '0');
  assert.equal(r.cells.length, 0);
});

test('FiberHome: تثبيت برج بدون رقم قناة ← يوقف قبل أي أمر', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await assert.rejects(d.lockCell({ tech: 'LTE', pci: '214' }), (e: any) => e.noChange === true);
  assert.equal(r.writes.length, 0);
});

// ═══ مركز التحكم ═══
const W = 'IGD.LANDevice.1.WLANConfiguration.';

test('FiberHome مركز التحكم: القراءة (NAT، UPnP، DMZ، الشبكتين، الأسماء، الصيانة) — والأنوار تظهر لـ LG6121D بس', async () => {
  router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  const ex = await d.getExtras();
  assert.equal(ex.nat, 'symmetric');
  assert.equal(ex.upnp, false);
  assert.deepEqual(ex.dmz, { on: false, ip: '' });
  assert.equal(ex.led, undefined);
  assert.deepEqual(ex.bands, [{ band: '2.4', on: true }, { band: '5', on: true }]);
  assert.deepEqual(ex.wifiNets!.map((n: any) => [n.index, n.band, n.name, n.secured]), [['1', '2.4', 'STC_ECD00', true], ['9', '5', 'STC_ECD00_5G', true]]);
  assert.equal(ex.uptime, '26:03:04');
  assert.equal(ex.health!.tempC, 47);
  assert.deepEqual(ex.autoReboot, { on: false, everyDays: 1, from: 0, to: 0 });
  // ما فيه كلمة مرور في أي مكان من الرد
  assert.ok(!JSON.stringify(ex).includes('old-pass1'));

  router({ model: 'LG6121D' });
  const d2 = await driver();
  await d2.login('192.168.8.1', 'admin', 'pw');
  const e2 = await d2.getExtras();
  assert.equal(e2.led, true);
  assert.deepEqual(e2.bands, [{ band: '2.4', on: true }]); // LG6121D: 2.4 بس
  assert.equal(e2.wifiNets.length, 1);
});

test('FiberHome مركز التحكم: NAT مفتوح، UPnP (والمنافذ)، DMZ، الأنوار', async () => {
  const r = router({ model: 'LG6121D' });
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.setNat('cone');
  assert.equal(r.db['IGD.X_FH_Firewall.NATType'], '2');
  await d.setUpnp(true);
  const ex = await d.getExtras();
  assert.equal(ex.upnp, true);
  assert.deepEqual(ex.upnpMaps, [{ app: 'Xbox', ip: '192.168.8.20', port: '3074', proto: 'UDP' }]);
  await d.setDmz(true, '192.168.8.20');
  assert.equal(r.db['IGD.X_FH_Firewall.DMZEnable'], '1'); assert.equal(r.db['IGD.X_FH_Firewall.DMZIP'], '192.168.8.20');
  const n = r.writes.length;
  await assert.rejects(d.setDmz(true, 'abc'), (e: any) => e.noChange === true);
  assert.equal(r.writes.length, n);
  await d.setLed(false);
  assert.equal(r.db['IGD.DeviceInfo.X_FH_LedSwitch'], '0');
  assert.equal((await d.getExtras()).led, false);
});

test('FiberHome مركز التحكم: إعادة التشغيل التلقائية ما تنضبط على ١٢ الليل (٤ الفجر بدالها)', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.setAutoReboot(true);
  assert.equal(r.db['IGD.X_FH_TimedReboot.Enable'], '1');
  assert.equal(r.db['IGD.X_FH_TimedReboot.Time'], '04:00');
  assert.equal(r.db['IGD.X_FH_TimedReboot.RepeatDays'].split(',').length, 7);
  assert.deepEqual((await d.getExtras()).autoReboot, { on: true, everyDays: 1, from: 240, to: 240 });
  await d.setAutoReboot(false);
  assert.equal(r.db['IGD.X_FH_TimedReboot.Enable'], '0');
});

test('FiberHome مركز التحكم: إطفاء/تشغيل الشبكات — 5G على MainSSIDIndex_58G، ودمج الشبكتين يمنع', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.setBandOn('5', false);
  assert.equal(r.db[W + '9.RadioEnabled'], '0');
  assert.equal(r.db[W + '1.RadioEnabled'], '1');
  await d.setBandOn('5', true);
  assert.equal(r.db[W + '9.RadioEnabled'], '1');
  r.db['IGD.X_FH_BandSteering.Enable'] = '1';
  const n = r.writes.length;
  await assert.rejects(d.setBandOn('2.4', false), (e: any) => e.noChange === true && /دمج الشبكتين/.test(e.message));
  assert.equal(r.writes.length, n);

  const r2 = router({ model: 'LG6121D' });
  const d2 = await driver();
  await d2.login('192.168.8.1', 'admin', 'pw');
  await assert.rejects(d2.setBandOn('5', false), (e: any) => e.noChange === true);
  assert.equal(r2.writes.length, 0);
});

test('FiberHome مركز التحكم: اسم الواي فاي وكلمته — وشروط الراوتر توقف قبل أي أمر', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.setWifiNames([{ index: '1', name: 'Bandly_Home' }, { index: '9', name: 'STC_ECD00_5G' }], 'NewPass123');
  assert.equal(r.db[W + '1.SSID'], 'Bandly_Home');
  assert.equal(r.db[W + '9.SSID'], 'STC_ECD00_5G');
  assert.equal(r.db[W + '1.PreSharedKey.1.PreSharedKey'], 'NewPass123');
  assert.equal(r.db[W + '9.PreSharedKey.1.PreSharedKey'], 'NewPass123');
  assert.equal(r.db[W + '2.SSID'], 'extra'); // الشبكة الإضافية ما تنلمس
  const n = r.writes.length;
  await assert.rejects(d.setWifiNames([{ index: '1', name: 'بيتنا' }]), (e: any) => e.noChange === true && /عربية/.test(e.message));
  await assert.rejects(d.setWifiNames([{ index: '1', name: 'My Home' }]), (e: any) => e.noChange === true);
  await assert.rejects(d.setWifiNames([{ index: '1', name: 'Ok' }], 'short'), (e: any) => e.noChange === true);
  await assert.rejects(d.setWifiNames([{ index: '1', name: 'Ok' }], 'a'.repeat(40)), (e: any) => e.noChange === true);
  assert.equal(r.writes.length, n);
  r.db[W + '1.BeaconType'] = 'None'; r.db[W + '9.BeaconType'] = 'None';
  await assert.rejects(d.setWifiNames([{ index: '1', name: 'Bandly_Home' }, { index: '9', name: 'STC_ECD00_5G' }], 'NewPass456'), (e: any) => e.noChange === true && /مفتوحة/.test(e.message));
  assert.equal(r.writes.length, n);
});

test('FiberHome مركز التحكم: ضبط المصنع بنفس أوامر الصفحة', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.factoryReset();
  assert.deepEqual(r.cmds, ['RECORD_MESSAGE_WEB', 'UBUS_RESTORE_MODE_2']);
});

test('FiberHome LG6851F: is_encrypt ما رد ← نتعرّف عليه من صفحة الدخول ونفترض التشفير، والدخول يشتغل', async () => {
  router({ noEncryptApi: true, model: 'LG6851F' });
  const d = await driver();
  assert.equal(await d.detect('192.168.8.1'), true);
  assert.equal((await d.identify()).label, 'FiberHome LG6851F');
  await d.login('192.168.8.1', 'admin', 'pw');
  assert.equal((await d.getSignal()).band, 'B3');
});

test('FiberHome: جهاز ثاني (مو FiberHome) ما ينحسب FiberHome', async () => {
  (globalThis as any).fetch = async () => ({ ok: false, status: 404, url: 'http://192.168.8.1/', headers: { get: () => null }, text: async () => '<html>Huawei</html>' });
  const d = await driver();
  assert.equal(await d.detect('192.168.8.1'), false);
});

test('FiberHome القديم (v1): ميزات الفيرموير الجديد مخفية — التطبيق ما يعرض أزرار ما نعرف صفحتها', async () => {
  router();
  const d = await driver();
  await d.login('192.168.8.1', '', 'pw');
  for (const k of ['getCarriers', 'getDevices', 'blockDevice', 'getUsage', 'listSms', 'sendSms', 'getApnProfiles', 'setApn', 'getDns', 'setDns', 'getAntenna', 'reconnectData', 'reattach']) {
    assert.equal((d as any)[k], undefined, `${k} لازم يختفي في v1`);
  }
  assert.equal(typeof d.getBandConfig, 'function', 'ميزات v1 باقية');
  assert.deepEqual(await d.getWifiRadios(), [], 'قناة الواي فاي: فاضية في v1');
});
