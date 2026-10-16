/**
 * لقطة إعدادات القفل قبل أي تجربة (ترددات، أبراج، قنوات، وضع الشبكة) — عشان الإرجاع
 * يرجّع اللي كان على الراوتر **بالضبط** بدل تخمين («فك» أو «تلقائي»).
 *
 * كل درايفر يحفظ بياناته الخام في data (شكلها يخصه)، والإرجاع يكتبها ويقرأ بعدها ويقارن.
 * لو بقى فرق، يرمي خطأ فيه قائمة الأشياء اللي ما رجعت (mismatch) — ما ندّعي نجاح.
 *
 * ملف صافي بدون react-native — عشان الاختبارات تشتغل في Node.
 */
export interface LockSnapshot {
  /** رقم الدرايفر اللي قرأها (huawei / zte) — الإرجاع يرفض لقطة من نوع ثاني */
  driver: string;
  /** وقت القراءة (ms) */
  at: number;
  /** وصف مختصر للمستخدم: «4G: B1+B3 · 5G: تلقائي · 4G + 5G» */
  summary: string;
  /** البيانات الخام — يفهمها الدرايفر نفسه بس */
  data: unknown;
}

export interface RestoreMismatchError extends Error {
  /** الأشياء اللي ما رجعت كما كانت (بالعربي، جاهزة للعرض) */
  mismatch: string[];
}

/** الكتابة انقبلت بس القراءة بعدها تختلف عن اللقطة */
export function restoreMismatch(items: string[]): RestoreMismatchError {
  const e = new Error(`ما رجع كل شي كما كان: ${items.join('، ')}`) as RestoreMismatchError;
  e.mismatch = items;
  return e;
}

/** قائمة اللي ما رجع — أو null لو الخطأ مو من نوع «ما تطابق» */
export function mismatchOf(e: unknown): string[] | null {
  const m = e && typeof e === 'object' ? (e as any).mismatch : undefined;
  return Array.isArray(m) ? m : null;
}

/** أقصى وقت ننتظر فيه الخدمة بعد إرجاع متحقق منه، قبل ما نفك كل شي (حسب نوع الراوتر) */
export const SETTLE_MS: Record<string, number> = {
  'huawei-lte': 2 * 60_000,
  zte: 4 * 60_000,
};
export const settleMsFor = (driverId: string) => SETTLE_MS[driverId] ?? 2 * 60_000;
