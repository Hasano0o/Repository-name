/**
 * FiberHome LG6851F — الفيرموير الجديد (مسارات /fh_api/). من plugins/polyfill.min.js (٣٨٧٢٦٤ بايت، «جهاز جديد»
 * ٢٩ و٣٠ أكتوبر) بعد فك الـ obfuscator — وكل دالة هنا مختبرة بالبايت مقابل كود الصفحة نفسه.
 *
 * الفرق عن الفيرموير القديم (./crypto):
 *   • المسارات /fh_api/tmp/ · /fh_api/sign/ بدل /api/… (القديمة: is_encrypt ← 403، الدخول ← 304)
 *   • التشفير شغّال دايماً (_0x936828_ = 1 وما يتغيّر)
 *   • IV = الحروف 111..126 ("opqrstuvwxyz{|}~")
 *   • ردود GET ممكن تجي مخلوطة بحروف زايدة ومواقعها في رأس content-len، وبعد التنظيف base64 (fhapiUnmaskGet).
 *   • GET is_encrypt: الصفحة تقرأ رده .data — فالرد JSON {"data": "…"} (لو انخلط برأس content-len يصير نص
 *     وما له .data وتعلق الصفحة نفسها). في data: الحرف ٥ علامة، والباقي سر من ٥ حروف مشفّر RSA (PKCS#1 v1.5)
 *     بمفتاح خاص مدفون في الصفحة.
 *   • مفتاح AES لكل طلب = خلط sessionid (get_refresh_sessionid) مع السر.
 *   • جسم POST = ٦ حروف عشوائية + hex(AES-CBC(JSON {dataObj, ajaxmethod, sessionid}))
 *   • رد POST = ٦ حروف + hex بنفس المفتاح — إلا الدخول/الخروج (/fh_api/sign/) ردهم نص عادي.
 * ملف صافي — بدون شبكة.
 */
import { aesCbcEncrypt, aesCbcDecrypt, unb64 } from '../zyxel/crypto';

export const FHAPI_TMP = '/fh_api/tmp/';
export const FHAPI_SIGN = '/fh_api/sign/';
export const FHAPI_IV = Array.from({ length: 16 }, (_, i) => String.fromCharCode(i + 111)).join('');

/** المفتاح الخاص المدفون في polyfill.min.js (متغير _0xp98jky) — نفسه عند كل الأجهزة، والصفحة تفك فيه السر */
const FHAPI_PRIVATE_KEY =
  'MIIEuwIBADANBgkqhkiG9w0BAQEFAASCBKUwggShAgEAAoIBAQC3Ij9dkS9pmNeORIuDOFavCpO92Ieh/jglB8vAqxe3pA2VakZN' +
  'NHN7caHvNb4DTCAMlRcFrRVf1K2CGHKdrgiyJGe0kwAnCwUTihCe9jkMzl+ZNKHYtWufUv7ISh+FZXfHi/huyl/MqIPzagIB3glp' +
  'AJ4T7T7gWGT1+fklekZ8URfMqbTXUa/3QBCmwfKrdv4YiIOuPqpifxYK9BWeNYKUOyWbF+dKVi9Wns9mU55Tvw23yF1/jYpXmzv9' +
  'MTZnybgnIKnXdXmBSyGxxxj9hVqdvQuMyslForGxxHIIDaGS26vZTdqfJGeFoBCHHMXzGaNC/1uF0x87VA7au4jxuBORAgMBAAEC' +
  'gf8CgPVc0h9T0kMgLs+5e4uz2PEsJ0mzbUZXO0QN3kj0ucl1wX40kAMELQmJu7JdWS0W/vLRoQwpwz6cCLmIbliwFs9UKK5X2k63' +
  'davEgJlHE4s7DP0peVF/XCMfmePUbw60K7W5zgqBQcyMB2b/n4mBZgDDRPsXFh5LPp+pY4KTMIK2TcWCTOi+7SeoNkKaOXwfkprB' +
  'CYSNdi6OociMVLUaVd16MHofseuaUKPXoTI8vaa7MbT4RGXEPiuXbwfN6G5j9Gi3zN8c+1Im9rLLcXUNnwxJCmt5cIsSdKY/BwL5' +
  'YbfzwWZSSfqnVIZmYZFfCFLy45EfNWf8tJNODy5QlQkCgYEA38XpPi2TPVkCRfOL4pjeWRW4C6fa0ziBgtJtN4Elx7o401BgUNNu' +
  'OW4/NhTMSlf1Z9qEGi2M2Eyj1xT8ZMlH2+fILAwV+G2sQIY4NY9XMHsPGGCsDOIvYvw76yYXnBOcaOX1+jY+g2ING1Zb+P0ymR8l' +
  'Xb/a3Y+gKhfeEYqbA+UCgYEA0YIKzX/pAYWyxJhgr+8ki5DkYCCZGb3H2v0APqb9CNbgFtkEEdgJTdcpRKuEgkmIp+iR7i9TiwCy' +
  '3rwHUn5wodn5cSnGq/nIRRa+YtGJc4qmjEo0TZJNcmx4U4vjKfTDc6wZkaQ9nzGF5Fww3xMh5u+0Rh+IfH74dktMN3hxLj0CgYAw' +
  'pU6SNMgocvwahtpnFUJo7V7IMeJRPpxw+xvBEDNNWv9VeMinaX8xvvTA5f6PPtXbkNZc9oAC2Y5YiHhh1Jvpg1axtKLmEbl7gXIg' +
  'upuCr43Vh9Z/KoCQrTK9aNeDF4RODYfOsBIg76TXx4tQ8oIYZXvzCG0k8z8nR28AMziFvQKBgQC3YkG8cQruZy38gXiYZxYxCAmu' +
  'zrnUW1cVq0FMlfSEiTkrJpg2WkiClyQrVIqvVFhGyP77YveYg2sOJb2vCrfiJB8AW9Xn8MLJHshVTR4oQaPYxpcTk00xLBsC3j5g' +
  'Gjv/AxR6dC3wK3QMWFn62Q9iykyc2LsqZiVrvisfntBK7QKBgAJu8Z3zUHojUtOTsiziwiApOdNfYhHpkp8fUYsskYaxb8DIdthY' +
  'nZIV1hfh+0Qqly7zv8ykys3q+g0HFiBpd6L9VhE1BTgnvDf1dsag1nk6+/JFWYaOJVD0IGtDT0pRtiEPM9EYp6H2gMnN8/CRt6nd' +
  'UJwqeV9xjw6Sl0ftaKuF';

