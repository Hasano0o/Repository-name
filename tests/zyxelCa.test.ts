/** زيكسل NR5103EV2: قوائم الدمج في cellwan_status (فيديو عضو ١٥ نوفمبر — كان يعرض B78 بدل B3) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zxCells, zxPcc } from '../src/drivers/zyxel/ca';

test('NR5103EV2: القوائم ← الأساسي B3 + ثانوي B41×2 + n78', () => {
  const c = { INTF_Current_Band: 'LTE_BC3,LTE_BC41,LTE_BC41,NR5G_BAND78', INTF_RFCN: '1850,40590,40392,647424', INTF_PhyCell_ID: '275' };
  const cells = zxCells(c);
  assert.deepEqual(cells.map(x => `${x.tech}:${x.band}:${x.arfcn}`), ['LTE:3:1850', 'LTE:41:40590', 'LTE:41:40392', 'NR:78:647424']);
  assert.deepEqual(zxPcc(c), { tech: 'LTE', band: 3, arfcn: '1850', pci: '275' });
});

test('NR5103EV2: اسم التردد ناقص ← من رقم القناة', () => {
  const cells = zxCells({ INTF_Current_Band: 'LTE_BC3', INTF_RFCN: '1850,40590,647424' });
  assert.deepEqual(cells.map(x => `${x.tech}:${x.band}`), ['LTE:3', 'LTE:41', 'NR:78']);
});

test('NR5103E العادي (قيمة وحدة) ما تغيّر', () => {
  assert.deepEqual(zxPcc({ INTF_Current_Band: 'LTE_BC28', INTF_RFCN: '9410', INTF_PhyCell_ID: '120' }), { tech: 'LTE', band: 28, arfcn: '9410', pci: '120' });
  assert.equal(zxPcc({ INTF_Current_Band: 'NR5G_BAND78', INTF_RFCN: '641280' })?.tech, 'NR');
});
