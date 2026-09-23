/**
 * Screenshot → Diagnostic Integration — PHASE 4C-2B
 *
 * Pure function — لا I/O، لا شبكة، لا تخزين.
 *
 * Pipeline:
 *   ScreenshotEvidenceResult (from 4C-2A finalizeReview)
 *        ↓ integrateScreenshotReview
 *   DiscoveredRouter مُعزَّز (immutable, new object)
 *        ↓ buildDiagnosticPackage (4A, آخر Privacy Boundary)
 *   RouterDiagnosticPackage
 *
 * القواعد:
 *   - Consent إلزامي (ScreenshotConsentState من 4C-1).
 *   - Explicit allowlist: identity.vendor, identity.model,
 *     signalFields, bandFields, cellFields.
 *   - networkFields, endpointHints, warnings: IGNORED.
 *   - capabilities/capabilitiesV2: frozen إلى router الأصلي.
 *   - Precedence: API/header > html/script/field_probe/... > screenshot > user
 *   - Same tier → existing router value wins.
 *   - Re-sanitization على كل قيمة قبل الـ merge.
 *   - لا mutation على input.
 */

import {
  ScreenshotConsentState,
  isConsentGranted,
} from './consent';
import {
  ScreenshotEvidenceResult,
  isSensitiveValue,
} from '../screenshotCollector';
import { buildDiagnosticPackage } from '../diagnostic';
import { buildCapabilityEvidence } from '../capabilities';
import { MASK, sanitizeField } from '../sanitize';
import {
  ConsentRecord,
  DiscoveredRouter,
  Evidence,
  EvidenceSource,
  FieldEvidence,
  RouterDiagnosticPackage,
} from '../types';

// ────────────── Types ──────────────

export interface IntegrationInput {
  router: DiscoveredRouter;
  review: ScreenshotEvidenceResult;
  consent: ScreenshotConsentState;
  appVersion: string;
}

export type IntegrationFailureReason = 'NO_CONSENT' | 'NO_EVIDENCE';

export interface IntegrationStats {
  filled: number;
  overridden: number;
  sanitized: number;
  hintsIgnored: number;
}

export type IntegrationResult =
  | { ok: true; package: RouterDiagnosticPackage; stats: IntegrationStats }
  | { ok: false; reason: IntegrationFailureReason };

// ────────────── Precedence (private) ──────────────

const SOURCE_TIER: Record<EvidenceSource, number> = {
  api: 100,
  header: 95,
  html: 90,
  script: 85,
  field_probe: 80,
  fingerprint: 70,
  static: 60,
  screenshot: 30,
  user: 20,
};

function tierOf(src: EvidenceSource): number {
  return SOURCE_TIER[src] ?? 0;
}

// ────────────── Sanitization (Layer 3) ──────────────

function sanitizeEvidence(
  fieldKey: string,
  ev: Evidence<string | number>,
): { result: Evidence<string> | null; sanitized: boolean } {
  if (ev.value === null) return { result: null, sanitized: false };
  const strValue = String(ev.value);
  if (strValue === '') return { result: null, sanitized: false };
  if (isSensitiveValue(strValue)) return { result: null, sanitized: true };
  const cleaned = sanitizeField(fieldKey, strValue);
  if (cleaned === MASK || cleaned === '') return { result: null, sanitized: true };
  const out: Evidence<string> = {
    value: cleaned,
    source: ev.source,
    confidence: ev.confidence,
    at: ev.at,
  };
  if (ev.volatility) out.volatility = ev.volatility;
  if (ev.notes) out.notes = ev.notes;
  return { result: out, sanitized: cleaned !== strValue };
}

// ────────────── Merge ──────────────

interface MergeSlot {
  result?: Evidence<string | number>;
  filled: boolean;
  overridden: boolean;
  sanitized: boolean;
}

function mergeField(
  fieldKey: string,
  existing: Evidence<string | number> | undefined,
  candidate: Evidence<string | number> | undefined,
): MergeSlot {
  const hasExisting = !!existing && existing.value !== null && existing.value !== '';

  let safeCandidate: Evidence<string> | undefined;
  let sanitizedFlag = false;
  if (candidate && candidate.value !== null && candidate.value !== '') {
    const s = sanitizeEvidence(fieldKey, candidate);
    sanitizedFlag = s.sanitized;
    if (s.result) safeCandidate = s.result;
  }

  if (!hasExisting) {
    if (safeCandidate) {
      return { result: safeCandidate, filled: true, overridden: false, sanitized: sanitizedFlag };
    }
    return { result: existing, filled: false, overridden: false, sanitized: sanitizedFlag };
  }

  if (!safeCandidate) {
    return { result: existing, filled: false, overridden: false, sanitized: sanitizedFlag };
  }

  const eTier = tierOf(existing!.source);
  const cTier = tierOf(safeCandidate.source);
  if (cTier > eTier) {
    return { result: safeCandidate, filled: false, overridden: false, sanitized: sanitizedFlag };
  }
  return { result: existing, filled: false, overridden: true, sanitized: false };
}

