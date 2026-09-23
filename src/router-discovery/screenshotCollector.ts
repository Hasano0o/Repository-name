/**
 * Screenshot Collector — PHASE 4B
 *
 * Pure function — لا I/O، لا شبكة، لا تخزين، لا حفظ صورة.
 * يستقبل نصًا (من OCR مستقبلي) ويستخرج Evidence منظّف.
 *
 * القواعد الصارمة:
 *   - source='screenshot' و confidence='OBSERVED' مفروضان داخليًا.
 *   - volatility لكل حقل حسب نوعه.
 *   - Sensitive fields تُسقط قبل إنشاء Evidence.
 *   - Endpoint hints فقط من /api/, /goform/, /cgi-bin/, /rest/.
 *   - لا capability evidence — Discovery هو مصدرها.
 *   - لا Date.now() أثناء المعالجة إذا capturedAt صالح.
 *   - لا IP/URL عام داخل result أو warnings.
 */

import { isLanHost } from '../utils/host';
import { MASK, sanitizeField } from './sanitize';
import {
  Evidence,
  EvidenceVolatility,
  FieldEvidence,
} from './types';

// ────────────── Types ──────────────

export type ScreenshotWarningCode =
  | 'SENSITIVE_FIELD_DROPPED'
  | 'VALUE_SANITIZED'
  | 'LAN_ENDPOINT_DROPPED'
  | 'WRITE_ENDPOINT_DROPPED'
  | 'INVALID_VALUE_DROPPED'
  | 'AMBIGUOUS_FIELD_DROPPED'
  | 'INVALID_TIMESTAMP';

export interface ScreenshotTextBlock {
  text: string;
  confidence?: number;
}

export interface ScreenshotEvidenceInput {
  blocks: ScreenshotTextBlock[];
  capturedAt?: number;
}

export interface ScreenshotEndpointHint {
  path: string;
  source: 'screenshot';
  confidence: 'OBSERVED';
  observedAt: number;
}

export interface ScreenshotIdentityEvidence {
  vendor: Evidence<string> | null;
  model: Evidence<string> | null;
}

export interface ScreenshotEvidenceResult {
  identity: ScreenshotIdentityEvidence;
  signalFields: FieldEvidence;
  bandFields: FieldEvidence;
  cellFields: FieldEvidence;
  networkFields: FieldEvidence;
  endpointHints: ScreenshotEndpointHint[];
  warnings: ScreenshotWarningCode[];
}

// ────────────── Constants ──────────────

const SENSITIVE_LOOSE = new Set([
  'imei', 'imsi', 'iccid', 'meid', 'esn',
  'serial', 'serialnumber',
  'mac', 'macaddress', 'macaddr', 'hwaddr',
  'ssid', 'wifiname', 'wlanname', 'networkname',
  'password', 'pwd', 'passwd', 'pass',
  'pin', 'puk',
  'token', 'accesstoken', 'authtoken', 'refreshtoken',
  'cookie', 'session', 'sessionid', 'authorization', 'bearer',
  'username', 'loginuser', 'login',
  'phone', 'phonenumber', 'msisdn', 'mobile',
  'email',
  'apn', 'apnname', 'apnuser', 'apnprofile',
  'profilename',
  'sms', 'smstext', 'message', 'messagecontent',
]);

const VENDOR_LOOSE = new Set(['vendor', 'manufacturer', 'brand']);
const MODEL_LOOSE = new Set(['model', 'devicemodel', 'modelnumber']);

const FIELD_ALIASES: Record<string, readonly string[]> = {
  rsrp: ['rsrp', 'lte rsrp', '4g rsrp', '5g rsrp', 'signal rsrp', 'rsrp (dbm)', 'rsrp(dbm)'],
  rsrq: ['rsrq', 'lte rsrq', '4g rsrq', '5g rsrq', 'rsrq (db)'],
  rssi: ['rssi', 'lte rssi', 'rssi (dbm)'],
  sinr: ['sinr', 'snr', 'lte sinr', '5g sinr', 'sinr (db)', 'snr (db)'],
  pci: ['pci', 'physical cell id', 'physical cell identity'],
  earfcn: ['earfcn', 'lte earfcn', 'e-arfcn', 'dl earfcn'],
  nrarfcn: ['nrarfcn', 'nr-arfcn', '5g arfcn', 'nr arfcn', 'dl arfcn'],
  band: ['band', 'lte band', 'nr band', '5g band', 'current band'],
  bandwidth: ['bandwidth', 'bw', 'channel bandwidth'],
  cell_id: ['cell id', 'cellid', 'ci', 'cell identity'],
  tac: ['tac', 'tracking area code'],
  mcc: ['mcc', 'country code'],
  mnc: ['mnc', 'network code'],
  network_type: ['network type', 'connection type', 'network mode', 'system mode'],
  operator: ['operator', 'carrier', 'network operator', 'service provider'],
};

