/**
 * هواوي فايبر (ONT) — المرحلة ١: التعرّف والدخول من صفحات حقيقية (ملفات «جهاز جديد» ٢٧ أكتوبر – ٧ نوفمبر):
 * DG8245V (STC، الرمز في الصفحة) · HG8245X6-8Ne «Mobily Fiber» و HG8245W5 (الرمز من GetRandCount.asp) · LG8245X6.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { __esModule: true, default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;

const fs = require('fs');
const path = require('path');
const fx = (n: string) => fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/hgont', n), 'utf8');
const P = require('../src/drivers/hgont/parse');

test('صفحات الدخول الحقيقية: التعرّف والموديل والرمز والقفل', () => {
  const dg = fx('dg8245v.html'), x6 = fx('hg8245x6.html'), w5 = fx('hg8245w5.html'), lg = fx('lg8245x6.html');
  for (const h of [dg, x6, w5, lg]) assert.ok(P.isOntLoginPage(h));
  assert.equal(P.productName(dg), 'DG8245V');
  assert.equal(P.productName(x6), 'Mobily Fiber');
  assert.equal(P.productName(lg), 'LG8245X6-10');
  assert.equal(P.tokenFromPage(dg), 'c4400f3fbfc170ec9e182fb307607f56');
  assert.equal(P.tokenFromPage(x6), undefined);
  assert.equal(P.lockInfo(dg).maxTries, 3);
  assert.equal(P.lockInfo(w5).leftSecs, 0);
  assert.equal(P.loginLanguage(w5), 'arabic');
  // صفحة راوتر شريحة هواوي (HiLink) ما تنحسب فايبر
  assert.equal(P.isOntLoginPage('<html><script src="/js/main.js"></script>api/webserver/SesTokInfo</html>'), false);
});

test('base64 ونص الدخول — نفس base64encode في صفحة الجهاز', () => {
  assert.equal(P.b64('FSY49JFW'), Buffer.from('FSY49JFW').toString('base64'));
  assert.equal(P.b64('ab'), 'YWI=');
  assert.equal(P.loginBody('user', 'p@ss', 'english', 'tok1'), 'UserName=user&PassWord=cEBzcw%3D%3D&Language=english&x.X_HW_Token=tok1');
});

/** جهاز محاكى: دخول صحيح ← «/» يرجع الرئيسية · غلط ← صفحة الدخول بعدّاد محاولات */
function ont(page: string, opts: { user?: string; pw?: string } = {}) {
  let logged = false;
  const log: string[] = [];
  let lastBody = '', lastCookie = '';
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const m = (init?.method ?? 'GET').toUpperCase();
    log.push(`${m} ${u.pathname}`);
    const res = (text: string, status = 200, sc = '') => ({ ok: true, status, url, headers: { get: (k: string) => (k.toLowerCase() === 'set-cookie' && sc ? sc : null) }, text: async () => text } as any);
    // كوكي يدوي: الطلبات لازم credentials: 'omit' (جرة النظام كانت تغطي على كوكي الدخول)
    assert.equal(init?.credentials, 'omit');
    if (u.pathname === '/asp/GetRandCount.asp') return res('﻿0123456789abcdef0123456789abcdef');
    if (u.pathname === '/login.cgi') {
      lastBody = String(init?.body ?? ''); lastCookie = String(init?.headers?.Cookie ?? '');
      const q = new URLSearchParams(lastBody);
      const okUser = q.get('UserName') === (opts.user ?? 'user');
      const okPw = Buffer.from(q.get('PassWord') ?? '', 'base64').toString() === (opts.pw ?? 'FSY49JFW');
      logged = okUser && okPw && !!q.get('x.X_HW_Token') && /^Cookie=body:Language:\w+:id=-1$/.test(lastCookie);
      return logged ? res('<script>window.location="/index.asp";</script>', 200, 'Cookie=sid=S1D:Language:english:id=1; path=/')
        : res(page.replace("var LoginTimes = '0'", "var LoginTimes = '1'"));
    }
    const sess = logged && String(init?.headers?.Cookie ?? '').includes('sid=S1D');
    if (u.pathname === '/') return res(sess ? '<html><frameset><frame src="/index.asp"></frameset></html>' : page);
    return res('', 404);
  };
  return { log, body: () => lastBody, cookie: () => lastCookie };
}

