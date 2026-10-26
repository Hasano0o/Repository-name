/**
 * درايفر Green Packet 5G CPE على راوتر محاكى بنفس واجهة الصفحة (/web/v1 JSON، {code,data}، رأس authorization).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

function router(opts: { password?: string; ignoreWrites?: boolean } = {}) {
  const st: any = {
    token: 'tok-123', locked: [] as any[], nextIdx: 1, mode: 'NR5G-SA/NR5G-NSA/LTE', cellCfg: 'AutoSelect', pref: [] as any[], nextPref: 1,
    macMode: 'disable', black: [] as any[], dmz: { DmzEnableStatus: false, ExcludePingService: false, ExcludeTelnetSSHPort: false, ExcludeWebServerPort: true, DmzHostIpAddress: '' },
    upnp: { ForwardItems: [], UPnPServiceEnable: false, UPnPNotifyInternal: 30 },
    ap: [
      { WlanStatus: 'Enable', Ssid: 'Zain_E5_5C51D', CountryCode: 'SA', Mode: '11ax', ChannelBandwidth: '40MHz', ChannelMode: 'Auto', Channel: '6', TxPower: '100', MaxUsers: '32', Band: '2.4G', IndexId: '1' },
      { WlanStatus: 'Enable', Ssid: 'Zain_E5_5C51D_5G', CountryCode: 'SA', Mode: '11ax', ChannelBandwidth: '80MHz', ChannelMode: 'Auto', Channel: '36', TxPower: '100', MaxUsers: '32', Band: '5G', IndexId: '2' },
    ],
    sec: { IsSingleSsid: 0, Items: [
      { Band: '2.4G', Ssid: 'Zain_E5_5C51D', SecurityMode: 'WPA2-PSK', WPACipher: 'AES', PSKKey: '12345678' },
      { Band: '5G', Ssid: 'Zain_E5_5C51D_5G', SecurityMode: 'WPA2-PSK', WPACipher: 'AES', PSKKey: '12345678' },
    ] },
    sms: [{ SmsId: 5, number: '959', content: 'رصيدك 30 GB', smsdate: '2026-10-26', smstime: '20:10:00', Readed: false }],
    sent: [] as any[], cmds: [] as string[], posts: [] as string[],
  };
  const ok = (data: unknown) => ({ code: 200, msg: 'success', data });
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, url: 'http://192.168.0.1/', headers: { get: () => null }, text: async () => JSON.stringify(body) } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const p = u.pathname.replace('/web/v1', '') + (u.search || '');
    const m = (init?.method ?? 'GET').toUpperCase();
    const b = init?.body ? JSON.parse(init.body) : undefined;
    if (p === '/startup/productinfo') return res(200, ok({ ProductType: 3 }));
    if (p === '/user/login') {
      if (b.username === 'admin' && b.password === (opts.password ?? 'admin')) return res(200, ok({ Authorization: st.token, userrole: 'admin', FirstLogin: 0 }));
      return res(200, { code: 400, msg: 'error' });
    }
    if (init?.headers?.authorization !== st.token) return res(200, { code: 401, msg: 'unauthorized' });
    if (m !== 'GET') st.posts.push(`${m} ${p}`);
    const W = (fn: () => void) => { if (!opts.ignoreWrites) fn(); return res(200, ok({})); };
    switch (`${m} ${p}`) {
      case 'GET /dashboard/internetinfo': return res(200, ok({ Status: 'Connected', WorkMode: 'NSA', Operator: 'Zain SA' }));
      case 'GET /dashboard/radio/cainfo': return res(200, ok({ Items: [{ CACells: [
        { Index: 0, Type: 'PCC', Band: 'B3', ARFCN: '1300', FrequencyBandwidth: '1815/20', PCI: '214', RSSI: '-70', RSRP: '-95', RSRQ: '-11', CINR: '14' },
        { Index: 1, Type: 'SCC', Band: 'B1', ARFCN: '100', FrequencyBandwidth: '2140/15', PCI: '214', RSSI: '-75', RSRP: '-101', RSRQ: '-12', CINR: '9' },
        { Index: 2, Type: 'NR PCC', Band: 'n78', ARFCN: '636666', FrequencyBandwidth: '3550/100', PCI: '41', RSSI: '-65', RSRP: '-88', RSRQ: '-10', CINR: '18' },
      ] }] }));
      case 'GET /dashboard/radio/nsacellinfo': return res(200, ok({ PLMN: '42004', TAC: '1', PCI: 'B3(PCI:214)', ECGI: '420040123456' }));
      case 'GET /dashboard/radio/nrcellinfo': return res(200, ok({ NR_PLMN: '42004', NR_TAC: '1', NR_PCI: '41', NCGI: '' }));
      case 'GET /startup/radiocellsinfo': return res(200, ok({ Items: [{ WorkMode: 'LTE', SINR: '14', RSRP: '-95' }, { WorkMode: 'NR', SINR: '18', RSRP: '-88' }] }));
      case 'GET /setting/network/cellselect/sortedcelllist': return res(200, ok({ Items: [{ NetworkMode: '4G', BandId: '3', Earfcn: '1300', PCI: '99', RSRP: '-110' }] }));
      case 'GET /setting/deviceinfo': return res(200, ok({ ProductModel: 'E5-250MK', SoftwareVersion: 'E5_1.2.3', HardwareVersion: 'V1', IMEI: 'x' }));
      case 'GET /dashboard/waninfo': return res(200, ok({ IpAddress: '10.5.6.7' }));
      case 'GET /setting/network/ltenetworkband?Mode=4G': return res(200, ok({ Items: ['1', '3', '8', '28', '40'] }));
      case 'GET /setting/network/ltenetworkband?Mode=5G': return res(200, ok({ Items: ['1', '28', '78'] }));
      case 'GET /setting/network/ltediscretebandsetting': return res(200, ok({ Items: st.locked }));
      case 'POST /setting/network/ltediscretebandsetting': return W(() => {
        for (const it of b.Items) {
          assert.ok(['insert', 'delete', 'none'].includes(it.OperateType));
          if (it.OperateType === 'insert') st.locked.push({ IndexId: String(st.nextIdx++), NetworkMode: it.NetworkMode, BandId: it.BandId, StartFreq: '', EndFreq: '', StartEarfcn: '', EndEarfcn: '', OperateType: 'none' });
          if (it.OperateType === 'delete') st.locked = st.locked.filter((x: any) => !(x.NetworkMode === it.NetworkMode && x.BandId === it.BandId));
        }
      });
      case 'GET /setting/network/wirelessnetworksetting/preferredmode': return res(200, ok({ Items: ['NR5G-SA/NR5G-NSA/LTE', 'NR5G-SA', 'NR5G-NSA', 'LTE'] }));
      case 'GET /setting/network/wirelessnetworksetting/workmode': return res(200, ok({ PreferredMode: st.mode, Extra: 'x' }));
      case 'POST /setting/network/wirelessnetworksetting/workmode': assert.equal(b.Extra, 'x'); return W(() => { st.mode = b.PreferredMode; });
      case 'GET /setting/network/cellselect/config': return res(200, ok({ Config: st.cellCfg }));
      case 'POST /setting/network/cellselect/config': return W(() => { st.cellCfg = b.Config; });
      case 'GET /setting/network/cellselect/preferredlist': return res(200, ok({ Items: st.pref }));
      case 'POST /setting/network/cellselect/preferredlist': return W(() => { for (const it of b.Items) st.pref.push({ ...it, IndexId: String(st.nextPref++), OperateType: 'none' }); });
      case 'DELETE /setting/network/cellselect/preferredlist': return W(() => { st.pref = st.pref.filter((x: any) => !b.Items.some((y: any) => y.IndexId === x.IndexId)); });
      case 'POST /setting/system/maintenance/reboot': st.cmds.push('reboot'); return res(200, ok({}));
      case 'POST /setting/system/maintenance/factoryreset': st.cmds.push('reset'); return res(200, ok({}));
      case 'GET /setting/host/hostsinfo': return res(200, ok({ OnlineItems: [{ HostName: 'PS5', MacAddress: 'aa:bb:cc:00:00:01', IpAddress: '192.168.0.20' }], OfflineItems: [] }));
      case 'GET /setting/wifi/macfilterconfig': return res(200, ok({ Settings: st.macMode }));
      case 'POST /setting/wifi/macfilterconfig': return W(() => { st.macMode = b.Settings; });
      case 'GET /setting/wifi/macfilteraccesslist?Mode=blacklist': return res(200, ok({ AccessList: st.black }));
      case 'POST /setting/wifi/macfilteraccesslist': return W(() => { assert.equal(b.Mode, 'blacklist'); for (const x of b.AccessList) st.black.push({ IndexId: String(st.black.length + 1), MacAddress: x.MacAddress, HostName: x.HostName }); });
      case 'DELETE /setting/wifi/macfilteraccesslist': return W(() => { st.black = st.black.filter((x: any) => !b.AccessList.some((y: any) => y.IndexId === x.IndexId)); });
      case 'GET /sms/inbox?StartPos=0&ReadNum=20': return res(200, ok({ ItemList: st.sms }));
      case 'GET /sms/outbox?StartPos=0&ReadNum=20': return res(200, ok({ ItemList: [] }));
      case 'POST /sms/inbox': return W(() => { st.sms.find((x: any) => x.SmsId === b.SmsId).Readed = b.Readed; });
      case 'DELETE /sms/inboxbatchsms': return W(() => { st.sms = st.sms.filter((x: any) => !b.SmsIds.includes(x.SmsId)); });
      case 'POST /sms/newmsg': return W(() => { st.sent.push(b); });
      case 'GET /setting/firewall/dmzsetting': return res(200, ok(st.dmz));
      case 'POST /setting/firewall/dmzsetting': return W(() => { st.dmz = b; });
      case 'GET /setting/firewall/upnpsetting': return res(200, ok(st.upnp));
      case 'POST /setting/firewall/upnpsetting': return W(() => { st.upnp = b; });
      case 'GET /setting/wifi/wlanapsetting': return res(200, ok({ Settings: JSON.parse(JSON.stringify(st.ap)) }));
      case 'POST /setting/wifi/wlanapsetting': return W(() => { for (const x of b.Settings) { const i = st.ap.findIndex((y: any) => y.IndexId === x.IndexId); st.ap[i] = x; } });
      case 'GET /setting/wifi/wlanapsettingpara': return res(200, ok({ Items: [{ Band: '2.4G', Channels: ['1', '6', '11'] }, { Band: '5G', Channels: ['36', '149'] }] }));
      case 'GET /setting/wifi/wlanapsecurity': return res(200, ok(JSON.parse(JSON.stringify(st.sec))));
      case 'POST /setting/wifi/wlanapsecurity': return W(() => { st.sec = b; });
      case 'POST /user/logout': return res(200, ok({}));
    }
    return res(200, { code: 404, msg: 'no such ' + m + ' ' + p });
  };
  return st;
}
const driver = () => { const { GreenPacketDriver } = require('../src/drivers/greenpacket/index'); return new GreenPacketDriver(); };

test('Green Packet: يتعرف، يدخل (admin/admin)، ويقرأ 4G + 5G NSA والدمج والجيران', async () => {
  router();
  const d = driver();
  assert.equal(await d.detect('192.168.0.1'), true);
  await d.login('192.168.0.1', '', 'admin');
  const s = await d.getSignal();
  assert.equal(s.network, '5G NSA');
  assert.equal(s.band, 'B3'); assert.equal(s.pci, '214'); assert.equal(s.earfcn, '1300'); assert.equal(s.rsrp, -95); assert.equal(s.sinr, 14);
  assert.equal(s.nrBand, 'n78'); assert.equal(s.nrPci, '41'); assert.equal(s.nrRsrp, -88); assert.equal(s.nrSinr, 18);
  assert.equal(s.caCount, 3); assert.equal(s.caBandwidthMhz, 135);
  const ca = await d.getCarriers();
  assert.deepEqual(ca.map((c: any) => [c.tech, c.band, c.role]), [['LTE', 3, 'PCC'], ['LTE', 1, 'SCC'], ['NR', 78, 'PCC']]);
  const cells = await d.getCells();
  assert.ok(cells.some((c: any) => c.kind === 'neighbor' && c.pci === '99'));
  const det = await d.getDeviceDetails();
  assert.equal(det.model, 'E5-250MK'); assert.equal(det.wanIp, '10.5.6.7');
});

test('Green Packet: كلمة مرور غلط ← رسالة فيها الافتراضي', async () => {
  router({ password: 'secret' });
  await assert.rejects(driver().login('192.168.0.1', 'admin', 'admin'), /غلط/);
});

test('Green Packet: تثبيت ترددات 4G و5G مثل صفحة LookBand، والتحقق، وفك التثبيت', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  const c0 = await d.getBandConfig();
  assert.deepEqual(c0.supported, [1, 3, 8, 28, 40]); assert.deepEqual(c0.nrSupported, [1, 28, 78]);
  assert.deepEqual(c0.locked, []); assert.equal(c0.mode, '00');
  await d.setBand([3, 1], [78]);
  assert.deepEqual(st.locked.map((x: any) => x.NetworkMode + x.BandId).sort(), ['4G1', '4G3', '5G78']);
  await d.setBand([3], undefined);
  assert.deepEqual(st.locked.map((x: any) => x.NetworkMode + x.BandId).sort(), ['4G3', '5G78']);
  await d.setBand('keep', []);
  assert.deepEqual(st.locked.map((x: any) => x.NetworkMode + x.BandId), ['4G3']);
  await d.setBand([], []);
  assert.equal(st.locked.length, 0);
  const n = st.posts.length;
  await assert.rejects(d.setBand([66]), (e: any) => e.noChange === true);
  assert.equal(st.posts.length, n);
});

test('Green Packet: الراوتر يقول نجح وما تغيّر ← نقول الحقيقة', async () => {
  router({ ignoreWrites: true });
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  await assert.rejects(d.setBand([3]), /القراءة بعده مختلفة/);
});

test('Green Packet: وضع الشبكة من قائمة الراوتر (4G فقط / SA فقط) — والإعدادات الثانية ترجع مثل ما هي', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  const c = await d.getBandConfig();
  assert.deepEqual(c.modes.map((m: any) => m.value), ['00', '08', 'nsa', '03']);
  await d.setNetworkMode('03'); assert.equal(st.mode, 'LTE');
  await d.setNetworkMode('08'); assert.equal(st.mode, 'NR5G-SA');
});

test('Green Packet: تثبيت البرج (Preferred Listing) وفكه — ولقطة ← تغييرات ← إرجاع بالضبط', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  const snap = await d.readLockState();
  await d.lockCell({ tech: 'LTE', pci: '214', arfcn: '1300', band: 3 });
  assert.equal(st.cellCfg, 'PreferredListing');
  assert.deepEqual(st.pref.map((x: any) => [x.NetworkMode, x.BandId, x.Earfcn, x.PCI]), [['4G', '3', '1300', '214']]);
  assert.equal((await d.getCellLock()).pci, '214');
  await d.setBand([3], [78]);
  await d.setNetworkMode('03');
  await d.restoreLockState(snap);
  assert.equal(st.locked.length, 0); assert.equal(st.mode, 'NR5G-SA/NR5G-NSA/LTE');
  assert.equal(st.cellCfg, 'AutoSelect'); assert.equal(st.pref.length, 0);
  const n = st.posts.length;
  await assert.rejects(d.lockCell({ tech: 'LTE', pci: '214' }), (e: any) => e.noChange === true);
  assert.equal(st.posts.length, n);
});

test('Green Packet: الأجهزة والحظر بفلتر الواي فاي، والرسائل، وإعادة التشغيل', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  assert.deepEqual((await d.getDevices()).map((x: any) => [x.mac, x.name, x.blocked]), [['AA:BB:CC:00:00:01', 'PS5', false]]);
  await d.blockDevice('aa:bb:cc:00:00:01', true, 'PS5');
  assert.equal(st.macMode, 'blacklist'); assert.equal(st.black.length, 1);
  assert.equal((await d.getDevices())[0].blocked, true);
  await d.blockDevice('AA:BB:CC:00:00:01', false);
  assert.equal(st.black.length, 0);
  const inbox = await d.listSms('inbox');
  assert.deepEqual(inbox.map((m: any) => [m.phone, m.content, m.unread]), [['959', 'رصيدك 30 GB', true]]);
  await d.markSmsRead(inbox[0].index); assert.equal(st.sms[0].Readed, true);
  await d.sendSms('959', 'رصيد'); assert.equal(st.sent[0].Recipient, '959'); assert.equal(st.sent[0].Content, 'رصيد');
  await d.deleteSms(inbox[0].index); assert.equal(st.sms.length, 0);
  await d.reboot(); await d.factoryReset();
  assert.deepEqual(st.cmds, ['reboot', 'reset']);
});

test('Green Packet مركز التحكم: DMZ، UPnP، إطفاء 5G، الاسم والكلمة (كلمة الواي فاي ما تطلع للشاشة)، والقناة', async () => {
  const st = router();
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  const ex = await d.getExtras();
  assert.deepEqual(ex.dmz, { on: false, ip: '' }); assert.equal(ex.upnp, false);
  assert.deepEqual(ex.bands, [{ band: '2.4', on: true }, { band: '5', on: true }]);
  assert.deepEqual(ex.wifiNets.map((n: any) => n.name), ['Zain_E5_5C51D', 'Zain_E5_5C51D_5G']);
  assert.ok(!JSON.stringify(ex).includes('12345678'));
  await d.setDmz(true, '192.168.0.20'); assert.equal(st.dmz.DmzEnableStatus, true); assert.equal(st.dmz.ExcludeWebServerPort, true);
  await d.setUpnp(true); assert.equal(st.upnp.UPnPServiceEnable, true); assert.equal(st.upnp.UPnPNotifyInternal, '30');
  await d.setBandOn('5', false); assert.equal(st.ap[1].WlanStatus, ''); assert.equal(st.ap[0].WlanStatus, 'Enable');
  await d.setWifiNames([{ index: '0', name: 'Bandly' }, { index: '1', name: 'Bandly_5G' }], 'NewPass99');
  assert.equal(st.sec.Items[0].Ssid, 'Bandly'); assert.equal(st.sec.Items[1].PSKKey, 'NewPass99');
  const n = st.posts.length;
  await assert.rejects(d.setWifiNames([{ index: '0', name: 'x' }], 'has space1'), (e: any) => e.noChange === true);
  assert.equal(st.posts.length, n);
  const r = await d.getWifiRadios();
  assert.deepEqual(r.map((x: any) => [x.band, x.channel]), [['2.4', '0'], ['5', '0']]);
  await d.setWifiChannel('2.4', '11');
  assert.equal(st.ap[0].ChannelMode, 'Manual'); assert.equal(st.ap[0].Channel, '11');
});
