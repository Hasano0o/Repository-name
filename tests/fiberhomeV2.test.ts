/**
 * FiberHome LG6851F — الفيرموير الجديد (/fh_api/). راوتر محاكى يرد بنفس بروتوكول polyfill.min.js (٣٨٧٢٦٤ بايت):
 * is_encrypt مخلوط برأس content-len + سر RSA، مفتاح AES من sessionid والسر، جسم/رد = ٦ حروف + hex.
 * الحساب في الراوتر المحاكى بـ node:crypto (AES وRSA) — مستقل عن كود الدرايفر.
 * ومتجهات ثابتة طلعت من كود الصفحة نفسه (fixtures/fhapi-vectors.json) تثبّت إن fhapi.ts يطابقها بالبايت.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare const require: any;
declare const Buffer: any;
(globalThis as any).__DEV__ = false;

const F = require('../src/drivers/fiberhome/fhapi');
const IV = 'opqrstuvwxyz{|}~';

const NODES = `var x_NetworkSettings_obj="IGD.X_FH_MobileNetwork.NetworkSettings.";
var x_NetworkSet_LTELockBAND="LTELockBAND",x_NetworkSet_NRLockBAND="NRLockBAND",x_NetworkSet_LockBandEnable="LockBandEnable";
var x_NetworkSet_NetworkMode="NetworkMode";var x_NetworkSet_ENDC="ENDC";
var x_RadioSignalParameter_obj="IGD.X_FH_MobileNetwork.RadioSignalParameter.";
var x_RadioSignal_WorkMode="WorkMode",x_RadioSignal_RSRP="RSRP",x_RadioSignal_SINR="SINR",x_RadioSignal_BAND="BAND",x_RadioSignal_PCI="PCI";
var x_RadioSignal_SSB_RSRP="SSB_RSRP",x_RadioSignal_NR_Band="NR_Band",x_RadioSignal_NR_PCI="NR_PCI";
var x_LockCellList_obj="IGD.X_FH_MobileNetwork.LockCellList.";var x_LockCellList_LockCell="LockCell.";var x_LockCellList_LockEnable="Enable";
var x_LockCellList_act="act",x_LockCellList_arfcn="arfcn",x_LockCellList_pci="pci";
var x_Firewall_obj="IGD.X_FH_Firewall.";var x_Firewall_NATType="NATType",x_Firewall_DMZEnable="DMZEnable",x_Firewall_DMZIP="DMZIP";
var x_DeviceInfo_obj="IGD.DeviceInfo.";var x_DeviceInfo_LedSwitch="LedSwitch",x_UPNP_Enable="UPNPEnable";
var x_WLANConfiguration_obj="IGD.LANDevice.1.WLANConfiguration.";var x_wifi_RadioEnabled="RadioEnabled",x_wifi_SSID="SSID",x_wifi_BeaconType="BeaconType",x_wifi_Enable="Enable";
var x_wifi_Radio_obj="IGD.WiFi.Radio.";var x_wifi_SSID_obj="IGD.WiFi.SSID.";var x_wifi_AccessPoint_obj="IGD.WiFi.AccessPoint.";
var x_wifi_ModeEnabled="ModeEnabled",x_wifi_PreSharedKey="PreSharedKey",x_wifi_Channel="Channel",x_wifi_OperatingChannelBandwidth="OperatingChannelBandwidth",x_wifi_RegulatoryDomain="RegulatoryDomain";
var x_wifi_WifiBandSteering_obj="IGD.WiFi.X_FH_BandSteering.";var x_MainSSIDIndex_58G_obj="IGD.X_FH_WiFi.MainSSIDIndex58G";
var x_WANDevice_obj="IGD.WANDevice.";var x_WANConnectionDevice="WANConnectionDevice.";var x_WANIPConnection="WANIPConnection.";var x_WANPPPConnection="WANPPPConnection.";
var x_wan_Enable="Enable",x_wan_Name="Name",x_wan_WANEnable="WANEnable",x_wan_WanInterface="WanInterface";
var x_DMZ_obj="DMZ.";var x_DMZ_Enable="Enable",x_DMZ_DMZHostIP="DMZHostIP";
var x_PCCInfo_obj="IGD.X_FH.PCCInfo.";var x_PCCInfo2_obj="IGD.X_FH.PCCInfo2.";var x_PCCInfo_Type="Type",x_PCCInfo_Band="Band",x_PCCInfo_Pci="Pci",x_PCCInfo_Arfcn="Arfcn",x_PCCInfo_DlBandWidth="DlBandWidth";
var x_SCCInfo_obj="IGD.X_FH.SCCInfo.";var x_SCCInfo_Type="Type",x_SCCInfo_State="State",x_SCCInfo_Band="Band",x_SCCInfo_Pci="Pci",x_SCCInfo_Arfcn="Arfcn",x_SCCInfo_DlBandWidth="DlBandWidth";
var x_Hosts_Host_obj="IGD.LANDevice.1.Hosts.Host.";var x_Host_HostName="HostName",x_Host_DevName="DevName",x_Host_MacAddress="MACAddress",x_Host_IPAddress="IPAddress",x_Host_Active="Active",x_Host_InternetAccess="InternetAccess";
var x_TrafficStats_obj="IGD.X_FH.TrafficStats.";var x_MonthRxBytes="MonthRxBytes",x_MonthTxBytes="MonthTxBytes";
var x_SMS_recv_msg_obj="IGD.X_FH.SMS.Recv.";var x_SMS_send_msg_obj="IGD.X_FH.SMS.Send.";var x_SMS_recv_isOpened_obj="isOpened";var x_NetworkSet_AirplaneEnable="AirplaneEnable";
var x_Configuration_Management_obj="IGD.X_FH_MobileNetwork.ConfigurationManagement.Management.";var x_Management_ProfileName="ProfileName",x_Management_Enable="Enable",x_Management_AuthenticationType="AuthenticationType",x_Management_APN="APN",x_Management_UserName="UserName",x_Management_Password="Password";
var x_LANHostConfigManagement_obj="IGD.LANDevice.1.LANHostConfigManagement.";var x_LANHost_DNSManualEnable="DNSManualEnable",x_LANHost_DNSServers="DNSServers",x_LANHost_IPInterface_1="IPInterface.1.",x_LANHost_IPInterfaceIPAddress="IPInterfaceIPAddress";
var x_NetworkSet_AntennaOutterSwitch="AntennaOutterSwitch",x_NetworkSet_AntennaOutterType="AntennaOutterType";
var x_SIM_1_obj="IGD.X_FH_MobileNetwork.SIM.1.";var x_SIM_1_CarrierName="CarrierName",x_SIM_1_SIMStatus="SIMStatus",x_SIM_1_IMEI="IMEI";`;

/** المفتاح العام المقابل للمفتاح المدفون في الصفحة (n, e من fhapi) */
function publicKey() {
  const { n, e } = F.fhapiPublicKey();
  const b64u = (x: bigint) => { let h = x.toString(16); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex').toString('base64url'); };
  return (ncrypto as any).createPublicKey({ key: { kty: 'RSA', n: b64u(n), e: b64u(e) }, format: 'jwk' } as any);
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const rand = (n: number) => Array.from({ length: n }, () => ALNUM[Math.floor(Math.random() * ALNUM.length)]).join('');

function mask(plain: string, a = 7, b = 23, c = 41) {
  const s3 = Buffer.from(plain, 'utf8').toString('base64');
  const s2 = s3.slice(0, c - 1) + rand(5) + s3.slice(c - 1);
  const s1 = s2.slice(0, b - 1) + rand(5) + s2.slice(b - 1);
  return { data: rand(a) + s1, hdr: String(a).padStart(2, '0') + String(b) + '.' + String(c) };
}

function router(opts: { password?: string; sidLen?: number; operator?: string } = {}) {
  const pub = publicKey();
  let secret = rand(5);
  const encSecret = () => rand(5) + '0' + (ncrypto as any).publicEncrypt({ key: pub, padding: (ncrypto as any).constants.RSA_PKCS1_PADDING }, Buffer.from(secret)).toString('base64');
  const db: Record<string, string> = {
    'IGD.X_FH_MobileNetwork.NetworkSettings.LTELockBAND': '', 'IGD.X_FH_MobileNetwork.NetworkSettings.NRLockBAND': '',
    'IGD.X_FH_MobileNetwork.NetworkSettings.LockBandEnable': '0', 'IGD.X_FH_MobileNetwork.NetworkSettings.NetworkMode': '3',
    'IGD.X_FH_MobileNetwork.NetworkSettings.ENDC': '2', 'IGD.X_FH_MobileNetwork.LockCellList.Enable': '0',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.WorkMode': 'NSA', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.RSRP': '-95',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.SINR': '14', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.BAND': '3',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.PCI': '301', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.SSB_RSRP': '-88',
    'IGD.X_FH_MobileNetwork.RadioSignalParameter.NR_Band': '78', 'IGD.X_FH_MobileNetwork.RadioSignalParameter.NR_PCI': '77',
    // الواي فاي بالشجرة الجديدة (wifiBasic.js)
    'IGD.WiFi.Radio.1.Enable': '1', 'IGD.WiFi.Radio.2.Enable': '1', 'IGD.WiFi.Radio.1.Channel': '1', 'IGD.WiFi.Radio.2.Channel': '36',
    'IGD.WiFi.Radio.1.OperatingChannelBandwidth': '20MHz', 'IGD.WiFi.Radio.2.OperatingChannelBandwidth': '80MHz',
    'IGD.WiFi.Radio.1.RegulatoryDomain': 'SA', 'IGD.WiFi.Radio.2.RegulatoryDomain': 'SA',
    'IGD.WiFi.X_FH_BandSteering.Enable': '0', 'IGD.X_FH_WiFi.MainSSIDIndex58G': '9',
    'IGD.WiFi.SSID.1.Enable': '1', 'IGD.WiFi.SSID.1.SSID': 'FHCPE-24', 'IGD.WiFi.AccessPoint.1.ModeEnabled': 'WPA2-Personal',
    'IGD.WiFi.SSID.9.Enable': '1', 'IGD.WiFi.SSID.9.SSID': 'FHCPE-5G', 'IGD.WiFi.AccessPoint.9.ModeEnabled': 'WPA2-Personal',
  };
  Object.assign(db, {
    // الدمج (carrierAggregation.js): 4G أساسي B3 + 5G n78 (PCC2) + ثانوي B1 شغّال + ثانوي ثاني مطفي
    'IGD.X_FH.PCCInfo.Type': 'LTE PCC', 'IGD.X_FH.PCCInfo.Band': 'B3', 'IGD.X_FH.PCCInfo.Pci': '301', 'IGD.X_FH.PCCInfo.Arfcn': '1300', 'IGD.X_FH.PCCInfo.DlBandWidth': '20MHz', 'IGD.X_FH.PCCInfo.RSRP': '-95',
    'IGD.X_FH.PCCInfo2.Type': 'NR PCC', 'IGD.X_FH.PCCInfo2.Band': 'n78', 'IGD.X_FH.PCCInfo2.Pci': '77', 'IGD.X_FH.PCCInfo2.Arfcn': '627264', 'IGD.X_FH.PCCInfo2.DlBandWidth': '100MHz', 'IGD.X_FH.PCCInfo2.RSRP': '-88',
    'IGD.X_FH.TrafficStats.MonthRxBytes': '52428800000', 'IGD.X_FH.TrafficStats.MonthTxBytes': '2147483648',
    'IGD.X_FH_MobileNetwork.NetworkSettings.AirplaneEnable': '0',
    'IGD.LANDevice.1.LANHostConfigManagement.DNSManualEnable': '0', 'IGD.LANDevice.1.LANHostConfigManagement.DNSServers': '192.168.8.1',
    'IGD.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceIPAddress': '192.168.8.1',
    'IGD.X_FH_MobileNetwork.NetworkSettings.AntennaOutterSwitch': '0', 'IGD.X_FH_MobileNetwork.NetworkSettings.AntennaOutterType': '0',
    'IGD.X_FH_MobileNetwork.SIM.1.CarrierName': 'zain KSA', 'IGD.X_FH_MobileNetwork.SIM.1.SIMStatus': 'Ready', 'IGD.X_FH_MobileNetwork.SIM.1.IMEI': '860000000000001',
    'IGD.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable': '1',
  });
  const hosts = [
    { child_node_idx: '1', HostName: 'iPhone', DevName: '', MACAddress: 'aa:bb:cc:00:00:01', IPAddress: '192.168.8.10', Active: '1', InternetAccess: '1' },
    { child_node_idx: '2', HostName: 'android-x', DevName: 'جوال ولدي', MACAddress: 'aa:bb:cc:00:00:02', IPAddress: '192.168.8.11', Active: '1', InternetAccess: '1' },
    { child_node_idx: '3', HostName: 'old-tv', DevName: '', MACAddress: 'aa:bb:cc:00:00:03', IPAddress: '0.0.0.0', Active: '0', InternetAccess: '1' },
  ];
  const apns = [
    { child_node_idx: '1', ProfileName: 'default', Enable: '1', AuthenticationType: '0', APN: 'zain', UserName: '' },
  ];
  const sms: Record<string, any> = {
    s1: { session_phone: '700', message_item1: { rcvorsend: 'recv', msg_content: 'رصيدك 20 GB', time: '2026-10-30 21:00', childnode: '4', isOpened: '0' },
      message_item2: { rcvorsend: 'send', msg_content: 'رصيد', time: '2026-10-30 20:59', childnode: '2' } },
  };
  /** عناصر DMZ تحت اتصال الإنترنت الموجّه (dmzSet.js) */
  const DMZ_PATH = 'IGD.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.DMZ';
  const dmzIdx: string[] = [];
  let sid = '';
  let logged = false;
  const seen: string[] = [];
  /** أوامر الكتابة اللي وصلت الراوتر فعلاً (method · dataObj) */
  const writes: { m: string; d: any }[] = [];
  const cells: { act: string; arfcn: string; pci: string }[] = [];
  const aes = (mode: 'enc' | 'dec', key: string, data: string) => {
    const c = mode === 'enc' ? (ncrypto as any).createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV)) : (ncrypto as any).createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV));
    return Buffer.concat([c.update(Buffer.from(data, mode === 'enc' ? 'utf8' : 'hex')), c.final()]).toString(mode === 'enc' ? 'hex' : 'utf8');
  };
  const res = (status: number, text: string, headers: Record<string, string> = {}) =>
    ({ ok: status >= 200 && status < 300, status, url: 'http://192.168.8.1/', headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, text: async () => text } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    seen.push(`${init?.method ?? 'GET'} ${u.pathname}${u.search.replace(/_0\.\d+/, '_R')}`);
    // الفيرموير الجديد يقفل المسارات القديمة (تقرير ٣٠ أكتوبر: is_encrypt ← 403، الدخول ← 304)
    if (u.pathname.startsWith('/api/')) return res(init?.method === 'POST' ? 304 : 403, '');
    if (init?.method !== 'POST') {
      const m = u.searchParams.get('ajaxmethod');
      if (u.pathname === '/fh_api/tmp/FHNCAPIS' && m === 'get_refresh_sessionid') { sid = rand(opts.sidLen ?? 32); return res(200, JSON.stringify({ sessionid: sid }), { 'content-type': 'text/plain; charset=GBK' }); }
      if (u.pathname === '/fh_api/tmp/FHNCAPIS' && m === 'is_encrypt') return res(200, JSON.stringify({ data: encSecret() }), { 'content-type': 'text/plain' });
      if (u.pathname === '/fh_api/tmp/FHAPIS' && m === 'set_developer_mode') return res(200, '{}');
      return res(404, '');
    }
    const key = F.fhapiKey(sid, secret);
    let body: any;
    try { body = JSON.parse(aes('dec', key, String(init.body).slice(6))); } catch { return res(200, '{"error":"decrypt"}'); }
    assert.equal(body.sessionid, sid, 'كل طلب يحمل sessionid الجديد');
    assert.match(String(init.body).slice(0, 6), /^[a-z0-9]{6}$/, 'أول ٦ حروف عشوائية');
    assert.ok(!('X-Requested-With' in (init.headers ?? {})), 'POST مثل الصفحة: بدون X-Requested-With');
    assert.equal(init.headers['Content-Type'], 'application/json; charset=utf-8');
    if (u.pathname === '/fh_api/sign/DO_WEB_LOGIN') {
      logged = body.dataObj.username === 'admin' && body.dataObj.password === (opts.password ?? 'pw');
      return res(200, JSON.stringify({ result: logged ? 0 : 4 }));
    }
    if (u.pathname === '/fh_api/tmp/FHAPIS' && !logged) return res(418, '');
    const m = body.ajaxmethod, d = body.dataObj;
    let out: any = {};
    if (m === 'get_device_info') out = { model_name: 'LG6851F', operator_name: opts.operator ?? 'SA_STC', wifi5: 1, ssid_num: 16 };
    else if (m === 'get_xmlnode_js_file') out = { xml: NODES };
    else if (m === 'get_value_by_xmlnode') for (const [k, p] of Object.entries(d)) out[k] = db[p as string] ?? '';
    else if (m === 'web_get_wifi_possible_channels') out = { channels: d.band === '0' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] : [36, 40, 44, 48, 149, 153, 157, 161] };
    else if (m === 'get_xml_childnode_value' && (d.url === 'IGD.WiFi.SSID.' || d.url === 'IGD.WiFi.AccessPoint.')) {
      const rows = [];
      for (let i = 1; i <= 16; i++) {
        if (!(`IGD.WiFi.SSID.${i}.SSID` in db)) continue;
        const row: any = { child_node_idx: String(i) };
        for (const [k, leaf] of Object.entries(d.node)) row[k] = db[`${d.url}${i}.${leaf}`] ?? '';
        rows.push(row);
      }
      out = { data: rows };
    }
    else if (m === 'get_xml_childnode_value' && d.url === 'IGD.WANDevice.') {
      const dmz = dmzIdx.map(i => ({ child_node_idx: i, Enable: db[`${DMZ_PATH}.${i}.Enable`] ?? '', DMZHostIP: db[`${DMZ_PATH}.${i}.DMZHostIP`] ?? '' }));
      out = { data: [
        { child_node_idx: '1', wanenable: '1', waninterface: 'dev.wwan.1', wanconnection: [
          { child_node_idx: '1', ipoe: [{ child_node_idx: '1', Enable: '1', Name: '1_INTERNET_R_VID_', dmz }, { child_node_idx: '2', Enable: '1', Name: '2_TR069_R_VID_', dmz: [] }], pppoe: [] },
        ] },
        { child_node_idx: '2', wanenable: '0', waninterface: 'dev.eth.4', wanconnection: [] },
      ] };
    }
    else if (m === 'get_xml_childnode_value' && d.url === 'IGD.X_FH.SCCInfo.') {
      assert.equal(d.num, 4, 'SCC: num 4 مثل الصفحة');
      out = { data: [
        { child_node_idx: '1', Type: 'LTE SCC', State: 'activated', Band: 'B1', Pci: '12', Arfcn: '100', DlBandWidth: '15MHz', RSRP: '-101' },
        { child_node_idx: '2', Type: 'LTE SCC', State: 'deactivated', Band: 'B28', Pci: '9', Arfcn: '9410', DlBandWidth: '10MHz', RSRP: '-110' },
        { child_node_idx: '3', Type: '', State: '', Band: '' }, { child_node_idx: '4', Type: '', State: '', Band: '' },
      ] };
    }
    else if (m === 'get_xml_childnode_value' && d.url === 'IGD.LANDevice.1.Hosts.Host.') out = { data: hosts };
    else if (m === 'get_xml_childnode_value' && d.url === 'IGD.X_FH_MobileNetwork.ConfigurationManagement.Management.') {
      assert.ok(!('Password' in d.node), 'ما نقرأ كلمة APN');
      out = { data: apns };
    }
    else if (m === 'get_sms_data') out = sms;
    else if (m === 'get_xml_childnode_value') out = { data: cells.map((c, i) => ({ child_node_idx: String(i + 1), ...c })) };
    else {
      // كتابة — نطبّقها مثل الراوتر (عشان الدرايفر يتأكد بالقراءة بعدها)
      writes.push({ m, d });
      if (m === 'set_value_by_xmlnode') for (const k of Object.keys(d.url)) db[d.url[k]] = String(d.value[k]);
      if (m === 'set_single_by_xmlnode') db[d.url] = String(d.value);
      if (m === 'add_set_xmlnode') cells.push({ ...d.setNode.value });
      if (m === 'del_xmlnode') cells.splice(Number(d.index) - 1, 1);
      out = { success: 'true' };
      if (m === 'add_xmlnode' && d.dmz) { const i = String(dmzIdx.length + 1); dmzIdx.push(i); assert.equal(d.dmz, DMZ_PATH, 'المسار مثل dmzSet.js'); out = { dmz: i }; }
      if (m === 'add_xmlnode' && d.Management) { const i = String(apns.length + 1); apns.push({ child_node_idx: i, ProfileName: '', Enable: '0', AuthenticationType: '0', APN: '', UserName: '' }); out = { Management: i }; }
      // الراوتر يطبّق الكتابة على القوائم (الأجهزة/APN) مثل ما يطبقها على الخانات
      for (const h of hosts) { const v = db[`IGD.LANDevice.1.Hosts.Host.${h.child_node_idx}.InternetAccess`]; if (v !== undefined) h.InternetAccess = v; }
      for (const a of apns) for (const f of ['ProfileName', 'Enable', 'AuthenticationType', 'APN', 'UserName'] as const) {
        const v = db[`IGD.X_FH_MobileNetwork.ConfigurationManagement.Management.${a.child_node_idx}.${f}`]; if (v !== undefined) (a as any)[f] = v;
      }
      if (m === 'send_msg') out = { result: 0 };
    }
    return res(200, rand(6) + aes('enc', key, JSON.stringify(out)));
  };
  return { db, seen, writes, cells, rotateSecret: () => { secret = rand(5); } };
}

