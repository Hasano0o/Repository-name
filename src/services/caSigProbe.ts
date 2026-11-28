/**
 * فحص صيغة «قراءة كل ثانوي» مرة وحدة لكل راوتر ZTE (٢٨ نوفمبر):
 * ملفات الأعضاء بيّنت إن صفحات ZTE تطلب lte_multi_ca_scell_sig_info مع lte_multi_ca_scell_info،
 * بس صيغته ما نعرفها — فنرسل الردود الخام تقرير للرسيفر (data/reports «ca-sig») ونبني القراءة منها بعدين.
 * - قراءة بس (getCaRaw) — ما فيه أي أمر تغيير
 * - نرسل بس لو فيه دمج فعلي (scell_info أو sig_info مو فاضي) — غيره ما نحفظ شي ونعيد المرة الجاية
 * - تنحفظ «تم» بس لو وصل التقرير
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { sendSupportReport } from './errors';

const k = (id: string) => `bandly.caSigProbe.${id}`;
let running = false;

export async function probeCaSigOnce(r: SavedRouter): Promise<void> {
  if (running) return;
  try {
    if (await AsyncStorage.getItem(k(r.id))) return;
    running = true;
    const res = await withSession(r, async d => {
      if (!d.getCaRaw) return null;
      const raw = await d.getCaRaw();
      const model = await d.getDeviceDetails?.().then(x => x.model).catch(() => undefined);
      return { raw, model };
    }, false).catch(() => null);
    if (!res) return;
    const { raw, model } = res;
    if (!raw.lte_multi_ca_scell_info && !raw.lte_multi_ca_scell_sig_info && !raw.nr_multi_ca_scell_info) return;
    const lines = [
      `model: ${model ?? '?'}`,
      `driver: ${r.driverName ?? ''}`,
      `sig_info: ${raw.lte_multi_ca_scell_sig_info ? 'yes' : 'empty'}`,
      '',
      ...Object.entries(raw).map(([key, v]) => `${key} = ${v}`),
    ];
    if (await sendSupportReport('ca-sig', lines.join('\n'), r)) await AsyncStorage.setItem(k(r.id), '1');
  } catch {
    // فحص جانبي — ما يأثر على شي
  } finally {
    running = false;
  }
}
