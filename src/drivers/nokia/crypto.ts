/**
 * Nokia FastMile 5G Gateway — نفس دوال assets/js/crypto_page.js في صفحة الراوتر (sjcl):
 *   sha256(a, b)    = base64(SHA-256("a:b"))
 *   sha256url(a, b) = base64url_escape(sha256(a, b))   ← + → -  و  / → _  و  = → .
 * ملف صافي (عليه اختبارات).
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { b64, utf8 } from '../zyxel/crypto';


export function nkEscape(b: string): string {
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');
}
export function nkSha256(a: string, b: string): string {
  return b64(sha256(utf8(`${a}:${b}`)));
}
export function nkSha256url(a: string, b: string): string {
  return nkEscape(nkSha256(a, b));
}

/**
 * الفيرموير الأحدث (ملف ٢٧ أكتوبر — 3.1): الراوتر يرسل iterations، والكلمة تتحول قبل الدخول:
 * hex(SHA256(كلمة)) ثم (iterations-1) مرة hex(SHA256(bytes(hex))) — نفس submitChanges في صفحة تغيير الكلمة.
 * iterations = 0 أو مو موجود (فيرموير ٣١ أكتوبر) ← الكلمة كما هي.
 */
export function nkPasswordHash(pass: string, iterations: number): string {
  const n = Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 100000 ? iterations : 0;
  if (!n) return pass;
  let h = bytesToHex(sha256(utf8(pass)));
  for (let i = 1; i < n; i++) h = bytesToHex(sha256(hexToBytes(h)));
  return h;
}

/**
 * جسم طلب الدخول بالضبط مثل login() في الصفحة:
 * userhash · RandomKeyhash · response = sha256url(sha256(user, pass), nonce) · nonce · enckey · enciv
 * enckey/enciv: مفتاح AES عشوائي نعطيه الراوتر (يشفّر فيه كلمات الواي فاي في الردود) — ١٦ بايت base64.
 */
export function nkLoginBody(user: string, pass: string, nonce: string, randomKey: string, rand: (n: number) => Uint8Array, iterations = 0): { body: string; key: string; iv: string } {
  const key = b64(rand(16)), iv = b64(rand(16));
  const response = nkSha256url(nkSha256(user, nkPasswordHash(pass, iterations)), nonce);
  const body = `userhash=${nkSha256url(user, nonce)}&RandomKeyhash=${nkSha256url(randomKey, nonce)}&response=${response}`
    + `&nonce=${nkEscape(nonce)}&enckey=${nkEscape(key)}&enciv=${nkEscape(iv)}`;
  return { body, key, iv };
}
