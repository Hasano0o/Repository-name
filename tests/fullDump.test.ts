/**
 * «أرسل ملفات راوترك» (FULL) — مين يطلع له الكرت، ومتى يطلع مرة ثانية.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullDumpEligible, fullDumpFingerprint } from '../src/services/fullDumpRule';
import { MODELS, identifyHuawei } from '../src/drivers/models';

const H = MODELS.huawei.id;

test('FULL: الموديلات المؤكدة ما يطلع لها (MU5001 / U60 Pro)', () => {
  assert.equal(fullDumpEligible('zte', MODELS.mu5001, H), false);
  assert.equal(fullDumpEligible('zteng', MODELS.u60Pro, H), false);
});

test('FULL: MC801A العادي صار مؤكد (٣١ أكتوبر) ← ما يطلع · U30 Air وزيكسل غير المؤكد والجيب ← يطلع', () => {
  assert.equal(fullDumpEligible('zte', MODELS.mc801a, H), false);
  assert.equal(fullDumpEligible('zte', MODELS.u30Air, H), true);
  assert.equal(fullDumpEligible('zyxel', { id: 'zyxel-nr5103e', label: 'Zyxel NR5103E', brand: 'zyxel', tech: '5G' } as any, H), true);
  assert.equal(fullDumpEligible('zteufi', null, H), true);
});

test('FULL: هواوي بس لو ما عرفنا الموديل — ما نزعج أصحاب H158/H155', () => {
  assert.equal(fullDumpEligible('huawei-lte', identifyHuawei('H158-381'), H), false);
  assert.equal(fullDumpEligible('huawei-lte', identifyHuawei('H155-382'), H), false);
  assert.equal(fullDumpEligible('huawei-lte', identifyHuawei(''), H), true);
  assert.equal(fullDumpEligible('huawei-lte', null, H), true);
});

test('FULL: البصمة = الموديل + الفيرموير — فيرموير جديد ← يطلع مرة ثانية', () => {
  const a = fullDumpFingerprint('mc801a', 'BD_MC801AV1.0.0B05');
  assert.equal(a, fullDumpFingerprint('mc801a', ' BD_MC801AV1.0.0B05 '));
  assert.ok(a !== fullDumpFingerprint('mc801a', 'BD_MC801AV1.0.0B06'));
  assert.equal(fullDumpFingerprint('zyxel'), 'zyxel|');
});
