/**
 * غلاف «قراءة بس» لدرايفر — لراوتر انضاف بـ«برمج لي جهازي» (مطابقة تلقائية من الرسيفر).
 *
 * المطابقة التلقائية تقول «صفحته تشبه عائلة كذا» — هذا يكفي نقرأ الإشارة، وما يكفي نكتب:
 * أمر تثبيت بصيغة عائلة ثانية يعلّق الراوتر على «No Service» (MU5001 — ١٨ أكتوبر).
 * فالغلاف يمرّر القراءة ويوقف أي دالة تغيّر شي **قبل** ما توصل الدرايفر، بعلامة noChange
 * (safeApply يوقف بدون «رجّع إعدادك»).
 *
 * القائمة بيضاء: get… / is… / list… + أسماء الدخول. أي دالة جديدة تنضاف للدرايفرات
 * تنحجب تلقائياً لين نسمح لها هنا. ملف صافي بدون react-native (عليه اختبارات).
 */
import type { Capability, RouterDriver } from './types';
import { noChange } from './noChange';

export const READ_ONLY_MSG = 'راوترك انضاف بـ«برمج لي جهازي» — قراءة بس للحين. التغيير ينفتح بعد ما نتأكد منه على موديلك.';

/** القدرات اللي تبقى ظاهرة (كلها قراءة) */
const READ_CAPS: Capability[] = ['signal', 'devices', 'usage', 'traffic', 'cells'];
/** دوال مسموحة بالاسم — الدخول والخروج والتعريف وقراءات ما تبدأ بـ get */
const ALLOW = new Set([
  'detect', 'login', 'logout', 'markStale', 'identify',
  'afterLoginPages', 'prepareAfterLogin', 'pageFilesKnown',
  'readBaseline', 'useBaseline', 'readLockState',
]);

export function isReadMethod(name: string): boolean {
  return ALLOW.has(name) || /^(get|is|list)[A-Z]/.test(name);
}

export function isReadOnlyDriver(d: unknown): boolean {
  return !!d && (d as any).readOnly === true;
}

export function readOnlyDriver<T extends RouterDriver>(d: T): T {
  if (isReadOnlyDriver(d)) return d;
  return new Proxy(d, {
    get(t, prop) {
      if (prop === 'readOnly') return true;
      if (prop === 'capabilities') return (t.capabilities ?? []).filter(c => READ_CAPS.includes(c));
      const v = (t as any)[prop];
      if (typeof v !== 'function') return v;
      // this = الدرايفر الأصلي: الدوال الداخلية (طلبات الدخول والقراءة) تشتغل عادي
      if (typeof prop === 'symbol' || isReadMethod(prop)) return v.bind(t);
      return async () => { throw noChange(READ_ONLY_MSG); };
    },
    set(t, prop, value) {
      (t as any)[prop] = value;
      return true;
    },
  });
}