async function driver() {
  const { FiberhomeDriver } = require('../src/drivers/fiberhome/index');
  return new FiberhomeDriver();
}
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

test('fhapi: متجهات من كود صفحة الراوتر نفسه — فك GET، السر، المفتاح، الجسم بالبايت، فك الرد', () => {
  const V = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'fhapi-vectors.json'), 'utf8'));
  assert.ok(V.length >= 5);
  for (const v of V) {
    assert.equal(F.fhapiUnmaskGet(v.isEnc.data, v.isEnc.hdr), v.isEncPlain, 'فك is_encrypt');
    assert.equal(F.fhapiSecret(v.isEncPlain).secret, v.secret, 'السر');
    const r = [...v.prefixRnd];
    assert.equal(F.fhapiBody(v.method, v.dataObj, v.sid, v.secret, () => r.shift()), v.pageBody, 'الجسم مطابق لجسم الصفحة بالبايت');
    assert.deepEqual(F.fhapiReply(v.replyText, v.sid, v.secret), v.reply, 'فك الرد');
  }
});

test('fhapi: رد GET مخلوط برأس content-len يتنظف — وبدون الرأس يبقى كما هو', () => {
  for (let i = 0; i < 50; i++) {
    const plain = JSON.stringify({ i, s: rand(20 + i), ar: 'ع' });
    const len = Buffer.from(plain).toString('base64').length;
    const m = mask(plain, i % 20, 1 + (i * 7) % len, 1 + (i * 13) % (len - 1));
    assert.equal(F.fhapiUnmaskGet(m.data, m.hdr), plain);
  }
  assert.equal(F.fhapiUnmaskGet('{"a":1}', null), null);
  assert.equal(F.fhapiUnmaskGet('{"a":1}', '123'), null);
});