const SIGNAL_KEYS = new Set(['rsrp', 'rsrq', 'rssi', 'sinr', 'pci']);
const BAND_KEYS = new Set(['earfcn', 'nrarfcn', 'band', 'bandwidth']);
const CELL_KEYS = new Set(['cell_id', 'tac']);
const NETWORK_KEYS = new Set(['mcc', 'mnc', 'network_type', 'operator']);

const VOLATILITY_BY_FIELD: Record<string, EvidenceVolatility> = {
  rsrp: 'dynamic',
  rsrq: 'dynamic',
  rssi: 'dynamic',
  sinr: 'dynamic',
  pci: 'dynamic',
  earfcn: 'dynamic',
  nrarfcn: 'dynamic',
  band: 'dynamic',
  bandwidth: 'dynamic',
  cell_id: 'dynamic',
  tac: 'dynamic',
  mcc: 'dynamic',
  mnc: 'dynamic',
  network_type: 'dynamic',
  operator: 'slow',
};

const KEY_RE = /^([A-Za-z0-9\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF\s()_./\-]{0,40}?)\s*[:=]\s*([\s\S]+)$/;
const EMBEDDED_KEY_RE = /\s+([A-Za-z\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF()_./\-]{0,40}?)\s*[:=]/;
const ENDPOINT_PATH_RE = /(\/(?:api|goform|cgi-bin|rest)\/[\w./?=&\-]{2,200})/gi;
const FULL_URL_RE = /https?:\/\/([^/\s?#]+)(\/[^\s]{1,200})/gi;
const WRITE_PATH_RE = /(goform_set_cmd_process|reboot|reset|set_|write_|delete_|apply_|factory)/i;
const SENSITIVE_QUERY_RE = /[?&](password|passwd|pwd|token|key|session|auth|ssid|pin)=/i;

// ────────────── Helpers ──────────────

function loose(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
}

const REVERSE_ALIASES: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const a of aliases) m.set(loose(a), canonical);
  }
  return m;
})();

function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function isSensitiveValue(value: string): boolean {
  if (/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(value)) return true;
  if (/^\d{15}$/.test(value) && luhnValid(value)) return true;
  if (/^89\d{16,20}$/.test(value) && luhnValid(value)) return true;
  if (/^[A-Za-z0-9+/]{40,}={0,2}$/.test(value)) return true;
  return false;
}

function stripUnits(value: string, canonical: string): string | null {
  const numeric =
    canonical === 'rsrp' || canonical === 'rsrq' || canonical === 'rssi' ||
    canonical === 'sinr' || canonical === 'bandwidth';
  if (!numeric) return value;
  // Extract leading number only when not immediately followed by another
  // digit. Rejects "999999" but accepts "-92", "-92.5", "-92 dBm",
  // "-92dBm", "-92 <trailing garbage>".
  const m = value.match(/^\s*(-?\d{1,3}(?:\.\d+)?)(?!\d)/);
  if (!m) return null;
  return m[1];
}

export function validateValue(canonical: string, value: string): boolean {
  switch (canonical) {
    case 'rsrp':
    case 'rsrq':
    case 'rssi':
    case 'sinr':
      return /^-?\d{1,3}(\.\d+)?$/.test(value);
    case 'pci':
      return /^\d{1,4}$/.test(value);
    case 'earfcn':
    case 'nrarfcn':
      return /^\d{1,7}$/.test(value);
    case 'band':
      return /^[Bn]\d{1,3}$/i.test(value);
    case 'bandwidth':
      return /^\d{1,3}(\.\d+)?$/.test(value);
    case 'cell_id':
      return /^(0x)?[0-9a-fA-F]{1,12}$/.test(value);
    case 'tac':
      return /^\d{1,5}$/.test(value);
    case 'mcc':
      return /^\d{3}$/.test(value);
    case 'mnc':
      return /^\d{2,3}$/.test(value);
    case 'network_type':
      return /^(lte|4g|5g|nr|lte\+?|nr-?nsa|nr-?sa)/i.test(value);
    case 'operator':
      if (/^\d+$/.test(value)) return false;
      return /^[A-Za-z\u0600-\u06FF0-9\s\-_.+&]{2,40}$/.test(value);
    default:
      return false;
  }
}

function createScreenshotEvidence(
  value: string,
  volatility: EvidenceVolatility,
  capturedAt: number,
): Evidence<string> {
  return {
    value,
    source: 'screenshot',
    confidence: 'OBSERVED',
    volatility,
    at: capturedAt,
  };
}

function resolveCapturedAt(
  input: number | undefined,
  warnings: Set<ScreenshotWarningCode>,
): number {
  if (input === undefined) return Date.now();
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    warnings.add('INVALID_TIMESTAMP');
    return Date.now();
  }
  return input;
}

function extractPairsRecursive(
  text: string,
  out: Array<[string, string]>,
): void {
  if (!text) return;
  const m = text.match(KEY_RE);
  if (!m) return;
  const key = m[1].trim();
  const value = m[2].trim();
  if (!key || !value) return;

  const embedded = value.match(EMBEDDED_KEY_RE);
  if (embedded && embedded.index !== undefined && embedded.index > 0) {
    const beforeValue = value.slice(0, embedded.index).trim();
    if (beforeValue) out.push([key, beforeValue]);
    const rest = value.slice(embedded.index).trim();
    extractPairsRecursive(rest, out);
  } else {
    out.push([key, value]);
  }
}

