/**
 * خانة عنوان الراوتر (add-login ٧ نوفمبر): عضو لصق «https://hirouter.net/html/content.html#home»
 * ← كان يوصل للدرايفر كما هو («ما رد»). cleanHostInput يخلي العنوان بس.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
declare const require: any;
const { cleanHostInput, isLanHost } = require('../src/utils/host');

test('رابط كامل ملصوق ← العنوان بس', () => {
  assert.equal(cleanHostInput('https://hirouter.net/html/content.html#home'), 'hirouter.net');
  assert.equal(cleanHostInput('http://192.168.8.1/html/home.html'), '192.168.8.1');
  assert.equal(cleanHostInput(' HTTP://192.168.0.1/index.html#login '), '192.168.0.1');
  assert.equal(cleanHostInput('192.168.1.1/'), '192.168.1.1');
  assert.equal(cleanHostInput('http://admin@192.168.8.1/'), '192.168.8.1');
  assert.equal(cleanHostInput('http://192.168.8.1:8080/x?y=1'), '192.168.8.1:8080');
});

test('العنوان العادي ما يتغيّر', () => {
  assert.equal(cleanHostInput('192.168.8.1'), '192.168.8.1');
  assert.equal(cleanHostInput(''), '');
  assert.ok(isLanHost(cleanHostInput('https://hirouter.net/html/content.html#home')));
});
