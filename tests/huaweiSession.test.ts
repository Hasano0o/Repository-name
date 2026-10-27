// رموز جلسة هواوي — الفيرموير الجديدة (H155-383) ما فيها SesTokInfo
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSesTok, tokenFromReply, isTokenReply, isHuaweiSessionReply } from '../src/drivers/huawei/session';

test('القديم: SesTokInfo فيه رمز', () => {
  const x = '<?xml version="1.0" encoding="UTF-8"?><response><SesInfo>SessionID=abc</SesInfo><TokInfo>tok123</TokInfo></response>';
  assert.equal(hasSesTok(x), true);
  assert.equal(isHuaweiSessionReply(x), true);
});

test('H155-383: SesTokInfo يرد خطأ، webserver/token يرد رمز ← نتعرّف عليه هواوي', () => {
  const err = '<?xml version="1.0" encoding="UTF-8"?><error><code>100002</code><message></message></error>';
  assert.equal(isHuaweiSessionReply(err), false);
  const tok = '<?xml version="1.0" encoding="UTF-8"?><response><token>' + 'a'.repeat(32) + 'REALTOKEN0123456789</token></response>';
  assert.equal(isTokenReply(tok), true);
  assert.equal(isHuaweiSessionReply(tok), true);
  // نفس الصفحة: token.substr(32)
  assert.equal(tokenFromReply(tok), 'REALTOKEN0123456789');
  assert.equal(tokenFromReply('<response><token>short</token></response>'), 'short');
});

test('صفحات ثانية فيها كلمة token ما تنحسب هواوي', () => {
  assert.equal(isHuaweiSessionReply('<html><script>var token="086724f57013f16e042e012becf825";</script></html>'), false);
  assert.equal(isHuaweiSessionReply('{"token":"abcdefghijkl"}'), false);
  assert.equal(isHuaweiSessionReply(''), false);
});
