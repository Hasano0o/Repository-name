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

/** الصفحة نفسها ترسل Language؟ (LG8245X6/HG8245X6 إيه · DG8245V لا — صفحة ١٤ نوفمبر) */
export function pageSendsLanguage(html: string): boolean {
  return /addParameter\(\s*['"]Language['"]/.test(html);
}

export function loginBody(user: string, pw: string, lang: string, token: string, withLang = true): string {
  const e = encodeURIComponent;
  return `UserName=${e(user)}&PassWord=${e(b64(pw))}${withLang ? `&Language=${e(lang)}` : ''}&x.X_HW_Token=${e(token)}`;
}

/** كوكي الجلسة من رأس set-cookie (هواوي ONT: «Cookie=sid=…:Language:…:id=1; path=/») ← «اسم=قيمة» بس */
export function cookieFrom(setCookie: string): string {
  const out: string[] = [];
  for (const part of setCookie.split(/,(?=\s*[A-Za-z0-9_.-]+=)/)) {
    const nv = part.split(';')[0].trim();
    if (/^[A-Za-z0-9_.-]+=/.test(nv) && !/=\s*$/.test(nv) && !/=deleted$/i.test(nv)) out.push(nv);
  }
  return out.join('; ');
}

/** معاملات نصية لكل «new <Ctor>(…)» في الصفحة (نصوص "…" أو '…' بس، مع فك \xNN) */
export function ctorArgs(html: string, ctor: string): string[][] {
  const out: string[][] = [];
  const re = new RegExp(`new\\s+${ctor}\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const args: string[] = [];
    let i = re.lastIndex;
    while (i < html.length) {
      while (/[\s,]/.test(html[i])) i++;
      const q = html[i];
      if (q === ')') break;
      if (q !== '"' && q !== "'") { // رقم أو متغير — ناخذه لين الفاصلة
        const e = html.slice(i).search(/[,)]/); if (e < 0) break;
        args.push(html.slice(i, i + e).trim()); i += e; continue;
      }
      let j = i + 1, s = '';
      while (j < html.length && html[j] !== q) { if (html[j] === '\\') { s += html[j] + html[j + 1]; j += 2; } else s += html[j++]; }
      args.push(unhex(s).replace(/\\(.)/g, '$1')); i = j + 1;
    }
    out.push(args);
  }
  return out;
}

export interface OntDeviceInfo { serial?: string; hardware?: string; software?: string; model?: string; mac?: string }

/** deviceinfo.asp — new stDeviceInfo(domain, SN, HW, SW, Model, Vendor, Release, MAC, Desc, …) (DG8245V ١٤ نوفمبر) */
export function deviceInfo(html: string): OntDeviceInfo | null {
  const a = ctorArgs(html, 'stDeviceInfo').find(x => /DeviceInfo/.test(x[0] ?? ''));
  if (!a) return null;
  const v = (i: number) => (a[i] ?? '').trim() || undefined;
  return { serial: v(1), hardware: v(2), software: v(3), model: v(4), mac: v(7) };
}

export interface OntUserDev { ip?: string; mac: string; port?: string; online: boolean; conn?: string; name?: string }

/** GetLanUserDevInfo.asp — new USERDevice(domain, IP, MAC, Port, IpType, DevType, Status, ConnType, Time, HostName, …) */
export function userDevices(html: string): OntUserDev[] {
  return ctorArgs(html, 'USERDevice')
    .filter(a => /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(a[2] ?? ''))
    .map(a => ({
      ip: a[1] || undefined, mac: a[2].toUpperCase(), port: a[3] || undefined,
      online: /^online$/i.test(a[6] ?? ''), conn: a[7] || undefined, name: (a[9] ?? '').trim() || undefined,
    }));
}

export interface OntUplink { pon: string; online: boolean; mode: string }

/** ontstate.asp — نوع الوصلة للإنترنت: PonMode 'ge' = كابل إيثرنت (المنفذ الضوئي مو مستخدم) · gpon/epon = فايبر */
export function uplinkState(html: string): OntUplink | null {
  const pm = html.match(/var\s+PonMode\s*=\s*['"]([^'"]*)['"]/);
  if (!pm) return null;
  const pon = pm[1].toLowerCase();
  const eth = ctorArgs(html, 'stLinkStatus').some(a => /up/i.test(a[1] ?? ''));
  const gpon = ctorArgs(html, 'stGponOntStateInfo').concat(ctorArgs(html, 'stOntState')).some(a => a.some(x => /^O5/i.test(x)));
  const online = /OntState\s*=\s*["']ONLINE["']\s*;\s*$/m.test(html) || eth || gpon;
  const mode = pon === 'ge' ? 'كابل إيثرنت (GE)' : pon ? `فايبر ${pon.toUpperCase()}` : 'فايبر';
  return { pon, online, mode };
}
