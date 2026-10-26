import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyZteWrite, WRITE_ALLOWED_WHEN_UNVERIFIED } from '../src/drivers/zte/writeResult';

test('تصنيف رد ZTE: HTTP 200 مو دليل نجاح', () => {
  assert.equal(classifyZteWrite('{"result":"success"}'), 'ok');
  assert.equal(classifyZteWrite('{"result":"failure"}'), 'rejected');
  assert.equal(classifyZteWrite('{"result":"3"}'), 'rejected');
  // سجل U30 Pro الحقيقي: «{}» بالتوقيع الصحيح، فاضي بالغلط
  assert.equal(classifyZteWrite('{}'), 'unhandled');
  assert.equal(classifyZteWrite(''), 'empty');
  assert.equal(classifyZteWrite('   '), 'empty');
  assert.equal(classifyZteWrite('{"result":"0"}'), 'other'); // رد الدخول — مو حكم على أمر كتابة
});

test('الأوامر المسموحة لموديل كتابته ما انثبتت: دخول/خروج بس (إعادة التشغيل ممنوعة لين تنثبت)', () => {
  for (const ok of ['LOGIN', 'LOGOUT', 'GOFORM_LOGOUT']) assert.ok(WRITE_ALLOWED_WHEN_UNVERIFIED.has(ok));
  for (const no of ['BAND_SELECT', 'WAN_PERFORM_NR5G_BAND_LOCK', 'SET_BEARER_PREFERENCE', 'LTE_LOCK_CELL_SET', 'setAccessPointInfo', 'DEVELOPER_OPTION_LOGIN', 'REBOOT_DEVICE', 'SEND_SMS', 'DISCONNECT_NETWORK']) {
    assert.ok(!WRITE_ALLOWED_WHEN_UNVERIFIED.has(no), no);
  }
});