test('fhapi: is_encrypt — نقرأ .data مثل الصفحة، وأي شكل ثاني = فاضي (والدرايفر يقول السبب)', () => {
  assert.equal(F.fhapiIsEncryptData({ data: 'abc' }), 'abc');
  assert.equal(F.fhapiIsEncryptData('{"data":"xyz"}'), 'xyz');
  assert.equal(F.fhapiIsEncryptData('garbage'), '');
  assert.equal(F.fhapiIsEncryptData({ enable: 1 }), '');
  assert.equal(F.fhapiSecret('').secret, null);
  assert.equal(F.fhapiSecret('xxxxx0AAAA').secret, null, 'RSA غلط ← null مو استثناء');
});

test('FiberHome v2 (/fh_api/): يتعرف، يدخل، ويقرأ الإشارة — وما يلمس /api/ القديم', async () => {
  const r = router();
  const d = await driver();
  assert.equal(await d.detect('192.168.8.1'), true);
  const m = await d.identify();
  assert.equal(m.label, 'FiberHome LG6851F');
  await d.login('192.168.8.1', '', 'pw');
  const s = await d.getSignal();
  assert.equal(s.network, '5G NSA');
  assert.equal(s.band, 'B3'); assert.equal(s.rsrp, -95); assert.equal(s.pci, '301');
  assert.equal(s.nrBand, 'n78'); assert.equal(s.nrRsrp, -88);
  // على /api/ القديم: فحص التعرّف بس (GET is_encrypt مرة وحدة) — ولا دخول ولا أوامر
  assert.deepEqual(r.seen.filter(x => / \/api\//.test(x)).map(x => x.replace(/&_=0\.\d+/, '')), ['GET /api/tmp/FHNCAPIS?ajaxmethod=is_encrypt']);
  assert.ok(r.seen.includes('POST /fh_api/sign/DO_WEB_LOGIN?_R'), 'الدخول على /fh_api/sign/');
  assert.equal(r.seen.filter(x => /\/fh_api\/.*is_encrypt/.test(x)).length, 1, 'السر ينطلب مرة وحدة');
});

test('FiberHome v2: كلمة مرور غلط ← «كلمة المرور» (result=4 مثل login.js)', async () => {
  router({ password: 'right' });
  const d = await driver();
  await assert.rejects(d.login('192.168.8.1', 'admin', 'wrong'), /كلمة المرور/);
});

test('FiberHome v2: الميزات اللي طابقت صفحة الراوتر (ملف AUTH ٣١ أكتوبر) تنكتب وتتأكد بالقراءة', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  const N = 'IGD.X_FH_MobileNetwork.NetworkSettings.';
  await d.setBand([3, 1]);
  assert.equal(r.db[N + 'LockBandEnable'], '1');
  assert.equal(r.db[N + 'LTELockBAND'], '1,3');
  await d.setNetworkMode('03');
  assert.equal(r.db[N + 'NetworkMode'], '0', '4G فقط = 0 (نفس networkSet.js)');
  await d.lockCell({ tech: 'LTE', pci: '301', arfcn: '1300' });
  assert.deepEqual(r.cells, [{ act: '1', arfcn: '1300', pci: '301' }], 'act 1 = 4G (نفس cellLockSet.js)');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.LockCellList.Enable'], '1');
  await d.unlockCell();
  assert.equal(r.db['IGD.X_FH_MobileNetwork.LockCellList.Enable'], '0');
  await d.setNat('cone');
  assert.equal(r.db['IGD.X_FH_Firewall.NATType'], '2');
  await d.setLed(false);
  assert.equal(r.db['IGD.DeviceInfo.LedSwitch'], '0');
  await d.reboot();
  assert.ok(r.writes.some(w => w.m === 'do_cmd_web' && w.d.key === 'REBOOT_WEB'), 'REBOOT_WEB (نفس reboot.js)');
  // اللقطة والإرجاع (الإنقاذ يعتمد عليها)
  const snap = await d.readLockState();
  await d.setBand([28]);
  await d.restoreLockState(snap);
  assert.equal(r.db[N + 'LTELockBAND'], '1,3', 'رجع للقطة');
});

test('FiberHome v2: الواي فاي بالخانات الجديدة (Radio/SSID/AccessPoint) — وما نلمس WLANConfiguration القديمة', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  const ex = await d.getExtras();
  assert.deepEqual(ex.bands, [{ band: '2.4', on: true }, { band: '5', on: true }]);
  assert.deepEqual((ex.wifiNets ?? []).map((x: any) => [x.index, x.name, x.secured]), [['1', 'FHCPE-24', true], ['9', 'FHCPE-5G', true]]);
  await d.setBandOn('5', false);
  assert.equal(r.db['IGD.WiFi.Radio.2.Enable'], '0', 'Radio.2 = ٥ (wifiBasic_5g.js)');
  await d.setWifiNames([{ index: '1', name: 'Bandly-24' }], 'NewPass123');
  assert.equal(r.db['IGD.WiFi.SSID.1.SSID'], 'Bandly-24');
  assert.equal(r.db['IGD.WiFi.AccessPoint.1.PreSharedKey'], 'NewPass123');
  assert.ok(!r.writes.some(w => JSON.stringify(w.d).includes('WLANConfiguration')), 'ولا كتابة على الخانات القديمة');
  // دمج الشبكتين شغّال ← شبكة الـ٥ الرئيسية مقفولة (نفس الصفحة)
  r.db['IGD.WiFi.X_FH_BandSteering.Enable'] = '1';
  await assert.rejects(d.setWifiNames([{ index: '9', name: 'X' }]), (e: any) => e.noChange === true);
  await assert.rejects(d.setBandOn('2.4', false), (e: any) => e.noChange === true);
});

