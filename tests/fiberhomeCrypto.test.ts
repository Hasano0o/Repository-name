import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { fhEncrypt, fhDecrypt, fhBody, fhKey, FH_IV } from '../src/drivers/fiberhome/crypto';

const KEY = 'ABCDEF0123456789';
const nodeEnc = (s: string) => {
  const c = (crypto as any).createCipheriv('aes-128-cbc', Buffer.from(KEY), Buffer.from(FH_IV));
  return Buffer.concat([c.update(Buffer.from(s, 'utf8')), c.final()]).toString('hex');
};
const nodeDec = (h: string) => {
  const d = (crypto as any).createDecipheriv('aes-128-cbc', Buffer.from(KEY), Buffer.from(FH_IV));
  return Buffer.concat([d.update(Buffer.from(h, 'hex')), d.final()]).toString('utf8');
};
declare const Buffer: any;

test('FiberHome: iv = الحروف 112..127 (مثل int_aes_iv)', () => {
  assert.equal(FH_IV, 'pqrstuvwxyz{|}~\x7f');
  assert.equal(fhKey('0123456789ABCDEFXYZ'), '0123456789ABCDEF');
});

test('FiberHome: تشفيرنا = AES-128-CBC الحقيقي (والعكس) — عربي وإيموجي بعد', () => {
  for (const s of ['{"ajaxmethod":"get_xmlnode_js_file","dataObj":null}', 'شرورة 5G 😀', 'x'.repeat(33)]) {
    assert.equal(fhEncrypt(s, KEY), nodeEnc(s));
    assert.equal(fhDecrypt(nodeEnc(s), KEY), s);
    assert.equal(nodeDec(fhEncrypt(s, KEY)), s);
  }
});

test('FiberHome: جسم الطلب فيه sessionid ومشفّر بمفتاحها', () => {
  const sid = KEY + 'tail';
  const b = fhBody({ ajaxmethod: 'get_xmlnode_js_file', dataObj: null }, sid, true);
  assert.deepEqual(JSON.parse(nodeDec(b)), { ajaxmethod: 'get_xmlnode_js_file', dataObj: null, sessionid: sid });
  assert.equal(JSON.parse(fhBody({ a: 1 }, sid, false)).sessionid, sid);
});
