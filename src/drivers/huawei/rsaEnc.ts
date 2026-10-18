import { sha1 } from '@noble/hashes/legacy';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/**
 * تشفير طلبات هواوي «;enc» — نفس صفحة الراوتر (main.js، doRSAEncrypt لما isSupportEcc = false):
 * النص (XML كامل) ← base64(utf8) ← يتقسم قطع بطول (حجم المفتاح بالبايت − 42) ← كل قطعة RSA-OAEP (SHA-1، بدون label)
 * ← hex، وتنلزق القطع ورا بعض. المفتاح من api/webserver/publickey (encpubkeyn / encpubkeye).
 * مقروء من صفحة H158-381 (5G CPE Pro 5) — ١٨ أكتوبر ٢٠٢٦.
 */

const H_LEN = 20; // SHA-1

function mgf1(seed: Uint8Array, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let off = 0;
  for (let c = 0; off < len; c++) {
    const cnt = new Uint8Array([(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]);
    const buf = new Uint8Array(seed.length + 4);
    buf.set(seed); buf.set(cnt, seed.length);
    const h = sha1(buf);
    out.set(h.subarray(0, Math.min(h.length, len - off)), off);
    off += h.length;
  }
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return r;
}

function oaepEncrypt(msg: Uint8Array, n: bigint, e: bigint, k: number, rand: (n: number) => Uint8Array): string {
  const lHash = sha1(new Uint8Array(0));
  const db = new Uint8Array(k - H_LEN - 1);
  db.set(lHash);
  db[db.length - msg.length - 1] = 1;
  db.set(msg, db.length - msg.length);
  const seed = rand(H_LEN);
  const dbMask = mgf1(seed, db.length);
  for (let i = 0; i < db.length; i++) db[i] ^= dbMask[i];
  const seedMask = mgf1(db, H_LEN);
  const mSeed = seed.slice();
  for (let i = 0; i < H_LEN; i++) mSeed[i] ^= seedMask[i];
  const em = new Uint8Array(k);
  em.set(mSeed, 1); em.set(db, 1 + H_LEN);
  const c = modPow(BigInt('0x' + bytesToHex(em)), e, n);
  return c.toString(16).padStart(k * 2, '0');
}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

/** يشفّر نص الطلب كامل (مع <?xml…?><request>) — يرجّع hex */
export function huaweiEncrypt(plain: string, nHex: string, eHex: string, rand: (n: number) => Uint8Array): string {
  const n = BigInt('0x' + nHex);
  const e = BigInt('0x' + eHex);
  const k = nHex.length / 2;
  const chunk = k - 2 * H_LEN - 2;
  const c = b64(utf8ToBytes(plain));
  let out = '';
  for (let i = 0; i < c.length; i += chunk) out += oaepEncrypt(utf8ToBytes(c.substr(i, chunk)), n, e, k, rand);
  return out;
}

