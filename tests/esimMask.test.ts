/** ردود eSIM تنرسل للرسيفر — الأرقام الطويلة لازم تنخفي */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskLongDigits } from '../src/utils/esimMask';

test('ICCID و EID ينخفون، والأرقام القصيرة تبقى', () => {
  const t = '<iccid>8996601234567890123</iccid><eid>89049032004008882600012345678901</eid><state>1</state><code>100002</code>';
  const m = maskLongDigits(t);
  assert.ok(!m.includes('8996601234567890123'));
  assert.ok(m.includes('<iccid>8996***************</iccid>'));
  assert.ok(!m.includes('4008882600012345678901'));
  assert.ok(m.includes('<state>1</state>') && m.includes('<code>100002</code>'));
});
