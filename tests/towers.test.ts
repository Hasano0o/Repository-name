/** الخلية والبرج (ملاحظة عضو ٢٨ نوفمبر): PCI = الخلية (السيكتور)، رقم البرج = eNB من Cell ID (ECI ÷ ٢٥٦). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enbOf } from '../src/utils/towerMap';

test('رقم البرج: خليتين (214 و 87) على نفس البرج 110984', () => {
  assert.equal(enbOf({ cellId: '28411905' }), 110984);
  assert.equal(enbOf({ cellId: '28411907' }), 110984);
  assert.equal(enbOf({ cellId: '1B18801' }), 110984); // hex
  assert.equal(enbOf({ enodebId: '110984', cellId: '' }), 110984);
  assert.equal(enbOf({ cellId: '' }), undefined);
});
