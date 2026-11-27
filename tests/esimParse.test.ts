/** الشريحة الإلكترونية: قراءة الشرائح من رد الراوتر + كود الباركود */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEsimProfiles, parseLpa } from '../src/utils/esimParse';

test('الشرائح: كل كتلة فيها iccid = شريحة، بالاسم والحالة', () => {
  const xml = `<response><profiles>
    <profile><iccid>8996601234567890123</iccid><profile_name>STC</profile_name><state>1</state></profile>
    <profile><iccid>8996607777777771234</iccid><nickname>Mobily</nickname><state>0</state></profile>
  </profiles></response>`;
  const p = parseEsimProfiles(xml);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], { name: 'STC', iccid4: '0123', active: true });
  assert.deepEqual(p[1], { name: 'Mobily', iccid4: '1234', active: false });
});

test('الشرائح: بدون اسم ← آخر ٤ أرقام · خطأ أو فاضي ← ولا شي', () => {
  assert.deepEqual(parseEsimProfiles('<response><Profile><ICCID>8996601234567899999</ICCID></Profile></response>'),
    [{ name: 'شريحة …9999', iccid4: '9999', active: undefined }]);
  assert.deepEqual(parseEsimProfiles('<error><code>100002</code></error>'), []);
  assert.deepEqual(parseEsimProfiles('<response><count>0</count></response>'), []);
  assert.deepEqual(parseEsimProfiles(''), []);
});

test('الباركود: LPA:1$ بس', () => {
  assert.deepEqual(parseLpa('LPA:1$rsp.stc.com.sa$ABCD-1234-XYZ'), { smdp: 'rsp.stc.com.sa', matchingId: 'ABCD-1234-XYZ' });
  assert.deepEqual(parseLpa(' lpa:1$SMDP.Example.com:443$K1$1.3.6 '), { smdp: 'smdp.example.com:443', matchingId: 'K1' });
  assert.equal(parseLpa('https://example.com'), null);
  assert.equal(parseLpa('WIFI:S:home;P:123;;'), null);
});
