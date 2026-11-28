/** زيكسل NR5103EV2 NSA (عضو ٢٨ نوفمبر): الأساسي 5G = أول 5G في القائمة (n78)، مو NSA_Band (n41) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zxNrMain } from '../src/drivers/zyxel/ca';

test('NR5103EV2: B3 أساسي + n78 أساسي 5G + n41 ثانوي', () => {
  const c = { INTF_Current_Band: 'LTE_BC3,LTE_BC1,LTE_BC20,NR5G_BAND78,NR5G_BAND41', INTF_RFCN: '1650,100,6300,647424,528990', NSA_Band: 'n41' };
  assert.deepEqual(zxNrMain(c), { tech: 'NR', band: 78, arfcn: '647424', pci: undefined });
});

test('بدون 5G في القائمة (NR5103E العادي) ← null، يمشي على NSA_Band مثل قبل', () => {
  assert.equal(zxNrMain({ INTF_Current_Band: 'LTE_BC3', INTF_RFCN: '1650', NSA_Band: '78' }), null);
  assert.equal(zxNrMain({ INTF_Current_Band: 'LTE_BC3,LTE_BC1', INTF_RFCN: '1650,100' }), null);
});

test('SA (الأول 5G) ← null', () => {
  assert.equal(zxNrMain({ INTF_Current_Band: 'NR5G_BAND78,NR5G_BAND41', INTF_RFCN: '647424,528990' }), null);
});
