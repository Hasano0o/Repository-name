/**
 * «ضبط المصنع» بعد التجارب (تعليق عضو ٦ نوفمبر + ٦٣ فشل إرجاع بأسبوع):
 *  1. اضبط لي كل شي / الأبراج كانت تبلع فشل الإرجاع ← الراوتر يبقى على آخر تجربة (بدون دمج).
 *     restoreOrFree: الفشل ← فك كل التثبيتات (يلقط أقوى برج) مع حفظ إعدادك.
 *  2. لقطة ما قبل التجربة كانت في الذاكرة بس ← لو انقطعت التجربة ما يرجع شي.
 *     pendingRestore + recoverPending: تنحفظ على الجوال وترجع أول ما يرجع التطبيق على شبكة الراوتر.
 * الجلسات والواجهة بدائل؛ safeLock نفسه حقيقي.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
const store = new Map<string, string>();
let driver: any = null;
const T: any = new Proxy({}, { get: () => () => T });
const stubs: Record<string, unknown> = {
  'react-native': { Alert: { alert() {} }, Platform: { OS: 'android' } },
  '@react-native-async-storage/async-storage': { __esModule: true, default: {
    getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => { store.set(k, v); }, removeItem: async (k: string) => { store.delete(k); },
  } },
  '../store/sessions': {
    withSession: async (_r: unknown, fn: (d: unknown) => unknown) => fn(driver),
    withSessionPatient: async (_r: unknown, fn: (d: unknown) => unknown) => fn(driver),
    withRouterLock: async (_r: unknown, fn: (op: unknown) => unknown) => fn({}),
    dropSession() {}, isRouterBusyAnywhere: async () => false,
  },
  '../services/errors': { reportError() {} },
  '../store/baseline': { getBaseline: async () => null },
  '../drivers/registry': { driverById: () => driver },
  './nrprobe': { trafficBurst: async () => 0 },
  './signal': { isNoService: () => false },
  '../ui/Progress': { progress: { start: () => T, none: T } },
};
Module._load = function (req: string, ...rest: unknown[]) {
  if (req in stubs) return stubs[req];
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;

const { restoreOrFree, recoverPending } = require('../src/utils/safeLock');
const { savePending, getPending } = require('../src/store/pendingRestore');
const { getReleaseSnap } = require('../src/store/lockSnap');

const R = { id: 'r1', driverId: 'test-drv', host: '192.168.8.1', name: 'x' };
const SNAP = { driver: 'test-drv', at: 1, summary: '4G: تلقائي', data: { lte: 'auto' } };

/** راوتر محاكى: restoreFails = الإرجاع يرمي (مشغول) · reachable=false = الجوال مو على شبكته */
function fake(o: { restoreFails?: boolean; reachable?: boolean } = {}) {
  const log: string[] = [];
  driver = {
    id: 'test-drv',
    readLockState: async () => { if (o.reachable === false) throw new Error('تعذر الاتصال بالراوتر'); return SNAP; },
    restoreLockState: async (s: unknown) => { log.push('restore'); if (o.restoreFails) throw new Error('الراوتر ما رد'); assert.deepEqual(s, SNAP); },
    setBand: async (a: unknown[], b: unknown[]) => { log.push(`setBand(${a.length},${b.length})`); },
    getCellLocks: async () => [],
    getSignal: async () => ({ rsrp: -90 }),
    isConnected: async () => true,
  };
  return log;
}

test('restoreOrFree: الإرجاع نجح ← ما نفك شي، والتجربة تنمسح', async () => {
  store.clear();
  const log = fake();
  await savePending('r1', SNAP, 'pilot:band', 'اضبط لي كل شي');
  const res = await restoreOrFree(R, SNAP, () => {});
  assert.equal(res.exact, true);
  assert.equal(res.freed, false);
  assert.deepEqual(log, ['restore']);
  assert.equal(await getPending('r1'), null);
});

test('restoreOrFree: الإرجاع فشل ← نفك التثبيتات (ما نخليه على آخر تجربة) ونحفظ إعدادك', async () => {
  store.clear();
  const log = fake({ restoreFails: true });
  await savePending('r1', SNAP, 'pilot:band', 'اضبط لي كل شي');
  const res = await restoreOrFree(R, SNAP, () => {});
  assert.equal(res.exact, false);
  assert.equal(res.freed, true);
  assert.equal(res.online, true);
  assert.ok(log.includes('setBand(0,0)'), log.join(' '));
  assert.deepEqual(await getReleaseSnap('r1'), SNAP);     // يقدر يرجّعه من صفحة الراوتر
  assert.equal(await getPending('r1'), null);
});

test('recoverPending: تجربة انقطعت ← نرجّع إعدادها لما يرجع التطبيق على الشبكة', async () => {
  store.clear();
  const log = fake();
  await savePending('r1', SNAP, 'combo:3+1', 'B3 + B1');
  const res = await recoverPending(R);
  assert.equal(res?.ok, true);
  assert.match(res!.note, /B3 \+ B1/);
  assert.deepEqual(log, ['restore']);
  assert.equal(await getPending('r1'), null);
});

test('recoverPending: الجوال مو على شبكة الراوتر ← ما نسوي شي وتبقى للمرة الجاية', async () => {
  store.clear();
  const log = fake({ reachable: false });
  await savePending('r1', SNAP, 'combo:3+1', 'B3 + B1');
  assert.equal(await recoverPending(R), null);
  assert.deepEqual(log, []);
  assert.ok(await getPending('r1'));
});

test('recoverPending: لقطة نوع راوتر ثاني أو قديمة ← تنمسح بدون أي أمر', async () => {
  store.clear();
  const log = fake();
  await savePending('r1', { ...SNAP, driver: 'zte' }, 'x', 'x');
  assert.equal(await recoverPending(R), null);
  assert.equal(await getPending('r1'), null);
  assert.deepEqual(log, []);
});