const { HuaweiOntDriver } = require('../src/drivers/hgont/index');

test('DG8245V: الرمز من الصفحة ← login.cgi ← دخلنا', async () => {
  const r = ont(fx('dg8245v.html'));
  const d = new HuaweiOntDriver();
  assert.equal(await d.detect('192.168.1.1'), true);
  await d.login('192.168.1.1', 'user', 'FSY49JFW', { fresh: true });
  assert.ok(!r.log.includes('POST /asp/GetRandCount.asp'), 'الرمز من الصفحة');
  assert.match(r.body(), /x\.X_HW_Token=c4400f3fbfc170ec9e182fb307607f56/);
  assert.equal(r.cookie(), 'Cookie=body:Language:english:id=-1');
  assert.ok(!/Language=/.test(r.body()), 'صفحة DG8245V ما ترسل Language');
  assert.deepEqual(d.authHeaders(), { Cookie: 'Cookie=sid=S1D:Language:english:id=1' }, 'الجلسة للجامع');
  assert.equal((await d.identify()).label, 'هواوي فايبر DG8245V');
});

test('HG8245X6 (موبايلي): الرمز من GetRandCount.asp (بدون BOM)', async () => {
  const r = ont(fx('hg8245x6.html'));
  const d = new HuaweiOntDriver();
  await d.login('192.168.100.1', 'user', 'FSY49JFW', { fresh: true });
  assert.ok(r.log.includes('POST /asp/GetRandCount.asp'));
  assert.match(r.body(), /x\.X_HW_Token=0123456789abcdef0123456789abcdef/);
  assert.match(r.body(), /Language=/, 'صفحة HG8245X6 ترسل Language');
});

test('كلمة غلط ← رسالة اسم المستخدم من الملصق، وما نعيدها بالخلفية (يقفل بعد ٣)', async () => {
  const r = ont(fx('dg8245v.html'));
  const d = new HuaweiOntDriver();
  await assert.rejects(d.login('192.168.1.1', 'admin', 'FSY49JFW', { fresh: true }), (e: any) => /الملصق/.test(e.message) && /3/.test(e.message));
  const n = r.log.filter(x => x === 'POST /login.cgi').length;
  await assert.rejects(d.login('192.168.1.1', 'admin', 'FSY49JFW'), (e: any) => /ما جرّبناها/.test(e.message));
  assert.equal(r.log.filter(x => x === 'POST /login.cgi').length, n, 'ما انرسلت محاولة ثانية');
});

test('الراوتر قافل (LockLeftTime) ← ما نرسل الكلمة', async () => {
  const r = ont(fx('dg8245v.html').replace("var LockLeftTime = '0'", "var LockLeftTime = '42'"));
  const d = new HuaweiOntDriver();
  await assert.rejects(d.login('192.168.1.1', 'user', 'FSY49JFW', { fresh: true }), (e: any) => /42/.test(e.message));
  assert.ok(!r.log.includes('POST /login.cgi'));
});

test('DG8245V (تقرير ٢٢:٣٧): login.cgi رد صغير + set-cookie و «/» يبقى صفحة الدخول ← دخلنا (الحكم من رد login.cgi)', async () => {
  const page = fx('dg8245v.html');
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const res = (text: string, sc = '') => ({ ok: true, status: 200, url, headers: { get: (k: string) => (k.toLowerCase() === 'set-cookie' && sc ? sc : null) }, text: async () => text } as any);
    if (u.pathname === '/login.cgi') return res('<html><script>var pageName = "/index.asp"; top.location.replace(pageName);</script></html>', 'Cookie=sid=Z:Language:arabic:id=1; path=/');
    return res(page);
  };
  const d = new HuaweiOntDriver();
  await d.login('192.168.1.1', 'user', '9TDXBNTF', { fresh: true });
  assert.deepEqual(d.authHeaders(), { Cookie: 'Cookie=sid=Z:Language:arabic:id=1' });
});

