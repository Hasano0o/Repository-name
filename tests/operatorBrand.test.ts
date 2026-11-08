import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandOf, brandColor } from '../src/utils/operatorBrand';

test('إضافات معرض الحج تنشال: «Zain HAJJ EXPO» ← زين · «stc ksa HAJJ EXPO» ← stc', () => {
  assert.deepEqual(brandOf('Zain HAJJ EXPO'), { key: 'zain', label: 'زين' });
  assert.deepEqual(brandOf('stc ksa HAJJ EXPO'), { key: 'stc', label: 'stc' });
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
  assert.deepEqual(brandOf('  Libyana  '), { key: null, label: 'Libyana' });
  assert.equal(brandColor('Libyana'), '#64748b');
  assert.equal(brandOf('').label, '');
  assert.equal(brandOf(undefined).label, '');
});
