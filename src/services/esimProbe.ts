/**
 * فحص eSIM مرة وحدة لكل راوتر (١٧ نوفمبر — المرحلة ١ من «أضف شريحة بالباركود»):
 * نقرأ ردود الراوتر (قراءة بس — getEsimRaw) ونرسلها تقرير للرسيفر (data/reports — ما يروح لتليجرام)،
 * عشان نعرف كم راوتر فعلاً فيه eSIM ووش شكل الرد قبل ما نبني الإضافة بالباركود.
 * - بس للدرايفرات اللي فيها getEsimRaw (هواوي للحين)
 * - الأرقام الطويلة (ICCID / EID / IMSI) تنخفى قبل الإرسال
 * - نرسل بس لو الصفحة تقول فيه eSIM أو ما عرفنا (مو مدعومة = ما نرسل)
 * - تنحفظ «تم» بس لو وصل التقرير — لو فشل نعيد المرة الجاية
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { sendSupportReport } from './errors';
import { maskLongDigits } from '../utils/esimMask';

const k = (id: string) => `bandly.esimProbe.${id}`;
let running = false;

export async function probeEsimOnce(r: SavedRouter): Promise<void> {
  if (running) return;
  try {
    if (await AsyncStorage.getItem(k(r.id))) return;
    running = true;
    const res = await withSession(r, async d => (d.getEsimRaw ? d.getEsimRaw() : null), false).catch(() => null);
    if (!res) return;
    // مو مدعومة ← ما نرسل شي (السيرفر يحفظ آخر ٣٠٠ تقرير بس — ما نزحم تقارير الدعم الحقيقية بـ ١٧٠ هواوي)
    if (res.enabled === false) { await AsyncStorage.setItem(k(r.id), 'no'); return; }
    const lines = [
      `eSIM: ${res.enabled === true ? 'مفعّلة في الصفحة ✓' : res.enabled === false ? 'مو مدعومة' : 'ما عرفنا'}`,
      `driver: ${r.driverName ?? ''}`,
      '',
      ...Object.entries(res.raw).map(([p, t]) => `── ${p}\n${maskLongDigits(t)}`),
    ];
    if (await sendSupportReport(res.enabled ? 'esim-yes' : 'esim-probe', lines.join('\n'), r)) {
      await AsyncStorage.setItem(k(r.id), res.enabled === true ? 'yes' : res.enabled === false ? 'no' : '?');
    }
  } catch {
    // فحص جانبي — ما يأثر على شي
  } finally {
    running = false;
  }
}
