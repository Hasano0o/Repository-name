/**
 * خطوة «نطبّق التغيير» في safeApply — منفصلة وبدون react-native عشان نختبرها في Node.
 *
 * تحل مشكلتين:
 * ١. خطأ قبل إرسال أي أمر (فحص مسبق، دخول فشل، رقم ناقص) كان يشغّل «رجّع إعدادك» و«فك كل التثبيتات»
 *    ويمسح قفل المستخدم الشغال. الحين نعدّ كم مرة انطلبت دالة التطبيق ونقرأ علامة noChange.
 * ٢. أوامر تاخذ وقت طويل (ZTE يعيد التشغيل بعد تثبيت البرج، لين ٣ دقائق): كنا نقطع بعد ٦٠ ثانية
 *    ونبدأ نرجّع ونفك والراوتر لسا في نص إعادة التشغيل — أوامر فوق أوامر. الحين ننتظره يخلص.
 */
import { safeToSkipRevert } from '../drivers/noChange';

export type ApplyOutcome =
  /** الأمر خلص بدون خطأ */
  | { kind: 'done' }
  /** الأمر ما خلص حتى بعد الانتظار الإضافي — حالته غير معروفة */
  | { kind: 'stillRunning' }
  /** فشل. skipRevert = متأكدين إن الراوتر ما تغيّر */
  | { kind: 'failed'; error: unknown; skipRevert: boolean };

const TIMEOUT = Symbol('timeout');
function race<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(TIMEOUT), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export async function runApply<D>(o: {
  /** يشغّل الدالة داخل جلسة الراوتر (withSession) — ممكن يعيد استدعاءها بعد طرد */
  session: (fn: (d: D) => Promise<void>) => Promise<void>;
  apply: (d: D) => Promise<void>;
  /** المهلة العادية */
  firstMs: number;
  /** انتظار إضافي لو الأمر لسا شغال (إعادة تشغيل مثلاً) — بدل ما نتدخّل وهو في النص */
  extraMs: number;
  onLong?: () => void;
}): Promise<ApplyOutcome> {
  let calls = 0;
  const p = o.session(d => { calls++; return o.apply(d); });
  try {
    let r = await race(p, o.firstMs);
    if (r === TIMEOUT) {
      o.onLong?.();
      r = await race(p, o.extraMs);
      if (r === TIMEOUT) {
        // نمنع «unhandled rejection» لو فشل بعدين
        p.catch(() => {});
        return { kind: 'stillRunning' };
      }
    }
    return { kind: 'done' };
  } catch (e) {
    return { kind: 'failed', error: e, skipRevert: safeToSkipRevert(e, calls) };
  }
}
