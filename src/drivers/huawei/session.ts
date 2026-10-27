/**
 * رموز جلسة هواوي — ملف صافي (بدون react-native) عشان عليه اختبارات.
 *
 * الفيرموير القديمة: api/webserver/SesTokInfo يرجّع <SesInfo> (الكوكي) و<TokInfo> (الرمز).
 * فيرموير ٢٠٢٥ بواجهة Vue (H155-383 — ملفات صفحته ٢٧ أكتوبر): ما فيها SesTokInfo أبداً
 * (main.js ما يطلبه ولا مرة) — الصفحة تاخذ الرمز من api/webserver/token (أول ٣٢ حرف حشو)
 * ومن <meta name="csrf_token">. بدون هالاحتياط التطبيق يقول «راوترك مو مدعوم» وهو هواوي.
 */

/** رد SesTokInfo فيه رمز؟ */
export function hasSesTok(xml: string): boolean {
  return /<TokInfo>[^<]+<\/TokInfo>/.test(xml);
}

/** الرمز من رد api/webserver/token — نفس الصفحة: token.substr(32) */
export function tokenFromReply(xml: string): string {
  const t = xml.match(/<token>([^<]*)<\/token>/)?.[1]?.trim() ?? '';
  return t.length > 32 ? t.slice(32) : t;
}

/** رد api/webserver/token من هواوي؟ (<response><token>…) — مو أي صفحة فيها كلمة token */
export function isTokenReply(xml: string): boolean {
  return /<response>[\s\S]*<token>[^<]{8,}<\/token>[\s\S]*<\/response>/.test(xml) && !/<error>/.test(xml);
}

/** الراوتر هواوي ويرد؟ — SesTokInfo (القديم) أو webserver/token (الجديد) */
export function isHuaweiSessionReply(xml: string): boolean {
  return hasSesTok(xml) || isTokenReply(xml);
}
