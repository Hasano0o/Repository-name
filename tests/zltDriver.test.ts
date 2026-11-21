/**
 * ZLT / SIMCom «war» (X10 · X21 · X28 Pro · VN007+) — الدخول مطابق لكود الراوتر (sha256.js من ملفات «مو مدعوم؟» ينشغل في vm)،
 * وراوتر محاكى بنفس ردود /cgi-bin/http.cgi.
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
const vm = require('vm');
const P = require('../src/drivers/zlt/parse');
const { ZltDriver, zltPass } = require('../src/drivers/zlt/index');

function routerSha() {
  const ctx: any = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/zlt/sha256.js'), 'utf8'), ctx);
  return (s: string) => ctx.sha256_digest(s);
}

test('ZLT: كلمة الدخول sha256(token+كلمة) مطابقة لـ sha256.js', () => {
  const sha = routerSha();
  for (const [t, pw] of [['a1b2c3d4', 'admin'], ['6f2e9a', 'P@ss w0rd!'], ['', '12345678']]) assert.equal(zltPass(t, pw), sha(t + pw));
});

test('ZLT: التعرّف على الصفحة · قراءة الإشارة', () => {
  assert.ok(P.isZltPage('<!-- * @,@FilePath: ,: \\simcom_war\\index.html --> <!DOCTYPE html>'));
  assert.ok(P.isZltPage('<!-- * @,@FilePath: ,: \\war\\index.html --> <html>'));
  assert.equal(P.isZltPage('<html>/api/webserver/SesTokInfo</html>'), false);
  assert.deepEqual(P.parseZlt('xx{"a":1}'), { a: 1 });
  const s = P.signalFrom({ network_type_str: '4G', RSRP: '-95', RSRQ: '-11', SINR: '12', RSSI: '-70dBm', PCI: '101', CELL_ID: '173634354', FREQ: '1300', ENODEBID: '678259', currentband: 'B3', bandwidth: '20MHz', RSRP_5G: '', SINR_5G: 'NULL' });
  assert.equal(s.rsrp, -95); assert.equal(s.sinr, 12); assert.equal(s.rssi, -70); assert.equal(s.band, '3'); assert.equal(s.pci, '101'); assert.equal(s.enodebId, '678259');
  assert.equal(s.nrRsrp, undefined);
  const n = P.signalFrom({ network_type_str: '5G NSA', RSRP: '-90', SINR: '8', currentband: 'LTE BAND 1', RSRP_5G: '-84', SINR_5G: '15', currentband_5g: 'n78', PCI_5G: '12' });
  assert.equal(n.band, '1'); assert.equal(n.nrRsrp, -84); assert.equal(n.nrBand, '78'); assert.equal(n.nrPci, '12');
  assert.match(P.loginFailMsg('2'), /باقي 2/);
  assert.match(P.loginFailMsg('0'), /قفل/);
});

/** راوتر محاكى */
function zlt(pw: string, httpsOnly = false) {
  const log: string[] = [];
  const sha = routerSha();
  let sid = '', times = 3;
  const token = 'f00dbabe12345678';
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    if (httpsOnly && u.protocol === 'http:') throw new Error('Network request failed');
    log.push(u.protocol);
    const res = (text: string) => ({ ok: true, status: 200, url, headers: { get: () => null }, text: async () => text } as any);
    if (u.pathname === '/') return res('<!-- * @,@FilePath: ,: \\simcom_war\\index.html --><html></html>');
    if (u.pathname !== '/cgi-bin/http.cgi') return res('');
    const b = JSON.parse(String(init?.body ?? '{}'));
    log.push(`cmd ${b.cmd}`);
    if (b.cmd === 232) return res(JSON.stringify({ token, netx_login_time: 0 }));
    if (b.cmd === 100) {
      assert.equal(b.method, 'POST'); assert.equal(b.sessionId.length, 64);
      if (b.username === 'admin' && b.passwd === sha(token + pw)) { sid = 'S' + Date.now(); return res(JSON.stringify({ success: true, sessionId: sid, user_level: '1' })); }
      times--;
      return res(JSON.stringify({ login_fail: 'fail', login_times: String(times) }));
    }
    if (!sid || b.sessionId !== sid) return res('{"success":false,"message":"NO_AUTH"}');
    if (b.cmd === 205) return res(JSON.stringify({ network_type_str: '4G', network_operator: 'Zain KSA', RSRP: '-97', RSRQ: '-12', SINR: '9', PCI: '55', currentband: 'B3' }));
    if (b.cmd === 43) return res(JSON.stringify({ module: 'X21', modversion: 'V1.0.3', imei: '000' }));
    return res('{}');
  };
  return { log, expire: () => { sid = ''; } };
}

