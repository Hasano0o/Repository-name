import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandOf, brandColor } from '../src/utils/operatorBrand';

test('الفعالية تنفصل عن اسم الشركة: «Zain HAJJ EXPO» ← زين + HAJJ EXPO', () => {
  assert.deepEqual(brandOf('Zain HAJJ EXPO'), { key: 'zain', label: 'زين', event: 'HAJJ EXPO' });
  assert.deepEqual(brandOf('stc ksa HAJJ EXPO'), { key: 'stc', label: 'stc', event: 'HAJJ EXPO' });
});

test('بدون فعالية: Zain KSA / STC / 42001 / mobily 5G ← فاضي', () => {
  for (const n of ['Zain KSA', 'STC', '42001', 'mobily 5G', 'Mobily-KSA', 'Virgin Mobile']) assert.equal(brandOf(n).event, '', n);
});

test('الأسماء المعروفة ورموز PLMN', () => {
  assert.equal(brandOf('Zain KSA').key, 'zain');
  assert.equal(brandOf('mobily').label, 'موبايلي');
  assert.equal(brandOf('STC').key, 'stc');
  assert.equal(brandOf('42001').key, 'stc');
  assert.equal(brandOf('420 03').key, 'mobily');
  assert.equal(brandOf('SALAM').key, 'salam');
  assert.equal(brandOf('Virgin Mobile').key, 'virgin');
});

test('شركة ما نعرفها ← الاسم مثل ما هو (بلون محايد) · فاضي ← لا شي', () => {
  assert.deepEqual(brandOf('  Libyana  '), { key: null, label: 'Libyana', event: '' });
  assert.equal(brandColor('Libyana'), '#64748b');
  assert.equal(brandOf('').label, '');
  assert.equal(brandOf(undefined).label, '');
});
