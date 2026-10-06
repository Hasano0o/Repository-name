/**
 * غلاف آمن لماسح ملصق الراوتر.
 * مهم: التحديثات عن بُعد توصل للنسخ القديمة اللي ما فيها مكتبة الكاميرا —
 * فما نستورد expo-camera إلا بعد ما نتأكد إنها موجودة (وإلا التطبيق يطيح عند التشغيل).
 */
import { Alert, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { LabelData } from '../utils/routerLabel';
import { desktop } from '../desktop/bridge';

export type ScanMode = 'full' | 'wifi';

export interface ScannerProps {
  visible: boolean;
  mode?: ScanMode;
  onClose: () => void;
  onResult: (d: LabelData) => void;
}

export function scannerAvailable(): boolean {
  if (Platform.OS === 'web' || desktop) return false;
  return requireOptionalNativeModule('ExpoCamera') != null;
}

/** يطلع رسالة لو النسخة المثبّتة قديمة — يرجع true لو الماسح جاهز */
export function ensureScanner(): boolean {
  if (scannerAvailable()) return true;
  Alert.alert('تحتاج تحديث', 'قراءة الملصق بالكاميرا تحتاج آخر نسخة من Bandly — حمّلها من البوت وثبّتها فوق النسخة الحالية.');
  return false;
}

/** يرسم الماسح بس لما يكون ظاهر والمكتبة موجودة */
export function LabelScannerHost(p: ScannerProps) {
  if (!p.visible || !scannerAvailable()) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { LabelScanner } = require('./LabelScanner') as typeof import('./LabelScanner');
  return <LabelScanner {...p} />;
}
