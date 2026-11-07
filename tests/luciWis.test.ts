/**
 * LuCI ثيم «superos» (WIS) — صحن 5G خارجي «5G Feedhorn» (192.168.225.1، ملف FULL عضو ٧ نوفمبر):
 * Pro7 كان يطلب admin/status/nr و admin/modem/* ← 404 كلها. صفحتهم الرئيسية: XHR.poll(<root>, {status:1}) ← lte_info.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LuciDriver } from '../src/drivers/luci';
import { isWisPage, wisSignal, wisNeighbours, wisIs5g } from '../src/drivers/luci/wis';

declare const require: any;
declare const process: any;
(globalThis as any).__DEV__ = false;
const fs = require('fs');
const path = require('path');
const STATUS = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/luci/wis-status.html'), 'utf8').replace(/STOKSTOKSTOKSTOKSTOKSTOKSTOKSTOK/g, 'a1b2c3d4e5f60718');
const LOGIN = '<html><body><form method="post"><input name="luci_username"/><input type="password" name="luci_password"/></form></body></html>';

test('صفحة superos الحقيقية تنعرف (مو Pro7)', () => {
  assert.equal(isWisPage(STATUS), true);
  assert.equal(isWisPage('<html>luci-static/bigtmt/ nr_icons</html>'), false);
});

test('wisSignal: 5G SA و 4G و «255» = ما فيه SINR و «-1» = ما فيه برج', () => {
  const s5 = wisSignal({ sys_mode: 'NR5G-SA', band: '78', arfcn: '636666', rsrp: '-88', rsrq: '-11', sinr: '17', cellid: 'A1B2C3', phys_cellid: '301' });
  assert.equal(s5.network, '5G SA'); assert.equal(s5.nrBand, 'n78'); assert.equal(s5.nrRsrp, -88); assert.equal(s5.nrSinr, 17); assert.equal(s5.nrPci, '301');
  const s4 = wisSignal({ sys_mode: 'LTE', band: 'B3', arfcn: '1300', rsrp: '-97 dBm', rsrq: '-12', sinr: '255', cellid: '-1', phys_cellid: '12' });
  assert.equal(s4.network, '4G'); assert.equal(s4.band, 'B3'); assert.equal(s4.rsrp, -97); assert.equal(s4.sinr, undefined); assert.equal(s4.cellId, undefined);
  assert.equal(wisIs5g({ band: '78', arfcn: '636666' }), true, 'بدون sys_mode: القناة فوق ١٠٠ ألف = 5G');
  assert.deepEqual(wisNeighbours({ neighb_num: '2', neighbour1: '636666,301,-90', neighbour2: '-1,-1' }), [{ arfcn: '636666', pci: '301' }]);
});

test('الدرايفر: بعد الدخول على superos ← الإشارة من <root>?status=1 (مو admin/status/nr)', async () => {
  const asked: string[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    asked.push(`${init?.method ?? 'GET'} ${u.pathname}${u.search}`);
    const res = (status: number, body: string, finalUrl = url) => ({ ok: status < 400, status, url: finalUrl, headers: { get: () => 'text/html' }, text: async () => body } as any);
    if (u.pathname === '/cgi-bin/luci' && init?.method === 'POST') return res(200, STATUS, `http://${u.host}/cgi-bin/luci/;stok=a1b2c3d4e5f60718`);
    if (u.pathname === '/cgi-bin/luci/;stok=a1b2c3d4e5f60718' && u.search === '?status=1') {
      return res(200, JSON.stringify({ uptime: 100, lte_info: { sys_mode: 'NR5G-SA', band: '78', arfcn: '636666', rsrp: '-88', rsrq: '-11', sinr: '17', cellid: 'A1B2C3', phys_cellid: '301', dial_ip: '10.1.2.3', neighb_num: '1', neighbour1: '636666,302' } }));
    }
    if (u.pathname.startsWith('/cgi-bin/luci')) return res(404, 'not found');
    return res(200, LOGIN);
  };
  const d = new LuciDriver();
  await d.login('192.168.225.1', 'admin', 'admin');
  assert.equal(d.name, 'WIS 5G CPE (OpenWrt)');
  const sig = await d.getSignal();
  assert.equal(sig.nrRsrp, -88);
  assert.ok(!asked.some(a => a.includes('/admin/status/nr')), asked.join(' | '));
  const cells = await d.getCells();
  assert.equal(cells.filter(c => c.kind === 'neighbor').length, 1);
  assert.ok(d.afterLoginPages().some(p => p.endsWith('/admin/lte/network')));
  assert.equal((await d.getNetworkInfo()).connected, true);
});
