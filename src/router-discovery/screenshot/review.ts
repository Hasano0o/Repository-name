/**
 * Screenshot Review — PHASE 4C-2A
 *
 * Immutable review state — no mutation, no I/O, no storage.
 *
 * Pipeline:
 *   ScreenshotEvidenceResult (immutable)
 *        ↓ createReviewFromResult
 *   ScreenshotReviewState
 *        ↓ editReviewField / editReviewIdentity
 *        ↓ revertReviewField / revertReviewIdentity
 *   ScreenshotReviewState (new instance)
 *        ↓ finalizeReview
 *   ScreenshotEvidenceResult (with notes: 'User-edited' where applicable)
 *
 * Rules:
 *   - Evidence metadata (source, confidence, volatility, at) is read-only.
 *   - endpointHints and warnings are read-only.
 *   - Edits validated via validateValue + isSensitiveValue + sanitizeField.
 *   - Notes string is fixed: 'User-edited' — no caller input.
 *   - No Capability upgrade anywhere.
 */

import {
  Evidence,
  EvidenceConfidence,
  EvidenceSource,
  EvidenceVolatility,
  FieldEvidence,
} from '../types';
import {
  ScreenshotEvidenceResult,
  ScreenshotEndpointHint,
  ScreenshotWarningCode,
  validateValue,
  isSensitiveValue,
} from '../screenshotCollector';
import { MASK, sanitizeField } from '../sanitize';

// ────────────── Types ──────────────

export type FieldBucket =
  | 'signalFields'
  | 'bandFields'
  | 'cellFields'
  | 'networkFields';

export type IdentityKey = 'vendor' | 'model';

export interface ReviewedField {
  currentValue: string;
  originalValue: string;
  edited: boolean;
  source: EvidenceSource;
  confidence: EvidenceConfidence;
  volatility?: EvidenceVolatility;
  at: number;
}

export interface ScreenshotReviewState {
  identity: {
    vendor: ReviewedField | null;
    model: ReviewedField | null;
  };
  signalFields: Record<string, ReviewedField>;
  bandFields: Record<string, ReviewedField>;
  cellFields: Record<string, ReviewedField>;
  networkFields: Record<string, ReviewedField>;
  endpointHints: ScreenshotEndpointHint[];
  warnings: ScreenshotWarningCode[];
}

export type EditReason =
  | 'INVALID_VALUE'
  | 'SENSITIVE_VALUE'
  | 'UNKNOWN_FIELD';

export type EditResult =
  | { ok: true; state: ScreenshotReviewState }
  | { ok: false; reason: EditReason };

// ────────────── Builders ──────────────

interface EvidenceLike {
  value: string | number | null;
  source: EvidenceSource;
  confidence: EvidenceConfidence;
  volatility?: EvidenceVolatility;
  at: number;
}

function toReviewedField(ev: EvidenceLike): ReviewedField | null {
  if (ev.value === null) return null;
  const strValue = String(ev.value);
  if (strValue === '') return null;
  return {
    currentValue: strValue,
    originalValue: strValue,
    edited: false,
    source: ev.source,
    confidence: ev.confidence,
    volatility: ev.volatility,
    at: ev.at,
  };
}

function bucketFromFieldEvidence(
  fields: FieldEvidence,
): Record<string, ReviewedField> {
  const out: Record<string, ReviewedField> = {};
  for (const [k, ev] of Object.entries(fields)) {
    const rf = toReviewedField(ev);
    if (rf) out[k] = rf;
  }
  return out;
}

export function createReviewFromResult(
  result: ScreenshotEvidenceResult,
): ScreenshotReviewState {
  return {
    identity: {
      vendor: result.identity.vendor
        ? toReviewedField(result.identity.vendor)
        : null,
      model: result.identity.model
        ? toReviewedField(result.identity.model)
        : null,
    },
    signalFields: bucketFromFieldEvidence(result.signalFields),
    bandFields: bucketFromFieldEvidence(result.bandFields),
    cellFields: bucketFromFieldEvidence(result.cellFields),
    networkFields: bucketFromFieldEvidence(result.networkFields),
    endpointHints: [...result.endpointHints],
    warnings: [...result.warnings],
  };
}

// ────────────── Bucket replace helper ──────────────

function replaceBucket(
  state: ScreenshotReviewState,
  bucket: FieldBucket,
  next: Record<string, ReviewedField>,
): ScreenshotReviewState {
  if (bucket === 'signalFields') return { ...state, signalFields: next };
  if (bucket === 'bandFields') return { ...state, bandFields: next };
  if (bucket === 'cellFields') return { ...state, cellFields: next };
  return { ...state, networkFields: next };
}

