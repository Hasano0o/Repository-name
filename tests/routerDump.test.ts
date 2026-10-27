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

test('FiberHome: polyfill.min.js و vue-i18n.min.js تنجمع (فيها $post وأسماء الإعدادات)، والمكتبات الكبيرة لا', async () => {
  const asked: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    const p = url.replace(/^http:\/\/[^/]+/, '').split('?')[0];
    asked.push(p);
    const files: Record<string, string> = {
      '/': '<script src="/plugins/vue.min.js"></script><script src="/plugins/vue-i18n.min.js"></script><script src="/plugins/polyfill.min.js"></script><script src="/js/jquery-3.5.1.min.js"></script><script src="/plugins/topo.min.js"></script>',
      '/plugins/vue.min.js': 'v', '/plugins/vue-i18n.min.js': 'i18n', '/plugins/polyfill.min.js': 'function $post(){}',
    };
    const b = files[p];
    return { ok: b !== undefined, headers: { get: () => 'text/plain' }, text: async () => b ?? '' } as any;
  };
  const { files, skipped } = await collectRouterFiles('192.168.8.1');
  const got = files.map(f => f.p);
  assert.ok(got.includes('/plugins/polyfill.min.js'));
  assert.ok(got.includes('/plugins/vue-i18n.min.js'));
  assert.ok(skipped.some(s => /jquery/.test(s)));
  assert.ok(skipped.some(s => /topo\.min/.test(s)));
});

declare const Buffer: any;
import * as ncrypto from 'node:crypto';
import { FH_IV } from '../src/drivers/fiberhome/crypto';

test('FiberHome: «مو مدعوم؟» يجيب ملف أسماء الإعدادات (get_xmlnode_js_file) بالتشفير الصحيح — بدون sessionid في الحزمة', async () => {
  const SID = 'S3SS10N0123456789abcdef';
  const KEY = SID.slice(0, 16);
  const aes = (mode: 'enc' | 'dec', data: string) => {
    const c = mode === 'enc' ? (ncrypto as any).createCipheriv('aes-128-cbc', Buffer.from(KEY), Buffer.from(FH_IV)) : (ncrypto as any).createDecipheriv('aes-128-cbc', Buffer.from(KEY), Buffer.from(FH_IV));
    return Buffer.concat([c.update(Buffer.from(data, mode === 'enc' ? 'utf8' : 'hex')), c.final()]).toString(mode === 'enc' ? 'hex' : 'utf8');
  };
  let posted: any;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const ok = (t: string) => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => t } as any);
    if (u.pathname === '/') return ok('<script src="/plugins/polyfill.min.js"></script>');
    if (u.pathname === '/plugins/polyfill.min.js') return ok("'get_xmlnode_js_file|FHNCAPIS'");
    if (u.pathname === '/api/tmp/FHNCAPIS' && init?.method !== 'POST') {
      const m = u.searchParams.get('ajaxmethod');
      if (m === 'is_encrypt') return ok('{"enable":1}');
      if (m === 'get_refresh_sessionid') return ok(JSON.stringify({ sessionid: SID }));
    }
    if (u.pathname === '/api/tmp/FHNCAPIS' && init?.method === 'POST') {
      posted = JSON.parse(aes('dec', init.body));
      return ok(aes('enc', JSON.stringify({ xml: 'var x_NetworkSettings_obj="InternetGatewayDevice.X_FH_MobileNetwork.";var x_NetworkSet_LTELockBAND="LTELockBAND";' })));
    }
    return { ok: false, status: 404, headers: { get: () => '' }, text: async () => '' } as any;
  };
  const { files } = await collectRouterFiles('192.168.8.1');
  assert.equal(posted.ajaxmethod, 'get_xmlnode_js_file');
  assert.equal(posted.sessionid, SID);
  const x = files.find(f => f.p === '/_bandly/xmlnode.js');
  assert.ok(x, `ما انحفظ: ${files.map(f => f.p).join(' ')}`);
  assert.match(x!.t, /x_NetworkSet_LTELockBAND/);
  assert.ok(!files.some(f => f.t.includes(SID)), 'sessionid تسرّب للحزمة');
});

test('FiberHome: لو جلب الأسماء فشل ← ملف خطأ واضح بدل ما يضيع بصمت', async () => {
  (globalThis as any).fetch = async (url: string) => {
    const u = new URL(url);
    const ok = (t: string) => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => t } as any);
    if (u.pathname === '/') return ok('<script src="/plugins/polyfill.min.js"></script>');
    if (u.pathname === '/plugins/polyfill.min.js') return ok("'get_xmlnode_js_file|FHNCAPIS'");
    return { ok: false, status: 403, headers: { get: () => '' }, text: async () => '' } as any;
  };
  const { files } = await collectRouterFiles('192.168.8.1');
  const e = files.find(f => f.p === '/_bandly/xmlnode-error.txt');
  assert.ok(e);
  assert.match(e!.t, /is_encrypt: HTTP 403/);
});

