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

/** الواي فاي اللي الجوال متصل فيه (أندرويد — من بناء ٢٣ نوفمبر ٢٠٢٦) */
export interface RawWifi {
  connected: boolean;
  rssi?: number | null;
  /** سرعة الربط بالراوتر (Mbps) — مو سرعة النت */
  linkSpeed?: number | null;
  rxLinkSpeed?: number | null;
  txLinkSpeed?: number | null;
  /** MHz — أقل من 3000 = 2.4 جيجا */
  frequency?: number | null;
  /** 4=Wi‑Fi 4 · 5=Wi‑Fi 5 · 6=Wi‑Fi 6 · 8=Wi‑Fi 7 */
  standard?: number | null;
}

interface BandlyCellNative {
  /** موجود من بناء ٢٣ نوفمبر ٢٠٢٦ — النسخ الأقدم ما فيها */
  wifiInfo?(): RawWifi;
  isSupported(): boolean;
  hasPermission(): boolean;
  deviceInfo(): RawDeviceInfo;
  serviceInfo(): RawService;
  getCells(): Promise<RawCell[]>;
  /** موجود من نسخة أكتوبر ٢٠٢٦ — النسخ الأقدم ما فيها */
  recognizeText?(uri: string): Promise<{ text: string; lines: string[] }>;
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

/** قراءة النص من صورة — null لو التطبيق المثبّت ما يدعمها */
export function ocrAvailable(): boolean {
  return typeof Native?.recognizeText === 'function';
}

export async function recognizeText(uri: string): Promise<{ text: string; lines: string[] }> {
  if (!Native?.recognizeText) throw new Error('قراءة النص تحتاج آخر نسخة من Bandly — حمّلها من البوت');
  return Native.recognizeText(uri);
}

/** قوة الواي فاي من الجوال — null لو آيفون أو نسخة قديمة أو فشل */
export function readWifi(): RawWifi | null {
  if (!Native || typeof Native.wifiInfo !== 'function') return null;
  try { return Native.wifiInfo(); } catch { return null; }
}
export const wifiNativeAvailable = (): boolean => typeof Native?.wifiInfo === 'function';
