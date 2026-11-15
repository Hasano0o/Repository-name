/**
 * TP-Link «GDPR» (Archer NX200 v2 — ١٥ نوفمبر ٢٠٢٦) — نفس tpEncrypt.js + encrypt.js في صفحة الراوتر بالضبط:
 *   - AES-128-CBC + PKCS7، المفتاح والـ iv نصوص أرقام (١٦ حرف) تنقرأ UTF-8، والناتج base64 (CryptoJS)
 *   - التوقيع RSA-512 «بدون حشو» (nopadding): النص يتقطع كل ٦٤ بايت، يتكمّل بأصفار، وكل قطعة ← ١٢٨ حرف hex
 *     دخول: "key=K&iv=I&h=<md5(user+pwd)>&s=<seq+طول_البيانات_المشفرة>" · غيره: "h=…&s=…"
 *   - الجسم: "sign=<…>\r\ndata=<…>\r\n" على /cgi_gdpr?9 — والرد base64 مشفّر بنفس المفتاح
 * بدون react-native — ينختبر في node.
 */
import { md5 } from '@noble/hashes/legacy';
import { bytesToHex } from '@noble/hashes/utils';
import { aesCbcEncrypt, aesCbcDecrypt, b64, unb64, utf8, fromUtf8 } from '../zyxel/crypto';

export interface TpKeys { key: string; iv: string }
export interface TpState { keys: TpKeys; hash: string; seq: number; nn: string; ee: string }

/** مثل AES.genKey في الصفحة: (الوقت + رقم عشوائي) أول ١٦ حرف */
export function tpGenKeys(now = Date.now(), rand = Math.random): TpKeys {
  const one = () => (String(now) + String(rand() * 1e9)).replace(/\D/g, '').padEnd(16, '0').slice(0, 16);
  return { key: one(), iv: one() };
}

export const tpHash = (user: string, pwd: string) => bytesToHex(md5(utf8(user + pwd)));

export function tpAesEncrypt(plain: string, k: TpKeys): string {
  return b64(aesCbcEncrypt(utf8(k.key), utf8(k.iv), utf8(plain)));
}
export function tpAesDecrypt(data: string, k: TpKeys): string {
  return fromUtf8(aesCbcDecrypt(utf8(k.key), utf8(k.iv), unb64(data.trim())));
}

function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}

/** $.rsa.encrypt(text, nn, ee, 512, 0) — بدون حشو، قطع ٦٤ بايت، كل قطعة ١٢٨ حرف hex */
export function tpRsa(text: string, nnHex: string, eeHex: string, bits = 512): string {
  const n = BigInt('0x' + nnHex), e = BigInt('0x' + eeHex);
  const blk = bits / 8, hexLen = bits / 4;
  let out = '';
  for (let i = 0; i < text.length; i += blk) {
    const part = utf8(text.substring(i, i + blk));
    const ba = new Uint8Array(blk); ba.set(part.slice(0, blk));
    const m = BigInt('0x' + bytesToHex(ba));
    out += modPow(m, e, n).toString(16).padStart(hexLen, '0');
  }
  return out;
}

export function tpSign(st: TpState, dataLen: number, login: boolean): string {
  const s = (login ? `key=${st.keys.key}&iv=${st.keys.iv}&` : '') + `h=${st.hash}&s=${st.seq + dataLen}`;
  return tpRsa(s, st.nn, st.ee);
}

/** جسم الطلب المشفّر (مثل tpAjax في gdprProxy.js) */
export function tpBody(plain: string, st: TpState, login: boolean): string {
  const data = tpAesEncrypt(plain, st.keys);
  return `sign=${tpSign(st, data.length, login)}\r\ndata=${data}\r\n`;
}

/** رد /cgi/getGDPRParm أو /cgi/getParm: var ee="010001"; var nn="…"; var seq="…"; */
export function tpParm(text: string): { nn: string; ee: string; seq: number } | null {
  const nn = text.match(/\bnn\s*=\s*"([0-9a-fA-F]{64,})"/)?.[1];
  const ee = text.match(/\bee\s*=\s*"([0-9a-fA-F]+)"/)?.[1];
  const seq = text.match(/\bseq\s*=\s*"?(\d+)"?/)?.[1];
  return nn && ee && seq ? { nn, ee, seq: parseInt(seq, 10) } : null;
}

/** طلب JSON مثل $.dm (dutPrefilter): الأرقام نصوص + stack/pstack، وآخره \r\n */
export function tpJson(operation: string, oid: string, data: Record<string, unknown> = {}): string {
  const d: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) d[k] = typeof v === 'number' ? String(v) : v;
  if (!d.stack) d.stack = '0,0,0,0,0,0';
  if (!d.pstack) d.pstack = '0,0,0,0,0,0';
  return JSON.stringify({ data: d, operation, oid }) + '\r\n';
}

/** base64 مثل $.Base64Encoding (UTF-8) */
export const tpB64 = (s: string) => b64(utf8(s));