// ─── أدوات بايتات ───
export const utf8 = (s: string): Uint8Array => {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
};
export const unutf8 = (b: Uint8Array): string => {
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

// ─── رد GET (رأس content-len) ───
/**
 * مثل interceptor الرد في الصفحة: content-len = "AABBB.CCC" — نشيل أول AA حرف، ثم ٤ حروف من الموقع BBB، ثم ٤ من CCC،
 * والباقي base64 لنص UTF-8. null = الرأس ناقص/غير صالح (الصفحة نفسها تترك الرد كما هو في هالحالة).
 */
export function fhapiUnmaskGet(data: string, contentLen: string | null | undefined): string | null {
  const h = String(contentLen ?? '');
  if (!(h.length > 4 && h.indexOf('.') !== -1)) return null;
  const p = h.split('.');
  const a = Number(p[0].slice(0, 2));
  const b = Number(p[0].slice(2));
  const c = Number(p[1]);
  const s1 = String(data).substring(a);
  const s2 = s1.substring(0, b - 1) + s1.substring(b + 4);
  const s3 = s2.substring(0, c - 1) + s2.substring(c + 4);
  return unutf8(unb64(s3));
}

// ─── RSA (فك السر) ───
function derRead(b: Uint8Array, i: number): { tag: number; start: number; end: number } {
  const tag = b[i++];
  let len = b[i++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + b[i++];
  }
  return { tag, start: i, end: i + len };
}
const bigOf = (b: Uint8Array) => BigInt('0x' + (toHex(b) || '0'));
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
interface RsaPriv { n: bigint; e: bigint; d: bigint; p: bigint; q: bigint; dp: bigint; dq: bigint; qi: bigint; k: number }
let PRIV: RsaPriv | null = null;
/** PKCS#8 → (n, e, d, p, q, dp, dq, qinv) */
export function parsePkcs8(b64: string): RsaPriv {
  const der = unb64(b64);
  const top = derRead(der, 0);                    // PrivateKeyInfo SEQ
  let i = top.start;
  i = derRead(der, i).end;                        // version INT
  i = derRead(der, i).end;                        // AlgorithmIdentifier SEQ
  const oct = derRead(der, i);                    // OCTET STRING
  const rsa = derRead(der, oct.start);            // RSAPrivateKey SEQ
  let j = rsa.start;
  const ints: bigint[] = [];
  while (j < rsa.end && ints.length < 9) {
    const x = derRead(der, j);
    ints.push(bigOf(der.slice(x.start, x.end)));
    j = x.end;
  }
  const [, n, e, d, p, q, dp, dq, qi] = ints;
  let k = 0;
  for (let t = n; t > 0n; t >>= 8n) k++;
  return { n, e, d, p, q, dp, dq, qi, k };
}
function priv(): RsaPriv {
  return PRIV ?? (PRIV = parsePkcs8(FHAPI_PRIVATE_KEY));
}
/** المفتاح العام المقابل (n, e) — للاختبارات (الراوتر المحاكى يشفّر فيه السر) */
export function fhapiPublicKey(): { n: bigint; e: bigint } {
  const k = priv();
  return { n: k.n, e: k.e };
}
/** مثل JSEncrypt.decrypt: base64 ← RSA (CRT) ← PKCS#1 v1.5 نوع ٢ ← UTF-8. null لو الصيغة غلط (JSEncrypt يرجع false) */
export function fhapiRsaDecrypt(b64: string): string | null {
  const key = priv();
  let c: bigint;
  try { c = bigOf(unb64(String(b64).replace(/\s+/g, ''))); } catch { return null; }
  if (c <= 0n || c >= key.n) return null;
  const m1 = modPow(c % key.p, key.dp, key.p);
  const m2 = modPow(c % key.q, key.dq, key.q);
  let h = ((m1 - m2) * key.qi) % key.p;
  if (h < 0n) h += key.p;
  const m = m2 + h * key.q;
  const hex = m.toString(16).padStart(key.k * 2, '0');
  const em = fromHex(hex);
  if (em[0] !== 0 || em[1] !== 2) return null;
  let z = 2;
  while (z < em.length && em[z] !== 0) z++;
  if (z >= em.length || z < 10) return null;
  return unutf8(em.slice(z + 1));
}

/** نص data في رد is_encrypt: الحرف ٥ علامة (فحص أدوات المطوّر في الصفحة)، والباقي السر المشفّر */
export function fhapiSecret(isEncryptText: string): { flag: number; secret: string | null } {
  const t = String(isEncryptText ?? '');
  return { flag: Number(t.slice(5, 6)), secret: fhapiRsaDecrypt(t.slice(6)) };
}

// ─── مفتاح AES ───
/** نفس _0x46c520_: ١٦ حرف من sessionid والسر (السر لازم ٥ حروف — الصفحة نفسها تعيد طلبه لو غير كذا) */
export function fhapiKey(sessionid: string, secret: string): string {
  const s = String(sessionid ?? '');
  const L = s.length;
  const off = (s[1].charCodeAt(0) % 3) - 1;
  let j = 0;
  let out = '';
  for (let i = 0; i < 16; i++) {
    if ([5, 7, 10, 11, 13].indexOf(i) !== -1) out += String.fromCharCode(secret[j++].charCodeAt(0) + off);
    else if (L > i * 4 + 2) out += String.fromCharCode(s[L - 2 - i * 4].charCodeAt(0) - 1);
    else out += String.fromCharCode(s[i * 4 - 31].charCodeAt(0) + 1);
  }
  return out;
}

// ─── العشوائي (نفس _0x416fe4_ و _0x2204e1_) ───
/** رقمين من Math.random() كنص (الحرف ٢ و٣) — مثل الصفحة بالضبط */
const twoDigits = (rnd: () => number) => { const r = rnd() + ''; return Number(r[2] + r[3]); };
/** ٦ حروف: حرف صغير أو رقم — يتشال من بداية الجسم عند الراوتر */
export function fhapiPrefix(rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    if (twoDigits(rnd) % 2 === 1) s += String.fromCharCode((twoDigits(rnd) % 26) + 97);
    else s += String.fromCharCode((twoDigits(rnd) % 10) + 48) + '';
  }
  return s;
}

