import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enbOf, cellMapperUrl, cityPos } from '../src/utils/towerMap';

test('enbOf: من eNB مباشرة، أو Cell ID عشري/هكس', () => {
  assert.equal(enbOf({ enodebId: '678259' }), 678259);
  assert.equal(enbOf({ cellId: '54682373' }), 213603);   // صورة EzCtrl
  assert.equal(enbOf({ cellId: '173634354' }), 678259);  // برج حسن (ECI) = eNB 678259
  assert.equal(enbOf({ cellId: 'A597D32' }), Math.floor(0xa597d32 / 256));
  assert.equal(enbOf({ cellId: '' }), undefined);
  assert.equal(enbOf(null), undefined);
});

test('cellMapperUrl: الشركة والمدينة', () => {
  const u = cellMapperUrl('zain', 'شرورة');
  assert.match(u, /MCC=420&MNC=4/);
  assert.match(u, /latitude=17\.4667/);
  assert.match(cellMapperUrl('stc'), /MNC=1&.*zoom=6/);
  assert.ok(cityPos('مدينة الرياض'));
});
