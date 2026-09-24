/**
 * Router Lab — Discovery Harness — PHASE 5D
 *
 * ⚠️ DEV-ONLY: not exported from lab/index.ts.
 * Caller is responsible for guarding with __DEV__.
 *
 * يشغّل مسار Discovery الكامل ضد MockRouter:
 *   targets → safeDiscoveryFetch → policy → fetch (mock)
 *          → evidence extraction → capabilities → compat
 *
 * القواعد:
 *   - لا fetch مباشر — فقط safeDiscoveryFetch.
 *   - لا parser جديد — نستخدم evidenceCollector الموجود.
 *   - لا buildDiagnosticPackage (فصل الطبقات).
 *   - لا Math.random، لا وقت اصطناعي.
 *   - hasDriver: false دائمًا.
 *   - UNKNOWN لا يُرقّى إلى vendor/model.
 */

import { safeDiscoveryFetch, SafeFetchErrorCode } from '../safeRequest';
import {
  extractIdentityFromHtml,
  extractSignalFields,
  extractBandFields,
  extractCellFields,
} from '../evidenceCollector';
import { buildCapabilityEvidence } from '../capabilities';
import { computeCompatibility } from '../compat';
import { unknownEvidence } from '../evidence';
import {
  CapabilityEvidence,
  CapabilityEvidenceV2,
  CapabilityState,
  DiscoveredEndpoint,
  DiscoveredRouter,
  DiscoveryError,
  DiscoveryErrorKind,
  Evidence,
  FieldEvidence,
} from '../types';
import { installMockFetch, uninstallMockFetch } from './transport';
import { getProfileForHost, isMockHost } from './hosts';

// ────────────── Types ──────────────

export interface HarnessTarget {
  readonly path: string;
  readonly label: string;
}

export interface HarnessInput {
  readonly host: string;
  readonly targets?: readonly HarnessTarget[];
}

export interface HarnessStats {
  /** عدد targets التي تمت معالجتها */
  readonly attempted: number;
  /** عدد الطلبات التي سمحت بها policy */
  readonly allowed: number;
  /** عدد الطلبات التي رفضتها policy */
  readonly denied: number;
  /** عدد safeDiscoveryFetch الناجحة */
  readonly ok: number;
  /** عدد REDIRECT_BLOCKED (مُدرَج ضمن errored) */
  readonly redirectBlocked: number;
  /** عدد 404 (مُدرَج ضمن ok) */
  readonly notFound: number;
  /** بقية الأخطاء بعد allow */
  readonly errored: number;
}

export interface HarnessResult {
  readonly host: string;
  readonly profileId: string;
  readonly router: DiscoveredRouter;
  readonly capabilitiesV2: CapabilityEvidenceV2;
  readonly stats: HarnessStats;
}

// ────────────── Default targets ──────────────

export const HARNESS_TARGETS: readonly HarnessTarget[] = [
  { path: '/',                                  label: 'homepage' },
  { path: '/login.html',                        label: 'login-page' },
  { path: '/api/device/information',            label: 'huawei-info' },
  { path: '/api/device/signal',                 label: 'huawei-signal' },
  { path: '/api/device/seccellinfo',            label: 'huawei-seccell' },
  { path: '/api/monitoring/status',             label: 'huawei-status' },
  { path: '/api/monitoring/traffic-statistics', label: 'huawei-traffic' },
  { path: '/api/net/current-plmn',              label: 'huawei-plmn' },
  { path: '/api/net/net-mode',                  label: 'huawei-net-mode' },
  { path: '/api/dhcp/settings',                 label: 'huawei-dhcp' },
  { path: '/api/dialup/profiles',               label: 'huawei-apn' },
  { path: '/goform/goform_get_cmd_process?cmd=rsrp', label: 'zte-cmd-rsrp' },
];

// ────────────── Helpers ──────────────

function errorKind(code: SafeFetchErrorCode): DiscoveryErrorKind {
  switch (code) {
    case 'POLICY_DENIED':              return 'policy-denied';
    case 'REDIRECT_BLOCKED':           return 'network';
    case 'RESPONSE_TOO_LARGE':         return 'malformed';
    case 'UNSUPPORTED_CONTENT_TYPE':   return 'malformed';
    case 'RESPONSE_STREAM_UNAVAILABLE':return 'malformed';
    case 'NETWORK_ERROR':              return 'network';
    case 'TIMEOUT':                    return 'timeout';
    case 'MALFORMED_RESPONSE':         return 'parse';
    case 'UNSAFE_HOST':
    case 'INVALID_URL':
    default:                           return 'unknown';
  }
}

function mergeFieldEvidence(
  acc: FieldEvidence,
  next: FieldEvidence,
): FieldEvidence {
  const out: FieldEvidence = { ...acc };
  for (const [k, v] of Object.entries(next)) {
    if (out[k] === undefined) out[k] = v;
  }
  return out;
}

function kindOf(contentType: string): 'json' | 'xml' | null {
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('xml')) return 'xml';
  return null;
}