test('جهاز جديد (Nokia — Angular): <base href="/web_whw/"> + قطع runtime', async () => {
  const { baseHrefOf, angularChunks, resolvePath, findRefs } = require('../src/services/routerDump');
  const html = '<base href="/web_whw/"><script src="runtime.d739df4d0fedb33c.js" type="module"></script><script src="main.da0b4dbf51457d52.js" type="module"></script>';
  assert.equal(baseHrefOf(html), '/web_whw/');
  assert.equal(baseHrefOf('<base href="/">'), null);
  assert.deepEqual(findRefs(html).map((r: string) => resolvePath(r, '/web_whw/index.html')), ['/web_whw/runtime.d739df4d0fedb33c.js', '/web_whw/main.da0b4dbf51457d52.js']);
  const rt = 'a.u=e=>(76===e?"common":e)+"."+{76:"0b3c3e1a2f4d5e6f",592:"a1b2c3d4e5f60718",common:"1122334455667788"}[e]+".js"';
  assert.deepEqual(angularChunks(rt).sort(), ['592.a1b2c3d4e5f60718.js', '76.0b3c3e1a2f4d5e6f.js', 'common.1122334455667788.js']);
});

test('TP-Link MR600 (٢٧ أكتوبر): الملفات تنطلب مع Referer، jquery.tp.min.js ينجمع (فيه $.act والتشفير)، وردود getParm/getBusy في probe.txt', async () => {
  const asked: { p: string; m: string }[] = [];
  const login = '<html><script src="../js/jquery-1.8.3.min.js"></script><script src="../js/oid_str.js"></script><script src="../js/encrypt.js"></script><script src="../js/lib.js"></script>'
    + '<script>INCLUDE_LOGIN_GDPR_ENCRYPT&&($.loadScript("../js/cryptoJS.min.js"),$.loadScript("../js/tpEncrypt.js"))</script><script src="../js/jquery.tp.min.js"></script>'
    + '<script>x.open("POST",window.location.protocol+"//"+window.location.host+"/cgi/getParm",!1)</script></html>';
  (globalThis as any).fetch = async (url: string, init: any = {}) => {
    const p = url.replace(/^http:\/\/[^/]+/, '').split('?')[0];
    asked.push({ p, m: init.method ?? 'GET' });
    // مثل الراوتر: بدون Referer يرجّع صفحة الدخول لأي ملف
    const ref = init.headers?.Referer;
    const files: Record<string, string> = {
      '/': login, '/js/oid_str.js': 'var LTE_NET_STATUS="x";', '/js/encrypt.js': 'rsa', '/js/lib.js': 'lib',
      '/js/cryptoJS.min.js': 'cj', '/js/tpEncrypt.js': 'Iencryptor', '/js/jquery.tp.min.js': '$.act=function(){}',
      '/cgi/getParm': '{"nn":"C0FFEE","ee":"010001","seq":"123","userSetting":1}', '/cgi/getBusy': '{"isLogined":0,"isBusy":0}',
    };
    const b = p !== '/' && ref !== 'http://192.168.1.1/' ? login : files[p];
    return { ok: b !== undefined, headers: { get: () => 'text/plain' }, text: async () => b ?? '' } as any;
  };
  const { files, skipped } = await collectRouterFiles('192.168.1.1');
  const got = files.map(f => f.p);
  for (const f of ['/js/oid_str.js', '/js/encrypt.js', '/js/lib.js', '/js/tpEncrypt.js', '/js/jquery.tp.min.js']) assert.ok(got.includes(f), f);
  assert.ok(skipped.includes('/js/jquery-1.8.3.min.js'));
  const probe = files.find(f => f.p === '/_bandly/probe.txt');
  assert.ok(probe && /POST \/cgi\/getParm → ok .*"nn":"C0FFEE"/.test(probe.t));
  assert.ok(asked.some(a => a.p === '/cgi/getParm' && a.m === 'POST'));
});

import { namedChunks } from '../src/services/routerDump';
test('هواوي H155-383: قطع Webpack بالأسماء (lockband/networkmode) تنجمع، وصفحات الشبكة أول', () => {
  const main = 'c.src=function(e){return A.p+"js/"+({0:"common",4:"login",20:"bridgemode-bridgemode-vue",55:"lockband",70:"networkmode",142:"wifisecurity-wifisecurity-vue"}[e]||e)+".js?r=1"}';
  const got = namedChunks(main);
  assert.ok(got.includes('js/lockband.js'));
  assert.ok(got.includes('js/networkmode.js'));
  assert.ok(got.indexOf('js/lockband.js') < got.indexOf('js/wifisecurity-wifisecurity-vue.js'));
  assert.deepEqual(namedChunks('var x = 1;'), []);
});

test('هواوي H155-383: الجامع يطلب /js/lockband.js (مو /js/js/…)', async () => {
  const asked: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    const p = url.replace(/^http:\/\/[^/]+/, '').split('?')[0];
    asked.push(p);
    const files: Record<string, string> = {
      '/': '<script src="../js/main.js?r=1"></script>',
      '/js/main.js': 'c.src=function(e){return A.p+"js/"+({55:"lockband",70:"networkmode"}[e]||e)+".js?r=1"}',
      '/js/lockband.js': 'lock-freq', '/js/networkmode.js': 'LTEBandOption',
    };
    const b = files[p];
    return { ok: b !== undefined, headers: { get: () => 'text/plain' }, text: async () => b ?? '' } as any;
  };
  const { files } = await collectRouterFiles('192.168.8.1');
  const got = files.map(f => f.p);
  assert.ok(got.includes('/js/lockband.js'));
  assert.ok(got.includes('/js/networkmode.js'));
  assert.ok(!asked.includes('/js/js/lockband.js'));
});