test('FiberHome v2: DMZ تحت اتصال الإنترنت (dmzSet.js) — إضافة ثم إطفاء، والقراءة في مركز التحكم', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  assert.deepEqual((await d.getExtras()).dmz, { on: false, ip: '' });
  await assert.rejects(d.setDmz(true, '999.1.1.1'), (e: any) => e.noChange === true);
  await d.setDmz(true, '192.168.8.5');
  assert.ok(r.writes.some(w => w.m === 'add_xmlnode'), 'add_xmlnode أول مرة');
  const P = 'IGD.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.DMZ.1.';
  assert.equal(r.db[P + 'Enable'], '1');
  assert.equal(r.db[P + 'DMZHostIP'], '192.168.8.5');
  assert.deepEqual((await d.getExtras()).dmz, { on: true, ip: '192.168.8.5' });
  await d.setDmz(false, '');
  assert.equal(r.db[P + 'Enable'], '0');
  assert.equal(r.writes.filter(w => w.m === 'add_xmlnode').length, 1, 'المرة الثانية تعدّل نفس العنصر');
  assert.ok(!r.writes.some(w => JSON.stringify(w.d).includes('Firewall.DMZ')), 'ولا كتابة على خانة DMZ القديمة');
});

test('FiberHome v2: قناة الواي فاي (wifiAdvanced.js) — القنوات المسموحة من الراوتر وتتغيّر', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  const radios = await d.getWifiRadios();
  assert.deepEqual(radios.map((x: any) => [x.band, x.channel, x.allowed?.length]), [['2.4', '1', 13], ['5', '36', 8]]);
  await d.setWifiChannel('2.4', '6');
  assert.equal(r.db['IGD.WiFi.Radio.1.Channel'], '6');
  await d.setWifiChannel('5', '149');
  assert.equal(r.db['IGD.WiFi.Radio.2.Channel'], '149');
  await assert.rejects(d.setWifiChannel('5', '165'), (e: any) => e.noChange === true, 'قناة مو بالقائمة');
});

