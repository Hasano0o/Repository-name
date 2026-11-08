/**
 * مين يطلع له كرت «أرسل ملفات راوترك» (FULL) — منطق بدون react-native عشان ينختبر.
 * - الموديل المؤكد (verified: MU5001 / U60 Pro…) ← لا
 * - هواوي: بس لو ما عرفنا الموديل (الدعم ثابت عند أغلبهم — ما نزعج ١٧٠ جهاز)
 * - غيرها (MC801A العادي، زيكسل، U30، OPPO، Green Packet، جيب ZTE…) ← نعم
 */
import type { ModelProfile } from '../drivers/models';

export function fullDumpEligible(driverId: string, prof: ModelProfile | null, huaweiGenericId: string): boolean {
  if (prof?.verified) return false;
  if (/huawei/i.test(driverId) || prof?.brand === 'huawei') return !prof || prof.id === huaweiGenericId;
  return true;
}
/** نفس الراوتر بفيرموير جديد ← الصفحات تتغيّر ← يطلع مرة ثانية */
export function fullDumpFingerprint(modelId: string, software?: string): string {
  return `${modelId}|${String(software ?? '').trim()}`;
}

/** موديلات عامة يتشاركها أكثر من جهاز — ما نخفي الكرت بالموديل لحاله (بالبصمة بس) */
const GENERIC = new Set(['zte', 'zte-ng', 'huawei', 'unknown']);
/**
 * ملفات هالراوتر عندنا من قبل؟ (السيرفر يقرا router.txt من كل zip FULL — /live-api/community/full-known)
 * known = null (السيرفر ما رد) ← نعتبرها عندنا: ما نزعج العضو بالكرت على الفاضي.
 */
export function fullDumpKnown(fp: string, modelKey: string, known: { fps: string[]; models: string[] } | null): boolean {
  if (!known) return true;
  if (known.fps.includes(fp)) return true;
  return !GENERIC.has(modelKey) && known.models.includes(modelKey);
}