// ─── الجسم والرد ───
export function fhapiEncrypt(text: string, key: string): string {
  return toHex(aesCbcEncrypt(utf8(key), utf8(FHAPI_IV), utf8(text)));
}
export function fhapiDecrypt(hex: string, key: string): string {
  return unutf8(aesCbcDecrypt(utf8(key), utf8(FHAPI_IV), fromHex(hex)));
}
/** جسم POST مثل _0x23ba2b_ + _0x34g520_ — ترتيب المفاتيح: dataObj, ajaxmethod, sessionid */
export function fhapiBody(method: string, dataObj: unknown, sessionid: string, secret: string, rnd: () => number = Math.random): string {
  const json = JSON.stringify({ dataObj: dataObj === undefined ? null : dataObj, ajaxmethod: method, sessionid });
  return fhapiPrefix(rnd) + fhapiEncrypt(json, fhapiKey(sessionid, secret));
}
/** رد POST (مو الدخول): نشيل أول ٦ حروف ونفك — مثل _0x336985_ */
export function fhapiReply(text: string, sessionid: string, secret: string): unknown {
  return JSON.parse(fhapiDecrypt(String(text).slice(6), fhapiKey(sessionid, secret)));
}

/** رد is_encrypt مثل ما تقراه الصفحة (res.data). نقبل كمان النص لو جا JSON كنص بعد التنظيف */
export function fhapiIsEncryptData(reply: unknown): string {
  let r: any = reply;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return ''; } }
  return r && typeof r === 'object' && typeof r.data === 'string' ? r.data : '';
}
