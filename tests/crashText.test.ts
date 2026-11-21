/** ماسك الانهيارات (٢١ نوفمبر): نص التقرير — يدخل حد السيرفر (٣٠٠ حرف) وفيه الشاشة ومكان الخطأ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const { crashText } = require('../src/services/crashText');

test('نوع الخطأ + الرسالة + الشاشة + أول سطور المكان', () => {
  const e = new TypeError("Cannot read property 'band' of undefined");
  e.stack = "TypeError: Cannot read property 'band' of undefined\n    at renderCard (http://localhost/index.bundle:1:2345)\n    at Router (index.bundle:1:999)\n    at a (x)\n    at b (y)";
  const t = crashText(e, 'الراوتر');
  assert.match(t, /^TypeError: Cannot read property 'band' of undefined · شاشة الراوتر · /);
  assert.match(t, /renderCard/);
  assert.ok(!t.includes('http://'));
  assert.ok(!t.includes('at b (y)'));
});

test('خطأ غريب (نص أو null) ما يطيّح الماسك نفسه', () => {
  assert.match(crashText('boom', ''), /^Error: boom · شاشة الرئيسية$/);
  assert.match(crashText(null, 'x'), /^Error: — · شاشة x$/);
});

test('ما يتعدى ٢٨٠ حرف', () => {
  const e = new Error('x'.repeat(1000));
  assert.ok(crashText(e, 'الترددات').length <= 280);
});
