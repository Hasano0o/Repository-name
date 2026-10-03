import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/** برج كما يرجعه المودم (القيم الناقصة = null) */
export interface RawCell {
  tech: 'LTE' | 'NR';
  registered: boolean;
  pci?: number | null;
  tac?: number | null;
  ci?: number | null;
  nci?: string | null;
  earfcn?: number | null;
  arfcn?: number | null;
  bandwidth?: number | null;
  bands?: number[];
  rsrp?: number | null;
  rsrq?: number | null;
  rssnr?: number | null;
  sinr?: number | null;
  rssi?: number | null;
  cqi?: number | null;
  ta?: number | null;
  level?: number;
  mcc?: string | null;
  mnc?: string | null;
}

export interface RawService {
  operator: string;
  operatorNumeric: string;
  state?: number;
  bandwidths?: number[];
  raw?: string;
  denied?: boolean;
}

export interface RawDeviceInfo {
  manufacturer: string;
  model: string;
  android: string;
  sdk: number;
  operator: string;
  simOperator: string;
  simState: number;
}

interface BandlyCellNative {
  isSupported(): boolean;
  hasPermission(): boolean;
  deviceInfo(): RawDeviceInfo;
  serviceInfo(): RawService;
  getCells(): Promise<RawCell[]>;
}

/**
 * الموديول الأصلي — null لو التطبيق المثبّت قديم (قبل إضافة الميزة) أو مو أندرويد.
 * مهم: التحديثات عن بُعد توصل للنسخ القديمة، فلازم كل شي يتحمّل غيابه.
 */
const Native: BandlyCellNative | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<BandlyCellNative>('BandlyCell') : null;

export const cellModuleAvailable = (): boolean => Native !== null;

export function cellNative(): BandlyCellNative {
  if (!Native) throw new Error('هذي الميزة تحتاج آخر نسخة من Bandly — حمّلها من البوت وثبّتها');
  return Native;
}