interface BucketMerge {
  bucket: FieldEvidence;
  filled: number;
  overridden: number;
  sanitized: number;
}

function mergeBucket(router: FieldEvidence, review: FieldEvidence): BucketMerge {
  const out: FieldEvidence = { ...router };
  let filled = 0, overridden = 0, sanitized = 0;
  for (const key of Object.keys(review)) {
    const slot = mergeField(key, out[key], review[key]);
    if (slot.result !== undefined) out[key] = slot.result;
    if (slot.filled) filled++;
    if (slot.overridden) overridden++;
    if (slot.sanitized) sanitized++;
  }
  return { bucket: out, filled, overridden, sanitized };
}

// ────────────── Helpers ──────────────

function hasMeaningfulFieldValue(bucket: FieldEvidence): boolean {
  for (const ev of Object.values(bucket)) {
    if (ev.value === null || ev.value === '') continue;
    return true;
  }
  return false;
}

function hasAnyEvidence(review: ScreenshotEvidenceResult): boolean {
  const v = review.identity.vendor;
  const m = review.identity.model;
  if (v && v.value !== null && v.value !== '') return true;
  if (m && m.value !== null && m.value !== '') return true;
  if (hasMeaningfulFieldValue(review.signalFields)) return true;
  if (hasMeaningfulFieldValue(review.bandFields)) return true;
  if (hasMeaningfulFieldValue(review.cellFields)) return true;
  if (review.endpointHints.length > 0) return true;
  return false;
}

function toConsentRecord(consent: ScreenshotConsentState): ConsentRecord {
  const grantedAt = typeof consent.grantedAt === 'number' ? consent.grantedAt : 0;
  return {
    at: new Date(grantedAt).toISOString(),
    scopes: ['screenshot'],
    version: 1,
  };
}

// ────────────── Main ──────────────

export function integrateScreenshotReview(
  input: IntegrationInput,
): IntegrationResult {
  if (!isConsentGranted(input.consent)) {
    return { ok: false, reason: 'NO_CONSENT' };
  }
  if (!hasAnyEvidence(input.review)) {
    return { ok: false, reason: 'NO_EVIDENCE' };
  }

  const { router, review } = input;

  const vendorSlot = mergeField(
    'manufacturer',
    router.manufacturer.value !== null ? router.manufacturer : undefined,
    review.identity.vendor ?? undefined,
  );
  const modelSlot = mergeField(
    'model',
    router.model.value !== null ? router.model : undefined,
    review.identity.model ?? undefined,
  );

  const signal = mergeBucket(router.signalFields, review.signalFields);
  const band = mergeBucket(router.bandFields, review.bandFields);
  const cell = mergeBucket(router.cellFields, review.cellFields);

  const stats: IntegrationStats = {
    filled:
      (vendorSlot.filled ? 1 : 0) +
      (modelSlot.filled ? 1 : 0) +
      signal.filled + band.filled + cell.filled,
    overridden:
      (vendorSlot.overridden ? 1 : 0) +
      (modelSlot.overridden ? 1 : 0) +
      signal.overridden + band.overridden + cell.overridden,
    sanitized:
      (vendorSlot.sanitized ? 1 : 0) +
      (modelSlot.sanitized ? 1 : 0) +
      signal.sanitized + band.sanitized + cell.sanitized,
    hintsIgnored: review.endpointHints.length,
  };

  const enhancedRouter: DiscoveredRouter = {
    ...router,
    manufacturer:
      (vendorSlot.result as Evidence<string> | undefined) ?? router.manufacturer,
    model: (modelSlot.result as Evidence<string> | undefined) ?? router.model,
    signalFields: signal.bucket,
    bandFields: band.bucket,
    cellFields: cell.bucket,
  };

  const pkg = buildDiagnosticPackage(
    enhancedRouter,
    toConsentRecord(input.consent),
    input.appVersion,
  );

  // Capability freeze: buildDiagnosticPackage recomputes capabilitiesV2
  // from the enhanced fields; we override with the ORIGINAL router's
  // capabilities V2 so that Screenshot evidence cannot upgrade.
  const originalCapsV2 = buildCapabilityEvidence(
    router.endpoints,
    router.signalFields,
    router.bandFields,
    router.cellFields,
  );
  const frozenPackage: RouterDiagnosticPackage = {
    ...pkg,
    capabilities: router.capabilities,
    capabilitiesV2: originalCapsV2,
  };

  return { ok: true, package: frozenPackage, stats };
}
