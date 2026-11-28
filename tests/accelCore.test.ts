/** «هل يفيدك مسرّع؟» — src/utils/accelCore.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const { accelVerdict, parseAccelConfig, TUNNEL_MS } = require('../src/utils/accelCore');

const L = (median: number, jitter = 2, lossPct = 0) => ({ median, jitter, lossPct, samples: 10 });

test('طريق أقصر عبر سيرفرنا = يفيد', () => {
  const v = accelVerdict(L(80), L(25), L(20));
  assert.equal(v.kind, 'helps');
  assert.equal(v.via, 45 + TUNNEL_MS);
  assert.equal(v.gain, 80 - 45 - TUNNEL_MS);
});

test('الطريق المباشر أصلاً ممتاز = ما يفيد', () => {
  assert.equal(accelVerdict(L(30), L(25), L(20)).kind, 'no');
});

test('فرق بسيط', () => {
  assert.equal(accelVerdict(L(55), L(25), L(22)).kind, 'small');
});

test('فقد كبير بالمباشر والمسرّع نظيف = يفيد حتى لو البنق قريب', () => {
  assert.equal(accelVerdict(L(50, 2, 20), L(25), L(22)).kind, 'helps');
});

test('سيرفرنا ما رد = فشل', () => {
  assert.equal(accelVerdict(L(50), null, L(20)).kind, 'fail');
  assert.equal(accelVerdict(L(50), { median: 0, jitter: 0, lossPct: 100, samples: 0 }, L(20)).kind, 'fail');
});

test('المباشر ما رد وطريقنا يرد = يفيد', () => {
  assert.equal(accelVerdict({ median: 0, jitter: 0, lossPct: 100, samples: 0 }, L(25), L(20)).kind, 'helps');
});

test('الإعدادات: https بس وبدون مسار', () => {
  const s = parseAccelConfig({ servers: [
    { id: 'ruh1', name: 'الرياض', url: 'https://1-2-3-4.sslip.io/' },
    { id: 'x', name: 'x', url: 'http://1.2.3.4' },
    { id: 'y', name: 'y', url: 'https://a.com/path' },
    { id: 1, name: 'z', url: 'https://b.com' },
  ] });
  assert.deepEqual(s, [{ id: 'ruh1', name: 'الرياض', url: 'https://1-2-3-4.sslip.io' }]);
  assert.deepEqual(parseAccelConfig(null), []);
});

test('فقد أقل بس البنق أبطأ بوضوح ← مو «يفيد» (الدمام ٢٧ نوفمبر: 113 ← 203)', () => {
  const L2 = (median: number, lossPct: number) => ({ median, jitter: 2, lossPct, samples: 10 });
  assert.equal(accelVerdict(L2(113, 20), L2(56, 0), L2(144, 0)).kind, 'no');
  // فقد أقل والبنق قريب ← يفيد
  assert.equal(accelVerdict(L2(80, 20), L2(50, 0), L2(30, 0)).kind, 'helps');
});