test('ZLT: دخول صحيح ← الإشارة والشركة والموديل · الجلسة راحت ← دخول جديد', async () => {
  const r = zlt('admin');
  const d = new ZltDriver();
  assert.ok(await d.detect('192.168.0.1'));
  await d.login('192.168.0.1', 'admin', 'admin', { fresh: true });
  const s = await d.getSignal();
  assert.equal(s.rsrp, -97); assert.equal(s.band, '3');
  const n = await d.getNetworkInfo();
  assert.equal(n.operator, 'Zain KSA'); assert.equal(n.connected, true);
  assert.equal((await d.getDeviceDetails()).model, 'ZLT X21');
  r.expire();
  assert.equal((await d.getSignal()).rsrp, -97);
  assert.equal(r.log.filter(x => x === 'cmd 100').length, 2);
});

test('ZLT: كلمة غلط ← باقي المحاولات · الخلفية ما تعيد الكلمة المرفوضة', async () => {
  const r = zlt('admin');
  const d = new ZltDriver();
  await assert.rejects(d.login('192.168.0.1', 'admin', 'wrong', { fresh: true }), /باقي 2/);
  await assert.rejects(d.login('192.168.0.1', 'admin', 'wrong'), /رفضها الراوتر قبل/);
  assert.equal(r.log.filter(x => x === 'cmd 100').length, 1);
});

test('ZLT: صفحات FULL ما فيها شي خطر · فيها صفحات الترددات والبرج', () => {
  const pages: string[] = new ZltDriver().afterLoginPages();
  assert.ok(pages.includes('/html/config/lteLockFrequencyConfig.html') && pages.includes('/js/isp/lockCell.js'));
  assert.ok(!pages.some(p => /reboot|reset|upgrade|logout|restore/i.test(p)));
});

test('ZLT X300A (du): https بس ← نتعرّف عليه وندخل على https', async () => {
  const r = zlt('Bpo', true);
  const d = new ZltDriver();
  assert.ok(await d.detect('192.168.70.1'));
  await d.login('192.168.70.1', 'admin', 'Bpo', { fresh: true });
  assert.equal((await d.getSignal()).rsrp, -97);
  assert.ok(!r.log.slice(1).some(x => x === 'http:'));
});

test('ZLT X300A: نسخة درايفر جديدة بدون detect (فتح صفحة الراوتر) ← تحوّل https لحالها', async () => {
  zlt('Bpo', true);
  const d = new ZltDriver();
  await d.login('192.168.70.1', 'user', 'Bpo', { fresh: true }).catch(() => {});
  const d2 = new ZltDriver();
  await d2.login('192.168.70.1', 'admin', 'Bpo', { fresh: true });
  assert.equal((await d2.getSignal()).rsrp, -97);
});

test('ZLT: الموديل في الـ id (كرت FULL لكل موديل)', async () => {
  zlt('admin');
  const d = new ZltDriver();
  assert.equal((await d.identify()).id, 'zlt');
  await d.login('192.168.0.1', 'admin', 'admin', { fresh: true });
  const p = await d.identify();
  assert.equal(p.id, 'zlt-x21'); assert.equal(p.label, 'ZLT X21');
});

test('ZLT X300A: الدمج بخانة وحدة «372+372+372» — الأساسي أول، والثانويات أبراج بترددها', () => {
  const raw = { network_type_str: '5G SA', RSRP: '', RSRP_5G: '-65', RSRQ_5G: '-12', SINR_5G: '6', PCI_5G: '372+372+372', FREQ_5G: '647424+640704+501390', currentband_5g: 'n78', bandwidth_5g: '100MHz' };
  const s = P.signalFrom(raw);
  assert.equal(s.nrPci, '372'); assert.equal(s.nrArfcn, '647424'); assert.equal(s.nrRsrp, -65); assert.equal(s.caCount, 3);
  const c = P.caCellsFrom(raw, s);
  assert.equal(c.length, 3);
  assert.deepEqual(c.map((x: any) => [x.kind, x.band]), [['serving', 78], ['secondary', 78], ['secondary', 41]]);
  assert.equal(P.signalFrom({ RSRP: '-90', PCI: '55' }).caCount, undefined);
});