// ────────────── Edit: field bucket ──────────────

export function editReviewField(
  state: ScreenshotReviewState,
  bucket: FieldBucket,
  key: string,
  newValue: string,
): EditResult {
  if (typeof newValue !== 'string') {
    return { ok: false, reason: 'INVALID_VALUE' };
  }
  const fields = state[bucket];
  const existing = fields[key];
  if (!existing) return { ok: false, reason: 'UNKNOWN_FIELD' };

  if (isSensitiveValue(newValue)) {
    return { ok: false, reason: 'SENSITIVE_VALUE' };
  }
  if (!validateValue(key, newValue)) {
    return { ok: false, reason: 'INVALID_VALUE' };
  }
  const sanitized = sanitizeField(key, newValue);
  if (sanitized === MASK || sanitized === '') {
    return { ok: false, reason: 'SENSITIVE_VALUE' };
  }

  const updated: ReviewedField = {
    ...existing,
    currentValue: sanitized,
    edited: sanitized !== existing.originalValue,
  };

  return {
    ok: true,
    state: replaceBucket(state, bucket, { ...fields, [key]: updated }),
  };
}

// ────────────── Edit: identity ──────────────

export function editReviewIdentity(
  state: ScreenshotReviewState,
  key: IdentityKey,
  newValue: string,
): EditResult {
  if (typeof newValue !== 'string') {
    return { ok: false, reason: 'INVALID_VALUE' };
  }
  const existing = state.identity[key];
  if (!existing) return { ok: false, reason: 'UNKNOWN_FIELD' };

  const maxLen = key === 'vendor' ? 40 : 60;
  const minLen = 2;
  if (newValue.length < minLen || newValue.length > maxLen) {
    return { ok: false, reason: 'INVALID_VALUE' };
  }
  if (isSensitiveValue(newValue)) {
    return { ok: false, reason: 'SENSITIVE_VALUE' };
  }
  const sanitized = sanitizeField(key, newValue);
  if (sanitized === MASK || sanitized === '') {
    return { ok: false, reason: 'SENSITIVE_VALUE' };
  }

  const updated: ReviewedField = {
    ...existing,
    currentValue: sanitized,
    edited: sanitized !== existing.originalValue,
  };

  return {
    ok: true,
    state: {
      ...state,
      identity: { ...state.identity, [key]: updated },
    },
  };
}

// ────────────── Revert ──────────────

export function revertReviewField(
  state: ScreenshotReviewState,
  bucket: FieldBucket,
  key: string,
): ScreenshotReviewState {
  const fields = state[bucket];
  const existing = fields[key];
  if (!existing) return state;

  const reverted: ReviewedField = {
    ...existing,
    currentValue: existing.originalValue,
    edited: false,
  };

  return replaceBucket(state, bucket, { ...fields, [key]: reverted });
}

export function revertReviewIdentity(
  state: ScreenshotReviewState,
  key: IdentityKey,
): ScreenshotReviewState {
  const existing = state.identity[key];
  if (!existing) return state;

  const reverted: ReviewedField = {
    ...existing,
    currentValue: existing.originalValue,
    edited: false,
  };

  return {
    ...state,
    identity: { ...state.identity, [key]: reverted },
  };
}

// ────────────── Finalize ──────────────

function reviewedToEvidence(f: ReviewedField): Evidence<string> {
  const ev: Evidence<string> = {
    value: f.currentValue,
    source: f.source,
    confidence: f.confidence,
    at: f.at,
  };
  if (f.volatility) ev.volatility = f.volatility;
  if (f.edited) ev.notes = 'User-edited';
  return ev;
}

function bucketToEvidence(
  fields: Record<string, ReviewedField>,
): FieldEvidence {
  const out: FieldEvidence = {};
  for (const [k, f] of Object.entries(fields)) {
    out[k] = reviewedToEvidence(f);
  }
  return out;
}

export function finalizeReview(
  state: ScreenshotReviewState,
): ScreenshotEvidenceResult {
  return {
    identity: {
      vendor: state.identity.vendor
        ? reviewedToEvidence(state.identity.vendor)
        : null,
      model: state.identity.model
        ? reviewedToEvidence(state.identity.model)
        : null,
    },
    signalFields: bucketToEvidence(state.signalFields),
    bandFields: bucketToEvidence(state.bandFields),
    cellFields: bucketToEvidence(state.cellFields),
    networkFields: bucketToEvidence(state.networkFields),
    endpointHints: [...state.endpointHints],
    warnings: [...state.warnings],
  };
}
