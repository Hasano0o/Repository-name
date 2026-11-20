/**
 * Inseego 8800L عليه تعديل MONDO DEBO (AUTH ٢١ نوفمبر) — راوتر محاكى لـ /cgi/mapi.cgi بنفس mondo-secure-client.js:
 * {a:'r'} / {a:'l', p:رمز} ← {ok,c,n,m[9]} · {a:'x', x:m[IDX], c, n} والرد يبدّل c/n · مهام band_apply/lock ← result.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'react-native') return { Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;

const M = require('../src/drivers/inseego/mondo');
const sha1 = (s: string) => (ncrypto as any).createHash('sha1').update(s, 'utf8').digest('hex');

const STATUS = {
  ok: true, radio_mode: '4', qmi_source: 'live',
  current: { band: '3', tech: 'LTE', rsrp: '-92', rsrq: '-10', snr: '11.2', cell: '22113281', operator: 'Zain', pci: '176', earfcn: '1275', ca: 'yes' },
  ca_detail: { qmi_ok: '1', component_count: '2', configured_count: '1', source: 'live', pcell: { band: '3', earfcn: '1275', pci: '176', bandwidth: '20' }, scells: [{ band: '1', earfcn: '100', pci: '33', bandwidth: '15', state: 'activated' }, { band: '20', earfcn: '6300', pci: '9', bandwidth: '10', state: 'deactivated' }] },
  lock: { pci: '', earfcn: '', dual_state: 'unlocked', state: 'unlocked' },
  cells: [{ pci: '176', earfcn: '1275', band: '3', rsrp: '-92' }, { pci: '201', earfcn: '1650', band: '3', rsrp: '-101', rsrq: '-14' }],
};
const NAMES = ['s0', 'r1', 'f2', 'lc3', 'lm4', 'u5', 'b6', 'rb7', 'rm8'];

function router(o: { resumeOk?: boolean; code?: string; bandFail?: string } = {}) {
  const st = { logged: false, mondo: false, c: 'c0', n: 'n0', posts: [] as any[], jobs: new Map<string, any>(), applied: '' };
  const res = (status: number, text: string) => ({ ok: status < 400, status, url: 'http://192.168.1.1/', headers: { get: () => null }, text: async () => text } as any);
  const sec = 'aa11', g = 'bb22';
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    switch (u.pathname) {
      case '/': return res(200, '<html><head><title>MiFi 8800L</title></head></html>');
      case '/srv/status': return res(200, JSON.stringify({ statusData: { statusBarNetwork: 'Zain', statusBarTechnology: '4G LTE', statusBarSignalBars: 4 } }));
      case '/login/': return res(200, `<html><script>var secToken = "${sec}";</script><input type="hidden" name="gSecureToken" value="${g}" /></html>`);
      case '/submitLogin/': {
        const p = new URLSearchParams(init.body);
        if (p.get('shaPassword') !== sha1('admin123' + sec)) return res(500, JSON.stringify({ authError: 'Incorrect password' }));
        st.logged = true; return res(200, '{}');
      }
      case '/diagnostics/': return res(200, '<div id="internetStatus4gRSSI">-99 dBm</div><div id="lteBand">3</div>');
      case '/assets/js/mondo-secure-client.js': return res(200, "(function(w){var E='/cgi/mapi.cgi';w.MondoAPI={};})(window);");
      case '/cgi/mapi.cgi': {
        const p = Object.fromEntries(new URLSearchParams(init.body));
        st.posts.push(p);
        const sess = () => { st.mondo = true; st.c = 'c' + st.posts.length; st.n = 'n' + st.posts.length; return { ok: true, c: st.c, n: st.n, m: NAMES }; };
        if (p.a === 'r') return res(200, JSON.stringify(o.resumeOk || st.mondo ? sess() : { ok: false, e: 'no_session' }));
        if (p.a === 'l') return res(200, JSON.stringify(p.p === (o.code ?? '12345678') ? sess() : { ok: false, e: 'pair_bad' }));
        if (p.a === 'x') {
          if (!st.mondo || p.c !== st.c || p.n !== st.n) return res(200, JSON.stringify({ ok: false, e: 'request_rejected' }));
          st.c = 'c' + st.posts.length; st.n = 'n' + st.posts.length;
          const roll = { c: st.c, n: st.n };
          const name = NAMES.indexOf(p.x);
          if (name === 0) return res(200, JSON.stringify({ ...STATUS, ...roll }));
          if (name === 1) { const j = st.jobs.get(p.i); const done = j && --j.left <= 0; return res(200, JSON.stringify(done ? { ...j.result, ...roll } : { ok: true, pending: true, ...roll })); }
          if (name === 6) {
            st.applied = p.b;
            st.jobs.set('j1', { left: 2, result: o.bandFail ? { ok: false, message: o.bandFail } : { ok: true, message: 'Band_selection_applied_live' } });
            return res(200, JSON.stringify({ ok: true, id: 'j1', ...roll }));
          }
          if (name === 4) { st.jobs.set('j2', { left: 1, result: { ok: true, message: 'locked' } }); return res(200, JSON.stringify({ ok: true, id: 'j2', p: p.p, e: p.e, ...roll })); }
          return res(200, JSON.stringify({ ok: false, e: 'bad_request', ...roll }));
        }
        return res(200, JSON.stringify({ ok: false }));
      }
      default: return res(404, 'Not Found');
    }
  };
  return st;
}
const driver = () => { const { InseegoDriver } = require('../src/drivers/inseego/index'); return new InseegoDriver(); };
const fastSleep = () => Promise.resolve();

test('MONDO: النواقل والإشارة والأبراج من status (الثانوي المطفي ما ينحسب)', () => {
  const c = M.mondoCarriers(STATUS);
  assert.equal(c.length, 2);
  assert.deepEqual([c[0].role, c[0].band, c[0].pci, c[0].bandwidth], ['PCC', 3, '176', 20]);
  assert.deepEqual([c[1].role, c[1].band, c[1].arfcn], ['SCC', 1, '100']);
  const s = M.mondoSignal(STATUS);
  assert.equal(s.band, 'B3+B1'); assert.equal(s.caCount, 2); assert.equal(s.caBandwidthMhz, 35);
  assert.equal(s.rsrp, -92); assert.equal(s.sinr, 11.2); assert.equal(s.pci, '176'); assert.equal(s.earfcn, '1275');
  const cells = M.mondoCells(STATUS);
  assert.deepEqual(cells.map((x: any) => x.kind), ['serving', 'secondary', 'neighbor']);
  assert.equal(M.mondoLock(STATUS), null);
  assert.deepEqual(M.mondoLock({ lock: { pci: '201', earfcn: '1650', dual_state: 'locked' } }), { pci: '201', arfcn: '1650', tech: 'LTE', band: undefined });
  // بدون دمج: الأساسي بس
  assert.equal(M.mondoCarriers({ current: { band: '20', pci: '5', ca: 'no' } }).length, 1);
  assert.equal(M.mondoBw('100'), 20); assert.equal(M.mondoBw('15'), 15);
});

test('MONDO: العميل — رمز ← جلسة ← الأمر يبدّل c/n ← request_rejected = جلسة جديدة مرة', async () => {
  const st = router();
  const posts: any[] = [];
  const post = async (f: any) => { posts.push(f); const r = await (globalThis as any).fetch('http://192.168.1.1/cgi/mapi.cgi', { method: 'POST', body: M.mondoForm(f) }); return JSON.parse(await r.text()); };
  const c = new M.MondoClient(post);
  await assert.rejects(c.call('status'), (e: any) => M.isMondoCodeError(e));
  await assert.rejects(c.pair('12'), /كما هو/);
  await assert.rejects(c.pair('87654321'), /غلط/);
  await c.pair('12345678');
  const r1 = await c.call('status');
  assert.equal(r1.current.band, '3');
  const r2 = await c.call('status');
  assert.equal(r2.ok, true, 'c/n المتبدّلة تنرسل صح');
  st.c = 'other';  // الجهاز رفض (جلسة قديمة) ← resume (فيه جلسة عند الجهاز) ← نجاح
  assert.equal((await c.call('status')).ok, true);
});

test('MONDO: الدرايفر — بدون رمز تطلع خانة الرمز، وبعده الأساسي والثانوي والتثبيت', async () => {
  const st = router();
  const d = driver();
  await d.detect('192.168.1.1');
  await d.login('192.168.1.1', 'admin', 'admin123');
  assert.ok(d.codePair && d.getBandConfig && d.setBand && d.lockCell && d.getCarriers, 'الأدوات تنضاف بعد ما نلقى الأداة');
  assert.equal(await d.codePair.needed(), true);
  // بدون جلسة: القراءة ترجع لـ Diagnostics، والتثبيت يوقف قبل أي أمر
  assert.equal((await d.getSignal()).rsrp, -99);
  await assert.rejects(d.setBand([3]), (e: any) => e.noChange === true);
  assert.equal(st.applied, '');
  await d.codePair.submit('12345678');
  assert.equal(await d.codePair.needed(), false);
  const s = await d.getSignal();
  assert.equal(s.band, 'B3+B1'); assert.equal(s.pci, '176');
  assert.equal((await d.getCarriers()).length, 2);
  const cfg = await d.getBandConfig();
  assert.ok(cfg.supported.includes(3) && cfg.supported.includes(20)); assert.equal(cfg.mode, '4');
  // تسريع انتظار المهام
  const realSet = (globalThis as any).setTimeout;
  (globalThis as any).setTimeout = (f: any) => realSet(f, 0);
  try {
    await d.setBand([3, 1, 99]);
    assert.equal(st.applied, '1,3', 'الترددات المدعومة بس، مرتبة');
    assert.deepEqual((await d.getBandConfig()).locked, [1, 3]);
    await d.lockCell({ tech: 'LTE', pci: '201', arfcn: '1650' });
    assert.ok(st.posts.some(p => p.x === 'lm4' && p.p === '201' && p.e === '1650'));
  } finally { (globalThis as any).setTimeout = realSet; }
});

test('MONDO: فشل ورجع الإعداد السابق ← noChange برسالة الأداة', async () => {
  router({ resumeOk: true, bandFail: 'Band_change_failed_original_selection_restored' });
  const d = driver();
  await d.detect('192.168.1.1');
  await d.login('192.168.1.1', 'admin', 'admin123');
  const realSet = (globalThis as any).setTimeout;
  (globalThis as any).setTimeout = (f: any) => realSet(f, 0);
  try {
    await assert.rejects(d.setBand([3]), (e: any) => e.noChange === true && /رجعت الترددات السابقة/.test(e.message));
  } finally { (globalThis as any).setTimeout = realSet; }
});

test('MONDO: جهاز بدون الأداة ← ما تنضاف أدوات التثبيت', async () => {
  router();
  const prev = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init?: any) => (new URL(url).pathname === '/assets/js/mondo-secure-client.js'
    ? { ok: false, status: 404, url, headers: { get: () => null }, text: async () => 'Not Found' } : prev(url, init));
  const d = driver();
  await d.detect('192.168.1.1');
  await d.login('192.168.1.1', 'admin', 'admin123');
  assert.equal(d.getBandConfig, undefined); assert.equal(d.codePair, undefined);
  void fastSleep;
});