function extractPairsFromText(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const line of text.split(/[\r\n]+/)) {
    for (const piece of line.split(/[|;•·]+/)) {
      extractPairsRecursive(piece.trim(), pairs);
    }
  }
  return pairs;
}

function addEndpointHint(
  path: string,
  capturedAt: number,
  out: ScreenshotEndpointHint[],
  seen: Set<string>,
  warnings: Set<ScreenshotWarningCode>,
): void {
  if (!path || seen.has(path)) return;
  if (WRITE_PATH_RE.test(path)) {
    warnings.add('WRITE_ENDPOINT_DROPPED');
    return;
  }
  if (SENSITIVE_QUERY_RE.test(path)) {
    warnings.add('SENSITIVE_FIELD_DROPPED');
    return;
  }
  seen.add(path);
  out.push({
    path,
    source: 'screenshot',
    confidence: 'OBSERVED',
    observedAt: capturedAt,
  });
}

// ────────────── Main ──────────────

export function collectScreenshotEvidence(
  input: ScreenshotEvidenceInput,
): ScreenshotEvidenceResult {
  const warnings = new Set<ScreenshotWarningCode>();
  const capturedAt = resolveCapturedAt(input.capturedAt, warnings);

  const signalFields: FieldEvidence = {};
  const bandFields: FieldEvidence = {};
  const cellFields: FieldEvidence = {};
  const networkFields: FieldEvidence = {};
  const endpointHints: ScreenshotEndpointHint[] = [];
  const seenHints = new Set<string>();
  const identity: ScreenshotIdentityEvidence = { vendor: null, model: null };

  const blocks = input.blocks ?? [];

  for (const block of blocks) {
    if (!block || typeof block.text !== 'string' || !block.text) continue;

    // 1) Key-value pairs
    const pairs = extractPairsFromText(block.text);
    for (const [key, rawValue] of pairs) {
      const lk = loose(key);
      if (!lk) continue;

      if (SENSITIVE_LOOSE.has(lk)) {
        warnings.add('SENSITIVE_FIELD_DROPPED');
        continue;
      }

      if (VENDOR_LOOSE.has(lk)) {
        if (rawValue && rawValue.length <= 40 && !isSensitiveValue(rawValue)) {
          identity.vendor = createScreenshotEvidence(rawValue, 'static', capturedAt);
        }
        continue;
      }
      if (MODEL_LOOSE.has(lk)) {
        if (rawValue && rawValue.length <= 60 && !isSensitiveValue(rawValue)) {
          identity.model = createScreenshotEvidence(rawValue, 'static', capturedAt);
        }
        continue;
      }

      const canonical = REVERSE_ALIASES.get(lk);
      if (!canonical) {
        if (/signal|network|status|info/i.test(key)) {
          warnings.add('AMBIGUOUS_FIELD_DROPPED');
        }
        continue;
      }

      const cleaned = stripUnits(rawValue, canonical);
      if (cleaned === null || !validateValue(canonical, cleaned)) {
        warnings.add('INVALID_VALUE_DROPPED');
        continue;
      }
      if (isSensitiveValue(cleaned)) {
        warnings.add('VALUE_SANITIZED');
        continue;
      }
      const sanitized = sanitizeField(canonical, cleaned);
      if (sanitized === MASK || sanitized === '') {
        warnings.add('VALUE_SANITIZED');
        continue;
      }

      const vol = VOLATILITY_BY_FIELD[canonical] ?? 'dynamic';
      const ev = createScreenshotEvidence(sanitized, vol, capturedAt);

      if (SIGNAL_KEYS.has(canonical)) signalFields[canonical] = ev;
      else if (BAND_KEYS.has(canonical)) bandFields[canonical] = ev;
      else if (CELL_KEYS.has(canonical)) cellFields[canonical] = ev;
      else if (NETWORK_KEYS.has(canonical)) networkFields[canonical] = ev;
    }

    // 2) Endpoint hints
    const text = block.text;
    for (const m of text.matchAll(FULL_URL_RE)) {
      const host = m[1];
      const path = m[2];
      if (!isLanHost(host)) {
        warnings.add('LAN_ENDPOINT_DROPPED');
        continue;
      }
      addEndpointHint(path, capturedAt, endpointHints, seenHints, warnings);
    }
    for (const m of text.matchAll(ENDPOINT_PATH_RE)) {
      const path = m[1];
      if (endpointHints.some((h) => h.path === path)) continue;
      addEndpointHint(path, capturedAt, endpointHints, seenHints, warnings);
    }
  }

  return {
    identity,
    signalFields,
    bandFields,
    cellFields,
    networkFields,
    endpointHints,
    warnings: Array.from(warnings),
  };
}
