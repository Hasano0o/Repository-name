import { test } from 'node:test';
import assert from 'node:assert/strict';
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (req === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } };
  }
  return origLoad.call(this, req, ...rest);
};
const { estimateLoad, loadLevel, smoothLoad } = require('../src/utils/congestion');
const { diagnose } = require('../src/utils/latency');

test('estimateLoad: برج بهوائيين فاضي (‎-6) = فاضي، و‎-8 مو مزحوم', () => {
  assert.equal(loadLevel(estimateLoad(-6, 20)!), 'free');
  assert.equal(loadLevel(estimateLoad(-7, 20)!), 'free');
  assert.ok(loadLevel(estimateLoad(-8, 20)!) !== 'busy');
  assert.equal(loadLevel(estimateLoad(-10, 20)!), 'busy');
  assert.equal(loadLevel(estimateLoad(-11, 20)!), 'packed');
});

test('estimateLoad: تشويش (SINR تحت ١٠) أو قيمة غلط = ما نحكم', () => {
  assert.equal(estimateLoad(-12, 5), undefined);
  assert.equal(estimateLoad(-12, 9.9), undefined);
  assert.equal(estimateLoad(0, 20), undefined);
  assert.equal(estimateLoad(undefined, 20), undefined);
});

test('smoothLoad: قراءة شاذة وحدة ما تقلب الحكم', () => {
  assert.equal(smoothLoad([0.2, 0.25, 1, 0.2, 0.3]), 0.25);
  assert.equal(smoothLoad([]), undefined);
});

test('diagnose: التذبذب بدون دليل من الإشارة ما يقول «البرج زحمة»', () => {
  const game = { samples: 20, median: 70, jitter: 40, lossPct: 0, min: 50, max: 160 } as any;
  assert.equal(diagnose(game, null, 15, 0).title, 'الاتصال متذبذب الحين');
  assert.equal(diagnose(game, null, 15, 0, false, 0.2).title, 'الاتصال متذبذب الحين');
  assert.equal(diagnose(game, null, 15, 0, false, 0.8).title, 'البرج زحمة الحين');
});
