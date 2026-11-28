/** هواوي «التشخيص بضغطة» بالعربي (لقطة حسن ٢٨ نوفمبر) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onekeyRows } from '../src/drivers/huawei/labs';

const resp = JSON.stringify({ connection_status: '2', signal_status: '0', sim_status: '0', dialupswitch_off: '0', datalimit_status: '0', roam_off: '0', staticdns: '0', apnstatus: '0', modemdialup_err: '0', speedLimitStatus: '0' });

test('كل شي سليم', () => {
  const r = onekeyRows(resp);
  assert.deepEqual(r[0], { label: 'النتيجة', value: 'كل شي سليم ✓' });
  assert.deepEqual(r[1], { label: 'الاتصال', value: 'متصل بشبكة الجوال ✓' });
  assert.ok(r.some(x => x.label === 'الإشارة' && x.value === 'سليم ✓'));
  assert.ok(r.every(x => !/_/.test(x.label)));
});

test('إشارة ضعيفة + سرعة محدودة', () => {
  const r = onekeyRows(JSON.stringify({ connection_status: '2', signal_status: '1', speedLimitStatus: '1' }));
  assert.equal(r[0].value, 'فيه 2 مشاكل — شوف تحت');
  assert.ok(r.some(x => x.label === 'الإشارة' && /ضعيفة/.test(x.value)));
  assert.ok(r.some(x => x.label === 'تحديد السرعة' && /حادّ/.test(x.value)));
});

test('XML + حالة 7', () => {
  const r = onekeyRows('<response><connection_status>7</connection_status><apnstatus>1</apnstatus></response>');
  assert.equal(r[1].value, 'متصل بس الإنترنت ما يوصل ✗');
  assert.ok(r.some(x => x.label === 'إعدادات APN'));
});
