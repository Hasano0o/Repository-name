/**
 * VORTEX-3 موديل M49 (Shenzhen WeWins، جيب 4G على 192.168.8.1) — ملف عضو ٢١ نوفمبر:
 * صفحة ZTE goform (MODEL MF295N · نسخة النظام V3.Mobile.R…) — ملف موديل لحاله، قراءة بس، ما يلمس غيره.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyZte, MODELS } from '../src/drivers/models';

test('VORTEX M49: V3.Mobile ← ملف الموديل (4G، بدون 5G، الكتابة محجوبة)', () => {
  const p = identifyZte('V3.Mobile.R10', '', '');
  assert.equal(p.id, 'vortex-m49');
  assert.equal(p.tech, '4G');
  assert.equal(p.nrLock, false);
  assert.equal(p.writeUnverified, true);
});

test('VORTEX M49: من رقم العتاد (MF295N / VORTEX)', () => {
  assert.equal(identifyZte('', '', 'MF295N').id, 'vortex-m49');
  assert.equal(identifyZte('X', '', 'VORTEX-3').id, 'vortex-m49');
});

test('VORTEX M49: ما يغيّر تعرّف باقي ZTE', () => {
  assert.equal(identifyZte('BD_STCMU5001V1.0.2B04').id, MODELS.mu5001.id);
  assert.equal(identifyZte('MC801A1_Elisa1_B06').id, MODELS.mc801a.id);
  assert.equal(identifyZte('BD_XCBZHKMC801A ProV1.0.0B03').id, MODELS.mc801aPro.id);
});