test('DG8245V بعد الدخول: معلومات الجهاز والأجهزة المتصلة (أسطر حقيقية من FULL ١٤ نوفمبر)', () => {
  const di = 'x=new stDeviceInfo("InternetGatewayDevice.DeviceInfo","4857544327C345A9","1C1A\\x2eA","V500R020C00SPC270","DG8245V","HWTC","2023\\x2d05\\x2d24\\x5f00\\x3a35\\x3a18\\x20","9C\\x3a73\\x3a70\\x3a19\\x3a6B\\x3a9A","DG8245V","2153037804HYN3016100\\x2e0002","");';
  const d = P.deviceInfo(di);
  assert.deepEqual(d, { serial: '4857544327C345A9', hardware: '1C1A.A', software: 'V500R020C00SPC270', model: 'DG8245V', mac: '9C:73:70:19:6B:9A' });
  assert.equal(P.deviceInfo('<html>Waiting</html>'), null);
  const ud = 'var a=new Array(new USERDevice("InternetGatewayDevice.LANDevice.1.X_HW_UserDev.1","192\\x2e168\\x2e1\\x2e79","5e\\x3a4f\\x3aa7\\x3a20\\x3aec\\x3a17","SSID1","DHCP","","Offline","WIFI","7\\x3a45","iPhone","1","0","0","","","0"),'
    + 'new USERDevice("InternetGatewayDevice.LANDevice.1.X_HW_UserDev.2","192\\x2e168\\x2e1\\x2e80","46\\x3a55\\x3a87\\x3aea\\x3af1\\x3a7e","LAN1","DHCP","","Online","ETH","1\\x3a02","My\\x20PC","1","0","0","","","0"),null);';
  const list = P.userDevices(ud);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { ip: '192.168.1.79', mac: '5E:4F:A7:20:EC:17', port: 'SSID1', online: false, conn: 'WIFI', name: 'iPhone' });
  assert.equal(list[1].online, true); assert.equal(list[1].name, 'My PC');
});

test('DG8245V: نوع الوصلة من ontstate.asp (PonMode ge + إيثرنت Up)', () => {
  const h = `var OntState = "OFFLINE";\nvar ethLinkStatus = new Array(new stLinkStatus("InternetGatewayDevice.WANDevice.1.WANEthernetInterfaceConfig","Up"),null);\nvar GponOntStateInfo = new Array(null);\nvar PonMode = 'ge';`;
  assert.deepEqual(P.uplinkState(h), { pon: 'ge', online: true, mode: 'كابل إيثرنت (GE)' });
  const g = h.replace("'ge'", "'gpon'").replace('"Up"', '"Down"');
  assert.deepEqual(P.uplinkState(g), { pon: 'gpon', online: false, mode: 'فايبر GPON' });
  assert.equal(P.uplinkState('<html>Waiting</html>'), null);
});

test('موبايلي فايبر: الإشارة الضوئية من opticinfo.asp (سطر حقيقي ١٤ نوفمبر)', () => {
  const h = 'var opticInfos = new Array(new stOpticInfo("InternetGatewayDevice.X_HW_DEBUG.AMP.Optic","ok","2\\x2e31\\x20","\\x2d22\\x2e44","3274","54","9","\\x2d\\x2d","\\x2d\\x2d","HUAWEI\\x20\\x20","2513VL307645C\\x20","250523","1310","1490","20","0"),null);'
    + 'var OltOptics = new Array(new stOLTOpticInfo("InternetGatewayDevice.X_HW_DEBUG.AMP.OltOptic","\\x2d\\x2d","\\x2d\\x2d",""),null);';
  assert.deepEqual(P.opticInfo(h), { rx: -22.44, tx: 2.31, voltageMv: 3274, tempC: 54, biasMa: 9, linkOk: true });
  assert.equal(P.opticLevel(-22.44), 'good');
  assert.equal(P.opticLevel(-17), 'excellent');
  assert.equal(P.opticLevel(-26), 'fair');
  assert.equal(P.opticLevel(-29), 'poor');
  assert.deepEqual(P.opticInfo('new stOpticInfo("InternetGatewayDevice.X_HW_DEBUG.AMP.Optic","--","--","--","--","--","--")'), { linkOk: false });
  assert.equal(P.opticInfo('<html>Waiting</html>'), null);
});
