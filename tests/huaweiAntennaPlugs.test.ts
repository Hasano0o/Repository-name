import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAntennaPlugs } from '../src/drivers/huawei/more';

const io = (body: string | null) => ({
  get: async () => { if (body === null) throw new Error('x'); return body; },
  post: async () => '<response>OK</response>',
}) as any;

test('هواوي antenna_type: كيبل كل منفذ من antennaNinsertstatus (كود صفحة location.js)', async () => {
  const r = await getAntennaPlugs(io('<response><antenna1type>1</antenna1type><antenna2type>1</antenna2type><antenna1insertstatus>1</antenna1insertstatus><antenna2insertstatus>0</antenna2insertstatus></response>'));
  assert.deepEqual(r, [{ idx: 1, plugged: true, external: true }, { idx: 2, plugged: false, external: true }]);
});

test('بدون حقول المنافذ أو خطأ ← null (ما تطلع البطاقة)', async () => {
  assert.equal(await getAntennaPlugs(io('<response><antenna_type>0</antenna_type></response>')), null);
  assert.equal(await getAntennaPlugs(io('<error><code>100002</code></error>')), null);
  assert.equal(await getAntennaPlugs(io(null)), null);
});
