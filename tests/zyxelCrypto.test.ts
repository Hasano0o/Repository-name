import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nc from 'node:crypto';
import { aesCbcEncrypt, aesCbcDecrypt, rsaPkcs1Encrypt, b64, utf8, fromUtf8 } from '../src/drivers/zyxel/crypto';

const cat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };


function testPrivateDecrypt(opts: any, ciphertext: any): any {
  const crypto: any = require('node:crypto');
  if (opts.padding !== crypto.constants.RSA_PKCS1_PADDING) {
    return crypto.privateDecrypt(opts, ciphertext);
  }

  // Test-only PKCS#1 v1.5 decoding using the private RSA operation.
  const jwk: any = crypto.createPrivateKey(opts.key).export({ format: 'jwk' });
  const fromB64Url = (s: string) =>
    Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  const n = BigInt('0x' + fromB64Url(jwk.n).toString('hex'));
  const d = BigInt('0x' + fromB64Url(jwk.d).toString('hex'));
  const c = BigInt('0x' + Buffer.from(ciphertext).toString('hex'));

  function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    base %= mod;
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % mod;
      base = (base * base) % mod;
      exp >>= 1n;
    }
    return result;
  }

  const width = fromB64Url(jwk.n).length;
  let hex = modPow(c, d, n).toString(16).padStart(width * 2, '0');
  if (hex.length > width * 2) throw new Error('RSA test block too long');

  const block = Buffer.from(hex, 'hex');
  if (block[0] !== 0 || block[1] !== 2) {
    throw new Error('Invalid PKCS#1 v1.5 test padding');
  }

  const separator = block.indexOf(0, 2);
  if (separator < 10) throw new Error('Invalid PKCS#1 v1.5 padding separator');
  return block.subarray(separator + 1);
}

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
  assert.equal(b64(testPrivateDecrypt({ key: privateKey, padding: nc.constants.RSA_PKCS1_PADDING }, ct)), b64(secret));
});
