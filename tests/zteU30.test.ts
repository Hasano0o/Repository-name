/**
 * ZTE U30 Pro على راوتر محاكى بأوامر صفحته الحقيقية (service.js ٢٧ أكتوبر):
 * LTE_BAND_LOCK / NR_BAND_LOCK بقوائم أرقام، توقيع AD = SHA256(SHA256(wa+cr)+RD) كبير، وإعادة تشغيل بعد التغيير.
 * والتأكيد إن MU5001 ما يمر على هالمسار أبداً.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 1000 ? 1 : ms);

const { sha256 } = require(require.resolve('@noble/hashes/sha2', { paths: [process.cwd()] }));
const { bytesToHex, utf8ToBytes } = require(require.resolve('@noble/hashes/utils', { paths: [process.cwd()] }));
const SHA = (s: string) => bytesToHex(sha256(utf8ToBytes(s))).toUpperCase();

const WA = 'U30Pro_GEN_MEASV1.0.0B07';
const CR = 'MU5358_GEN_MEASV1.0.0B07';
const RD = 'rd123';

function router(kind: 'u30' | 'mu5001' = 'u30') {
  const st: Record<string, string> = {
    lte_band_lock: '1,3,5,8,34,39,40,41', nr_band_lock: '1,5,8,28,41,78', net_select: 'WL_AND_5G',
    frequency_support_4g: '[1,3,5,8,34,39,40,41]', frequency_support_5g: '[1,5,8,28,41,78]',
  };
  const locked: any[] = [];
  const posts: string[] = [];
  const goodAd = SHA(SHA(WA + CR) + RD);
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = new URL(url);
    const reply = (o: unknown) => ({ ok: true, status: 200, url, headers: { get: () => null }, text: async () => typeof o === 'string' ? o : JSON.stringify(o) } as any);
    if (u.pathname.endsWith('goform_set_cmd_process')) {
      const f = new URLSearchParams(String(init?.body ?? ''));
      const id = f.get('goformId') ?? '?';
      posts.push(id);
      if (id === 'LOGIN') return reply({ result: '0' });
      if (id === 'LOGOUT' || id === 'GOFORM_LOGOUT') return reply({ result: 'success' });
      if (kind === 'mu5001') return reply({ result: 'success' });
      // توقيع غلط ← الراوتر يقطع بدون رد (نفس سجل U30 الحقيقي)
      if (f.get('AD') !== goodAd) return reply('');
      if (id === 'LTE_BAND_LOCK') { st.lte_band_lock = f.get('lte_band_lock') ?? ''; return reply({ result: 'success' }); }
      if (id === 'NR_BAND_LOCK') { st.nr_band_lock = f.get('nr_band_lock') ?? ''; return reply({ result: 'success' }); }
      if (id === 'SET_BEARER_PREFERENCE') { st.net_select = f.get('BearerPreference') ?? ''; return reply({ result: 'success' }); }
      if (id === 'UNLOCK_ALL_CELL') { locked.length = 0; return reply({ result: 'success' }); }
      if (id === 'REBOOT_DEVICE') return reply({ result: 'success' });
      return reply({}); // أوامر MU5001 (BAND_SELECT…) ما لها معالج هنا
    }
    const keys = (u.searchParams.get('cmd') ?? '').split(',');
    if (keys[0] === 'locked_cell_info') return reply({ locked_cell_info: locked });
    if (keys[0] === 'neighbor_cell_info') return reply({ neighbor_cell_info: [{ band: '3', earfcn: '1650', pci: '77', rsrp: '-95', rsrq: '-11', sinr: '6' }] });
    const vers: Record<string, string> = kind === 'u30'
      ? { wa_inner_version: WA, cr_version: CR, web_version: WA }
      : { wa_inner_version: 'BD_STCMU5001V1.0.2B04', cr_version: '', web_version: '' };
    const o: Record<string, string> = {};
    for (const k of keys) o[k] = vers[k] ?? st[k] ?? (k === 'RD' ? RD : k === 'loginfo' ? 'ok' : k === 'LD' ? 'LD1' : k === 'network_type' ? 'ENDC' : '');
    return reply(o);
  };
  return { st, posts, locked };
}

function driver() {
  const { ZteDriver } = require('../src/drivers/zte/index');
  const d = new ZteDriver();
  (d as any).host = '192.168.0.1';
  (d as any).password = 'x';
  (d as any).ensure = async () => {};
  // إعادة التشغيل الحقيقية تنتظر الراوتر يرجع — هنا نرسل الأمر بس
  (d as any).rebootAndWait = async () => { await (d as any).assertWritable('REBOOT_DEVICE'); await (d as any).post({ goformId: 'REBOOT_DEVICE' }); };
  return d;
}
const writes = (p: string[]) => p.filter(x => !['LOGIN', 'LOGOUT', 'GOFORM_LOGOUT'].includes(x));

test('U30: الترددات المدعومة والمقفول من قوائم الراوتر', async () => {
  const r = router();
  r.st.lte_band_lock = '1,3';
  const c = await driver().getBandConfig();
  assert.deepEqual(c.supported, [1, 3, 5, 8, 34, 39, 40, 41]);
  assert.deepEqual(c.locked, [1, 3]);
  assert.deepEqual(c.nrLocked, [], 'كل 5G مفتوح = مو مقفول');
  assert.equal(c.mode, '00');
});

test('U30: تثبيت 4G = LTE_BAND_LOCK بقائمة أرقام + توقيع SHA256 + إعادة تشغيل — بدون BAND_SELECT', async () => {
  const r = router();
  await driver().setBand([3, 1]);
  assert.equal(r.st.lte_band_lock, '1,3');
  const w = writes(r.posts).filter(x => x !== 'LTE_BAND_LOCK' || true);
  assert.ok(!w.includes('BAND_SELECT'), w.join(','));
  assert.equal(w[w.length - 1], 'REBOOT_DEVICE');
  assert.equal(r.st.nr_band_lock, '1,5,8,28,41,78', '5G ما تلمّس');
});

test('U30: 5G = NR_BAND_LOCK، و«فك» = كل المدعوم', async () => {
  const r = router();
  const d = driver();
  await d.setBand('keep', [78]);
  assert.equal(r.st.nr_band_lock, '78');
  await d.setBand([], []);
  assert.equal(r.st.lte_band_lock, '1,3,5,8,34,39,40,41');
  assert.equal(r.st.nr_band_lock, '1,5,8,28,41,78');
});

test('U30: نفس القيمة الحالية ← ما نرسل شي ولا نعيد التشغيل', async () => {
  const r = router();
  await driver().setBand([], []);
  assert.deepEqual(writes(r.posts), []);
});

test('U30: لقطة ← تغيير ← إرجاع متحقق منه', async () => {
  const r = router();
  r.st.lte_band_lock = '1,3,8';
  const d = driver();
  const snap = await d.readLockState();
  assert.match(snap.summary, /B1\+B3\+B8/);
  await d.setBand([3], [78]);
  await d.setNetworkMode('03');
  assert.equal(r.st.net_select, 'Only_LTE');
  await d.restoreLockState(snap);
  assert.equal(r.st.lte_band_lock, '1,3,8');
  assert.equal(r.st.nr_band_lock, '1,5,8,28,41,78');
  assert.equal(r.st.net_select, 'WL_AND_5G');
});

test('U30: فك الأبراج = UNLOCK_ALL_CELL بس لو فيه تثبيت', async () => {
  const r = router();
  const d = driver();
  await d.unlockCell();
  assert.deepEqual(writes(r.posts), [], 'راوتر نظيف ← ما نرسل شي');
  r.locked.push({ pci: '77', earfcn: '1650', rat: 12 });
  const locks = await d.getCellLocks();
  assert.equal(locks[0].tech, 'LTE');
  assert.equal(locks[0].band, 3);
  await d.unlockCell();
  assert.ok(writes(r.posts).includes('UNLOCK_ALL_CELL'));
  assert.equal(r.locked.length, 0);
});

test('U30: الواي فاي يبقى محجوب (ما انثبت)', async () => {
  const r = router();
  const d = driver();
  try { await d.setBandOn('2.4', true); } catch {}
  assert.deepEqual(writes(r.posts), []);
  for (const id of ['setAccessPointInfo', 'SET_WIFI_INFO', 'BAND_SELECT']) {
    let err: any;
    try { await d.assertWritable(id); } catch (e) { err = e; }
    assert.equal(err?.noChange, true, id);
  }
});

test('MU5001: ما يمر على أوامر U30 — نفس BAND_SELECT القديم', async () => {
  const r = router('mu5001');
  try { await driver().setBand([3]); } catch {}
  assert.ok(r.posts.includes('BAND_SELECT'), r.posts.join(','));
  assert.ok(!r.posts.includes('LTE_BAND_LOCK'));
});
