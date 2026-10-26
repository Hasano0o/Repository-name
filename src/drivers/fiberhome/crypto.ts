/**
 * تشفير صفحة FiberHome (5G CPE) — من plugins/polyfill.min.js بعد فك الـ packer (تقرير ٢٦ أكتوبر):
 *   key = أول ١٦ حرف من sessionid (get_refresh_sessionid) · iv = الحروف 112..127 (int_aes_iv)
 *   AES-128-CBC + PKCS7، والناتج hex (ciphertext.toString()) — والرد hex بنفس المفتاح.
 *   الطلبات: POST /api/tmp/FHAPIS (بعد الدخول) أو FHNCAPIS (بدون دخول)، الدخول /api/sign/DO_WEB_LOGIN.
 * ملف صافي (عليه اختبارات مقابل AES الحقيقي).
 */
import { aesCbcEncrypt, aesCbcDecrypt } from '../zyxel/crypto';

export const FH_IV = Array.from({ length: 16 }, (_, i) => String.fromCharCode(i + 112)).join('');

const utf8 = (s: string): Uint8Array => {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00); }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
};
const unutf8 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    let cp = c;
    if (c >= 0xf0) cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else if (c >= 0xe0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else if (c >= 0xc0) cp = ((c & 31) << 6) | (b[i++] & 63);
    s += String.fromCodePoint(cp);
  }
  return s;
};
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from((h.trim().match(/../g) ?? []).map(x => parseInt(x, 16)));

export function fhKey(sessionid: string): string {
  return String(sessionid ?? '').substring(0, 16);
}
export function fhEncrypt(text: string, key: string, iv = FH_IV): string {
  return toHex(aesCbcEncrypt(utf8(key), utf8(iv), utf8(text)));
}
export function fhDecrypt(hex: string, key: string, iv = FH_IV): string {
  return unutf8(aesCbcDecrypt(utf8(key), utf8(iv), fromHex(hex)));
}
/** جسم الطلب مثل complatePostConfig: نضيف sessionid للكائن ونشفّره (أو نرسله نص لو التشفير مطفي) */
export function fhBody(obj: Record<string, unknown>, sessionid: string, encrypt: boolean): string {
  const s = JSON.stringify({ ...obj, sessionid });
  return encrypt ? fhEncrypt(s, fhKey(sessionid)) : s;
}
