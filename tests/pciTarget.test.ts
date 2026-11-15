/** «تنبيه برج معيّن» في توجيه الأنتنا (اقتراح عضو ١٥ نوفمبر) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normPci, pciHit } from '../src/utils/pciTarget';

test('PCI: تنظيف الرقم (أرقام عربية، فراغات، مدى 0–1007)', () => {
  assert.equal(normPci('38'), '38');
  assert.equal(normPci('٣٨'), '38');
  assert.equal(normPci(' 038 '), '38');
  assert.equal(normPci('0'), '0');
  assert.equal(normPci('1008'), null);
  assert.equal(normPci(''), null);
  assert.equal(normPci(undefined), null);
});

test('PCI: يطابق الأساسي 4G أو 5G', () => {
  assert.equal(pciHit('38', { pci: '38' }), 'LTE');
  assert.equal(pciHit('38', { pci: '117', nrPci: '38' }), 'NR');
  assert.equal(pciHit('38', { pci: '117' }), null);
  assert.equal(pciHit('', { pci: '38' }), null);
  assert.equal(pciHit('38', null), null);
});
