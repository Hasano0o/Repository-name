import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * قبول شهادات الراوترات الذاتية (https) على العناوين المحلية — موجود من بناء نوفمبر ٢٠٢٦.
 * الآيفون: موديول BandlyTls · الأندرويد: BandlyCell.lanTls (نفس موديول الأبراج).
 * التحديثات عن بُعد توصل للنسخ القديمة، فكل شي يتحمّل غيابه (يرجع false).
 */
type Flag = { lanTls?: () => boolean };

let cached: boolean | null = null;
export function lanTlsAvailable(): boolean {
  if (cached !== null) return cached;
  try {
    const m = Platform.OS === 'ios'
      ? requireOptionalNativeModule<Flag>('BandlyTls')
      : Platform.OS === 'android'
        ? requireOptionalNativeModule<Flag>('BandlyCell')
        : null;
    cached = typeof m?.lanTls === 'function' ? !!m.lanTls() : false;
  } catch {
    cached = false;
  }
  return cached;
}