test('FiberHome v2: الدمج (carrierAggregation.js) — أساسي 4G + 5G + الثانوي الشغّال بس، والقراءة تطلع فيها', async () => {
  router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  const ca = await d.getCarriers();
  assert.deepEqual(ca.map((c: any) => [c.tech, c.band, c.role, c.pci, c.bandwidth]), [['LTE', 3, 'PCC', '301', 20], ['NR', 78, 'SCC', '77', 100], ['LTE', 1, 'SCC', '12', 15]]);
  const snap = await d.getSnapshot();
  assert.ok(JSON.stringify(snap).includes('"band":78'), 'الـ5G يطلع في اللقطة');
});

test('FiberHome v2: الأجهزة (device.js) — المتصلين بس، والحظر InternetAccess "2" ويتأكد', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  const dev = await d.getDevices();
  assert.deepEqual(dev.map((x: any) => [x.mac, x.name, x.ip]), [['AA:BB:CC:00:00:01', 'iPhone', '192.168.8.10'], ['AA:BB:CC:00:00:02', 'جوال ولدي', '192.168.8.11']]);
  await d.blockDevice('aa:bb:cc:00:00:02', true);
  assert.equal(r.db['IGD.LANDevice.1.Hosts.Host.2.InternetAccess'], '2');
  assert.deepEqual((await d.getBlockedDevices()).map((x: any) => x.mac), ['AA:BB:CC:00:00:02']);
  await d.blockDevice('AA:BB:CC:00:00:02', false);
  assert.equal(r.db['IGD.LANDevice.1.Hosts.Host.2.InternetAccess'], '1');
  await assert.rejects(d.blockDevice('11:22:33:44:55:66', true), (e: any) => e.noChange === true);
});

