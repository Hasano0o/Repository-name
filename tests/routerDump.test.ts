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

test('ZTE (MC801A Pro): شاشات القائمة path:"network/…" ← /js/…js + /tmpl/…html — الشبكة والواي فاي أول', () => {
  const { zteMenuPaths } = require('../src/services/routerDump');
  // من menu_4ggateway.js الحقيقي (MC801A Pro، ٣٠ أكتوبر)
  const menu = 'define(function(){return[{hash:"#login",path:"login",level:"1"},{hash:"#home",path:"home",level:"1"},{hash:"#sms",path:"sms/smslist",level:"1"},{hash:"#mobile_network",path:"network/mobile_network",level:"3"},{hash:"#wifi_advance",path:"wifi/wifi_advance",level:"3"}]})';
  const out: string[] = zteMenuPaths(menu);
  assert.ok(out.includes('/js/network/mobile_network.js') && out.includes('/tmpl/network/mobile_network.html'));
  assert.ok(out.indexOf('/js/network/mobile_network.js') < out.indexOf('/js/sms/smslist.js'), 'الشبكة قبل الرسايل');
  assert.ok(out.indexOf('/js/wifi/wifi_advance.js') < out.indexOf('/js/login.js'));
  assert.deepEqual(zteMenuPaths('var x = {path:"a"}'), [], 'بدون hash ما نعتبره قائمة');
});

test('فحوص حية: ZTE — الإصدارات و /ubus/ = 404 بالكود، وما فيه أي أمر تغيير، والأسرار تنحذف', async () => {
  const { liveChecks } = require('../src/services/routerDump');
  const calls: string[] = [];
  const real = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    calls.push(`${init?.method ?? 'GET'} ${u.protocol}${u.pathname}${init?.body ? ' ' + init.body : ''}`);
    const r = (status: number, text: string) => ({ ok: status < 400, status, headers: { get: () => 'text/plain' }, text: async () => text });
    if (u.protocol === 'https:') throw new Error('TLS');
    if (u.pathname.startsWith('/ubus')) return r(404, 'Site or Page Not Found');
    if (u.pathname === '/goform/goform_get_cmd_process') return r(200, '{"wa_inner_version":"BD_XCBZHKMC801A ProV1.0.0B03","web_version":"WEB_XCBZHKG5BV1.0.0B03","loginfo":"","SSID1":"ZTE_B8E86C","imei":"869731080029697","RD":"abc"}');
    return r(200, '<html></html>');
  };
  try {
    const t: string = await liveChecks('http://192.168.0.1', 'x goform_get_cmd_process y');
    assert.match(t, /ZTE ubus: POST \/ubus\/ → 404/);
    assert.match(t, /BD_XCBZHKMC801A ProV1\.0\.0B03/);
    assert.match(t, /https: فشل/);
    assert.ok(!/ZTE_B8E86C|869731080029697|"RD":"abc"/.test(t), 'SSID و IMEI و RD لازم تنحذف:\n' + t);
    const posts = calls.filter(c => c.startsWith('POST'));
    assert.deepEqual(posts, ['POST http:/ubus/ []'], 'الـ POST الوحيد قراءة ubus «[]»');
    assert.ok(!calls.some(c => /goform_set_cmd_process/.test(c)), 'ولا أمر goform_set');
  } finally { (globalThis as any).fetch = real; }
});

test('فحوص حية: هواوي — رموز الجلسة تنحذف من XML', async () => {
  const { scrubLive } = require('../src/services/routerDump');
  const x = scrubLive('<response><SesInfo>SessionID=abc123</SesInfo><TokInfo>tok999</TokInfo><DeviceName>H122-373</DeviceName><Imei>8612</Imei></response>');
  assert.ok(!/abc123|tok999|8612/.test(x), x);
  assert.match(x, /H122-373/);
  assert.equal(scrubLive('a=1&password=xyz&b=2'), 'a=1&password=«محذوف»&b=2');
});

// ═══ ٣١ أكتوبر: «ما وصل» مع السبب + السحب بعد الدخول (FiberHome LG6851F الجديد — main.html) ═══
function mockStatus(files: Record<string, string | number>) {
  const asked: string[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const p = url.replace(/^http:\/\/[^/]+/, '').split('?')[0];
    asked.push(p + (init?.credentials ? '#' + init.credentials : ''));
    const b = files[p];
    const status = typeof b === 'number' ? b : b === undefined ? 404 : 200;
    return { ok: status < 400, status, headers: { get: () => 'text/html' }, text: async () => (typeof b === 'string' ? b : '') } as any;
  };
  return asked;
}

test('جهاز جديد: main.html من سكربت ينطلب من الجذر، واللي ما وصل ينكتب مع رد الراوتر (قبل: ينبلع بصمت)', async () => {
  const home = '<html><script src="/js/login.js"></script></html>';
  mockStatus({
    '/': home,
    '/js/login.js': 'location.href="main.html"; var x="/js/gone.js";',
    '/main.html': 403,
    '/js/gone.js': 404,
  });
  const { skipped } = await collectRouterFiles('192.168.8.1');
  // main.html داخل /js/login.js ينطلب من جذر الموقع (مثل المتصفح) — مو /js/main.html بس
  assert.ok(skipped.includes('✗ /main.html ← HTTP 403'), skipped.join(' | '));
  assert.ok(skipped.includes('✗ /js/gone.js ← HTTP 404'));
  assert.ok(skipped.indexOf('✗ /main.html ← HTTP 403') < skipped.indexOf('✗ /js/gone.js ← HTTP 404'), 'الصفحات قبل ملفات js');
});

