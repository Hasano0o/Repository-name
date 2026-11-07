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
  assert.deepEqual(wisNeighbours({ neighb_num: '2', neighbour1: '636666,301,-90', neighbour2: '-1,-1' }), [{ arfcn: '636666', pci: '301', rsrp: -90, rsrq: undefined, nr: true }]);
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

// ═══ FULL ٧ نوفمبر ٦:١٤ م (RG520N-EB، stc) — القراءة الحقيقية والكتابة من كود admin/lte/network ═══
const REAL = { rsrp: '-59', neighbour3: '500,7,-70,-18,-,-43', rssi: '31', cellid: '56', arfcn: '643296', neighb_num: '3', band: 'LTE BAND 1/NR5G BAND 78', sys_mode: '4G/5G', sinr: '25', phys_cellid: '56', operator: 'stc ksa', neighbour2: '500,212,-72,-18,-,-43', neighbour1: '500,283,-61,-10,-,-29', dial_ip: '10.245.89.29', modem: 'RG520N-EB', rsrq: '-10' };

test('القراءة الحقيقية: «4G/5G» = NSA · القراءة على 5G (القناة NR) · المجاورة 4G بأرقامها', () => {
  const s = wisSignal(REAL);
  assert.equal(s.network, '5G NSA');
  assert.equal(s.nrBand, 'n78'); assert.equal(s.nrRsrp, -59); assert.equal(s.nrSinr, 25); assert.equal(s.nrArfcn, '643296');
  assert.equal(s.rsrp, undefined, 'ما نلصق أرقام 5G على مرساة 4G');
  const nb = wisNeighbours(REAL);
  assert.equal(nb.length, 3);
  assert.deepEqual(nb[0], { arfcn: '500', pci: '283', rsrp: -61, rsrq: -10, nr: false });
});

function wisRouter(cfg: Record<string, unknown>) {
  const asked: string[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname);
    asked.push(`${init?.method ?? 'GET'} ${p}${u.search}`);
    const res = (status: number, body: string, finalUrl = url) => ({ ok: status < 400, status, url: finalUrl, headers: { get: () => 'text/html' }, text: async () => body } as any);
    if (u.pathname === '/cgi-bin/luci' && init?.method === 'POST') return res(200, STATUS, `http://${u.host}/cgi-bin/luci/;stok=a1b2c3d4e5f60718`);
    const root = '/cgi-bin/luci/;stok=a1b2c3d4e5f60718';
    if (p === root && u.search === '?status=1') return res(200, JSON.stringify({ lte_info: REAL, lte_config: cfg }));
    let m = p.match(/\/admin\/lte\/band_lock_action\/0\/(\[[^\]]*\])\/(\[[^\]]*\])$/);
    if (m) { cfg.net_band = JSON.parse(m[1]); cfg.net_5g_band = JSON.parse(m[2]); return res(200, ''); }
    m = p.match(/\/admin\/lte\/network_config_save\/0\/(\{.*\})$/);
    if (m) { const j = JSON.parse(m[1]); if (typeof j.enable !== 'number' || typeof j.slot !== 'number') return res(400, ''); cfg.net_mode = j.net_mode; return res(200, ''); }
    return res(404, 'not found');
  };
  return asked;
}

const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

test('WIS الترددات: الإعداد الحالي (B1 · n41/77/78) ← تثبيت B3 مع نفس 5G ← band_lock_action ونتأكد بالقراءة', async () => {
  const cfg: Record<string, unknown> = { slot: 1, enable: '1', net_monitor: '1', nat_type: '0', net_5g_band: ['41', '77', '78'], net_mode: 'Auto', net_band: ['1'] };
  const asked = wisRouter(cfg);
  const d = new LuciDriver();
  await d.login('192.168.225.1', 'admin', 'admin');
  const bc = await d.getBandConfig();
  assert.deepEqual(bc.locked, [1]); assert.deepEqual(bc.nrLocked, [41, 77, 78]); assert.equal(bc.mode, 'Auto');
  const snap = await d.readLockState();
  await d.setBand([3], undefined);
  assert.deepEqual(cfg.net_band, ['3']); assert.deepEqual(cfg.net_5g_band, ['41', '77', '78'], '5G ما تغيّر');
  assert.ok(asked.some(a => a.includes('/admin/lte/band_lock_action/0/["3"]/["41","77","78"]')), asked.join(' | '));
  // «تلقائي» = كل المربعات
  await d.setBand([], []);
  assert.equal((cfg.net_band as string[]).length, 14);
  assert.deepEqual((await d.getBandConfig()).locked, []);
  // الإرجاع للقطة
  await d.restoreLockState(snap);
  assert.deepEqual(cfg.net_band, ['1']); assert.deepEqual(cfg.net_5g_band, ['41', '77', '78']);
});

test('WIS وضع الشبكة: network_config_save بالأرقام كـ int · تردد مو بالقائمة ← noChange بدون إرسال', async () => {
  const cfg: Record<string, unknown> = { slot: 1, enable: '1', net_monitor: '1', nat_type: '0', net_5g_band: ['78'], net_mode: 'Auto', net_band: ['1'] };
  const asked = wisRouter(cfg);
  const d = new LuciDriver();
  await d.login('192.168.225.1', 'admin', 'admin');
  await d.setNetworkMode('4G');
  assert.equal(cfg.net_mode, '4G');
  const n = asked.length;
  await assert.rejects(d.setBand([66], undefined), (e: any) => /B66/.test(e.message));
  assert.ok(!asked.slice(n).some(a => a.includes('band_lock_action')));
  await assert.rejects(d.lockCell({ tech: 'NR', pci: '56', arfcn: '643296', band: 78 } as any), (e: any) => /ما فتحناه/.test(e.message));
});