function v2ToLegacy(v2: CapabilityEvidenceV2): CapabilityEvidence {
  const conv = (e: Evidence<CapabilityState>): Evidence<boolean> => {
    if (e.value === null || e.value === 'UNKNOWN') {
      return {
        value: null,
        source: e.source,
        confidence: 'UNKNOWN',
        at: e.at,
        volatility: e.volatility,
      };
    }
    const isTrue = e.value === 'CONFIRMED_READ' || e.value === 'PARTIAL_READ';
    return {
      value: isTrue,
      source: e.source,
      confidence: e.confidence,
      at: e.at,
      volatility: e.volatility,
    };
  };
  return {
    signal: conv(v2.signal),
    lte: conv(v2.lte),
    nr: conv(v2.nr),
    bands: conv(v2.bands),
    cells: conv(v2.cells),
    neighborCells: conv(v2.neighborCells),
    carrierAggregation: conv(v2.carrierAggregation),
    deviceInfo: conv(v2.deviceInfo),
    traffic: conv(v2.traffic),
    usage: conv(v2.usage),
    sms: conv(v2.sms),
    bandLock: conv(v2.bandLock),
    cellLock: conv(v2.cellLock),
    reboot: conv(v2.reboot),
    block: conv(v2.block),
  };
}

// ────────────── Main ──────────────

export async function runDiscoveryHarness(
  input: HarnessInput,
): Promise<HarnessResult> {
  const targets = input.targets ?? HARNESS_TARGETS;
  const host = input.host;

  if (!isMockHost(host)) {
    throw new Error('runDiscoveryHarness: host is not a registered mock host');
  }
  const profile = getProfileForHost(host);
  if (!profile) {
    throw new Error('runDiscoveryHarness: no profile for host');
  }

  const now = Date.now();

  const endpoints: DiscoveredEndpoint[] = [];
  const errors: DiscoveryError[] = [];
  let signalFields: FieldEvidence = {};
  let bandFields: FieldEvidence = {};
  let cellFields: FieldEvidence = {};
  const htmlBodies: string[] = [];

  const stats = {
    attempted: 0,
    allowed: 0,
    denied: 0,
    ok: 0,
    redirectBlocked: 0,
    notFound: 0,
    errored: 0,
  };

  installMockFetch();
  try {
    for (const t of targets) {
      stats.attempted++;
      const url = `http://${host}${t.path}`;
      const result = await safeDiscoveryFetch({ url });

      if (result.ok) {
        stats.allowed++;
        stats.ok++;
        if (result.status === 404) stats.notFound++;

        const ct = result.contentType.toLowerCase();
        if (ct.includes('html')) {
          htmlBodies.push(result.body);
        } else {
          const kind = kindOf(result.contentType);
          if (kind) {
            signalFields = mergeFieldEvidence(
              signalFields,
              extractSignalFields(result.body, kind, { source: 'api' }),
            );
            bandFields = mergeFieldEvidence(
              bandFields,
              extractBandFields(result.body, kind, { source: 'api' }),
            );
            cellFields = mergeFieldEvidence(
              cellFields,
              extractCellFields(result.body, kind, { source: 'api' }),
            );
          }
        }

        endpoints.push({
          path: t.path.split('?')[0],
          method: 'GET',
          status: result.status,
          contentType: result.contentType,
          authRequired: result.status === 401 || result.status === 403,
          source: 'api',
          ms: result.ms,
          at: now,
        });
      } else if (result.code === 'POLICY_DENIED') {
        stats.denied++;
        errors.push({
          step: t.label,
          kind: 'policy-denied',
          message: 'Policy denied request',
          at: now,
        });
      } else {
        stats.allowed++;
        stats.errored++;
        if (result.code === 'REDIRECT_BLOCKED') stats.redirectBlocked++;
        errors.push({
          step: t.label,
          kind: errorKind(result.code),
          message: `Request failed: ${result.code}`,
          at: now,
        });
      }
    }
  } finally {
    uninstallMockFetch();
  }

  // Identity — first HTML wins for each field
  let vendor = unknownEvidence<string>('html');
  let model = unknownEvidence<string>('html');
  let firmware = unknownEvidence<string>('html');
  let hardwareVersion = unknownEvidence<string>('html');

  for (const html of htmlBodies) {
    const id = extractIdentityFromHtml(html, { source: 'html', now });
    if (id.vendor.value && !vendor.value) vendor = id.vendor;
    if (id.model.value && !model.value) model = id.model;
    if (id.firmware.value && !firmware.value) firmware = id.firmware;
    if (id.hardwareVersion.value && !hardwareVersion.value) {
      hardwareVersion = id.hardwareVersion;
    }
  }

  const capabilitiesV2 = buildCapabilityEvidence(
    endpoints,
    signalFields,
    bandFields,
    cellFields,
  );
  const legacyCaps = v2ToLegacy(capabilitiesV2);

  const compatLevel = computeCompatibility({
    hasDriver: false,
    hasLiveEndpoint: endpoints.length > 0,
    capabilities: legacyCaps,
  });

  const router: DiscoveredRouter = {
    host,
    protocols: ['http'],
    manufacturer: vendor,
    model,
    firmware,
    hardwareVersion,
    fingerprints: [],
    endpoints,
    capabilities: legacyCaps,
    signalFields,
    bandFields,
    cellFields,
    errors,
    compatLevel,
    at: now,
  };

  return {
    host,
    profileId: profile.id,
    router,
    capabilitiesV2,
    stats,
  };
}
