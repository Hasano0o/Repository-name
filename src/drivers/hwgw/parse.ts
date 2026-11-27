/**
 * هواوي البوابة القديمة (LTE CPE E5172 — فيرموير V200R001، واجهة ASP بنطاقات TR-069) — منطق بدون شبكة عشان ينختبر.
 * من ملفات «مو مدعوم؟» لثلاث أعضاء (٣١ أكتوبر – ٨ نوفمبر ٢٠٢٦): index.html + js/index.js + js/rsa.js.
 *  • صفحة الدخول: loadbyver.js + «var LoginError = "<محاولات>:<كود>"» + txt_Username / txt_Password.
 *  • الدخول (index.js SubmitForm): POST /index/login.cgi نموذج Username + Password = MyRSAEncryptB64(الكلمة)
 *    — RSA PKCS#1 v1.5 (نوع 2) بمفتاح ثابت ١٠٢٤ بت في rsa.js ← hex ← base64 (hex2b64). كوكي «Language=…» قبلها.
 *  • الحالة بعد الدخول (main.js getPanelData): POST /index/getStatusByAjax.cgi ← XML: SIG (أعمدة) · Mode · Operator · Connect · SIM …
 */
import { hexToBytes } from '@noble/hashes/utils';

/** المفتاح الثابت في js/rsa.js (نفسه في الثلاث نسخ) */
export const E5172_MODULUS =
  'BEB90F8AF5D8A7C7DA8CA74AC43E1EE8A48E6860C0D46A5D690BEA082E3A74E1' +
  '571F2C58E94EE339862A49A811A31BB4A48F41B3BCDFD054C3443BB610B5418B' +
  '3CBAFAE7936E1BE2AFD2E0DF865A6E59C2B8DF1E8D5702567D0A9650CB07A43D' +
  'E39020969DF0997FCA587D9A8AE4627CF18477EC06765DF3AA8FB459DD4C9AF3';
export const E5172_EXP = '10001';

/** صفحة دخول البوابة القديمة؟ */
export function isGwLoginPage(html: string): boolean {
  return /loadbyver\.js/.test(html) && /var\s+LoginError\s*=/.test(html) && /txt_Password/.test(html) && /txt_Username/.test(html);
}

/** «var LoginError = "2:1074266212"» ← { times: 2, code } — times = محاولات غلط متتالية (الصفحة تحذّر من ٣) */
export function gwLoginError(html: string): { times: number; code: string } | null {
  const m = html.match(/var\s+LoginError\s*=\s*["'](\d+):(\d*)["']/);
  return m ? { times: parseInt(m[1], 10), code: m[2] } : null;
}

/**
 * صفحة «ارجع للبداية» (٢٥٧ بايت): «var pageName = '/'; window.location.replace(pageName);» — الراوتر يردها
 * على login.cgi (نجح أو فشل) وعلى أي صفحة html/*.asp بدون جلسة. فما تقول شي عن الدخول بحد ذاتها.
 */
export function isGwBounce(html: string): boolean {
  return html.length < 1200 && /var\s+pageName\s*=\s*['"]\/['"]/.test(html) && /location\.replace\(\s*pageName\s*\)/.test(html);
}

/**
 * اسم مستخدم شكله اسم موديل (E5172-920 · E5172s-927 …) — عضو ٢٧ نوفمبر دخل به (غالباً من الملصق) وانرفض مرتين.
 * الاسم في هالراوترات admin — ما نصرف محاولة (الراوتر يحذّر بعد ٣).
 */
export function gwModelLikeUser(user: string): boolean {
  return /^(e|b)\d{3,4}[a-z]?s?(-\d{2,4})?$/i.test(user.trim());
}

/** نسخة الفيرموير من loadbyver.js?ver=… */
export function gwVersion(html: string): string | undefined {
  return html.match(/loadbyver\.js\?ver=([A-Za-z0-9._-]{4,40})/)?.[1];
}

function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}

/** نص UTF-8 بنفس ترميز pkcs1pad2 في rsa.js (حروف < 128 بايت وحدة، وغيرها ٢–٣ بايت) */
function jsbnUtf8(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push((c >> 6) | 192, (c & 63) | 128);
    else out.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128);
  }
  return out;
}

/** MyRSAEncryptB64 حق الصفحة: PKCS#1 v1.5 نوع 2 ← c.toString(16) (بدون أصفار بالبداية، وزوجي) ← base64 */
export function gwRsaB64(text: string, rand: (n: number) => Uint8Array, nHex = E5172_MODULUS, eHex = E5172_EXP): string {
  const n = BigInt('0x' + nHex), e = BigInt('0x' + eHex);
  const k = (nHex.replace(/^0+/, '').length * 4 + 7) >> 3;
  const msg = jsbnUtf8(text);
  if (msg.length > k - 11) throw new Error('الكلمة طويلة على التشفير');
  const ps: number[] = [];
  while (ps.length < k - 3 - msg.length) {
    for (const b of rand(k)) { if (b !== 0 && ps.length < k - 3 - msg.length) ps.push(b); }
  }
  const em = [0, 2, ...ps, 0, ...msg];
  const m = BigInt('0x' + em.map(b => b.toString(16).padStart(2, '0')).join(''));
  let h = modPow(m, e, n).toString(16);
  if (h.length & 1) h = '0' + h;
  const bytes = hexToBytes(h);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** نموذج الدخول — نفس ترتيب WebSubmitForm */
export function gwLoginBody(user: string, encPw: string): string {
  return `Username=${encodeURIComponent(user)}&Password=${encodeURIComponent(encPw)}`;
}

export interface GwStatus { sig?: number; mode?: string; operator?: string; connect?: string; sim?: string; roam?: string; wanErr?: string }

/** رد getStatusByAjax.cgi (XML) — null لو مو الرد المتوقع (مثلاً رجعنا لصفحة الدخول) */
export function gwStatus(xml: string): GwStatus | null {
  if (!/<SIG>/i.test(xml)) return null;
  const t = (n: string) => xml.match(new RegExp(`<${n}>\\s*([^<]*?)\\s*</${n}>`, 'i'))?.[1];
  const sig = parseInt(t('SIG') ?? '', 10);
  return {
    sig: Number.isFinite(sig) ? sig : undefined,
    mode: t('Mode'), operator: t('Operator') || undefined, connect: t('Connect'),
    sim: t('SIM'), roam: t('Roam'), wanErr: t('WanErrCode'),
  };
}
