import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carrierRows, carrierLevel, hasPerCarrier, weakNote } from '../src/utils/carrierQuality';

const C = (role: 'PCC' | 'SCC', band: number, rsrp?: number, sinr?: number, tech: 'LTE' | 'NR' = 'LTE') => ({ tech, band, role, rsrp, sinr });

test('الأساسي أول دايماً، والترتيب الباقي كما هو', () => {
  const r = carrierRows([C('SCC', 1, -90, 10), C('PCC', 3, -85, 15), C('SCC', 20, -95, 5)]);
  assert.deepEqual(r.map(x => x.band), [3, 1, 20]);
});

test('التقييم = الأضعف بين RSRP و SINR', () => {
  assert.equal(carrierLevel({ rsrp: -75, sinr: 22 }), 'excellent');
  assert.equal(carrierLevel({ rsrp: -75, sinr: -2 }), 'poor');
  assert.equal(carrierLevel({ rsrp: -95 }), 'fair');
  assert.equal(carrierLevel({}), 'unknown');
});

test('ثانوي أضعف من الأساسي بـ ١٠ dB أو أكثر ← ضعيف + الفرق', () => {
  const r = carrierRows([C('PCC', 3, -80, 15), C('SCC', 1, -92, 14)]);
  assert.equal(r[1].weak, true);
  assert.equal(r[1].behind, 12);
  assert.match(weakNote(r)!, /B1 أضعف من الأساسي بـ 12 dB/);
});

test('5G ما ينقارن بالأساسي 4G (التردد العالي أضعف طبيعي)', () => {
  const r = carrierRows([C('PCC', 3, -80, 15), C('SCC', 78, -95, 14, 'NR')]);
  assert.equal(r[1].behind, undefined);
  assert.equal(r[1].weak, false);
});

test('قيم غلط من الراوتر (0 أو موجبة) تنشال', () => {
  const r = carrierRows([C('PCC', 3, -80, 15), C('SCC', 1, 0, 0)]);
  assert.equal(r[1].rsrp, undefined);
  assert.equal(hasPerCarrier([C('PCC', 3, -80, 15), C('SCC', 1, 0)]), false);
  assert.equal(hasPerCarrier([C('PCC', 3, -80, 15), C('SCC', 1, -90)]), true);
});

test('ثانويين ضعاف ← جملة وحدة', () => {
  const r = carrierRows([C('PCC', 3, -80, 15), C('SCC', 1, -112, -3), C('SCC', 20, -105, -1)]);
  assert.equal(weakNote(r), 'B1 · B20 ضعيفة — ممكن تنزّل سرعة الدمج');
});

test('كله زين ← بدون جملة', () => {
  assert.equal(weakNote(carrierRows([C('PCC', 3, -80, 15), C('SCC', 1, -84, 14)])), null);
});
