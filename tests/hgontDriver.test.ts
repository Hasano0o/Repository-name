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
    const res = (text: string, status = 200) => ({ ok: true, status, url, headers: { get: () => null }, text: async () => text } as any);
    if (u.pathname === '/asp/GetRandCount.asp') return res('﻿0123456789abcdef0123456789abcdef');
    if (u.pathname === '/login.cgi') {
      lastBody = String(init?.body ?? ''); lastCookie = String(init?.headers?.Cookie ?? '');
      const q = new URLSearchParams(lastBody);
      const okUser = q.get('UserName') === (opts.user ?? 'user');
      const okPw = Buffer.from(q.get('PassWord') ?? '', 'base64').toString() === (opts.pw ?? 'FSY49JFW');
      logged = okUser && okPw && !!q.get('x.X_HW_Token');
      return res(logged ? '<script>window.location="/index.asp";</script>' : page.replace("var LoginTimes = '0'", "var LoginTimes = '1'"));
    }
    if (u.pathname === '/') return res(logged ? '<html><frameset><frame src="/index.asp"></frameset></html>' : page);
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
  assert.equal((await d.identify()).label, 'هواوي فايبر DG8245V');
});

test('HG8245X6 (موبايلي): الرمز من GetRandCount.asp (بدون BOM)', async () => {
  const r = ont(fx('hg8245x6.html'));
  const d = new HuaweiOntDriver();
  await d.login('192.168.100.1', 'user', 'FSY49JFW', { fresh: true });
  assert.ok(r.log.includes('POST /asp/GetRandCount.asp'));
  assert.match(r.body(), /x\.X_HW_Token=0123456789abcdef0123456789abcdef/);
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
