/**
 * Screenshot UI Helpers — PHASE 4C-2C-1
 *
 * Pure functions only — no React, no I/O, no state.
 * UI يستدعيها فقط، لا يُعيد تنفيذ منطق أمني.
 */

import {
  CapabilityEvidence,
  DiscoveredRouter,
} from '../types';
import { unknownEvidence } from '../evidence';
import { ScreenshotWarningCode } from '../screenshotCollector';
import { EditReason, FieldBucket, ReviewedField } from './review';

/** الحد الأقصى لطول النص المدخل — حماية فعلية عند UI */
export const MAX_TEXT_INPUT_LENGTH = 50_000;

// ────────────── Text validation ──────────────

export function isTextInputEmpty(text: string): boolean {
  if (typeof text !== 'string') return true;
  return text.trim().length === 0;
}

export function isTextInputTooLong(text: string): boolean {
  if (typeof text !== 'string') return false;
  return text.length > MAX_TEXT_INPUT_LENGTH;
}

export function isTextInputValid(text: string): boolean {
  if (typeof text !== 'string') return false;
  if (isTextInputEmpty(text)) return false;
  if (isTextInputTooLong(text)) return false;
  return true;
}

// ────────────── Minimal DiscoveredRouter ──────────────

function emptyCapabilities(): CapabilityEvidence {
  return {
    signal: unknownEvidence<boolean>(),
    lte: unknownEvidence<boolean>(),
    nr: unknownEvidence<boolean>(),
    bands: unknownEvidence<boolean>(),
    cells: unknownEvidence<boolean>(),
    neighborCells: unknownEvidence<boolean>(),
    carrierAggregation: unknownEvidence<boolean>(),
    deviceInfo: unknownEvidence<boolean>(),
    traffic: unknownEvidence<boolean>(),
    usage: unknownEvidence<boolean>(),
    sms: unknownEvidence<boolean>(),
    bandLock: unknownEvidence<boolean>(),
    cellLock: unknownEvidence<boolean>(),
    reboot: unknownEvidence<boolean>(),
    block: unknownEvidence<boolean>(),
  };
}

/**
 * يبني DiscoveredRouter الحد الأدنى من host فقط.
 * كل الحقول UNKNOWN — لا ادعاء بأي قدرة.
 * يُستخدم في UI عندما لا يوجد Discovery كامل بعد.
 */
export function buildMinimalRouter(
  host: string,
  now: number,
): DiscoveredRouter {
  return {
    host,
    protocols: ['http'],
    manufacturer: unknownEvidence<string>(),
    model: unknownEvidence<string>(),
    firmware: unknownEvidence<string>(),
    hardwareVersion: unknownEvidence<string>(),
    fingerprints: [],
    endpoints: [],
    capabilities: emptyCapabilities(),
    signalFields: {},
    bandFields: {},
    cellFields: {},
    errors: [],
    compatLevel: 'DISCOVERY_ONLY',
    at: now,
  };
}

// ────────────── Translations (UI-only) ──────────────

export const WARNING_LABELS: Record<ScreenshotWarningCode, string> = {
  SENSITIVE_FIELD_DROPPED: 'تم تجاهل حقول حساسة',
  VALUE_SANITIZED: 'تم تنظيف بعض القيم',
  LAN_ENDPOINT_DROPPED: 'تم تجاهل عنوان غير محلي',
  WRITE_ENDPOINT_DROPPED: 'تم تجاهل عنوان تعديل',
  INVALID_VALUE_DROPPED: 'تم تجاهل قيمة غير صالحة',
  AMBIGUOUS_FIELD_DROPPED: 'تم تجاهل حقل غير واضح',
  INVALID_TIMESTAMP: 'طابع زمني غير صالح',
};

export function translateWarning(code: ScreenshotWarningCode): string {
  return WARNING_LABELS[code] ?? 'تنبيه';
}

export const BUCKET_LABELS: Record<FieldBucket, string> = {
  signalFields: 'الإشارة',
  bandFields: 'الترددات',
  cellFields: 'الخلية',
  networkFields: 'الشبكة',
};

// ═══════════════════════════════════════════════════════════════════════
// Display helpers — PHASE 4C-2C-2
// ═══════════════════════════════════════════════════════════════════════

export const FIELD_LABELS: Record<string, string> = {
  rsrp: 'RSRP',
  rsrq: 'RSRQ',
  rssi: 'RSSI',
  sinr: 'SINR',
  pci: 'PCI',
  earfcn: 'EARFCN',
  nrarfcn: 'NR-ARFCN',
  band: 'Band',
  bandwidth: 'عرض النطاق',
  cell_id: 'Cell ID',
  tac: 'TAC',
  mcc: 'MCC',
  mnc: 'MNC',
  network_type: 'نوع الشبكة',
  operator: 'المشغل',
  vendor: 'الشركة',
  model: 'الموديل',
};

export const FIELD_UNITS: Record<string, string> = {
  rsrp: 'dBm',
  rsrq: 'dB',
  rssi: 'dBm',
  sinr: 'dB',
  bandwidth: 'MHz',
};

export interface FormattedField {
  label: string;
  value: string;
  unit: string;
  edited: boolean;
  display: string;
}

export function formatReviewedField(
  key: string,
  field: ReviewedField,
): FormattedField {
  const label = FIELD_LABELS[key] ?? key;
  const unit = FIELD_UNITS[key] ?? '';
  const value = field.currentValue;
  const display = unit ? `${label}: ${value} ${unit}` : `${label}: ${value}`;
  return { label, value, unit, edited: field.edited, display };
}

export function shouldShowBucket(
  bucket: Record<string, ReviewedField>,
): boolean {
  return Object.keys(bucket).length > 0;
}

export function shouldShowIdentity(identity: {
  vendor: ReviewedField | null;
  model: ReviewedField | null;
}): boolean {
  return identity.vendor !== null || identity.model !== null;
}

export function translateEditReason(reason: EditReason): string {
  switch (reason) {
    case 'INVALID_VALUE':
      return 'القيمة غير صالحة';
    case 'SENSITIVE_VALUE':
      return 'القيمة تحتوي على بيانات حساسة';
    case 'UNKNOWN_FIELD':
      return 'حقل غير معروف';
    default:
      return 'خطأ';
  }
}
