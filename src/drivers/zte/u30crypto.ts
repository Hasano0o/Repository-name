/**
 * ZTE U30 Pro / U30 Air (صفحة UFI — service.js، ملفات ٢٧ و٢٩ أكتوبر): بعد الدخول الصفحة تفاوض مفتاح AES:
 *   GET cmd=web_crt_get ← result = المفتاح العام (PEM)
 *   Ko = hex(32 بايت عشوائي) · POST goformId=web_http_enstr_set web_enstr = JSEncrypt(Ko)  (RSA PKCS#1 على نص الـ hex)
 * وبعدها الحقول الحساسة (رقم ونص الرسالة، كلمة الواي فاي، PIN، APN) تنرسل l(x):
 *   iv = 12 بايت · AES-256-GCM(key = bytes(Ko)) · الناتج base64(iv ‖ tag ‖ ciphertext)
 * ملف صافي (عليه اختبارات مقابل AES-GCM حق node).
 */
import { aesBlockEncryptor, b64, utf8, rsaPkcs1Encrypt } from '../zyxel/crypto';

const hexToBytes = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map(x => parseInt(x, 16)));
export const bytesToHex = (u: Uint8Array) => Array.from(u, x => x.toString(16).padStart(2, '0')).join('');

/** ضرب في GF(2^128) (معيار GCM — البت الأعلى أول) */
function gmul(x: Uint8Array, y: Uint8Array): Uint8Array {
  const z = new Uint8Array(16);
  const v = y.slice();
  for (let i = 0; i < 128; i++) {
    if ((x[i >> 3] >> (7 - (i & 7))) & 1) for (let j = 0; j < 16; j++) z[j] ^= v[j];
    const lsb = v[15] & 1;
    for (let j = 15; j > 0; j--) v[j] = (v[j] >> 1) | ((v[j - 1] & 1) << 7);
    v[0] >>= 1;
    if (lsb) v[0] ^= 0xe1;
  }
  return z;
}
function ghash(h: Uint8Array, data: Uint8Array, aadLen: number, ctLen: number): Uint8Array {
  let y: Uint8Array = new Uint8Array(16);
  for (let o = 0; o < data.length; o += 16) {
    const blk = new Uint8Array(16); blk.set(data.subarray(o, o + 16));
    for (let j = 0; j < 16; j++) blk[j] ^= y[j];
    y = gmul(blk, h);
  }
  const len = new Uint8Array(16);
  const put = (off: number, bits: number) => { let b = bits; for (let i = 7; i >= 0; i--) { len[off + i] = b % 256; b = Math.floor(b / 256); } };
  put(0, aadLen * 8); put(8, ctLen * 8);
  for (let j = 0; j < 16; j++) len[j] ^= y[j];
  return gmul(len, h);
}
const inc32 = (c: Uint8Array) => { for (let i = 15; i >= 12; i--) { c[i] = (c[i] + 1) & 255; if (c[i]) break; } };

/** AES-GCM بـ iv طوله ١٢ (بدون AAD) */
export function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, pt: Uint8Array): { ct: Uint8Array; tag: Uint8Array } {
  const enc = aesBlockEncryptor(key);
  const h = enc(new Uint8Array(16));
  const j0 = new Uint8Array(16); j0.set(iv.subarray(0, 12)); j0[15] = 1;
  const ctr = j0.slice();
  const ct = new Uint8Array(pt.length);
  for (let o = 0; o < pt.length; o += 16) {
    inc32(ctr);
    const ks = enc(ctr.slice());
    for (let j = 0; j < 16 && o + j < pt.length; j++) ct[o + j] = pt[o + j] ^ ks[j];
  }
  const padded = new Uint8Array(Math.ceil(ct.length / 16) * 16); padded.set(ct);
  const s = ghash(h, padded, 0, ct.length);
  const ek = enc(j0.slice());
  const tag = s.map((b, i) => b ^ ek[i]);
  return { ct, tag };
}

/** l(x) في الصفحة: النص (ASCII — الرقم أو hex الرسالة) ← base64(iv ‖ tag ‖ ct) */
export function u30Enc(keyHex: string, text: string, rand: (n: number) => Uint8Array): string {
  const iv = rand(12);
  // forge createBuffer(نص) = بايت لكل حرف (latin1) — الحقول اللي تنمرّر هنا كلها ASCII
  const pt = Uint8Array.from(Array.from(String(text ?? ''), c => c.charCodeAt(0) & 255));
  const { ct, tag } = aesGcmEncrypt(hexToBytes(keyHex), iv, pt);
  const out = new Uint8Array(12 + 16 + ct.length);
  out.set(iv, 0); out.set(tag, 12); out.set(ct, 28);
  return b64(out);
}

/** مفتاح جديد + web_enstr (RSA PKCS#1 مثل JSEncrypt على نص الـ hex) */
export function u30NewKey(pem: string, rand: (n: number) => Uint8Array): { keyHex: string; enstr: string } {
  const keyHex = bytesToHex(rand(32));
  return { keyHex, enstr: b64(rsaPkcs1Encrypt(pem, utf8(keyHex), rand)) };
}
