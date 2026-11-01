/**
 * OpenWrt/LuCI القديم — 5G CPE Pro 7 (موبايلي، ١ نوفمبر ٢٠٢٦): صفحة الدخول 403 بخانتي luci_username/luci_password،
 * الدخول POST لنفس الرابط، والنجاح يحوّل لصفحة الإدارة (;stok=… في بعض النسخ).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LuciDriver } from '../src/drivers/luci';
import { pro7Signal } from '../src/drivers/luci/pro7';

(globalThis as any).__DEV__ = false;
const LOGIN = '<!DOCTYPE html><html><head><title>Pro7</title></head><body><form method="post" action="/cgi-bin/luci"><input type="text" name="luci_username" value="root" /><input type="password" name="luci_password" /></form></body></html>';

function router(stok = 'a1b2c3d4e5f60718') {
  let session = '';
  const asked: string[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    asked.push(`${init?.method ?? 'GET'} ${u.pathname}`);
    const res = (status: number, body: string, finalUrl = url) => ({ ok: status < 400, status, url: finalUrl, headers: { get: () => 'text/html' }, text: async () => body } as any);
    if (u.pathname === '/cgi-bin/luci' && init?.method === 'POST') {
      const b = new URLSearchParams(String(init.body));
      if (b.get('luci_username') === 'admin' && b.get('luci_password') === 'admin') {
        session = stok;
        return res(200, `<html><head><title>Pro7 - System Status</title></head><body class="logged-in"><a href="/cgi-bin/luci/;stok=${stok}/admin/status/overview">Status</a><a href="/cgi-bin/luci/;stok=${stok}/admin/logout">Logout</a></body></html>`, `http://${u.host}/cgi-bin/luci/;stok=${stok}/`);
      }
      return res(403, LOGIN);
    }
    if (u.pathname.endsWith('/admin/status/nr_icons') && session && u.pathname.includes(`;stok=${session}`)) return res(200, '{"mode":"NR5G-NSA","signal":"4","status":"connected","sms_num":"0"}');
    if (u.pathname.startsWith('/cgi-bin/luci')) return session && u.pathname.includes(`;stok=${session}`) ? res(200, '<html><body class="logged-in">ok</body></html>') : res(403, LOGIN);
    if (u.pathname === '/') return res(200, '<meta http-equiv="refresh" content="0; URL=/cgi-bin/luci" />');
    return res(404, '');
  };
  return asked;
}

test('LuCI: يتعرّف من صفحة الدخول (403) ويطلع اسم الجهاز من العنوان', async () => {
  router();
  const d = new LuciDriver();
  assert.equal(await d.detect('192.168.1.1'), true);
  assert.equal(d.name, 'Pro7 (OpenWrt)');
});

test('LuCI: كلمة غلط ← رسالة واضحة · الصحيحة ← stok وصفحات FULL', async () => {
  router();
  const d = new LuciDriver();
  await assert.rejects(d.login('192.168.1.1', 'admin', 'x'), /غلط/);
  await d.login('192.168.1.1', 'admin', 'admin');
  const pages = d.afterLoginPages();
  assert.ok(pages[0].includes(';stok=a1b2c3d4e5f60718'), pages.join(','));
  assert.equal(await d.isConnected(), true);
  assert.equal(d.name, 'Pro7 (OpenWrt)', 'الاسم بدون «- System Status»');
});

test('LuCI Pro7: nr_icons ← نوع الشبكة (5G NSA) بدون أرقام مخترعة', async () => {
  router();
  const d = new LuciDriver();
  await d.login('192.168.1.1', 'admin', 'admin');
  const sig = await d.getSignal();
  assert.equal(sig.network, '5G NSA');
  assert.equal(sig.nrActiveFromStatus, true);
  assert.equal(sig.rsrp, undefined);
  assert.equal((await d.getNetworkInfo()).mode, '5G NSA');
});

test('Pro7 status/nr: NSA ← 4G (B3) + 5G (n78) بالأرقام', () => {
  const sig = pro7Signal({ mode: 'NR5G-NSA', name: 'Mobily', signal: '-88', rsrq: '-11', sinr: '14', PCI: '305', ECGI: '4200301234567', arfcn: '1650', band: 'LTE BAND 3', band_width: '20',
    nsa_band: 'NR5G BAND 78', nsa_pci: '512', nsa_earfcn: '636666', nsa_band_width: '100', nsa_rsrp: '-95 dBm', nsa_rsrq: '-12', nsa_sinr: '9' });
  assert.equal(sig.network, '5G NSA');
  assert.equal(sig.band, 'B3'); assert.equal(sig.rsrp, -88); assert.equal(sig.sinr, 14); assert.equal(sig.pci, '305'); assert.equal(sig.dlBandwidth, '20');
  assert.equal(sig.nrBand, 'n78'); assert.equal(sig.nrRsrp, -95); assert.equal(sig.nrPci, '512'); assert.equal(sig.nrDlBandwidth, '100');
});

test('Pro7 status/nr: SA ← أرقام 5G بس · قيم فاضية/غلط تنشال', () => {
  const sig = pro7Signal({ mode: 'NR5G-SA', signal: '-101', sinr: '7', rsrq: '-13', band: '78', sa_pci: '77', arfcn: '627264', band_width: '100' });
  assert.equal(sig.network, '5G SA');
  assert.equal(sig.nrBand, 'n78'); assert.equal(sig.nrRsrp, -101); assert.equal(sig.nrPci, '77'); assert.equal(sig.rsrp, undefined);
  const bad = pro7Signal({ mode: 'LTE', signal: '-', sinr: '999', PCI: '-', band: '' });
  assert.equal(bad.network, '4G'); assert.equal(bad.rsrp, undefined); assert.equal(bad.sinr, undefined); assert.equal(bad.pci, undefined); assert.equal(bad.band, undefined);
});

test('LuCI Pro7: getSignal يقرأ admin/status/nr?status=1', async () => {
  const asked = router();
  const real = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/admin/status/nr') && u.search.includes('status=1')) return { ok: true, status: 200, url, headers: { get: () => 'application/json' }, text: async () => '{"mode":"LTE","signal":"-79","sinr":"18","rsrq":"-9","PCI":"101","band":"3"}' } as any;
    return real(url, init);
  };
  const d = new LuciDriver();
  await d.login('192.168.1.1', 'admin', 'admin');
  const sig = await d.getSignal();
  assert.equal(sig.rsrp, -79); assert.equal(sig.band, 'B3'); assert.equal(sig.network, '4G');
  void asked;
});
