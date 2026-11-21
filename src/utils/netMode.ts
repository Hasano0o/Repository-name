/**
 * «وضع الشبكة يشتغل من صفحة الراوتر والتطبيقات الثانية إلا Bandly» (شكاوى ٢١ نوفمبر، أغلبها هواوي و ZTE):
 * كنا ننتظر الاتصال ٤٥ ثانية بس وبعدها نرجّع الوضع القديم تلقائياً — وهواوي يحتاج لين دقيقتين و ZTE لين ٤ دقايق
 * عشان يعيد التسجيل على الشبكة بعد تغيير الوضع (نفس مهل الإنقاذ في safeLock). يعني كنا نلغي التغيير قبل ما يكمل.
 */
export function modeWaitMs(driverId?: string): number {
  const id = String(driverId ?? '').toLowerCase();
  if (id.startsWith('zte')) return 240_000;
  if (id.startsWith('huawei') || id === 'hwgw') return 120_000;
  return 90_000;
}

/** «باقي ١:٣٠» */
export function leftLabel(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