test('جهاز جديد: الراوتر يرجّع صفحة البداية بدل الملف ← ينكتب كذا', async () => {
  const home = '<html><body onLoad="frmLoad()"><script>var a="main.html"</script></body></html>';
  mockStatus({ '/': home, '/main.html': home });
  const { skipped } = await collectRouterFiles('192.168.8.1');
  assert.ok(skipped.includes('✗ /main.html ← رجّع صفحة البداية بدل الملف'), skipped.join(' | '));
});

test('بعد الدخول: يبدأ من main.html ويسحب سكربتاتها بالكوكي، وبدون فحوص «بدون دخول»', async () => {
  const asked = mockStatus({
    '/main.html': '<html><script src="/js/app.js"></script></html>',
    '/js/app.js': 'var m=["set_lte_band","set_net_mode"];',
    '/': '<html>home</html>',
  });
  const { files } = await collectRouterFiles('192.168.8.1', undefined, { start: ['/main.html'], afterLogin: true });
  assert.deepEqual(files.map(f => f.p), ['/main.html', '/js/app.js']);
  assert.ok(asked.every(a => a.endsWith('#include')), 'الكوكي ينرسل: ' + asked.join(', '));
  assert.ok(!asked.some(a => /FHNCAPIS|_bandly|^\/#/.test(a)), 'ما فيه probe/live بعد الدخول: ' + asked.join(', '));
});

test('FiberHome LG6851F (ملف AUTH حقيقي): صفحات الإعدادات من /src/ (data-main) — الترددات والشبكة أول', async () => {
  const fh = (f: string) => fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'fiberhome-v2-auth', f), 'utf8');
  const served: Record<string, string> = {
    '/main.html': fh('main.html'),
    '/src/main.js': fh('main.js'),
    '/src/menu/menudata.js': fh('menudata.js'),
    '/src/router/router.js': fh('router.js'),
    '/src/index.js': 'define(["router"],function(){})',
  };
  const asked: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    const p = url.replace(/^http:\/\/[^/]+/, '').split('?')[0];
    asked.push(p);
    // أي صفحة تحت /src/content/pages موجودة (نحاكي الراوتر)، والجذر يرد 400 مثل الحقيقي
    const body = served[p] ?? (p.startsWith('/src/content/pages/') ? `define(function(){ $post("set_${p.split('/').pop()!.replace('.js', '')}") })` : undefined);
    return { ok: body !== undefined, status: body !== undefined ? 200 : 400, headers: { get: () => 'text/javascript' }, text: async () => body ?? '' } as any;
  };
  const { files } = await collectRouterFiles('192.168.8.1', undefined, { start: ['/main.html'], afterLogin: true });
  const got = files.map(f => f.p);
  for (const want of ['/src/main.js', '/src/index.js', '/src/content/pages/frequencyLockSet.js', '/src/content/pages/networkSet.js', '/src/content/pages/carrierLock.js']) {
    assert.ok(got.includes(want), `${want} ما انسحب — طلبنا: ${asked.slice(0, 30).join(', ')}`);
  }
  assert.ok(!asked.includes('/content/pages/frequencyLockSet.js'), 'ما نطلب من الجذر (400)');
  const pages = got.filter(p => p.startsWith('/src/content/pages/'));
  assert.ok(pages.indexOf('/src/content/pages/frequencyLockSet.js') < pages.indexOf('/src/content/pages/home.js'), 'صفحات الشبكة قبل الباقي');
});

test('هواوي القديم (E5785): رد XML 100002 ينحسب «ما وصل» مو ملف، والصفحات داخل السكربت تنطلب من مجلد الصفحة /html/', async () => {
  const NF = '<?xml version="1.0" encoding="UTF-8"?>\n<error>\n<code>100002</code>\n<message/>\n</error>';
  const served: Record<string, string> = {
    '/': '<html><script>window.location.replace("/html/index.html");</script></html>',
    '/html/index.html': '<html><script type="text/javascript" src="../js/main.js"></script></html>',
    '/js/main.js': 'var pages=["celllock.html","mobilenetworksettings.html"];$.get("api/net/net-mode")',
    '/html/celllock.html': '<div id="celllock"></div>',
    '/html/mobilenetworksettings.html': '<div id="netmode"></div>',
  };
  const asked: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    const p = url.replace(/^http:\/\/[^/]+/, '').split('?')[0];
    asked.push(p);
    const body = served[p] ?? NF;   // هواوي: 200 بـ XML خطأ لأي شي مو موجود
    return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => body } as any;
  };
  const { files, skipped } = await collectRouterFiles('192.168.8.1');
  const got = files.map(f => f.p);
  assert.ok(got.includes('/html/celllock.html') && got.includes('/html/mobilenetworksettings.html'), 'صفحات الإعدادات من /html/: ' + got.join(', '));
  assert.ok(!files.some(f => !f.p.startsWith('/_bandly/') && /<code>100002<\/code>/.test(f.t)), 'ولا ملف فاضي 100002: ' + files.filter(f => /100002/.test(f.t)).map(f => f.p).join(','));
  assert.ok(skipped.some(x => /رد هواوي 100002 \(مو موجود\)/.test(x)), skipped.join(' | '));
});
