/**
 * شريط الإشارة الضوئية (صفحة الفايبر — تصميم حسن ١٥ نوفمبر): من اليسار ضعيف ← لليمين قوي.
 * المناطق من صفحة الجهاز نفسها: أقل من −27 عطل · −27 إلى −24 مقبول · −24 إلى −8 ممتاز · فوق −8 قوي زيادة.
 * صافي (ينختبر).
 */
export const FIBER_MIN = -32;
export const FIBER_MAX = -4;
export const FIBER_ZONES: { from: number; to: number; tone: 'poor' | 'fair' | 'good' }[] = [
  { from: FIBER_MIN, to: -27, tone: 'poor' },
  { from: -27, to: -24, tone: 'fair' },
  { from: -24, to: -8, tone: 'good' },
  { from: -8, to: FIBER_MAX, tone: 'fair' },
];
/** مكان المؤشر ٠–١ */
export function fiberPos(rx: number): number {
  return Math.max(0, Math.min(1, (rx - FIBER_MIN) / (FIBER_MAX - FIBER_MIN)));
}
/** «منذ دقيقة» */
export function fiberAgo(at: number | undefined, now = Date.now()): string {
  if (!at) return '—';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'الحين';
  const m = Math.round(s / 60);
  if (m < 60) return m <= 1 ? 'منذ دقيقة' : m === 2 ? 'منذ دقيقتين' : `منذ ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'منذ ساعة' : h === 2 ? 'منذ ساعتين' : `منذ ${h} ساعة`;
  const d = Math.round(h / 24);
  return d === 1 ? 'منذ يوم' : d === 2 ? 'منذ يومين' : `منذ ${d} أيام`;
}
