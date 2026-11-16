/** عائلة فيرموير JRD/webapi (HH10E) على راوتر محاكى بنفس /jrd/webapi + buildInfo.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jrdScramble } from '../src/drivers/jrd/crypto';

declare const require: any;
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

const BUILDINFO = 'var versionInfo={"project":"HH10E","custom":"E1","buildTime":"2025-01-10","version":"3506469","stringVersion":"f4d1786"}';

function router(opts: { password?: string } = {}) {
  const st: any = {
    token: 'TOK123', posts: [] as string[], connected: true,
    db: {
      status: { NetworkType: 16, ConnectionStatus: 'CONNECTED', NetworkName: 'STC', SignalStrength: 4 },
      net: { RSRP: '-95', RSRQ: '-11', SINR: '14', RSSI: '-65', Band: 'NR BAND 78', CellId: '12345', eNBID: '48', DL_channel: '627264' },
      sys: { SwVersion: 'HH10E_E1_01', IMEI: '860000000000001', HwVersion: 'V1.0' },
      conn: { IPv4Adrress: '10.20.30.40', DlRate: 1500, UlRate: 300, ConnectionTime: 3600, DlBytes: 90000, UlBytes: 12000 },
      devs: [
        { DeviceType: 0, MacAddress: 'ff:ff:ff:00:00:00', DeviceName: 'Router', IpAddress: '192.168.1.1' },
        { DeviceType: 1, MacAddress: 'aa:bb:cc:00:00:09', DeviceName: 'Phone', IpAddress: '192.168.1.100' },
      ],
    },
  };
  const res = (body: unknown) => ({ ok: true, status: 200, url: 'http://192.168.1.1/', headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) } as any);
  const rpc = (result: any) => res({ jsonrpc: '2.0', id: '1.0', result });
  const err = (code: string) => res({ jsonrpc: '2.0', id: '1.0', error: { code, message: 'fail' } });
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.pathname === '/dist/buildInfo.js') return res(BUILDINFO);
    if (u.pathname !== '/jrd/webapi') return res({ ok: false });
    const name = u.searchParams.get('name')!;
    const b = JSON.parse(init.body);
    st.posts.push(name);
    const authed = (init.headers || {})._RequestVerificationToken === jrdScramble(st.token);
    switch (name) {
      // GetSystemStatus/GetSystemInfo مو أوامر الراوتر (دوال SDK) — الراوتر الحقيقي يرفضها
      case 'GetSystemStatus': case 'GetSystemInfo': return err('-32601');
      case 'GetModemStatus': return rpc(st.db.status);
      case 'GetApStatus': return rpc({ curr_num_2g: 1, curr_num_5g: 2, curr_num_lan: 0 });
      case 'GetApSystemInfo': return rpc({ HwVersion: 'HW1' });
      case 'Login': {
        const ok = jrdScramble('admin') === b.params.UserName && jrdScramble(opts.password ?? 'admin') === b.params.Password;
        return ok ? rpc({ token: st.token, remaintime: 300 }) : err('010101');
      }
      case 'Logout': return rpc({});
    }
    if (!authed) return err('010102'); // needLogin
    switch (name) {
      case 'GetNetworkInfo': return rpc(st.db.net);
      case 'GetConnectionState': return rpc(st.db.conn);
      case 'GetConnectedDeviceList': return rpc(st.db.devs);
      case 'GetModemSystemInfo': return rpc(st.db.sys);
      case 'SetDeviceReboot': return rpc({});
      case 'DisConnect': st.connected = false; return rpc({});
      case 'Connect': st.connected = true; return rpc({});
    }
    return err('999');
  };
  return st;
}
const driver = () => { const { JrdDriver } = require('../src/drivers/jrd/index'); return new JrdDriver(); };

test('JRD/HH10E: يتعرّف عليه من buildInfo + /jrd/webapi، ويقرأ الموديل', async () => {
  router();
  const d = driver();
  assert.equal(await d.detect('192.168.1.1'), true);
  assert.match((await d.identify()).label, /HH10E/);
});

test('JRD/HH10E: الدخول بـ scramble، التوكن للترويسة، وقراءة إشارة 5G', async () => {
  const st = router({ password: 'mypass' });
  const d = driver();
  await d.detect('192.168.1.1');
  await assert.rejects(d.login('192.168.1.1', 'admin', 'wrong', { fresh: true }), /غلط/);
  await d.login('192.168.1.1', 'admin', 'mypass', { fresh: true });
  const s = await d.getSignal();
  assert.equal(s.network, '5G');
  assert.equal(s.nrBand, 'N78');
  assert.equal(s.nrRsrp, -95);
  assert.equal(s.sinr, 14);
  assert.equal(s.cellId, '12345');
  const ni = await d.getNetworkInfo();
  assert.equal(ni.operator, 'STC');
  assert.equal(ni.connected, true);
});

test('JRD/HH10E: التفاصيل، الأجهزة (بدون الراوتر نفسه)، وآي بي جديد', async () => {
  const st = router();
  const d = driver();
  await d.detect('192.168.1.1');
  await d.login('192.168.1.1', 'admin', 'admin', { fresh: true });
  const det = await d.getDeviceDetails();
  assert.equal(det.software, 'HH10E_E1_01');
  assert.equal(det.wanIp, '10.20.30.40');
  const devs = await d.getDevices();
  assert.deepEqual(devs.map((x: any) => [x.mac, x.name]), [['AA:BB:CC:00:00:09', 'Phone']]);
  await d.reconnectData({ holdSecs: 2 });
  assert.deepEqual(st.posts.slice(-2), ['DisConnect', 'Connect']);
});

test('JRD/HH10E: ما فيه تثبيت ترددات ولا برج (قراءة بس في المرحلة ١)', () => {
  const d = driver();
  assert.equal(typeof d.setBand, 'undefined');
  assert.equal(typeof d.lockCell, 'undefined');
  assert.deepEqual(d.capabilities.includes('bandLock'), false);
});
