/**
 * Diagnostic Package Builder — PHASE 4A
 *
 * يبني RouterDiagnosticPackage من DiscoveredRouter + ConsentRecord.
 * القواعد:
 *   - لا يُبنى بدون consent صالح.
 *   - host يُعمّى (anonymizeHost).
 *   - لا raw body.
 *   - capabilitiesV2 مضمّن.
 *   - screenshots فارغة في 4A (تُملأ في 4B).
 */

import { anonymizeHost } from './evidence';
import { buildCapabilityEvidence } from './capabilities';
import { MASK, sanitizeField } from './sanitize';
import {
  ConsentRecord,
  DiscoveredRouter,
  DISCOVERY_SCHEMA_VERSION,
  FieldEvidence,
  RouterDiagnosticPackage,
} from './types';

/**
 * Defense-in-depth sanitization of a FieldEvidence map.
 *
 * Even though evidenceCollector is designed to never emit sensitive
 * keys, the diagnostic builder is the FINAL boundary before packaging
 * and must not trust its input.
 *
 * Rules:
 *   - Sensitive field name -> drop field entirely.
 *   - Otherwise apply sanitizeField(k, v) which also runs value-level
 *     checks (Luhn IMEI/ICCID, MAC, long tokens).
 *   - null values preserved.
 *   - empty string values dropped.
 */
function sanitizeFieldEvidence(fields: FieldEvidence): FieldEvidence {
  const out: FieldEvidence = {};
  for (const [k, ev] of Object.entries(fields)) {
    if (ev.value === null) {
      out[k] = ev;
      continue;
    }
    const str = String(ev.value);
    const cleaned = sanitizeField(k, str);
    if (cleaned === MASK || cleaned === '') continue;
    out[k] = { ...ev, value: cleaned };
  }
  return out;
}

export function buildDiagnosticPackage(
  router: DiscoveredRouter,
  consent: ConsentRecord,
  appVersion: string,
): RouterDiagnosticPackage {
  if (!consent || typeof consent.at !== 'string' || consent.at.length === 0) {
    throw new Error('Cannot build DiagnosticPackage without user consent');
  }

  const capabilitiesV2 = buildCapabilityEvidence(
    router.endpoints,
    router.signalFields,
    router.bandFields,
    router.cellFields,
  );

  return {
    schema: DISCOVERY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    appVersion,
    device: {
      manufacturer: router.manufacturer,
      model: router.model,
      firmware: router.firmware,
      hardwareVersion: router.hardwareVersion,
    },
    discovery: {
      protocols: router.protocols,
      hostPattern: anonymizeHost(router.host),
      fingerprints: router.fingerprints,
    },
    endpoints: router.endpoints,
    capabilities: router.capabilities,
    capabilitiesV2,
    signalFields: sanitizeFieldEvidence(router.signalFields),
    bandFields: sanitizeFieldEvidence(router.bandFields),
    cellFields: sanitizeFieldEvidence(router.cellFields),
    screenshots: [],
    errors: router.errors,
    compatLevel: router.compatLevel,
    userConsent: consent,
  };
}

/**
 * يعيد قائمة بما سيُرسل وما لن يُرسل — pure function.
 * لا side effects، لا شبكة، لا تخزين.
 */
export function describePackageContents(
  _router: DiscoveredRouter,
): {
  willSend: string[];
  willNotSend: string[];
} {
  const willSend = [
    'Device manufacturer (if observed)',
    'Device model (if observed)',
    'Firmware version (if observed)',
    'Hardware version (if observed)',
    'Protocols observed (http/https)',
    'Host pattern (anonymized)',
    'Endpoints discovered (path, status, content-type)',
    'Signal field names and values (sanitized)',
    'Band field names and values (sanitized)',
    'Cell field names and values (sanitized)',
    'Capability evidence (read-only)',
    'Compatibility level',
    'Structured errors (no raw bodies)',
  ];

  const willNotSend = [
    'Passwords, PINs, PUKs',
    'Tokens, session IDs, cookies',
    'Authorization headers',
    'IMEI, IMSI, ICCID, MEID, ESN',
    'MAC addresses',
    'SSID, Wi-Fi names',
    'Phone numbers, MSISDN',
    'SMS content, message text',
    'APN profile names',
    'Usernames',
    'Email addresses',
    'Raw HTML, JSON, XML bodies',
    'Raw HTTP headers',
    'Public IP addresses',
    'GPS location',
  ];

  return { willSend, willNotSend };
}
