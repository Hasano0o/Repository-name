/**
 * STC 5G AX3600 على راوتر محاكى بنفس بروتوكول صفحته (svcrunner + Auth-Info) — من ملفات صفحة عضو (١٤ نوفمبر).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';

declare const require: any;
declare const process: any;
declare const Buffer: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const C: any = ncrypto;
const sha = (s: string) => C.createHash('sha256').update(s).digest('hex');

function router(opts: { pass?: string; path?: string } = {}) {
  const st: any = { authed: false, lock: { cell_cat: '', cell_band: '', cell_arfun: '', cell_pci: '' }, sent: [] as any[], rebooted: false };
  const svc = opts.path ?? 'cgi-bin/luci/svcrunner';
  const res = (status: number, text: string) => ({ ok: status < 400, status, url: 'http://192.168.1.1/', headers: { get: () => null }, text: async () => text } as any);
  const J = (o: unknown, status = 200) => res(status, JSON.stringify(o));
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const p = new URL(url).pathname.slice(1);
    if (p === '') return res(200, '<meta http-equiv="refresh" content="0; URL=cgi-bin/luci/index" />');
    if (p === 'cgi-bin/luci/index') return res(200, '<script src=/static/js/manifest.1f20.js></script><script src=/static/js/app.0cc3c7583764fb8e69cc.js></script>');
    if (p !== svc) return res(404, '<html>nf</html>');
    const body = String(init?.body ?? '');
    const b = JSON.parse(body);
    // Auth-Info = sha256 للجسم قبل تبديل status ← sim_info، و rid = sha256(JSON(payload))
    const pre = b.namespace === 'sim_info' ? body.replace('"namespace":"sim_info"', '"namespace":"status"') : body;
    assert.equal(init.headers['Auth-Info'], sha(pre));
    assert.equal(b.rid, sha(JSON.stringify(b.payload))); assert.equal(b.token, '');
    st.sent.push(`${b.namespace}/${b.name}`);
    const R = (payload: unknown) => J({ name: b.name, namespace: b.namespace, payload });
    if (b.namespace === 'language') return R({ language: 'ar' });
    if (b.namespace === 'auth' && b.name === 'checkpasswd') {
      const ok = Buffer.from(b.payload.user, 'base64').toString() === 'admin' && Buffer.from(b.payload.password, 'base64').toString() === (opts.pass ?? '9eTest');
      st.authed = ok;
      return R(ok ? { result: 'okay' } : { result: 'fail' });
    }
    if (!st.authed) return J({ namespace: 'error', name: 'token_error', payload: {} }, 401);
    if (b.namespace === 'info' && b.name === 'get') return R([{ device_model: '5G AX3600' }, { device_imei: '8611', ex_version: 'V1.2', IPV4: { public_ip: '10.1.2.3' } },
      { LTE4G: { sig_rsrp: '-95', sig_rsrq: '-11', sig_snr: '12', cell_id: '1A2B', plmn: '42001', sig_cqi: '9' } },
      { NR5G: { sig_rsrp: '-88', sig_rsrq: '-10', sig_snr: '18', cell_id: '77AA' } }]);
    if (b.namespace === 'sim_info' && b.name === 'all_status') return R([{ network_mode: 'ENDC', CA_MODE: '2CA', operator: '42001', sim_status: 'Ready' }]);
    if (b.namespace === 'lock_cell') {
      if (b.name === 'get') return R({ ...st.lock });
      if (b.name === 'set') { st.lock = { cell_cat: b.payload.cell_act, cell_band: b.payload.cell_band, cell_arfun: b.payload.cell_arfcn, cell_pci: b.payload.cell_pci }; return R({ result: 'ok' }); }
      if (b.name === 'clr') { st.lock = { cell_cat: '', cell_band: '', cell_arfun: '', cell_pci: '' }; return R({ result: 'ok' }); }
    }
    if (b.namespace === 'reboot') { st.rebooted = true; return R({ result: 'okay' }); }
    return R({ result: 'fail' });
  };
  return st;
}
const driver = () => { const { StcAxDriver } = require('../src/drivers/stcax'); return new StcAxDriver(); };

test('STC AX3600: يتعرّف (svcrunner) · يدخل base64 · الإشارة 4G+5G من info · status ينرسل sim_info', async () => {
  const st = router();
  const d = driver();
  assert.equal(await d.detect('192.168.1.1'), true);
  await d.login('192.168.1.1', 'admin', '9eTest');
  const s = await d.getSignal();
  assert.equal(s.rsrp, -95); assert.equal(s.rsrq, -11); assert.equal(s.sinr, 12); assert.equal(s.cellId, '1A2B');
  assert.equal(s.nrRsrp, -88); assert.equal(s.nrSinr, 18); assert.equal(s.network, '5G NSA'); assert.equal(s.caCount, 2);
  assert.ok(st.sent.includes('sim_info/all_status'));
  assert.equal((await d.getDeviceDetails()).wanIp, '10.1.2.3');
});

test('STC AX3600: المسار الثاني (index/svcrunner) · كلمة غلط ← رسالة واضحة', async () => {
  router({ path: 'cgi-bin/luci/index/svcrunner' });
  const d = driver();
  assert.equal(await d.detect('192.168.1.1'), true);
  await assert.rejects(d.login('192.168.1.1', 'admin', 'غلط'), /كلمة المرور غلط/);
});

test('STC AX3600: صفحة LuCI القديمة ما يمسكها', async () => {
  (globalThis as any).fetch = async (url: string) => {
    const p = new URL(url).pathname.slice(1);
    const t = p === '' ? 'URL=cgi-bin/luci/index' : '<form><input name="luci_password"></form>';
    return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => t } as any;
  };
  assert.equal(await driver().detect('192.168.1.1'), false);
});

test('STC AX3600: تثبيت ترددات 4G ثم 5G ثم برج ثم فك · ما يقبل 4G و5G مع بعض · يتأكد بالقراءة', async () => {
  const st = router();
  const d = driver();
  await d.detect('192.168.1.1'); await d.login('192.168.1.1', 'admin', '9eTest');
  await d.setBand([3, 28]);
  assert.deepEqual(st.lock, { cell_cat: '7', cell_band: '3,28', cell_arfun: '', cell_pci: '' });
  let c = await d.getBandConfig();
  assert.deepEqual(c.locked, [3, 28]); assert.equal(c.lockKinds.lte, 'band');
  await d.setBand('keep', [78]);
  assert.equal(st.lock.cell_cat, '11'); assert.equal(st.lock.cell_band, '78');
  await assert.rejects(d.setBand([3], [78]), (e: any) => e.noChange === true);
  await assert.rejects(d.setBand([66]), (e: any) => e.noChange === true);
  await d.lockCell({ tech: 'LTE', band: 3, arfcn: '1650', pci: '211' });
  assert.deepEqual(await d.getCellLock(), { pci: '211', arfcn: '1650', band: 3, tech: 'LTE' });
  await assert.rejects(d.lockCell({ tech: 'LTE', pci: '211' }), (e: any) => e.noChange === true);
  await d.unlockCell();
  assert.equal(st.lock.cell_band, ''); assert.ok(st.sent.includes('lock_cell/clr'));
  await d.reboot(); assert.equal(st.rebooted, true);
});
