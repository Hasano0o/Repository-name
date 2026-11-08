import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandChips } from '../src/utils/bandChips';

const C = (tech: 'LTE' | 'NR', band: number, role: 'PCC' | 'SCC') => ({ tech, band, role });

test('صورة العضو: الإشارة B3 + n78 بس، والنواقل فيها B1 و B40 ← تطلع الأربع بألوانها', () => {
  const r = bandChips([C('LTE', 3, 'PCC'), C('LTE', 1, 'SCC'), C('LTE', 40, 'SCC'), C('NR', 78, 'SCC')], { band: 'B3', nrBand: 'n78' });
  assert.deepEqual(r, [
    { label: 'B3', kind: 'pcc' }, { label: 'B1', kind: 'lte' }, { label: 'B40', kind: 'lte' }, { label: 'n78', kind: 'nr' },
  ]);
});

test('بدون نواقل ← من الإشارة: أول 4G أساسي', () => {
  assert.deepEqual(bandChips(null, { band: 'B3+B1', nrBand: '78' }),
    [{ label: 'B3', kind: 'pcc' }, { label: 'B1', kind: 'lte' }, { label: 'n78', kind: 'nr' }]);
});

test('النواقل ناقصها 5G والإشارة فيها ← ينضاف بنفسجي', () => {
  assert.deepEqual(bandChips([C('LTE', 3, 'PCC')], { band: 'B3', nrBand: 'n78' }).map(c => c.kind), ['pcc', 'nr']);
});

test('5G لحاله (SA) ← الأساسي n78', () => {
  assert.deepEqual(bandChips([C('NR', 78, 'PCC')], {}), [{ label: 'n78', kind: 'pcc' }]);
  assert.deepEqual(bandChips([], { nrBand: 'n41' }), [{ label: 'n41', kind: 'pcc' }]);
});

test('ما فيه شي ← فاضي، وبدون تكرار', () => {
  assert.deepEqual(bandChips([], {}), []);
  assert.equal(bandChips([C('LTE', 3, 'PCC'), C('LTE', 3, 'SCC')], { band: 'B3' }).length, 1);
});

test('نواقل قديمة (الأساسي تغيّر من B3 لـ B1) ← نمشي على الإشارة', () => {
  const r = bandChips([C('LTE', 3, 'PCC'), C('LTE', 40, 'SCC')], { band: 'B1' });
  assert.deepEqual(r, [{ label: 'B1', kind: 'pcc' }]);
});

test('صورة العضو الثاني: B3 أساسي 15MHz + B3 ثانوي 20MHz + n78 ← B3 تطلع مرتين (أزرق وبرتقالي)', () => {
  const r = bandChips([
    { tech: 'LTE', band: 3, role: 'PCC', bandwidth: 15, arfcn: '1300' },
    { tech: 'LTE', band: 3, role: 'SCC', bandwidth: 20, arfcn: '1849' },
    { tech: 'NR', band: 78, role: 'SCC', bandwidth: 100 },
  ], { band: 'B3', nrBand: 'n78' });
  assert.deepEqual(r, [{ label: 'B3', kind: 'pcc' }, { label: 'B3', kind: 'lte' }, { label: 'n78', kind: 'nr' }]);
});

test('نفس الناقل مكرر بنفس ARFCN ← مرة وحدة', () => {
  assert.equal(bandChips([
    { tech: 'LTE', band: 3, role: 'PCC', arfcn: '1300' }, { tech: 'LTE', band: 3, role: 'SCC', arfcn: '1300' },
  ], {}).length, 1);
});
