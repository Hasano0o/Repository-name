/**
 * دوال مساعدة لبناء Evidence<T> بشكل متسق.
 *
 * المبدأ:
 *  - لا تُنشئ Evidence يدويًا في كل مكان — استخدم هذه الدوال.
 *  - كل دالة تفرض قاعدة واضحة (مثلاً UNKNOWN يقابله value = null).
 *  - لا تُشوّه القيم — القيمة كما وصلت (بعد sanitize إن كانت حساسة).
 */

import {
  Evidence,
  EvidenceSource,
  EvidenceConfidence,
} from './types';

// ═══════════════════════════════════════════════════════════════════════
// البناء الأساسي
// ═══════════════════════════════════════════════════════════════════════

/**
 * مُنشئ Evidence عام — لا تستخدمه مباشرة إلا لو كنت تعرف ماذا تفعل.
 * فضّل: unknownEvidence / observedEvidence / confirmedEvidence / partialEvidence
 */
export function makeEvidence<T>(
  value: T | null,
  source: EvidenceSource,
  confidence: EvidenceConfidence,
  notes?: string,
): Evidence<T> {
  if (confidence === 'UNKNOWN' && value !== null) {
    throw new Error(
      'Evidence with confidence=UNKNOWN must have value=null',
    );
  }
  if (confidence !== 'UNKNOWN' && value === null) {
    throw new Error(
      `Evidence with confidence=${confidence} must have a non-null value`,
    );
  }
  return {
    value,
    source,
    confidence,
    at: Date.now(),
    notes,
  };
}

/** لا معلومة — القيمة null و confidence UNKNOWN */
export function unknownEvidence<T>(
  source: EvidenceSource = 'static',
  notes?: string,
): Evidence<T> {
  return makeEvidence<T>(null, source, 'UNKNOWN', notes);
}

/** قيمة شوهدت مرة واحدة — لم تُتحقق */
export function observedEvidence<T>(
  value: T,
  source: EvidenceSource,
  notes?: string,
): Evidence<T> {
  return makeEvidence<T>(value, source, 'OBSERVED', notes);
}

/** قيمة محقّقة من مصدر قاطع، أو من مصدرين */
export function confirmedEvidence<T>(
  value: T,
  source: EvidenceSource,
  notes?: string,
): Evidence<T> {
  return makeEvidence<T>(value, source, 'CONFIRMED', notes);
}

/** قيمة جزئية — شوهد جزء منها فقط */
export function partialEvidence<T>(
  value: T,
  source: EvidenceSource,
  notes?: string,
): Evidence<T> {
  return makeEvidence<T>(value, source, 'PARTIAL', notes);
}

// ═══════════════════════════════════════════════════════════════════════
// الفحص
// ═══════════════════════════════════════════════════════════════════════

/** هل هذه القيمة معروفة (غير UNKNOWN)؟ */
export function isKnown<T>(e: Evidence<T>): boolean {
  return e.confidence !== 'UNKNOWN' && e.value !== null;
}

/** هل هذه القيمة محقّقة تمامًا؟ */
export function isConfirmed<T>(e: Evidence<T>): boolean {
  return e.confidence === 'CONFIRMED';
}

// ═══════════════════════════════════════════════════════════════════════
// الدمج — عند وصول معلومة من مصدرين
// ═══════════════════════════════════════════════════════════════════════

const CONFIDENCE_RANK: Record<EvidenceConfidence, number> = {
  UNKNOWN: 0,
  PARTIAL: 1,
  OBSERVED: 2,
  CONFIRMED: 3,
};

/**
 * دمج Evidence مع مصدر جديد:
 *  - إذا القيمتان متطابقتان → نرفع للـ CONFIRMED ونحتفظ بالمصدر الأعلى.
 *  - إذا اختلفتا → نأخذ الأعلى ثقةً، ونضع note يشرح التعارض.
 *  - إذا واحدة UNKNOWN → نأخذ الأخرى.
 */
export function mergeEvidence<T>(
  prev: Evidence<T>,
  next: Evidence<T>,
): Evidence<T> {
  if (prev.confidence === 'UNKNOWN') return next;
  if (next.confidence === 'UNKNOWN') return prev;

  const same = prev.value === next.value;
  const prevRank = CONFIDENCE_RANK[prev.confidence];
  const nextRank = CONFIDENCE_RANK[next.confidence];

  if (same) {
    const winner = prevRank >= nextRank ? prev : next;
    return {
      ...winner,
      confidence: 'CONFIRMED',
      notes: `Confirmed by both ${prev.source} and ${next.source}`,
    };
  }

  const winner = prevRank >= nextRank ? prev : next;
  const loser = prevRank >= nextRank ? next : prev;
  return {
    ...winner,
    notes: `Conflict: ${winner.source}="${String(winner.value)}" vs ${loser.source}="${String(loser.value)}"`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// تعمية العنوان (للاستخدام في RouterDiagnosticPackage فقط)
// ═══════════════════════════════════════════════════════════════════════

/**
 * يحوّل host إلى نمط غير حساس.
 * أمثلة:
 *   192.168.8.1     → 192.168.x.x
 *   10.0.0.138      → 10.x.x.x
 *   172.16.5.4      → 172.16.x.x
 *   fe80::1         → fe80::x
 *   myssid.lan      → *.lan
 *
 * لا يستخدم regex بشكل فوضوي — كل نطاق له معاملة صريحة.
 */
export function anonymizeHost(host: string): string {
  if (!host) return '';
  const h = host.trim();

  // IPv4
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [_, a, b] = v4;
    const A = parseInt(a, 10);
    if (A === 10) return '10.x.x.x';
    if (A === 192 && parseInt(b, 10) === 168) return '192.168.x.x';
    if (A === 172 && parseInt(b, 10) >= 16 && parseInt(b, 10) <= 31) {
      return `172.${b}.x.x`;
    }
    if (A === 127) return '127.x.x.x';
    if (A === 169 && parseInt(b, 10) === 254) return '169.254.x.x';
    return 'x.x.x.x';
  }

  // IPv6 — نعرض البادئة فقط
  if (h.includes(':')) {
    const prefix = h.split(':')[0];
    return `${prefix}::x`;
  }

  // hostname — نحتفظ بالـ TLD فقط
  const parts = h.toLowerCase().split('.');
  if (parts.length >= 2) {
    return `*.${parts[parts.length - 1]}`;
  }
  return '<local>';
}
