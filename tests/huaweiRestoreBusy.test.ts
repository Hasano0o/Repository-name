/**
 * هواوي — إرجاع بعد تجربة 5G أساسي (تقرير nrprim:78، ٢٨ نوفمبر ١٤:٥٠): رجّعنا الوضع 00 والراوتر رد على
 * GET lock-freq بـ 100006 وهو يعيد تهيئة المودم ← وقف الإرجاع. الحين نعيد القراءة لين يرد.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

declare const require: any;
declare const process: any;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === 'react-native') return { Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
  if (req === 'expo-crypto') return { getRandomBytes: (n: number) => Uint8Array.from(require('crypto').randomBytes(n)) };
  if (req === '@react-native-async-storage/async-storage') {
    const m = new Map<string, string>();
    return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } } };
  }
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
(globalThis as any).__DEV__ = false;
const realSet = setTimeout;
(globalThis as any).setTimeout = (fn: any, ms?: number) => realSet(fn, ms && ms >= 500 ? 1 : ms);

const { HuaweiDriver, HuaweiError } = require('../src/drivers/huawei/index');

test('lock-freq يرد 100006 مرتين بعد تغيير الوضع ← نعيد ونكمّل', async () => {
  const d = new HuaweiDriver();
  let n = 0;
  d.get = async (p: string) => {
    assert.equal(p, 'net/lock-freq');
    if (++n <= 2) throw new HuaweiError('100006');
    return '<response><ok/></response>';
  };
  assert.equal(await d.lockFreqPatient(), '<response><ok/></response>');
  assert.equal(n, 3);
});

test('غير 100006 (مثل 100003 انتهت الجلسة) ← يرمي على طول عشان طبقة الجلسة تدخل من جديد', async () => {
  const d = new HuaweiDriver();
  let n = 0;
  d.get = async () => { n++; throw new HuaweiError('100003'); };
  await assert.rejects(d.lockFreqPatient(), /100003/);
  assert.equal(n, 1);
});

test('100006 على طول ← بعد كم محاولة يرمي', async () => {
  const d = new HuaweiDriver();
  let n = 0;
  d.get = async () => { n++; throw new HuaweiError('100006'); };
  await assert.rejects(d.lockFreqPatient(), /100006/);
  assert.equal(n, 6);
});