test('FiberHome v2: الاستهلاك + الرسائل (قراءة/مقروءة/حذف/إرسال بالعربي UCS2)', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  assert.deepEqual(await d.getUsage(), { downloadBytes: 52428800000, uploadBytes: 2147483648 });
  const inbox = await d.listSms('inbox');
  assert.deepEqual(inbox.map((m: any) => [m.index, m.phone, m.unread]), [['recv:4', '700', true]]);
  assert.deepEqual((await d.listSms('sent')).map((m: any) => m.index), ['send:2']);
  await d.markSmsRead('recv:4');
  assert.equal(r.db['IGD.X_FH.SMS.Recv.4.isOpened'], '1');
  await d.deleteSms('recv:4');
  assert.ok(r.writes.some(w => w.m === 'del_xmlnode' && w.d.url === 'IGD.X_FH.SMS.Recv.' && w.d.index === '4'));
  await d.sendSms('700', 'رصيد');
  const sent = r.writes.find(w => w.m === 'send_msg');
  assert.deepEqual(sent?.d, { recv_number: '700', encode_schema: 'GSM_UCS2', content: 'رصيد' });
  await assert.rejects(d.sendSms('abc', 'x'), (e: any) => e.noChange === true);
});

test('FiberHome v2: APN (configManage.js) — الافتراضي ينسخ لملف جديد، والتبديل Enable "1"', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  const ap = await d.getApnProfiles();
  assert.deepEqual(ap.map((a: any) => [a.index, a.apn, a.current, a.readOnly]), [['1', 'zain', true, true]]);
  await d.setApn({ index: '1', name: 'zain-net', apn: 'zain.net', authMode: '0' });
  const M = 'IGD.X_FH_MobileNetwork.ConfigurationManagement.Management.';
  assert.ok(r.writes.some(w => w.m === 'add_xmlnode' && w.d.Management === M), 'الافتراضي ما ينعدّل — ملف جديد');
  assert.equal(r.db[M + '2.APN'], 'zain.net');
  assert.equal(r.db[M + '2.Enable'], '1');
  assert.equal(r.db[M + '1.APN'], undefined, 'الافتراضي ما انلمس');
  await d.selectApn('1');
  assert.equal(r.db[M + '1.Enable'], '1');
});

