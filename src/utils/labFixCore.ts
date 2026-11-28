/**
 * «تم الإصلاح — جرّب» (٢٨ نوفمبر) — منطق صافي (عليه اختبارات).
 * LAB_FIXES = الإصلاحات اللي نزلت مع التحديثات: المفتاح = «<driverId>:<labKey>» (labKey = id الميزة قبل «:»)
 * والتاريخ = يوم نزول الإصلاح. العضو اللي فشلت معه الميزة قبل هالتاريخ يطلع له «انصلحت، جرّبها» مرة.
 * إضافة إصلاح: سطر هنا مع نفس الـ commit (جلسة الصيانة اليومية تسويه).
 */
export const LAB_FIXES: Record<string, { at: string; note: string }> = {
  // مثال: 'zte:speed': { at: '2026-11-29', note: 'أولوية السرعة صارت تشتغل على MC801A' },
};

export const labKey = (id: string) => id.split(':')[0];

/** الفشل المحفوظ بالجوال: {"<routerId>|<driverId>:<labKey>": epochMs} */
export type FailLog = Record<string, number>;

export interface FixedNotice { key: string; lab: string; note: string }

/** الإصلاحات اللي تخص هالراوتر: فشل عنده قبل الإصلاح وما شاف التنبيه */
export function pendingFixes(routerId: string, driverId: string, fails: FailLog, seen: Record<string, number>, fixes = LAB_FIXES): FixedNotice[] {
  const out: FixedNotice[] = [];
  for (const [k, t] of Object.entries(fails)) {
    const [rid, dk] = k.split('|');
    if (rid !== routerId || !dk?.startsWith(driverId + ':')) continue;
    const fx = fixes[dk];
    if (!fx) continue;
    const fixAt = Date.parse(fx.at + 'T00:00:00+03:00');
    if (!(t < fixAt) || seen[k]) continue;
    out.push({ key: k, lab: dk.slice(driverId.length + 1), note: fx.note });
  }
  return out;
}
