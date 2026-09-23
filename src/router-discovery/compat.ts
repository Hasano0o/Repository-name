/**
 * منطق تحديد Compatibility Level من Evidence.
 *
 * القاعدة الذهبية:
 *  - لا نخمّن. نستنتج فقط من Evidence بحالة OBSERVED أو أعلى.
 *  - PARTIAL ≠ FULL — لا نجامل المستخدم.
 *  - إذا لم نر أي دليل على driver → DISCOVERY_ONLY.
 *  - إذا لم يستجب أي endpoint → UNSUPPORTED.
 */

import {
  CapabilityEvidence,
  CompatibilityLevel,
} from './types';
import { isKnown } from './evidence';

// ═══════════════════════════════════════════════════════════════════════
// المدخل — نتيجة جلسة Discovery (مختصرة، تكفي لاتخاذ القرار)
// ═══════════════════════════════════════════════════════════════════════

export interface CompatInput {
  /** هل يوجد Driver فعلي يعرف هذا الراوتر؟ */
  hasDriver: boolean;
  /** هل endpoint واحد على الأقل استجاب بـ status < 400؟ */
  hasLiveEndpoint: boolean;
  /** القدرات المستنتجة من Evidence */
  capabilities: CapabilityEvidence;
}

// ═══════════════════════════════════════════════════════════════════════
// الحساب
// ═══════════════════════════════════════════════════════════════════════

/**
 * يحدد مستوى التوافق بناءً على Evidence فقط.
 *
 * التسلسل:
 *  1. لا endpoint حي → UNSUPPORTED
 *  2. لا driver → DISCOVERY_ONLY
 *  3. driver + إشارة + نطاقات + خلايا → READ_ONLY أو FULL
 *  4. driver + إشارة فقط → PARTIAL
 *  5. غير ذلك → DISCOVERY_ONLY
 */
export function computeCompatibility(input: CompatInput): CompatibilityLevel {
  if (!input.hasLiveEndpoint) return 'UNSUPPORTED';
  if (!input.hasDriver) return 'DISCOVERY_ONLY';

  const c = input.capabilities;
  const hasSignal = isKnown(c.signal) && c.signal.value === true;
  const hasBands = isKnown(c.bands) && c.bands.value === true;
  const hasCells = isKnown(c.cells) && c.cells.value === true;

  // FULL: يحتاج كل قدرات القراءة + قدرة كتابة واحدة على الأقل
  const hasWrite = (
    (isKnown(c.bandLock) && c.bandLock.value === true) ||
    (isKnown(c.cellLock) && c.cellLock.value === true)
  );
  if (hasSignal && hasBands && hasCells && hasWrite) {
    return 'FULL';
  }

  // READ_ONLY: قراءة كاملة بدون كتابة
  if (hasSignal && hasBands && hasCells) {
    return 'READ_ONLY';
  }

  // PARTIAL: إشارة فقط (قد تشمل معلومات الجهاز ضمنًا)
  if (hasSignal) {
    return 'PARTIAL';
  }

  // Driver موجود لكن لا قدرات مؤكدة
  return 'DISCOVERY_ONLY';
}

// ═══════════════════════════════════════════════════════════════════════
// العرض (عربي RTL)
// ═══════════════════════════════════════════════════════════════════════

export const COMPAT_LABEL: Record<CompatibilityLevel, string> = {
  FULL: 'مدعوم بالكامل',
  READ_ONLY: 'قراءة فقط',
  PARTIAL: 'دعم جزئي',
  DISCOVERY_ONLY: 'استكشاف فقط',
  UNSUPPORTED: 'غير مدعوم',
};

export const COMPAT_DESCRIPTION: Record<CompatibilityLevel, string> = {
  FULL: 'يمكن لـ Bandly قراءة كل شيء والتحكم في الإعدادات المدعومة.',
  READ_ONLY: 'يمكن لـ Bandly قراءة الإشارة والنطاقات والخلايا — بدون تعديل.',
  PARTIAL: 'يمكن لـ Bandly قراءة الإشارة ومعلومات أساسية فقط.',
  DISCOVERY_ONLY: 'اكتشفنا جهازك لكن لم نفهم واجهته بعد — يمكنك مساعدتنا.',
  UNSUPPORTED: 'لم نتمكن من فهم واجهة هذا الجهاز.',
};

/**
 * لون الحالة (يُستخدم في UI لاحقًا).
 * نستخدم ألوان المشروع الحالية من src/ui/theme.ts:
 *   green, gold, red, muted — قيم hex مطابقة.
 */
export const COMPAT_COLOR: Record<CompatibilityLevel, string> = {
  FULL: '#12b76a',          // أخضر
  READ_ONLY: '#5ba644',     // أخضر فاتح
  PARTIAL: '#f79009',       // برتقالي
  DISCOVERY_ONLY: '#9aa1bd', // رمادي
  UNSUPPORTED: '#e5484d',   // أحمر
};

/** ترتيب من الأعلى إلى الأدنى — يستخدم في الفرز والمقارنة */
export const COMPAT_RANK: Record<CompatibilityLevel, number> = {
  FULL: 5,
  READ_ONLY: 4,
  PARTIAL: 3,
  DISCOVERY_ONLY: 2,
  UNSUPPORTED: 1,
};

/** مقارنة: هل a أفضل من b؟ */
export function isBetterLevel(
  a: CompatibilityLevel,
  b: CompatibilityLevel,
): boolean {
  return COMPAT_RANK[a] > COMPAT_RANK[b];
}