test('FiberHome v2: DNS (ipv4Settings.js) + الأنتنا (antennaSet.js) + اسم الشركة من الشريحة', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  assert.deepEqual(await d.getDns(), { manual: false });
  await d.setDns({ manual: true, primary: '1.1.1.1', secondary: '8.8.8.8' });
  assert.equal(r.db['IGD.LANDevice.1.LANHostConfigManagement.DNSServers'], '1.1.1.1,8.8.8.8');
  await d.setDns({ manual: false });
  assert.equal(r.db['IGD.LANDevice.1.LANHostConfigManagement.DNSServers'], '192.168.8.1', 'التلقائي = عنوان الراوتر (مثل الصفحة)');
  const a = await d.getAntenna();
  assert.equal(a.mode, 0);
  assert.equal(a.options.length, 4, 'LG6851F: داخلية / خارجية تلقائي / n41 / n78');
  await d.setAntenna(12);
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.AntennaOutterSwitch'], '1');
  assert.equal(r.db['IGD.X_FH_MobileNetwork.NetworkSettings.AntennaOutterType'], '2');
  const det = await d.getDeviceDetails();
  assert.equal(det.operator, 'zain KSA', 'CarrierName بدل كود الفيرموير');
});

test('FiberHome v2: DNS ممنوع لمشغّل ما تسمح صفحته (مثل PLDT) — ما ينرسل شي', async () => {
  const r = router({ operator: 'PLDT' });
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await assert.rejects(d.setDns({ manual: true, primary: '1.1.1.1' }), (e: any) => e.noChange === true);
  assert.deepEqual(r.writes, []);
});

