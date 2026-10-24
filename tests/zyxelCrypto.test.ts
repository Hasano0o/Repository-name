import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nc from 'node:crypto';
import { aesCbcEncrypt, aesCbcDecrypt, rsaPkcs1Encrypt, b64, utf8, fromUtf8 } from '../src/drivers/zyxel/crypto';

const cat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

test('زيكسل: AES-256-CBC يطابق node:crypto', () => {
  const key = nc.randomBytes(32), iv = nc.randomBytes(32);
  const msg = '{"Input_Account":"admin","Input_Passwd":"YWJj","currLang":"en"} عربي';
  const c = nc.createCipheriv('aes-256-cbc', key, iv.subarray(0, 16));
  const ref = cat(c.update(msg), c.final());
  assert.equal(b64(aesCbcEncrypt(key, iv, utf8(msg))), b64(ref));
  assert.equal(fromUtf8(aesCbcDecrypt(key, iv, ref)), msg);
});
test('زيكسل: RSA PKCS#1 v1.5 ينفك بالمفتاح الخاص', () => {
  const { publicKey, privateKey } = nc.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const secret = utf8(b64(nc.randomBytes(32)));
  const ct = rsaPkcs1Encrypt(publicKey, secret, n => new Uint8Array(nc.randomBytes(n)));
  assert.equal(b64(nc.privateDecrypt({ key: privateKey, padding: nc.constants.RSA_PKCS1_PADDING }, ct)), b64(secret));
});
