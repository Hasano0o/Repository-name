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

import { pciFind, pciChoices, pciRel } from '../src/utils/pciTarget';

test('PCI: البرج المطلوب جار ← «يوصل» بقوته · أساسي ← «شابك»', () => {
  const s = { pci: '453', band: 'B1', rsrp: -88, nrPci: '373', nrBand: 'n78', nrRsrp: -100 };
  const cells: any[] = [
    { kind: 'serving', tech: 'LTE', band: 1, pci: '453', rsrp: -88 },
    { kind: 'neighbor', tech: 'LTE', band: 3, pci: '451', arfcn: '1850', rsrp: -104 },
    { kind: 'neighbor', tech: 'LTE', band: 1, pci: '451', rsrp: -110 },
  ];
  assert.deepEqual(pciFind('451', s, cells), { state: 'seen', tech: 'LTE', band: 3, arfcn: '1850', rsrp: -104, sinr: undefined });
  assert.equal(pciFind('453', s, cells).state, 'serving');
  assert.equal(pciFind('373', s, cells).tech, 'NR');
  assert.equal(pciFind('999', s, cells).state, 'none');
  const ch = pciChoices(s, cells);
  assert.deepEqual(ch.map(c => c.pci), ['453', '373', '451']);
  assert.equal(ch[2].rsrp, -104);
});

test('PCI: القرب للصوت', () => {
  assert.equal(pciRel(undefined, -90), 0);
  assert.equal(pciRel(-90, -90), Math.max(0.35, Math.min(1, 35 / 45)));
  assert.equal(pciRel(-96, -90), 0.5);
  assert.ok(pciRel(-80, undefined) === 1);
});
