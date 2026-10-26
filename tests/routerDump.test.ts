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

import { sendRouterFiles, utf8Len, cleanText, splitBytes } from '../src/services/routerDump';

test('الدفعات بالبايت: العربي يحسب ٢ بايت، والتقسيم ما يقص رمز', () => {
  assert.equal(utf8Len('abc'), 3);
  assert.equal(utf8Len('شرورة'), 10);
  assert.equal(utf8Len('😀'), 4);
  const parts = splitBytes('😀'.repeat(10), 9);
  assert.ok(parts.every(p => utf8Len(p) <= 9));
  assert.equal(parts.join(''), '😀'.repeat(10));
});

test('التنظيف: نص رمز يتيم وحروف تحكم ما تخرّب الطلب', () => {
  assert.equal(cleanText('a\ud800b'), 'a�b');
  assert.equal(cleanText('a\udc00b'), 'a�b');
  assert.equal(cleanText('😀'), '😀');
  assert.equal(cleanText('a\u0000b\tc\nd'), 'ab\tc\nd');
});

test('الإرسال: دفعة تنرفض ← نرسل ملفاتها واحد واحد، والخربان بس يضيع، و«done» تنرسل دايماً', async () => {
  const got: any[] = [];
  (globalThis as any).fetch = async (_u: string, init: any) => {
    const b = JSON.parse(init.body);
    got.push(b);
    const bad = (b.files ?? []).some((f: any) => f.p === '/js/bad.js');
    return { ok: !bad, status: bad ? 400 : 200 } as any;
  };
  const r = await sendRouterFiles(
    [{ p: '/index.html', t: 'x' }, { p: '/js/bad.js', t: 'y' }, { p: '/js/service.js', t: 'z' }],
    { model: 'ZTE U30 Pro', host: '192.168.0.1', skipped: [] },
  );
  assert.equal(r.ok, true);
  assert.equal(r.sent, 2);
  assert.deepEqual(r.failed, ['/js/bad.js']);
  assert.equal(got[got.length - 1].done, true);
  assert.ok(got[got.length - 1].skipped.some((x: string) => /bad\.js/.test(x)));
  const delivered = got.filter(b => b.files && !b.files.some((f: any) => f.p === '/js/bad.js')).flatMap(b => b.files.map((f: any) => f.p));
  assert.ok(delivered.includes('/js/service.js'));
});
