import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { huaweiEncrypt } from '../src/drivers/huawei/rsaEnc';

test('Huawei RSA-OAEP preserves XML and Arabic text', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicExponent: 65537,
  });

  const jwk = publicKey.export({ format: 'jwk' });
  const nHex = Buffer.from(jwk.n!, 'base64url').toString('hex');
  const eHex = Buffer.from(jwk.e!, 'base64url').toString('hex');
  const original = '<?xml version="1.0"?><request><value>Bandly اختبار عربي 123</value></request>';

  let counter = 0;
  const encrypted = huaweiEncrypt(original, nHex, eHex, (n) => {
    const seed = Buffer.alloc(n);
    for (let i = 0; i < n; i++) seed[i] = (counter++ * 37 + i * 13) & 255;
    return seed;
  });

  assert.match(encrypted, /^[0-9a-f]+$/i);
  assert.equal(encrypted.length % 256, 0);

  const recoveredBase64 = (encrypted.match(/.{256}/g) ?? []).map((block) =>
    crypto.privateDecrypt({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha1',
    }, Buffer.from(block, 'hex')).toString('utf8')
  ).join('');

  assert.equal(Buffer.from(recoveredBase64, 'base64').toString('utf8'), original);
});
