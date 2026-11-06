/**
 * D-Link DWR-2000M / DWR-3000M — حسبة الدخول من صفحة الراوتر نفسها (قطعة login، دالة N):
 *   GET /acfun/getLoginKey?username=U ← info.PublicKey + info.Challenge
 *   مفتاح = HMAC_MD5(key = PublicKey + كلمة المرور, msg = Challenge) بالـ hex الكبير
 *   password = HMAC_MD5(key = المفتاح, msg = Challenge) بالـ hex الكبير ← POST /acfun/login {username, password}
 * النص يتحوّل UTF-8 قبل الحساب (دالة A في الصفحة). ملف صافي بدون react-native (عليه اختبار مقابل node:crypto).
 */

function utf8(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
    if (c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c & 0x3ff) << 10) + (d & 0x3ff); i++; }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(bytes: number[]): number[] {
  const len = bytes.length;
  const m = bytes.slice();
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  const bits = len * 8;
  for (let i = 0; i < 8; i++) m.push(Math.floor(bits / 2 ** (8 * i)) & 255);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < m.length; o += 64) {
    const w = Array.from({ length: 16 }, (_, j) => m[o + j * 4] | (m[o + j * 4 + 1] << 8) | (m[o + j * 4 + 2] << 16) | (m[o + j * 4 + 3] << 24));
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const t = d; d = c; c = b;
      const x = (a + f + K[i] + w[g]) >>> 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out: number[] = [];
  for (const v of [a0, b0, c0, d0]) for (let i = 0; i < 4; i++) out.push((v >>> (8 * i)) & 255);
  return out;
}

export function hmacMd5Hex(key: string, msg: string): string {
  let k = utf8(key);
  if (k.length > 64) k = md5(k);
  while (k.length < 64) k.push(0);
  const inner = md5([...k.map(b => b ^ 0x36), ...utf8(msg)]);
  const outer = md5([...k.map(b => b ^ 0x5c), ...inner]);
  return outer.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** نفس login() في الصفحة: يرجّع الكلمة اللي تنرسل + المفتاح (الصفحة تحفظه لتشفير خانات مثل كلمة الواي فاي) */
export function dlLoginHash(publicKey: string, password: string, challenge: string): { password: string; key: string } {
  const key = hmacMd5Hex(publicKey + password, challenge).toUpperCase();
  return { key, password: hmacMd5Hex(key, challenge).toUpperCase() };
}
