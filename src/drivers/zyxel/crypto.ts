/**
 * تشفير صفحة زيكسل الجديدة (jsencrypt + aes.js) — بدون مكتبات جديدة:
 *   AES-256-CBC (PKCS7) لمحتوى الطلب/الرد، و RSA PKCS#1 v1.5 لمفتاح AES (base64).
 * مرجع: zulufoxtrot/nr7101 v2 (MIT). ملف صافي — عليه اختبار يقارنه بـ node:crypto.
 */

// ═══ AES (FIPS-197) ═══
const SBOX = new Uint8Array(256);
const INV = new Uint8Array(256);
(() => {
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) INV[SBOX[i]] = i;
})();
const xt = (a: number) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
const mul = (a: number, b: number) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };

function expandKey(key: Uint8Array): Uint8Array[] {
  const nk = key.length / 4, nr = nk + 6;
  const w: number[][] = [];
  for (let i = 0; i < nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
  let rcon = 1;
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let t = [...w[i - 1]];
    if (i % nk === 0) { t = [SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]; rcon = xt(rcon); }
    else if (nk > 6 && i % nk === 4) t = t.map(b => SBOX[b]);
    w.push(w[i - nk].map((b, j) => b ^ t[j]));
  }
  const rk: Uint8Array[] = [];
  for (let r = 0; r <= nr; r++) rk.push(Uint8Array.from([...w[4 * r], ...w[4 * r + 1], ...w[4 * r + 2], ...w[4 * r + 3]]));
  return rk;
}
function encBlock(b: Uint8Array, rk: Uint8Array[]): Uint8Array {
  const s = b.map((x, i) => x ^ rk[0][i]);
  const nr = rk.length - 1;
  for (let r = 1; r <= nr; r++) {
    const t = new Uint8Array(16);
    for (let i = 0; i < 16; i++) t[i] = SBOX[s[(i + 4 * (i % 4)) % 16]]; // SubBytes+ShiftRows
    if (r !== nr) for (let c = 0; c < 4; c++) {
      const a0 = t[4 * c], a1 = t[4 * c + 1], a2 = t[4 * c + 2], a3 = t[4 * c + 3];
      t[4 * c] = xt(a0) ^ xt(a1) ^ a1 ^ a2 ^ a3;
      t[4 * c + 1] = a0 ^ xt(a1) ^ xt(a2) ^ a2 ^ a3;
      t[4 * c + 2] = a0 ^ a1 ^ xt(a2) ^ xt(a3) ^ a3;
      t[4 * c + 3] = xt(a0) ^ a0 ^ a1 ^ a2 ^ xt(a3);
    }
    for (let i = 0; i < 16; i++) s[i] = t[i] ^ rk[r][i];
  }
  return s;
}
function decBlock(b: Uint8Array, rk: Uint8Array[]): Uint8Array {
  const nr = rk.length - 1;
  let s = b.map((x, i) => x ^ rk[nr][i]);
  for (let r = nr - 1; r >= 0; r--) {
    const t = new Uint8Array(16);
    for (let i = 0; i < 16; i++) t[(i + 4 * (i % 4)) % 16] = INV[s[i]]; // InvShiftRows+InvSubBytes
    for (let i = 0; i < 16; i++) t[i] ^= rk[r][i];
    if (r !== 0) for (let c = 0; c < 4; c++) {
      const a0 = t[4 * c], a1 = t[4 * c + 1], a2 = t[4 * c + 2], a3 = t[4 * c + 3];
      t[4 * c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
      t[4 * c + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
      t[4 * c + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
      t[4 * c + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
    }
    s = t;
  }
  return s;
}

/** مشفّر بلوك AES واحد (للأوضاع اللي نبنيها فوقه مثل CTR — OPPO) */
export function aesBlockEncryptor(key: Uint8Array): (block: Uint8Array) => Uint8Array {
  const rk = expandKey(key);
  return b => encBlock(b, rk);
}

export function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const rk = expandKey(key);
  const pad = 16 - (data.length % 16);
  const buf = new Uint8Array(data.length + pad); buf.set(data); buf.fill(pad, data.length);
  const out = new Uint8Array(buf.length);
  let prev: Uint8Array = iv.slice(0, 16);
  for (let o = 0; o < buf.length; o += 16) {
    const blk = buf.slice(o, o + 16).map((x, i) => x ^ prev[i]);
    prev = encBlock(blk, rk); out.set(prev, o);
  }
  return out;
}

export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const rk = expandKey(key);
  const out = new Uint8Array(data.length);
  let prev: Uint8Array = iv.slice(0, 16);
  for (let o = 0; o + 16 <= data.length; o += 16) {
    const blk = data.slice(o, o + 16);
    out.set(decBlock(blk, rk).map((x, i) => x ^ prev[i]), o);
    prev = blk;
  }
  // PKCS7 (وبعض الراوترات تحشي بأصفار)
  const p = out[out.length - 1];
  if (p > 0 && p <= 16 && out.slice(out.length - p).every(x => x === p)) return out.slice(0, out.length - p);
  let e = out.length; while (e > 0 && out[e - 1] === 0) e--;
  return out.slice(0, e);
}

// ═══ base64 / utf8 ═══
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function b64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i] << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u.length ? B64[n & 63] : '=');
  }
  return s;
}
export function unb64(s: string): Uint8Array {
  const c = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < c.length; i += 4) {
    const n = (B64.indexOf(c[i]) << 18) | (B64.indexOf(c[i + 1]) << 12) | ((B64.indexOf(c[i + 2] ?? 'A') & 63) << 6) | (B64.indexOf(c[i + 3] ?? 'A') & 63);
    out.push((n >> 16) & 255);
    if (i + 2 < c.length) out.push((n >> 8) & 255);
    if (i + 3 < c.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}
export const utf8 = (s: string) => new TextEncoder().encode(s);
export const fromUtf8 = (u: Uint8Array) => new TextDecoder().decode(u);

// ═══ RSA PKCS#1 v1.5 (المفتاح العام PEM من /getRSAPublickKey) ═══
function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
/** يطلّع n و e من PEM (SubjectPublicKeyInfo أو RSAPublicKey) — قراءة DER بسيطة */
export function parseRsaPem(pem: string): { n: bigint; e: bigint; k: number } {
  const der = unb64(pem.replace(/-----[^-]+-----/g, ''));
  let p = 0;
  const len = () => { let l = der[p++]; if (l & 0x80) { const k = l & 0x7f; l = 0; for (let i = 0; i < k; i++) l = (l << 8) | der[p++]; } return l; };
  const ints: Uint8Array[] = [];
  const walk = (end: number) => {
    while (p < end) {
      const tag = der[p++]; const l = len(); const s = p;
      if (tag === 0x30) walk(s + l);
      else if (tag === 0x03) { p++; walk(s + l); }      // BIT STRING: نتخطى بايت «الحشو» وندخل
      else if (tag === 0x02) { ints.push(der.slice(s, s + l)); p = s + l; }
      else p = s + l;
    }
  };
  walk(der.length);
  const big = (u: Uint8Array) => BigInt('0x' + Array.from(u, x => x.toString(16).padStart(2, '0')).join('') || '0');
  const ni = ints.findIndex(x => x.length >= 64);
  if (ni < 0 || !ints[ni + 1]) throw new Error('مفتاح الراوتر غير مفهوم');
  const n = big(ints[ni]);
  let bits = 0; for (let t = n; t > 0n; t >>= 1n) bits++;
  return { n, e: big(ints[ni + 1]), k: Math.ceil(bits / 8) };
}
export function rsaPkcs1Encrypt(pem: string, msg: Uint8Array, rand: (n: number) => Uint8Array): Uint8Array {
  const { n, e, k } = parseRsaPem(pem);
  if (msg.length > k - 11) throw new Error('الرسالة أطول من المفتاح');
  const ps = new Uint8Array(k - msg.length - 3);
  let filled = 0;
  while (filled < ps.length) { for (const b of rand(ps.length)) if (b && filled < ps.length) ps[filled++] = b; }
  const em = new Uint8Array(k); em[1] = 2; em.set(ps, 2); em.set(msg, ps.length + 3);
  const c = modPow(BigInt('0x' + Array.from(em, x => x.toString(16).padStart(2, '0')).join('')), e, n);
  const hex = c.toString(16).padStart(k * 2, '0');
  return Uint8Array.from(hex.match(/../g)!.map(h => parseInt(h, 16)));
}
