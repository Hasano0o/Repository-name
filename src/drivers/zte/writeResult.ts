/**
 * تصنيف رد goform_set_cmd_process — ملف صافي (عليه اختبارات).
 *
 * من سجل ZTE U30 Pro الحقيقي (٢٦ أكتوبر، BAND_SELECT):
 *  • بتوقيع AD «wa+cr» الرد «{}» (٢ بايت) — والتوقيع نفسه قبله setAccessPointInfo بـ «success» (٢٥ أكتوبر)
 *  • بالسبع صيغ الثانية الرد فاضي (٠ بايت)
 * يعني: الفاضي = الراوتر رفض الطلب قبل ما يعالجه (توقيع/جلسة)، و«{}» = انقبل بس ما فيه معالج لهالأمر
 * بهالخانات في هالفيرموير. ولا واحد منها نجاح — والتأكيد الوحيد إعادة القراءة.
 */
export type ZteWrite = 'ok' | 'rejected' | 'empty' | 'unhandled' | 'other';

export function classifyZteWrite(out: string): ZteWrite {
  const s = (out ?? '').trim();
  if (!s) return 'empty';
  if (/"?result"?\s*:\s*"?success"?/i.test(s) || /^success$/i.test(s)) return 'ok';
  if (/failure|"result"\s*:\s*"?[1-9]/i.test(s)) return 'rejected';
  if (/^\{\s*\}$/.test(s)) return 'unhandled';
  return 'other';
}

/**
 * موديلات قراءتها مؤكدة وكتابتها لسا ما انثبتت بدليل (كود صفحة الراوتر أو تجربة ناجحة):
 * نمنع أوامر التغيير قبل ما تنرسل (بدل ١٦ أمر يرجع «{}» ويبان للعضو كأنه رفض)، ونخلي المسموح بس.
 */
// REBOOT_DEVICE مو هنا: ما شفناه ينجح على U30 Pro (ولا مرة في السجلات)، والرد «{}» يخلي التطبيق ينتظر
// إعادة تشغيل ما صارت. LOGIN/LOGOUT/GOFORM_LOGOUT ظاهرة في سجلاته وما تغيّر إعدادات.
export const WRITE_ALLOWED_WHEN_UNVERIFIED = new Set(['LOGIN', 'LOGOUT', 'GOFORM_LOGOUT']);
