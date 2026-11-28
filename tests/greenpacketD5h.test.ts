/**
 * Green Packet D5H (٢٨ نوفمبر): internetinfo يرد 501 و cainfo فاضي — القراءة من لوحة الصفحة نفسها
 * (deviceradioinfo · ltecellinfo · 5gcellinfo) ومنافذ الأنتنا من status/wanstatus (RSRP0/RSRP1).
 * أسماء الحقول من chunk-4326b00c في ملف العضو.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
(globalThis as any).__DEV__ = false;

function router(mode = 'NSA') {
  const ok = (data: unknown) => ({ code: 200, msg: 'success', data });
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, url: 'http://192.168.0.1/', headers: { get: () => null }, text: async () => JSON.stringify(body) } as any);
  const seen: string[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const p = u.pathname.replace('/web/v1', '') + (u.search || '');
    const b = init?.body ? JSON.parse(init.body) : undefined;
    seen.push(p);
    if (p === '/startup/productinfo') return res(200, ok({ ProductType: 3 }));
    if (p === '/user/login') return b.password === 'admin' ? res(200, ok({ Authorization: 't' })) : res(200, { code: 400 });
    if (init?.headers?.authorization !== 't') return res(200, { code: 401 });
    switch (p) {
      case '/dashboard/internetinfo': return res(501, { code: 501, msg: 'Not Implemented' });
      case '/dashboard/radio/cainfo': return res(200, ok({ Items: [] }));
      case '/dashboard/radio/nsacellinfo': return res(200, ok({ PLMN: '42001', TAC: '7', PCI: '311', ECGI: '4200112345' }));
      case '/dashboard/radio/nrcellinfo': return res(200, ok({ NR_PLMN: '42001', NR_TAC: '7', NR_PCI: '502', NCGI: '' }));
      case '/startup/radiocellsinfo': return res(501, { code: 501 });
      case '/dashboard/radio/deviceradioinfo': return res(200, ok({ WorkMode: mode, WANExternalIPAddress: '10.20.30.40', LTEBand: 'B3', NRBand: 'n78' }));
      case '/dashboard/radio/ltecellinfo': return res(200, ok({ RSRP: '-97', RSRQ: '-11', RSSI: '-68', SINR: '12' }));
      case '/dashboard/radio/5gcellinfo': return res(200, ok({ SSB_RSRP: '-89', SSB_RSRQ: '-10', SSB_SINR: '16', NR_RSSI: '-60' }));
      case '/status/wanstatus': return res(200, ok({ ConnectionStatus: { ConnectMode: 'Auto', ConnectStatus: 'Connected', USIMStatus: 'Ready', RSRP0: '-95', RSRP1: '-108', RSRQ: '-11', RSSI: '-68', SINR: '12' }, WanStatus: { IpAddress: '' } }));
      case '/setting/deviceinfo': return res(200, ok({ ProductModel: 'D5H', SoftwareVersion: 'x' }));
      case '/dashboard/waninfo': return res(501, { code: 501 });
    }
    return res(404, { code: 404 });
  };
  return seen;
}
const driver = () => { const { GreenPacketDriver } = require('../src/drivers/greenpacket/index'); return new GreenPacketDriver(); };

test('Green Packet D5H: يقرأ 4G و5G NSA من ltecellinfo/5gcellinfo لما internetinfo يرد 501', async () => {
  router('5G NR NSA');
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  const s = await d.getSignal();
  assert.equal(s.network, '5G NSA');
  assert.equal(s.band, 'B3');
  assert.equal(s.rsrp, -97);
  assert.equal(s.sinr, 12);
  assert.equal(s.rsrq, -11);
  assert.equal(s.pci, '311');
  assert.equal(s.nrBand, 'n78');
  assert.equal(s.nrRsrp, -89);
  assert.equal(s.nrSinr, 16);
  assert.equal(s.nrPci, '502');
  assert.equal(await d.isConnected(), true);
  assert.equal((await d.getNetworkInfo()).connected, true);
  assert.equal((await d.getDeviceDetails()).wanIp, '10.20.30.40');
});

test('Green Packet D5H: وضع LTE ما يطلب 5gcellinfo، و SA ما يطلب ltecellinfo', async () => {
  let seen = router('LTE');
  let d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  let s = await d.getSignal();
  assert.equal(s.network, '4G');
  assert.equal(s.rsrp, -97);
  assert.equal(s.nrRsrp, undefined);
  assert.ok(!seen.includes('/dashboard/radio/5gcellinfo'));

  seen = router('SA');
  d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  s = await d.getSignal();
  assert.equal(s.network, '5G SA');
  assert.equal(s.nrRsrp, -89);
  assert.ok(!seen.includes('/dashboard/radio/ltecellinfo'));
});

test('Green Packet D5H: منافذ الأنتنا RSRP0/RSRP1 من wanstatus', async () => {
  router('LTE');
  const d = driver();
  await d.login('192.168.0.1', 'admin', 'admin');
  const a = await d.getAntennas();
  assert.equal(a.length, 1);
  assert.equal(a[0].tech, 'LTE');
  assert.equal(a[0].band, 3);
  assert.deepEqual(a[0].ports.map((p: any) => [p.idx, p.rsrp]), [[0, -95], [1, -108]]);
});

test('Green Packet: workModeOf يفرّق NSA عن SA', () => {
  const { workModeOf } = require('../src/drivers/greenpacket/parse');
  assert.equal(workModeOf('5G NR NSA'), 'NSA');
  assert.equal(workModeOf('NSA'), 'NSA');
  assert.equal(workModeOf('5G NR SA'), 'SA');
  assert.equal(workModeOf('SA'), 'SA');
  assert.equal(workModeOf('LTE'), 'LTE');
  assert.equal(workModeOf('UNKNOWN'), '');
});
