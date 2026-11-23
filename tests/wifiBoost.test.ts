import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boostCheck, splitName } from '../src/utils/wifiBoost';

const goodLan = { median: 3, jitter: 1, lossPct: 0, samples: 10 };
const busyLan = { median: 25, jitter: 18, lossPct: 0, samples: 10 };

test('سرّع: 5 جيجا مطفية ← أول شي + زر التشغيل لو مسموح', () => {
  const r = boostCheck({ bands: [{ band: '2.4', on: true }, { band: '5', on: false }], can: { bandOn: true } });
  assert.equal(r[0].key, 'five-off');
  assert.equal(r[0].fix, 'enable5');
  assert.equal(boostCheck({ bands: [{ band: '5', on: false }] })[0].fix, undefined);
});

test('سرّع: جوال على 2.4 والشبكتين بأسماء مختلفة ← اتصل بالـ 5G باسمها', () => {
  const r = boostCheck({ phone: { rssi: -47, frequency: 2462 }, nets: [{ index: '1', band: '2.4', name: 'WLANC769F7' }, { index: '5', band: '5', name: 'WLANC769F7-5G' }] });
  const on24 = r.find(x => x.key === 'on24')!;
  assert.equal(on24.level, 'bad');
  assert.match(on24.why, /WLANC769F7-5G/);
});

test('سرّع: نفس الاسم ← افصل الشبكتين', () => {
  const r = boostCheck({ phone: { rssi: -50, frequency: 2412 }, nets: [{ index: '1', band: '2.4', name: 'بيت' }, { index: '5', band: '5', name: 'بيت' }], can: { rename: true } });
  assert.equal(r.find(x => x.key === 'on24-same')?.fix, 'split');
});

test('سرّع: إشارة قوية وبنق متذبذب ← قناة مزحومة', () => {
  const r = boostCheck({ phone: { rssi: -50, frequency: 5180 }, lan: busyLan, can: { channel: true } });
  assert.equal(r.find(x => x.key === 'busy')?.fix, 'channel');
  assert.ok(r.some(x => x.key === 'on5'));
});

test('سرّع: قناة 2.4 على ١٣ أو ٤', () => {
  assert.ok(boostCheck({ radios: [{ band: '2.4', channel: '13' }] }).some(x => x.key === 'ch-high'));
  assert.ok(boostCheck({ radios: [{ band: '2.4', channel: '4' }] }).some(x => x.key === 'ch-overlap'));
  assert.ok(!boostCheck({ radios: [{ band: '2.4', channel: '6' }, { band: '5', channel: '36' }] }).some(x => x.key.startsWith('ch-')));
  assert.ok(!boostCheck({ radios: [{ band: '2.4', channel: '0' }] }).some(x => x.key.startsWith('ch-')));
});

test('سرّع: الترتيب الأسوأ أول، والكل تمام', () => {
  const r = boostCheck({ phone: { rssi: -45, frequency: 5180 }, lan: goodLan });
  assert.ok(r.every(x => x.level === 'ok'));
  const m = boostCheck({ phone: { rssi: -80, frequency: 5180 }, lan: goodLan });
  assert.equal(m[0].level, 'bad');
});

test('سرّع: اسم 5G بعد الفصل', () => {
  assert.equal(splitName('WLANC769F7'), 'WLANC769F7-5G');
  assert.equal(splitName('Home 5G'), 'Home-5G');
  assert.ok(splitName('x'.repeat(40)).length <= 32);
});
