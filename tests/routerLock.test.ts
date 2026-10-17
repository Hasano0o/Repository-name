/**
 * اختبارات طبقة التحكم الموحّدة (الحجز) — بدون راوتر ولا تطبيق.
 * التشغيل: node tests/run.cjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouterLocks, isRouterBusyError, BUSY_PREFIX } from '../src/store/routerLockCore';

function fakeStore() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => { m.set(k, v); },
    remove: async (k: string) => { m.delete(k); },
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const caught = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e; } };

test('عملية ثانية على نفس الراوتر تنرفض فوراً (ما تنتظر ولا تتنفّذ بعدين)', async () => {
  const L = createRouterLocks(fakeStore());
  let release!: () => void;
  const first = L.withLock('huawei@192.168.8.1', () => new Promise<void>(r => { release = r; }), { label: 'التثبيت' });
  await tick();
  let ran = false;
  const e = await caught(L.withLock('huawei@192.168.8.1', async () => { ran = true; }));
  assert.ok(isRouterBusyError(e));
  assert.ok(String((e as Error).message).includes('التثبيت'));
  assert.equal(ran, false);
  release();
  await first;
  // بعد ما خلصت الأولى: الجديدة تشتغل
  let ran2 = false;
  await L.withLock('huawei@192.168.8.1', async () => { ran2 = true; });
  assert.equal(ran2, true);
});

test('راوتر ثاني ما ينحجز', async () => {
  const L = createRouterLocks(fakeStore());
  let release!: () => void;
  const first = L.withLock('a', () => new Promise<void>(r => { release = r; }));
  await tick();
  let ran = false;
  await L.withLock('b', async () => { ran = true; });
  assert.equal(ran, true);
  release();
  await first;
});

test('الخطوات اللي جوا العملية (op) تكمّل وما تنرفض', async () => {
  const L = createRouterLocks(fakeStore());
  const steps: string[] = [];
  await L.withLock('a', async op => {
    steps.push('outer');
    await L.withLock('a', async () => { steps.push('inner1'); }, { op });
    await L.withLock('a', async () => { steps.push('inner2'); }, { op });
  });
  assert.deepEqual(steps, ['outer', 'inner1', 'inner2']);
  assert.equal(L.isBusy('a'), false);
});

test('op لراوتر ثاني ينرفض', async () => {
  const L = createRouterLocks(fakeStore());
  const e = await L.withLock('a', async op => caught(L.withLock('b', async () => {}, { op })));
  assert.ok(e instanceof Error);
});

test('الحجز يبقى لين الوعد يخلص فعلاً (انتهاء المهلة ما يفكه)', async () => {
  const L = createRouterLocks(fakeStore());
  let finish!: () => void;
  L.holdPromise('a', new Promise<void>(r => { finish = r; }));
  assert.equal(L.isBusy('a'), true);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(L.isBusy('a'), true);
  assert.ok(isRouterBusyError(await caught(L.withLock('a', async () => {}))));
  finish();
  await tick(); await tick();
  assert.equal(L.isBusy('a'), false);
});

test('الحجز ينفك حتى لو العملية فشلت', async () => {
  const L = createRouterLocks(fakeStore());
  await caught(L.withLock('a', async () => { throw new Error('رفض'); }));
  assert.equal(L.isBusy('a'), false);
});

test('العلامة المحفوظة: تشغيل ثاني للتطبيق يشوف الحجز، وتنتهي لحالها', async () => {
  const st = fakeStore();
  let t = 1_000_000;
  const A = createRouterLocks(st, { now: () => t, ttlMs: 60_000 });
  const B = createRouterLocks(st, { now: () => t, ttlMs: 60_000 }); // مهمة خلفية بذاكرة منفصلة
  let release!: () => void;
  const p = A.withLock('a', () => new Promise<void>(r => { release = r; }));
  await tick();
  assert.equal(await B.isBusyAnywhere('a'), true);
  assert.ok(isRouterBusyError(await caught(B.withLock('a', async () => {}))));
  release();
  await p;
  await tick();
  assert.equal(st.m.has(BUSY_PREFIX + 'a'), false);
  assert.equal(await B.isBusyAnywhere('a'), false);
  // علامة قديمة من تطبيق انقفل في النص: تنتهي بعد عمرها
  st.m.set(BUSY_PREFIX + 'a', String(t + 60_000));
  assert.equal(await B.isBusyAnywhere('a'), true);
  t += 61_000;
  assert.equal(await B.isBusyAnywhere('a'), false);
});

test('خطأ «مشغول» معلّم إنه ما غيّر شي', async () => {
  const L = createRouterLocks(fakeStore());
  let release!: () => void;
  const p = L.withLock('a', () => new Promise<void>(r => { release = r; }));
  await tick();
  const e: any = await caught(L.withLock('a', async () => {}));
  assert.equal(e.noChange, true);
  assert.equal(e.reverted, false);
  release();
  await p;
});
