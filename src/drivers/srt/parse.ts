/**
 * زين 5G Indoor CPE SRT858M (واجهة «5G Device» — jQuery + layui، أوامر goform/action بـ JSON) — منطق بدون شبكة.
 * من ملفات «مو مدعوم؟» لعدة أعضاء (٣١ أكتوبر – ١٥ نوفمبر ٢٠٢٦): index.html · common/login.html · js/{login,tools,encryption,md5,common,home}.js
 *  • الدخول (login.js): كل خانة (username · password) = hex_hmac_md5("0123456789", القيمة) ← POST /goform/login JSON.
 *    retcode 0 نجاح · 203 قفل · 202 (str_login_signal) · غيره + remain_times = محاولات باقية (0 ← قفل مؤقت get_login_limit).
 *  • التشفير (tools.js): لو config.xml فيه encrypt=1 — الجسم password_encode بمفتاح X-MG-Private («سر x وقت») من /goform/sync،
 *    والرد password_decode. وإلا JSON عادي.
 *  • القراءة: POST /action/get_mgdb_params {"keys":[…]} ← {retcode, data:{…}} (بعد الدخول) · /goform/get_login_info ← loginStatus 1.
 */
import { hmac } from '@noble/hashes/hmac';
import { md5 } from '@noble/hashes/legacy';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export const SRT_LOGIN_KEY = '0123456789';

/** صفحة الراوتر (index.html: encryption.js + languagemanage.js + settings.html#status) */
export function isSrtPage(html: string): boolean {
  return /\/js\/encryption\.js/.test(html) && /languagemanage\.js/.test(html) && /settings\.html#status/.test(html);
}

/** hex_hmac_md5 حق md5.js (الكلمات ASCII عادة — UTF-8 للاحتياط) */
export function hmacMd5Hex(key: string, data: string): string {
  return bytesToHex(hmac(md5, utf8ToBytes(key), utf8ToBytes(data)));
}

export function srtLoginBody(user: string, pw: string): string {
  return JSON.stringify({ username: hmacMd5Hex(SRT_LOGIN_KEY, user), password: hmacMd5Hex(SRT_LOGIN_KEY, pw) });
}

/** config.xml: <encrypt>1</encrypt> ← الطلبات مشفّرة */
export function srtEncryptOn(xml: string): boolean {
  const m = xml.match(/<encrypt>\s*(\d+)\s*<\/encrypt>/i);
  return !!m && m[1] !== '0';
}

export interface MgKey { secret: string; ts: string; start: number }
/** ترويسة X-MG-Private «<سر>x<وقت hex>» (updatePrikey) */
export function parseMgKey(h: string | null | undefined, nowSec: number): MgKey | null {
  if (!h) return null;
  const [secret, ts] = String(h).split('x');
  if (!secret || ts === undefined) return null;
  return { secret, ts, start: nowSec };
}

// ── Base64 بنفس encryption.js (utf8 يدوي) ──
const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
function u8enc(e: string): string {
  let t = '';
  for (let n = 0; n < e.length; n++) {
    const r = e.charCodeAt(n);
    if (r < 128) t += String.fromCharCode(r);
    else if (r < 2048) t += String.fromCharCode((r >> 6) | 192) + String.fromCharCode((r & 63) | 128);
    else t += String.fromCharCode((r >> 12) | 224) + String.fromCharCode(((r >> 6) & 63) | 128) + String.fromCharCode((r & 63) | 128);
  }
  return t;
}
function u8dec(e: string): string {
  let t = '', n = 0;
  while (n < e.length) {
    const r = e.charCodeAt(n);
    if (r < 128) { t += String.fromCharCode(r); n++; }
    else if (r > 191 && r < 224) { const c2 = e.charCodeAt(n + 1); t += String.fromCharCode(((r & 31) << 6) | (c2 & 63)); n += 2; }
    else { const c2 = e.charCodeAt(n + 1), c3 = e.charCodeAt(n + 2); t += String.fromCharCode(((r & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63)); n += 3; }
  }
  return t;
}
function b64enc(s: string): string {
  const e = u8enc(s);
  let t = '', f = 0;
  while (f < e.length) {
    const n = e.charCodeAt(f++), r = e.charCodeAt(f++), i = e.charCodeAt(f++);
    const s1 = n >> 2, o = ((n & 3) << 4) | (r >> 4);
    let u = ((r & 15) << 2) | (i >> 6), a = i & 63;
    if (isNaN(r)) u = a = 64; else if (isNaN(i)) a = 64;
    t += CH.charAt(s1) + CH.charAt(o) + CH.charAt(u) + CH.charAt(a);
  }
  return t;
}
function b64dec(e0: string): string {
  const e = e0.replace(/[^A-Za-z0-9+/=]/g, '');
  let t = '', f = 0;
  while (f < e.length) {
    const s = CH.indexOf(e.charAt(f++)), o = CH.indexOf(e.charAt(f++)), u = CH.indexOf(e.charAt(f++)), a = CH.indexOf(e.charAt(f++));
    t += String.fromCharCode((s << 2) | (o >> 4));
    if (u != 64) t += String.fromCharCode(((o & 15) << 4) | (u >> 2));
    if (a != 64) t += String.fromCharCode(((u & 3) << 6) | a);
  }
  return u8dec(t);
}
const swapAt = (s: string, n: number, c: string) => s.substr(0, n) + c + s.substr(n + 1, s.length - 1 - n);
const CS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** password_encode حق encryption.js — حرف بحرف (نفس أرقام JS: parseInt + >>) */
export function mgEncode(data: string, k: MgKey, nowSec: number): string {
  const timeStamp = (parseInt('0x' + k.ts, 16) + (nowSec - k.start)).toString(16);
  let s = b64enc(timeStamp + ':' + data);
  const p16 = parseInt('0x' + k.secret, 16);
  const first = CS[s.length % CS.length];
  let tmp = '';
  for (let i = 0; i < 4; i++) tmp += CS[((p16 >> (i * 8)) & 0xff) % CS.length];
  s = tmp + s;
  for (let i = 0; i < 4; i++) {
    const num = ((p16 >> (i * 8)) & 0xff) % s.length;
    const chr = s.substr(num, 1), tot = s.substr(i % s.length, 1);
    s = swapAt(swapAt(s, num, tot), i % s.length, chr);
  }
  return first + s;
}

/** password_decode */
export function mgDecode(str: string, secret: string): string {
  const p16 = parseInt('0x' + secret, 16);
  let s = str.slice(1);
  for (let i = 3; i >= 0; i--) {
    const num = ((p16 >> (i * 8)) & 0xff) % s.length;
    const chr = s.substr(num, 1), tot = s.substr(i % s.length, 1);
    s = swapAt(swapAt(s, num, tot), i % s.length, chr);
  }
  return b64dec(s.slice(4));
}

/** mnet_sysmode ← اسم الشبكة (common.js: lte · nsa · nr5g · «no service») */
export function srtNetwork(sysmode?: string): string | undefined {
  const m = String(sysmode ?? '').toLowerCase();
  if (m === 'nr5g') return '5G';
  if (m === 'nsa') return '5G NSA';
  if (m === 'lte') return '4G';
  if (m === 'wcdma' || m === 'td-scdma') return '3G';
  return undefined;
}
