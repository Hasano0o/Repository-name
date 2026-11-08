import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heavyVerdict } from '../src/utils/heavyNet';

test('وش يثقّل نتك: الراوتر فاضي ← idle (السبب مو جهاز ثاني)', () => {
  const v = heavyVerdict({ downMbps: 0.1, upMbps: 0.05, pingMed: 60, pingBase: 55 });
  assert.equal(v.level, 'idle'); assert.equal(v.guess, false);
});

test('تنزيل ٢٠ ميقا + البنق زاد ١٢٠ ← heavy مع نصيحة التنزيل وأثر البنق', () => {
  const v = heavyVerdict({ downMbps: 20, upMbps: 0.5, pingMed: 170, pingBase: 50 });
  assert.equal(v.level, 'heavy'); assert.equal(v.added, 120);
  assert.match(v.detail, /يخرّب لعبك/);
  assert.ok(v.tips.some(t => /التنزيل عالي/.test(t)));
});

test('رفع عالي ← نصيحة الرفع (نسخ احتياطي)', () => {
  const v = heavyVerdict({ downMbps: 1, upMbps: 4 });
  assert.equal(v.level, 'heavy');
  assert.ok(v.tips.some(t => /الرفع عالي/.test(t)));
});

test('راوتر بدون سرعة: نحكم من البنق ونقول إنها تقدير', () => {
  assert.equal(heavyVerdict({ pingMed: 140, pingBase: 60 }).level, 'busy');
  assert.equal(heavyVerdict({ pingMed: 140, pingBase: 60 }).guess, true);
  assert.equal(heavyVerdict({ pingMed: 65, pingBase: 60 }).level, 'idle');
  assert.equal(heavyVerdict({}).level, 'unknown');
});
