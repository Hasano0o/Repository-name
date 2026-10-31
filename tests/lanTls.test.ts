/**
 * راوتر يحوّل لـ https بشهادة ذاتية (Huawei H112-370 من Three — ٣١ أكتوبر ٢٠٢٦، الآيفون: «A TLS error…»):
 * النسخة بدون القبول الأصلي ← «يحتاج آخر نسخة»، والنسخة اللي فيها ← «الاتصال المشفّر فشل»،
 * وأي انقطاع عادي يبقى «تعذر الاتصال» (ما يتأثر).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { http, setLanTlsFlag, TLS_ERR } from '../src/drivers/http';

(globalThis as any).__DEV__ = false;
const fail = (msg: string) => { (globalThis as any).fetch = async () => { throw new Error(msg); }; };

test('رسائل TLS من الآيفون والأندرويد تنعرف', () => {
  for (const m of [
    'A TLS error caused the secure connection to fail.',
    'An SSL error has occurred and a secure connection to the server cannot be made.',
    'javax.net.ssl.SSLHandshakeException: java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.',
    'Hostname 192.168.8.1 not verified',
  ]) assert.ok(TLS_ERR.test(m), m);
  for (const m of ['Network request failed', 'Fetch request has been canceled', 'timeout']) assert.ok(!TLS_ERR.test(m), m);
});

test('نسخة قديمة: خطأ TLS ← «يحتاج آخر نسخة»', async () => {
  setLanTlsFlag(() => false);
  fail('A TLS error caused the secure connection to fail.');
  await assert.rejects(http('http://192.168.8.1/api/user/state-login'), /يحتاج آخر نسخة/);
});

test('نسخة فيها القبول: خطأ TLS ← «الاتصال المشفّر فشل» مع الطلب', async () => {
  setLanTlsFlag(() => true);
  fail('A TLS error caused the secure connection to fail.');
  await assert.rejects(http('http://192.168.8.1/api/user/state-login'), /الاتصال المشفّر بالراوتر فشل \(GET \/api\/user\/state-login\)/);
});

test('انقطاع عادي ما يتغيّر', async () => {
  setLanTlsFlag(() => false);
  fail('Network request failed');
  await assert.rejects(http('http://192.168.8.1/api/user/state-login'), /تعذر الاتصال بالراوتر \(GET \/api\/user\/state-login\)/);
});

test('أسماء صفحات الراوترات محلية (H112-370 يحوّل لـ hirouter.net) — والنطاق كامل لا', async () => {
  const { isLanHost } = await import('../src/utils/host');
  for (const h of ['hirouter.net', 'HIROUTER.NET', 'https://hirouter.net/html/home.html', 'homerouter.cpe', 'x.router', '192.168.8.1']) assert.ok(isLanHost(h), h);
  for (const h of ['evil.net', 'hirouter.net.evil.com', 'google.com', '8.8.8.8']) assert.ok(!isLanHost(h), h);
});
