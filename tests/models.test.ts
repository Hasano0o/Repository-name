import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyZte, identifyHuawei } from '../src/drivers/models';

test('ZTE: موديلات اليوم', () => {
  assert.equal(identifyZte('BD_STCMU5001V1.0.2B04').id, 'mu5001');
  const pro = identifyZte('BD_XCBZHKMC801A ProV1.0.0B03', 'WEB_XCBZHKG5BV1.0.0B03');
  assert.equal(pro.id, 'mc801a-pro'); assert.equal(pro.write, 'ubus');
  const u10 = identifyZte('U10SProV1.02', '');
  assert.equal(u10.id, 'u10s-pro'); assert.equal(u10.nrLock, false); assert.equal(u10.tech, '4G');
  assert.equal(identifyZte('BD_MC888V1.0', '').id, 'mc888');
  assert.equal(identifyZte('', '').id, 'zte');
});
test('ZTE: صفحة G5 لموديل ثاني تكتب ubus', () => {
  const g = identifyZte('BD_XXMC802AV1', 'WEB_XXG5BV1.0');
  assert.equal(g.write, 'ubus'); assert.match(g.label, /MC802A/);
});
test('هواوي', () => {
  assert.equal(identifyHuawei('H158-381').nrLock, false);
  assert.match(identifyHuawei('B818-263').label, /B818-263/);
});

test('MU5001 مقفول على المجرّب — بدون بدائل', () => {
  const p = identifyZte('BD_STCMU5001V1.0.2B04');
  assert.deepEqual(p.pinned, { ad: 'wa+cr', lteMask: 'short', nrCmd: 'classic' });
  assert.equal(identifyZte('BD_XCBZHKMC801A ProV1.0.0B03', 'WEB_XCBZHKG5BV1.0.0B03').pinned, undefined);
});

test('ZTE U30 Pro: يتعرف من wa_inner_version بدون مسافة قبل Pro', () => {
  const m = identifyZte('U30Pro_GEN_MEASV1.0.0B07', 'U30Pro_GEN_MEASV1.0.0B07');
  assert.equal(m.id, 'u30-pro');
  assert.equal(m.label, 'ZTE U30 Pro');
  assert.equal(m.write, 'goform');
});
