/**
 * تشفير دخول راوترات فيرموير JRD/webapi (الواجهة على /jrd/webapi — JSON-RPC).
 * موديل HH10E (مشروع HH10E / custom E1) من ملفات صفحة عضو (١٦ نوفمبر) — نفس عائلة
 * الفيرموير يشغّل موديلات OEM كثيرة بنفس الـ SDK، فالدرايفر عائلة واحدة يتعرّف عليها من buildInfo.js.
 *
 * loginAuthType = 2 في إعداد هالفيرموير (config module): اسم المستخدم وكلمة المرور
 * «يتخربطون» بدالة scramble (كل حرف ← حرفين) بمفتاح ثابت مشتق من المشروع، ثم يُرسلان:
 *   POST /jrd/webapi?name=Login  body JSON-RPC {method:"Login", params:{UserName:scramble(user), Password:scramble(pass)}}
 * الرد الناجح {result:{token,...}} ← ترويسة الطلبات بعده _RequestVerificationToken = scramble(token).
 *
 * المفتاح اتحسب من مصفوفة الإعداد l[1] عبر دالة g (نفس ناتج pbkdf2 salt في كود الراوتر،
 * «e5dl12XYVggihggafXWf0f2YSf2Xngd1» بحروف صغيرة).
 */

/** مفتاح الـ scramble لـ loginAuthType 2 (ثابت في فيرموير HH10E/E1) */
export const JRD_KEY = 'e5dl12xyvggihggafxwf0f2ysf2xngd1';

/** مفتاح التحقق الثابت (ترويسة _RequestVerificationKey لكل طلب — بوابة الـ SDK) */
export const JRD_VERIFY_KEY =
  'KSDHSDFOGQ5WERYTUIQWERTYUISDFG1HJZXCVCXBN2GDSMNDHKVKFsVBNf';

/**
 * نفس دالة التخريب في كود الراوتر (fa7d export "c"): لكل حرف يطلّع بايتين من المفتاح والحرف.
 * بدون أي مكتبة — charCode فقط.
 */
export function jrdScramble(e: string, key: string = JRD_KEY): string {
  if (e == null || e === '') return '';
  const n: number[] = [];
  for (let i = 0; i < e.length; i++) {
    const a = e.charCodeAt(i);
    const k = key.charCodeAt(i % key.length);
    n[2 * i] = (240 & k) | ((15 & a) ^ (15 & k));
    n[2 * i + 1] = (240 & k) | ((a >> 4) ^ (15 & k));
  }
  let r = '';
  for (let s = 0; s < n.length; s++) r += String.fromCharCode(n[s]);
  return r;
}

/** معرّف طلب JSON-RPC مثل كود الراوتر (getJsonrpcId): عدد عشري نصّي */
export function jrdJsonrpcId(): string {
  return (100 * Math.random()).toFixed(1).toString();
}

/** يفك buildInfo.js (versionInfo={...}) لمعرفة المشروع/النسخة بدون دخول */
export function parseBuildInfo(js: string): {
  project?: string; custom?: string; version?: string; stringVersion?: string;
} {
  const pick = (k: string) => {
    const m = js.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"'));
    return m ? m[1] : undefined;
  };
  return {
    project: pick('project'),
    custom: pick('custom'),
    version: pick('version'),
    stringVersion: pick('stringVersion'),
  };
}
