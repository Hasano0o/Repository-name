/**
 * Nokia FastMile 5G Gateway — نفس دوال assets/js/crypto_page.js في صفحة الراوتر (sjcl):
 *   sha256(a, b)    = base64(SHA-256("a:b"))
 *   sha256url(a, b) = base64url_escape(sha256(a, b))   ← + → -  و  / → _  و  = → .
 * ملف صافي (عليه اختبارات).
 */
import { sha256 } from '@noble/hashes/sha2';
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
 * جسم طلب الدخول بالضبط مثل login() في الصفحة:
 * userhash · RandomKeyhash · response = sha256url(sha256(user, pass), nonce) · nonce · enckey · enciv
 * enckey/enciv: مفتاح AES عشوائي نعطيه الراوتر (يشفّر فيه كلمات الواي فاي في الردود) — ١٦ بايت base64.
 */
export function nkLoginBody(user: string, pass: string, nonce: string, randomKey: string, rand: (n: number) => Uint8Array): { body: string; key: string; iv: string } {
  const key = b64(rand(16)), iv = b64(rand(16));
  const response = nkSha256url(nkSha256(user, pass), nonce);
  const body = `userhash=${nkSha256url(user, nonce)}&RandomKeyhash=${nkSha256url(randomKey, nonce)}&response=${response}`
    + `&nonce=${nkEscape(nonce)}&enckey=${nkEscape(key)}&enciv=${nkEscape(iv)}`;
  return { body, key, iv };
}
