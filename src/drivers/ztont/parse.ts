/**
 * ZTE فايبر (ONT) — F660 وعائلته (صفحة دخول «Frm_Username» القديمة). من ملفات عضو ١٥ نوفمبر ٢٠٢٦ (٣ إرسالات).
 * الدخول من passwordSHA256() في index.html:
 *   POST / (نفس الصفحة) form: action=login · Username · Password = sha256(الكلمة + رقم عشوائي ٨ خانات)
 *   · Frm_Logintoken=3 · UserRandomNum=<الرقم> · Frm_Loginchecktoken=<من الصفحة — يتغيّر كل مرة>
 * القفل: locktime 60 — الصفحة تنادي SetDisabled() بعد محاولات غلط.
 * بدون react-native — ينختبر في node.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/** صفحة دخول ZTE ONT */
export function isZtOntLogin(t: string): boolean {
  return /id=["']?Frm_Username/.test(t) && /Frm_Loginchecktoken|Frm_Logintoken/.test(t);
}
/** الموديل من <title> (F660 · F670L …) */
export function ztOntModel(t: string): string | null {
  const m = t.match(/<title>\s*([^<]{2,40}?)\s*<\/title>/i);
  const v = m?.[1]?.trim();
  return v && /^[A-Z]{1,3}\d{3,4}[A-Z0-9-]*$/i.test(v) ? v : null;
}
/** رمز الصفحة (يتغيّر كل تحميل) */
export function ztOntCheckToken(t: string): string | null {
  return t.match(/["']Frm_Loginchecktoken["']\s*,\s*["']([0-9a-zA-Z]{4,})["']/)?.[1]
    ?? t.match(/name=["']?Frm_Loginchecktoken["']?[^>]*value=["']?([0-9a-zA-Z]{4,})/)?.[1] ?? null;
}
export function ztOntLoginToken(t: string): string {
  return t.match(/["']Frm_Logintoken["']\s*,\s*["']([0-9a-zA-Z]+)["']/)?.[1] ?? '3';
}
/** الصفحة تقفل الدخول (نداء SetDisabled() برا تعريفها) */
export function ztOntLocked(t: string): boolean {
  return /(^|[^\w.])SetDisabled\(\)\s*;/m.test(t.replace(/function\s+SetDisabled\s*\(\)/g, ''));
}
/** رسالة خطأ الصفحة بعد محاولة غلط (لو فيه) */
export function ztOntError(t: string): string | null {
  const all = [...t.matchAll(/getObj\(["']errmsg["']\)\.innerHTML\s*=\s*["']([^"']{4,160})["']/g)].map(m => m[1]);
  return all.find(x => /incorrect|not correct|wrong|error|fail|locked|try again|exceed|خطأ|غلط/i.test(x)) ?? null;
}
export function ztOntPassword(pwd: string, rand: number): string {
  return bytesToHex(sha256(utf8ToBytes(pwd + String(rand))));
}
export function ztOntBody(user: string, pwd: string, checkToken: string, loginToken = '3', rand = Math.round(Math.random() * 89999999) + 10000000): string {
  const f: [string, string][] = [
    ['action', 'login'], ['Username', user], ['Password', ztOntPassword(pwd, rand)],
    ['Frm_Logintoken', loginToken], ['UserRandomNum', String(rand)], ['Frm_Loginchecktoken', checkToken],
  ];
  return f.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
/** مسار خطر (ما نفتحه حتى بـ GET) */
export const ZT_DANGER = /logout|restart|reboot|reset|factory|upgrade|IF_ACTION|devrestart|restore/i;
