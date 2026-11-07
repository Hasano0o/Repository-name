/**
 * هواوي فايبر (ONT — HG8245 / DG8245V / LG8245X6 / «Mobily Fiber») — قراءة صفحة الدخول. بدون شبكة (ينختبر).
 * من ملفات «جهاز جديد» (٢٧ أكتوبر – ٧ نوفمبر: DG8245V STC · HG8245W5 · HG8245X6-8Ne موبايلي · LG8245X6):
 *  • صفحة الدخول «/»: txt_Username / txt_Password ← POST /login.cgi
 *    UserName · PassWord = base64(الكلمة) · Language · x.X_HW_Token  + كوكي «Cookie=body:Language:<لغة>:id=-1»
 *  • الرمز: DG8245V مكتوب في الصفحة نفسها (function GetRandCnt() { return '…'; })، والباقي POST /asp/GetRandCount.asp
 *  • القفل: errloginlockNum (DG8245V = 3 محاولات) · LockTime · LockLeftTime (ثواني باقية) · LoginTimes · FailStat
 */

const unhex = (s: string) => s.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const jsVar = (html: string, name: string): string | undefined => {
  const m = html.match(new RegExp(`var\\s+${name}\\s*=\\s*['"]([^'"]*)['"]`));
  return m ? unhex(m[1]) : undefined;
};

/** صفحة دخول جهاز فايبر هواوي؟ (مو راوتر شريحة — هذاك /api/webserver) */
export function isOntLoginPage(html: string): boolean {
  return /login\.cgi/.test(html) && /X_HW_Token/.test(html) && /txt_Password/.test(html);
}

/** الرمز المكتوب في الصفحة (DG8245V) — وإلا undefined ونطلبه من GetRandCount.asp */
export function tokenFromPage(html: string): string | undefined {
  const m = html.match(/function\s+GetRandCnt\s*\(\s*\)\s*\{\s*return\s*['"]([0-9a-zA-Z]{8,})['"]/);
  return m?.[1];
}

/** رد /asp/GetRandCount.asp — نص الرمز (أحياناً قبله BOM أو مسافات) */
export function tokenFromReply(text: string): string | undefined {
  const t = text.replace(/^﻿/, '').trim();
  return /^[0-9a-zA-Z]{8,128}$/.test(t) ? t : undefined;
}

export function productName(html: string): string | undefined {
  const p = jsVar(html, 'ProductName')?.trim();
  return p || undefined;
}

export function loginLanguage(html: string): string {
  return jsVar(html, 'Var_LastLoginLang') || jsVar(html, 'Var_DefaultLang') || 'english';
}

export interface OntLockInfo { maxTries?: number; leftSecs: number; failed: boolean; times?: number }

/** حالة القفل والمحاولات من صفحة الدخول (اللي ترجع بعد محاولة فاشلة كمان) */
export function lockInfo(html: string): OntLockInfo {
  const n = (v?: string) => { const x = parseInt(String(v ?? ''), 10); return Number.isFinite(x) ? x : undefined; };
  return {
    maxTries: n(jsVar(html, 'errloginlockNum')),
    leftSecs: n(jsVar(html, 'LockLeftTime')) ?? 0,
    failed: jsVar(html, 'LoginFailedFlag') === '1' || jsVar(html, 'FailStat') === '1',
    times: n(jsVar(html, 'LoginTimes')),
  };
}

/** base64 لنص (الكلمة ASCII عادة؛ UTF-8 للاحتياط) — نفس base64encode في صفحة الجهاز */
export function b64(s: string): string {
  const bytes = Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += A[a >> 2] + A[((a & 3) << 4) | ((b ?? 0) >> 4)]
      + (b === undefined ? '=' : A[((b & 15) << 2) | ((c ?? 0) >> 6)])
      + (c === undefined ? '=' : A[c & 63]);
  }
  return out;
}

export function loginBody(user: string, pw: string, lang: string, token: string): string {
  const e = encodeURIComponent;
  return `UserName=${e(user)}&PassWord=${e(b64(pw))}&Language=${e(lang)}&x.X_HW_Token=${e(token)}`;
}
