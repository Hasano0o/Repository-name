/**
 * Router Lab — Fixture Metadata — PHASE 5F
 *
 * نصوص موحّدة تُستخدم في كل fixtures الجديدة.
 * الغرض: توثيق ذاتي صريح بأن البيانات اصطناعية.
 */

export const REALISM_REALISTIC = 'synthetic-realistic' as const;

export const DISCLOSURE_UNIFORM = 'Synthetic. Not real hardware data.';

/**
 * ⚠️ تنبيه للمطورين:
 * - البنية (Schema/Content-Type/Field names) قريبة من أجهزة موثّقة علنًا.
 * - القيم (rsrp/sinr/pci/...) اصطناعية.
 * - IMEI/MAC/SN الموجودة تمر عبر sanitizer ولن تظهر في أي output.
 * - لا يدّعي هذا fixture دعم أي جهاز حقيقي.
 */
export const DISCLOSURE_DOC = DISCLOSURE_UNIFORM;
