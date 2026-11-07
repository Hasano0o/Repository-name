/**
 * لوحة FG360 (AW1000 — 5G CPE) — راوتر محاكى بنفس API صفحتهم (app.js من FULL عضو، ٧ نوفمبر):
 * POST :8088/cgi-bin/api.cgi { action, session, ... } · 401 = جلسة منتهية · { success:false, message } = رفض.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'react-native') return { Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const realSetTimeout = setTimeout;
(globalThis as any).setTimeout = (f: any, ms?: number) => realSetTimeout(f, Math.min(ms ?? 0, 5));

const CELL = {
  rat: 'NR5G-NSA', cell_rat: 'LTE', status: 'connected', operator_name: 'STC', sim_status: 'READY',
  rsrp: '-92', rsrq: '-11', sinr: '14', rssi: '-63', band: 'B3', arfcn: '1650', pci: '301', cell_id: '1A2B3C', tac: '7D0',
  base_station_id: '6827', temperature: '48', uptime: '1天 2小时',
  imei: '860000000000000', iccid: '8996600000000000000',
  carriers: [
    { role: 'PCC', state: 'active', band: 'B3', pci: '301', arfcn: '1650', bandwidth: '20', rsrp: '-92' },
    { role: 'SCC', state: 'active', band: 'n78', pci: '512', arfcn: '636666', bandwidth: '100', rsrp: '-88', rat: 'NR' },
  ],
  neighbors: [{ rat: 'LTE', pci: '144', arfcn: '1650', rsrp: '-101', rsrq: '-14', sinr: '2' }],
};

function router(o: { password?: string; setup?: boolean; expireOnce?: boolean } = {}) {
  const st = {
    session: '', calls: [] as any[], ports: new Set<string>(), expire: !!o.expireOnce,
    net: { ready: true, rat: '20', preferred1: '6', preferred2: '3', fiveg_mode: 7, supported_lte: [1, 3, 8, 28, 40], lte_bands: [1, 3, 8, 28, 40], supported_nr: [1, 28, 78], nr_bands: [1, 28, 78] },
    locked: false,
  };
  const res = (status: number, j: unknown) => ({ ok: status < 400, status, url: '', headers: { get: () => null }, text: async () => JSON.stringify(j) } as any);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    st.ports.add(u.port);
    if (u.port !== '8088') throw new Error('timeout'); // المنفذ 80: LuCI تعلق
    if (u.pathname !== '/cgi-bin/api.cgi') return res(404, { success: false });
    const b = JSON.parse(init.body);
    st.calls.push(b);
    if (b.action === 'system.password.status') return res(200, { success: true, setup_required: !!o.setup });
    if (b.action === 'login') {
      if (b.password !== (o.password ?? 'secret')) return res(403, { success: false, message: '用户名或密码错误' });
      st.session = 'S' + st.calls.length;
      return res(200, { success: true, session: st.session });
    }
    if (!b.session || b.session !== st.session) return res(401, { success: false, message: '登录已失效' });
    if (st.expire && b.action === 'status.get') { st.expire = false; st.session = 'dead'; return res(401, { success: false }); }
    switch (b.action) {
      case 'status.get': return res(200, { success: true, cellular: CELL });
      case 'network.get': return res(200, { success: true, network: st.net });
      case 'network.bands.set': st.net = { ...st.net, lte_bands: b.lte, nr_bands: b.nr }; return res(200, { success: true });
      case 'network.mode.set': st.net = { ...st.net, rat: b.rat }; return res(200, { success: true });
      case 'cell.get': return res(200, { success: true, locked: st.locked });
      case 'cell.set': st.locked = true; return res(200, { success: true, persistent: b.persistent });
      case 'cell.clear': st.locked = false; return res(200, { success: true });
      case 'system.reboot': return res(200, { success: true });
      default: return res(400, { success: false, message: 'unknown action' });
    }
  };
  return st;
}

async function drv() {
  const { Fg360Driver } = await import('../src/drivers/fg360');
  return new Fg360Driver();
}

test('fgHost: يضيف 8088 لو ما فيه منفذ، ويخلي المنفذ لو موجود', async () => {
  const { fgHost } = await import('../src/drivers/fg360/parse');
  assert.equal(fgHost('192.168.1.1'), '192.168.1.1:8088');
  assert.equal(fgHost('http://192.168.1.1/'), '192.168.1.1:8088');
  assert.equal(fgHost('192.168.1.1:8088'), '192.168.1.1:8088');
  assert.equal(fgHost('192.168.1.1:8080'), '192.168.1.1:8080');
});

test('detect: العنوان بدون منفذ ← يلقى اللوحة على 8088 (ما يلمس المنفذ 80 اللي يعلق)', async () => {
  const st = router();
  const d = await drv();
  assert.equal(await d.detect('192.168.1.1'), true);
  assert.deepEqual([...st.ports], ['8088']);
});

test('detect: عنوان بمنفذ ثاني ← لا · رد مو JSON حقهم ← لا', async () => {
  router();
  const d = await drv();
  assert.equal(await d.detect('192.168.1.1:8080'), false);
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, url: '', headers: { get: () => null }, text: async () => '<html>login</html>' });
  assert.equal(await (await drv()).detect('192.168.1.1'), false);
});

test('login: كلمة غلط ← رسالة واضحة · صح ← جلسة وتنرسل مع كل طلب', async () => {
  const st = router({ password: 'secret' });
  const d = await drv();
  await assert.rejects(d.login('192.168.1.1', 'root', 'nope'), /كلمة المرور غلط/);
  await d.login('192.168.1.1', 'root', 'secret');
  await d.getSignal();
  const last = st.calls[st.calls.length - 1];
  assert.equal(last.action, 'status.get');
  assert.equal(last.session, st.session);
});

test('login: الراوتر بدون كلمة مرور أول مرة ← يقول له يحطها من المتصفح', async () => {
  router({ setup: true });
  await assert.rejects((await drv()).login('192.168.1.1', 'root', 'x'), /أول مرة/);
});

test('الجلسة تنتهي ← يدخل من جديد ويكمل بدون خطأ', async () => {
  router({ expireOnce: true });
  const d = await drv();
  await d.login('192.168.1.1', 'root', 'secret');
  const s = await d.getSignal();
  assert.equal(s.rsrp, -92);
});

test('الإشارة NSA: 4G من الخلية الأساسية و5G من ناقل n78 · الأبراج والدمج', async () => {
  router();
  const d = await drv();
  await d.login('192.168.1.1', 'root', 'secret');
  const s = await d.getSignal();
  assert.equal(s.network, '5G NSA');
  assert.equal(s.band, 'B3'); assert.equal(s.pci, '301'); assert.equal(s.rsrp, -92); assert.equal(s.sinr, 14);
  assert.equal(s.nrBand, 'n78'); assert.equal(s.nrPci, '512'); assert.equal(s.nrRsrp, -88);
  assert.equal(s.caCount, 2);
  const cells = await d.getCells();
  assert.deepEqual(cells.map(c => `${c.kind}:${c.tech}:${c.pci}`), ['serving:LTE:301', 'secondary:NR:512', 'neighbor:LTE:144']);
  const car = await d.getCarriers();
  assert.deepEqual(car.map(c => `${c.role}:${c.tech}${c.band}`), ['PCC:LTE3', 'SCC:NR78']);
  const n = await d.getNetworkInfo();
  assert.equal(n.operator, 'STC'); assert.equal(n.connected, true);
});

test('التشخيص الخام بدون IMEI/ICCID', async () => {
  const { scrub } = await import('../src/drivers/fg360/parse');
  const t = scrub({ cellular: CELL });
  assert.ok(!t.includes('860000000000000'));
  assert.ok(!t.includes('8996600000000000000'));
  assert.ok(t.includes('-92'));
});

test('الترددات: كلها مختارة = تلقائي · تثبيت B3 + n78 ينكتب ويتأكد · [] يرجع الكل', async () => {
  const st = router();
  const d = await drv();
  await d.login('192.168.1.1', 'root', 'secret');
  let c = await d.getBandConfig();
  assert.deepEqual(c.locked, []); assert.deepEqual(c.supported, [1, 3, 8, 28, 40]); assert.deepEqual(c.nrSupported, [1, 28, 78]);
  await d.setBand([3], [78]);
  const w = st.calls.find(x => x.action === 'network.bands.set');
  assert.deepEqual(w.lte, [3]); assert.deepEqual(w.nr, [78]);
  assert.equal(w.rat, '20'); assert.equal(w.preferred1, '6');
  c = await d.getBandConfig();
  assert.deepEqual(c.locked, [3]); assert.deepEqual(c.nrLocked, [78]);
  await d.setBand([], []);
  assert.deepEqual((await d.getBandConfig()).locked, []);
});

test('الترددات: تردد مو مدعوم ← noChange وما ينرسل أمر', async () => {
  const st = router();
  const d = await drv();
  await d.login('192.168.1.1', 'root', 'secret');
  await assert.rejects(d.setBand([41]), (e: any) => e.noChange === true);
  assert.ok(!st.calls.some(x => x.action === 'network.bands.set'));
});

test('وضع الشبكة + البرج + اللقطة والإرجاع', async () => {
  const st = router();
  const d = await drv();
  await d.login('192.168.1.1', 'root', 'secret');
  const snap = await d.readLockState();
  await d.setNetworkMode('3');
  assert.equal(st.net.rat, '3');
  await d.lockCell({ tech: 'LTE', pci: '144', arfcn: '1650' });
  const set = st.calls.find(x => x.action === 'cell.set');
  assert.equal(set.kind, 'lte'); assert.equal(set.persistent, false);
  assert.equal((await d.getCellLock())?.pci, '144');
  await d.restoreLockState(snap);
  assert.equal(st.net.rat, '20'); assert.equal(st.locked, false);
  await assert.rejects(d.setNetworkMode('99'), (e: any) => e.noChange === true);
});

test('المشغّل: رمز PLMN «60601» ← «المدار (60601)» · الاسم يبقى كما هو · رمز مجهول يبقى رقم', async () => {
  const { opName } = await import('../src/drivers/fg360/parse');
  assert.equal(opName('60601'), 'المدار (60601)');
  assert.equal(opName('42004'), 'زين (42004)');
  assert.equal(opName('STC'), 'STC');
  assert.equal(opName('99999'), '99999');
  assert.equal(opName(''), undefined);
});
