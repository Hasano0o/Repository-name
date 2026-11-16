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

/**
 * نص خانة XML بعد فك الترميز (&quot; &amp; …) — الصفحة تقراه بـ DOM فيوصلها مفكوك.
 * ٧ نوفمبر: ردود SesTokInfo/token تجي أحياناً أطول بـ ٥ (262 بدل 257، 143/148 بدل 138) = «&quot;» داخل الرمز أو SessionID.
 * كنا نرسلها مرمّزة ← 125003 على كل محاولة (الطرد بعد logout، و«رمز الجلسة غير صالح» عند الإضافة).
 */
export function xmlUnesc(s = ''): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
/** عدد الرموز المرمّزة في نص (للتشخيص) */
export function escCount(s = ''): number {
  return (s.match(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi) ?? []).length;
}

/** الرمز من رد api/webserver/token — نفس الصفحة: token.substr(32) (بعد فك الترميز) */
export function tokenFromReply(xml: string): string {
  const t = xmlUnesc(xml.match(/<token>([^<]*)<\/token>/)?.[1]?.trim() ?? '');
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

/**
 * شكل ترويسة set-cookie للتشخيص — بدون القيم: اسم الكوكي وطوله والخصائص (Path/SameSite بقيمها، والباقي أسماء بس).
 * مثال: «SessionID(128) path=/ HttpOnly SameSite=None» — منها نعرف ليش جرة أندرويد ما تمسك الجلسة.
 */
export function cookieShape(sc: string): string {
  return sc.split(/,(?=\s*[A-Za-z0-9_.-]+=)/).slice(0, 4).map(c => {
    const [first, ...attrs] = c.split(';').map(x => x.trim()).filter(Boolean);
    const eq = (first ?? '').indexOf('=');
    const name = eq > 0 ? first.slice(0, eq) : '?';
    const len = eq > 0 ? first.length - eq - 1 : 0;
    const at = attrs.map(a => {
      const i = a.indexOf('=');
      const k = (i > 0 ? a.slice(0, i) : a).trim();
      return /^(path|samesite)$/i.test(k) && i > 0 ? `${k}=${a.slice(i + 1).trim().slice(0, 12)}` : k.slice(0, 16);
    });
    return [`${name.slice(0, 24)}(${len})`, ...at].join(' ');
  }).join(' | ').slice(0, 200);
}

/**
 * بيان الخصوصية/اتفاقية المستخدم (api/app/privacypolicy — JSON) — فيرموير Vue الجديدة (H155-381 ١٦ نوفمبر):
 * بعد إعدادات المصنع وتخطي المعالج، الدخول ينقبل و device/information تقرا، بس الإشارة والأجهزة والترددات ترد 100003
 * لين العضو يوافق على البيان. نفس شرط main.js (isNeedPrivacy) و common.js (getUpdateStatus):
 *  • يحتاج موافقة لو IsPrivacyPolicyUpdate=1 أو IsEULAUpdate=1، و change_status ≠ 2
 *  • Liscence: change_status=0 (أول مرة) ← "0" · الاثنين ← "0" · الاتفاقية بس ← "1" · البيان بس ← "2"
 * null = ما يحتاج (أو رد مو مفهوم — ما نرسل شي).
 */
export function privacyNeed(txt: string): { liscence: '0' | '1' | '2' } | null {
  let j: any;
  try { j = JSON.parse(txt); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const n = (v: unknown) => (v === undefined || v === null || v === '' ? NaN : Number(v));
  const pp = n(j.IsPrivacyPolicyUpdate) === 1, eula = n(j.IsEULAUpdate) === 1, cs = n(j.change_status);
  if ((!pp && !eula) || cs === 2 || Number.isNaN(cs)) return null;
  if (cs === 0) return { liscence: '0' };
  return { liscence: pp && eula ? '0' : eula ? '1' : '2' };
}

/** رد POST app/privacypolicy: {errcode:0} = انقبلت */
export function privacyAccepted(txt: string): boolean {
  try { const j = JSON.parse(txt); return Number(j?.errcode) === 0 && j?.errcode !== '' && j?.errcode !== undefined; } catch { return false; }
}