test('FiberHome v2: آي بي جديد — قطع البيانات ورجوعها (networkSet.js) + وضع الطيران ويرجع', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  await d.reconnectData({ holdSecs: 3 });
  const W = 'IGD.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable';
  assert.deepEqual(r.writes.filter(w => w.d.url === W).map(w => w.d.value), ['0', '1']);
  assert.equal(r.db[W], '1');
  await d.reattach(3);
  const A = 'IGD.X_FH_MobileNetwork.NetworkSettings.AirplaneEnable';
  assert.deepEqual(r.writes.filter(w => w.d.url === A).map(w => w.d.value), ['1', '0']);
  r.db[A] = '1';
  await d.wakeRadio();
  assert.equal(r.db[A], '0', 'wakeRadio يطفي الطيران لو علق');
});

test('FiberHome: operator_name كود فيرموير — «COMMON» ما يطلع كاسم شركة (كان «برج COMMON»)، SA_STC ← STC', async () => {
  const { fhOperator } = require('../src/drivers/fiberhome/index');
  assert.equal(fhOperator('COMMON'), undefined);
  assert.equal(fhOperator('SA_STC'), 'STC');
  assert.equal(fhOperator('PH_GLOBE'), 'GLOBE');
  assert.equal(fhOperator(''), undefined);
  router({ operator: 'COMMON' });
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  assert.equal((await d.getNetworkInfo()).operator, undefined);
});

test('FiberHome v2: الراوتر غيّر السر (إعادة تشغيل) ← طلب يفشل برسالة واضحة، واللي بعده يجيب السر الجديد', async () => {
  const r = router();
  const d = await driver();
  await d.login('192.168.8.1', 'admin', 'pw');
  r.rotateSecret();
  await assert.rejects(d.getSignal(), /ما قدرنا نفك|decrypt|رد غير متوقع/);
  const s = await d.getSignal();
  assert.equal(s.rsrp, -95);
  assert.equal(r.seen.filter(x => /\/fh_api\/.*is_encrypt/.test(x)).length, 2, r.seen.join('\n'));
});

test('FiberHome v2: sessionid بأطوال مختلفة (٣٠..٦٤) — الدخول والقراءة شغالة', async () => {
  for (const n of [30, 31, 40, 63, 64]) {
    router({ sidLen: n });
    const d = await driver();
    await d.login('192.168.8.1', 'admin', 'pw');
    assert.equal((await d.getSignal()).rsrp, -95, `طول ${n}`);
  }
});
