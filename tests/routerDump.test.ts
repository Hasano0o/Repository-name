/**
 * «جهاز جديد» من أول لآخر بملفات ZTE U30 Pro الحقيقية (index.html + main.js) وراوتر محاكى:
 * نتأكد إن الجامع يوصل لـ service.js و config/<DEVICE>/menu وصفحات الشبكة — بدون راوتر حقيقي.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectRouterFiles } from '../src/services/routerDump';

const fx = (f: string) => fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'zte-u30pro', f), 'utf8');

function mockRouter(files: Record<string, string>) {
  const asked: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    const p = url.replace(/^http:\/\/[^/]+/, '').split('?')[0];
    asked.push(p);
    const body = files[p];
    return { ok: body !== undefined, headers: { get: () => 'text/plain' }, text: async () => body ?? '' } as any;
  };
  return asked;
}

test('U30 Pro: الجامع يوصل service.js والقوائم وصفحة الشبكة', async () => {
  const asked = mockRouter({
    '/': fx('index.html'),
    '/js/lib/require/require.js': 'g={waitSeconds:7,baseUrl:"./",paths:{}};',
    '/js/main.js': fx('main.js'),
    '/js/service.js': 'define(["jquery"],function(){/* goformId */})',
    '/js/config/config.js': 'define({DEVICE:"u30pro",PRODUCT_TYPE:"UFI"})',
    '/js/config/u30pro/menu.js': 'define(function(){return [{hash:"#mobile_network",path:"network/net_setting"}]})',
    '/js/config/u30pro/config.js': 'define({})',
    '/js/network/net_setting.js': 'define(["text!tmpl/network/net_setting.html"],function(){})',
    '/tmpl/network/net_setting.html': '<div></div>',
    '/js/util.js': 'define(function(){})',
    '/js/app.js': 'define(function(){})',
  });
  const { files } = await collectRouterFiles('192.168.0.1');
  const got = files.map(f => f.p);
  for (const want of ['/index.html', '/js/main.js', '/js/service.js', '/js/config/config.js', '/js/config/u30pro/menu.js', '/js/network/net_setting.js', '/tmpl/network/net_setting.html', '/js/app.js']) {
    assert.ok(got.includes(want), `ناقص ${want} — طلبنا: ${asked.join(' ')}`);
  }
  // المكتبات المعروفة ما تنطلب
  assert.ok(!asked.some(p => /jquery-3\.6\.1/.test(p)));
});
