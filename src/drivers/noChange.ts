/**
 * علامة «ما تغيّر شي في الراوتر».
 *
 * الدرايفر يرمي خطأ بهالعلامة **فقط** لما يكون متأكد إنه ما أرسل أي أمر تغيير
 * (فحص مسبق فشل، رقم ناقص، الموديل ما يدعم الأمر، ما قدرنا نقرأ الحالة قبل البدء).
 * safeApply يشوف العلامة ويوقف بدون «رجّع إعدادك» ولا «فك كل التثبيتات» —
 * عشان خطأ قبل البدء ما يمسح قفل المستخدم الشغال.
 *
 * ملف بدون أي استيراد من react-native — عشان الاختبارات تشتغل في Node.
 */
export interface NoChangeError extends Error {
  noChange: true;
}

/** خطأ جديد: ما أرسلنا أي أمر تغيير */
export function noChange(message: string): NoChangeError {
  const e = new Error(message) as NoChangeError;
  e.noChange = true;
  return e;
}

/** يعلّم خطأ موجود بأنه صار قبل أي تغيير (ويحافظ على رسالته) */
export function markNoChange(e: unknown): NoChangeError {
  const err = (e instanceof Error ? e : new Error(String(e))) as NoChangeError;
  err.noChange = true;
  return err;
}

export function isNoChange(e: unknown): boolean {
  return !!(e && typeof e === 'object' && (e as any).noChange === true);
}

/**
 * هل نقدر نتخطى الإرجاع بأمان بعد فشل التطبيق؟
 * - applyCalls = 0: الخطأ صار قبل ما ندخل دالة التطبيق أصلاً (مثلاً تسجيل الدخول فشل) ← ما تغيّر شي.
 * - applyCalls = 1 والخطأ معلّم noChange ← الدرايفر متأكد إنه ما أرسل شي.
 * - أكثر من محاولة (طبقة الجلسات أعادت الأمر بعد طرد): المحاولة الأولى ممكن تكون أرسلت أمر،
 *   فما نثق بالعلامة ونرجّع مثل قبل.
 * - أي خطأ ثاني ← الراوتر ممكن يكون تغيّر ← نرجّع.
 */
export function safeToSkipRevert(e: unknown, applyCalls: number): boolean {
  if (applyCalls === 0) return true;
  return applyCalls === 1 && isNoChange(e);
}
