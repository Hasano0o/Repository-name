/**
 * OpenWrt/LuCI القديم — 5G CPE Pro 7 (موبايلي، ١ نوفمبر ٢٠٢٦): صفحة الدخول 403 بخانتي luci_username/luci_password،
 * الدخول POST لنفس الرابط، والنجاح يحوّل لصفحة الإدارة (;stok=… في بعض النسخ).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LuciDriver } from '../src/drivers/luci';

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
        return res(200, `<html><body class="logged-in"><a href="/cgi-bin/luci/;stok=${stok}/admin/status/overview">Status</a><a href="/cgi-bin/luci/;stok=${stok}/admin/logout">Logout</a></body></html>`, `http://${u.host}/cgi-bin/luci/;stok=${stok}/`);
      }
      return res(403, LOGIN);
    }
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
});
