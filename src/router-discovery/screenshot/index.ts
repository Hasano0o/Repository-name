/**
 * Screenshot Pipeline — PHASE 4C-1
 *
 * Public API:
 *   textToBlocks(text)      → ScreenshotTextBlock[]
 *   runScreenshotTextPipeline({ consent, text, capturedAt })
 *                            → ScreenshotTextPipelineResult
 *
 * لا I/O، لا شبكة، لا تخزين، لا OCR.
 * Consent يُفرض قبل أي معالجة.
 */

import {
  collectScreenshotEvidence,
  ScreenshotEvidenceResult,
  ScreenshotTextBlock,
} from '../screenshotCollector';
import { isConsentGranted, ScreenshotConsentState } from './consent';

export type { ScreenshotConsentState, ConsentDecision } from './consent';
export {
  createConsentState,
  grantConsent,
  revokeConsent,
  isConsentGranted,
} from './consent';

export type { ScreenshotEvidenceResult, ScreenshotTextBlock };

// ────────────── Input/Output ──────────────

export interface ScreenshotTextPipelineInput {
  consent: ScreenshotConsentState;
  text: string;
  capturedAt?: number;
}

export type ScreenshotTextPipelineFailureReason =
  | 'CONSENT_MISSING'
  | 'EMPTY_INPUT';

export type ScreenshotTextPipelineResult =
  | { ok: true; result: ScreenshotEvidenceResult }
  | { ok: false; reason: ScreenshotTextPipelineFailureReason };

// ────────────── textToBlocks ──────────────

/**
 * يحوّل نص خام إلى ScreenshotTextBlock[].
 * يقسم على فواصل الأسطر الفارغة (paragraphs).
 * - غير string → []
 * - نص فارغ → []
 * - trim لكل block + حذف الفارغة
 */
export function textToBlocks(text: string): ScreenshotTextBlock[] {
  if (typeof text !== 'string') return [];
  // Normalize CRLF and lone CR to LF before splitting.
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);
  const out: ScreenshotTextBlock[] = [];
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (trimmed) out.push({ text: trimmed });
  }
  return out;
}

// ────────────── Pipeline ──────────────

/**
 * يشغّل الـ pipeline: consent → blocks → collector.
 * لا يُعدّل الحالة المُمرَّرة.
 * لا يُنتج Evidence بدون موافقة GRANTED.
 */
export function runScreenshotTextPipeline(
  input: ScreenshotTextPipelineInput,
): ScreenshotTextPipelineResult {
  if (!isConsentGranted(input.consent)) {
    return { ok: false, reason: 'CONSENT_MISSING' };
  }

  const blocks = textToBlocks(input.text);
  if (blocks.length === 0) {
    return { ok: false, reason: 'EMPTY_INPUT' };
  }

  const result = collectScreenshotEvidence({
    blocks,
    capturedAt: input.capturedAt,
  });

  return { ok: true, result };
}
