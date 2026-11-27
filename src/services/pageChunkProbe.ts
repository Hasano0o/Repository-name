/**
 * كود صفحة من واجهة الراوتر للرسيفر — مرة وحدة لكل راوتر ولكل صفحة (٢٧ نوفمبر، H158-381):
 * هواوي Vue تحمّل صفحاتها (diagnosis · devicemanagement …) بعد الدخول بس، فما توصلنا في «مو مدعوم؟».
 * لما ميزة ترفض (مثل بنق الراوتر 100006) نسحب كود صفحتها بجلستنا ونرسله تقرير (data/reports — ما يروح لتليجرام)
 * عشان نشوف الطلب الصحيح بدل ما نخمّن. قراءة بس — ما نرسل أي أمر للراوتر.
 * - كود الصفحة نفسه ما فيه بيانات العضو (نفس ملفات الراوتر لكل الناس)
 * - «تم» تنحفظ بس لو وصل التقرير — لو فشل نعيد المرة الجاية
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { sendSupportReport } from './errors';

const k = (id: string, name: string) => `bandly.pageChunk.${id}.${name}`;
const running = new Set<string>();
/** السيرفر يقبل لين ٢٠٠ ألف حرف للتقرير */
const MAX = 190_000;

/** يرجّع true لو انرسل الحين (عشان الشاشة تقول «وصلتنا التفاصيل») */
export async function sendPageChunkOnce(r: SavedRouter, name: string, reason: string): Promise<boolean> {
  const key = k(r.id, name);
  if (running.has(key)) return false;
  running.add(key);
  try {
    if (await AsyncStorage.getItem(key)) return false;
    const code = await withSession(r, async d => (d.getPageChunk ? d.getPageChunk(name) : null), false).catch(() => null);
    // رد قصير = خطأ أو صفحة مو موجودة — ما نرسل ونجرّب المرة الجاية
    if (!code || code.length < 300) return false;
    const text = [`صفحة: ${name}`, `السبب: ${reason}`, `driver: ${r.driverName ?? ''}`, `الحجم: ${code.length}`, '', code.slice(0, MAX)].join('\n');
    if (await sendSupportReport(`page-${name}`, text, r)) {
      await AsyncStorage.setItem(key, String(Date.now()));
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    running.delete(key);
  }
}
