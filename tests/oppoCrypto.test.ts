/** تشفير OPPO مقابل AES-256-CTR و RSA-OAEP الحقيقيين في node */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ncrypto from 'node:crypto';
declare const require: any;
declare const process: any;
// المكتبات من node_modules المشروع (الاختبارات تنبني في مجلد مؤقت)
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  if (/^@noble\//.test(req)) return origLoad.call(this, require.resolve(req, { paths: [process.cwd()] }), ...rest);
  return origLoad.call(this, req, ...rest);
};
const { aesCtr, newKeys, oppoEncrypt, oppoDecrypt, oppoBody, randomToken, passHash, rsaOaepEncrypt } = require('../src/drivers/oppo/crypto');

declare const Buffer: any;
const rand = (n: number) => Uint8Array.from((ncrypto as any).randomBytes(n));
const kp = (ncrypto as any).generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });


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

test('OPPO: AES-CTR مثل crypto-js (= aes-256-ctr بعداد أول ١٦ بايت من iv) — نص عربي وطول مو مضاعف ١٦', () => {
  const key = 'A1B2C3D4E5F60718293A4B5C6D7E8F90', iv = '0F1E2D3C4B5A69788796A5B4C3D2E1F0';
  const msg = '{"data":{"SSID":"بيتنا 🌙"},"randomToken":"17300000000002123"}';
  const c = (ncrypto as any).createCipheriv('aes-256-ctr', Buffer.from(key), Buffer.from(iv).subarray(0, 16));
  const ref = Buffer.concat([c.update(Buffer.from(msg)), c.final()]).toString('base64');
  const mine = oppoEncrypt(msg, { key, iv, enc: '' });
  assert.equal(mine, ref);
  assert.equal(oppoDecrypt(ref, { key, iv, enc: '' }), msg);
  assert.equal(aesCtr(new Uint8Array(32), new Uint8Array(16), new Uint8Array(0)).length, 0);
});

test('OPPO: RSA-OAEP(SHA1) ينفك بالمفتاح الخاص — والمفتاح المرسل «key.iv»', () => {
  const k = newKeys(kp.publicKey, rand);
  assert.match(k.key, /^[0-9A-F]{32}$/); assert.match(k.iv, /^[0-9A-F]{32}$/);
  const plain = testPrivateDecrypt({ key: kp.privateKey, padding: (ncrypto as any).constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(k.enc, 'base64')).toString();
  assert.equal(plain, k.key + '.' + k.iv);
  const k2 = newKeys(kp.publicKey, rand, 'pkcs1');
  const p2 = testPrivateDecrypt({ key: kp.privateKey, padding: (ncrypto as any).constants.RSA_PKCS1_PADDING }, Buffer.from(k2.enc, 'base64')).toString();
  assert.equal(p2, k2.key + '.' + k2.iv);
  let threw = false; try { rsaOaepEncrypt(kp.publicKey, new Uint8Array(300), rand); } catch { threw = true; }
  assert.ok(threw, 'رسالة أطول من المفتاح ترمي');
});

test('OPPO: جسم الطلب {AES,data,JWT,sum} — sum = sha256(data+token+JWT) والمحتوى ينفك', () => {
  const k = newKeys(kp.publicKey, rand);
  const body = JSON.parse(oppoBody({ NetMode: 5 }, k, 1730000000000, 0.05));
  assert.equal(body.AES, k.enc);
  const token = randomToken(1730000000000, 0.05);
  assert.equal(token, '17300000000002500');
  const inner = JSON.parse(oppoDecrypt(body.data, k));
  assert.deepEqual(inner, { data: { NetMode: 5 }, randomToken: token });
  const jwt = JSON.parse(oppoDecrypt(body.JWT, k));
  assert.equal(Buffer.from(jwt.payload, 'base64').toString(), '{"username":"admin","iat":"1730000000000"}');
  assert.equal(body.sum, (ncrypto as any).createHash('sha256').update(body.data + token + body.JWT).digest('hex'));
  // بدون data (مثل إعادة التشغيل) ما ينرسل حقل data
  assert.deepEqual(Object.keys(JSON.parse(oppoDecrypt(JSON.parse(oppoBody(undefined, k, 1, 0.5)).data, k))), ['randomToken']);
  assert.equal(passHash('admin'), '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918');
});
