/**
 * تشفير صفحة OPPO 5G CPE (T1a — زين) — من js/app.*.js (الموديولات e8ea و b775، تقرير ٢٦ أكتوبر):
 *
 *   ١) GET /api/webCgi/GetPemKey ← {pem} مفتاح RSA عام
 *   ٢) نولّد key و iv: كل واحد ١٦ بايت عشوائي بصيغة hex كبيرة (٣٢ حرف)
 *      ونرسل للراوتر AES = RSA(key + "." + iv) بـ base64 (مكتبة node-rsa — الافتراضي OAEP/SHA1)
 *   ٣) كل طلب: {AES, data, JWT, sum}
 *        data = AES-CTR(JSON {data, randomToken})      — المفتاح = نص key (٣٢ بايت ← AES-256)،
 *        JWT  = AES-CTR(JSON {header, payload})           العداد = أول ١٦ بايت من نص iv (crypto-js)
 *        sum  = sha256(data + randomToken + JWT) hex
 *   ٤) الرد نص base64 مشفّر بنفس المفتاح ← JSON ← .data
 *      ErrorCode 5 = الراوتر ما عرف المفتاح ← نولّد مفتاح جديد ونعيد.
 *
 * ملف صافي (عليه اختبارات مقابل AES و RSA الحقيقيين في node).
 */
import { sha256 } from '@noble/hashes/sha2';
import { sha1 } from '@noble/hashes/legacy';
import { bytesToHex } from '@noble/hashes/utils';
import { aesBlockEncryptor, b64, unb64, utf8, fromUtf8, parseRsaPem, rsaPkcs1Encrypt } from '../zyxel/crypto';

/** AES-CTR مثل crypto-js: العداد = أول ١٦ بايت من iv، ويزيد آخر ٤ بايت بس (بدون حمل) */
export function aesCtr(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const enc = aesBlockEncryptor(key);
  const ctr = iv.slice(0, 16);
  const out = new Uint8Array(data.length);
  for (let o = 0; o < data.length; o += 16) {
    const ks = enc(ctr);
    for (let i = 0; i < 16 && o + i < data.length; i++) out[o + i] = data[o + i] ^ ks[i];
    let w = ((ctr[12] << 24) | (ctr[13] << 16) | (ctr[14] << 8) | ctr[15]) >>> 0;
    w = (w + 1) >>> 0;
    ctr[12] = w >>> 24; ctr[13] = (w >>> 16) & 255; ctr[14] = (w >>> 8) & 255; ctr[15] = w & 255;
  }
  return out;
}

export interface OppoKeys { key: string; iv: string; enc: string }

const hexUp = (b: Uint8Array) => bytesToHex(b).toUpperCase();

function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
const toBig = (u: Uint8Array) => BigInt('0x' + (bytesToHex(u) || '0'));
const fromBig = (n: bigint, len: number) => Uint8Array.from(n.toString(16).padStart(len * 2, '0').match(/../g)!.map(h => parseInt(h, 16)));

function mgf1(seed: Uint8Array, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let c = 0, o = 0; o < len; c++) {
    const h = sha1(Uint8Array.from([...seed, c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]));
    out.set(h.slice(0, Math.min(h.length, len - o)), o);
    o += h.length;
  }
  return out;
}

/** RSA-OAEP (SHA-1، بدون label) — الافتراضي في node-rsa */
export function rsaOaepEncrypt(pem: string, msg: Uint8Array, rand: (n: number) => Uint8Array): Uint8Array {
  const { n, e, k } = parseRsaPem(pem);
  const hLen = 20;
  if (msg.length > k - 2 * hLen - 2) throw new Error('الرسالة أطول من مفتاح الراوتر');
  const db = new Uint8Array(k - hLen - 1);
  db.set(sha1(new Uint8Array(0)), 0);
  db[db.length - msg.length - 1] = 1;
  db.set(msg, db.length - msg.length);
  const seed = rand(hLen).slice(0, hLen);
  const mdb = db.map((x, i) => x ^ mgf1(seed, db.length)[i]);
  const ms = seed.map((x, i) => x ^ mgf1(mdb, hLen)[i]);
  const em = new Uint8Array(k);
  em.set(ms, 1); em.set(mdb, 1 + hLen);
  return fromBig(modPow(toBig(em), e, n), k);
}

/** مفتاح جلسة جديد مثل A() في الصفحة */
export function newKeys(pem: string, rand: (n: number) => Uint8Array, scheme: 'oaep' | 'pkcs1' = 'oaep'): OppoKeys {
  const key = hexUp(rand(16));
  const iv = hexUp(rand(16));
  const m = utf8(key + '.' + iv);
  const c = scheme === 'oaep' ? rsaOaepEncrypt(pem, m, rand) : rsaPkcs1Encrypt(pem, m, rand);
  return { key, iv, enc: b64(c) };
}

export function oppoEncrypt(text: string, k: OppoKeys): string {
  return b64(aesCtr(utf8(k.key), utf8(k.iv), utf8(text)));
}
export function oppoDecrypt(data: string, k: OppoKeys): string {
  return fromUtf8(aesCtr(utf8(k.key), utf8(k.iv), unb64(String(data).replace(/(\r\n|\n|\r)/g, ''))));
}

/** randomToken مثل الصفحة: الوقت بالملي ثانية + "2" + ٣ أرقام */
export function randomToken(now: number, r: number): string {
  let n = (1000 * r).toFixed(0);
  while (n.length < 3) n += '0';
  return String(now) + '2' + n;
}

/** base64 لنص (js-base64 encode) */
const b64s = (s: string) => b64(utf8(s));

/** جسم الطلب المشفّر مثل w() في الصفحة */
export function oppoBody(data: unknown, k: OppoKeys, now: number, r: number): string {
  const token = randomToken(now, r);
  const inner: Record<string, unknown> = {};
  if (data !== undefined) inner.data = data;
  inner.randomToken = token;
  const enc = oppoEncrypt(JSON.stringify(inner), k);
  const jwt = oppoEncrypt(JSON.stringify({
    header: b64s(JSON.stringify({ type: 'JWT', alg: 'HS256' })),
    payload: b64s(JSON.stringify({ username: 'admin', iat: String(now) })),
  }), k);
  const sum = bytesToHex(sha256(utf8(enc + token + jwt)));
  return JSON.stringify({ AES: k.enc, data: enc, JWT: jwt, sum });
}

/** كلمة المرور في الدخول = sha256 hex */
export const passHash = (p: string) => bytesToHex(sha256(utf8(p)));
