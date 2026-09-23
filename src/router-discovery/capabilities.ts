/**
 * Capabilities evaluator — PHASE 4A
 *
 * لكل capability قواعد محددة مسبقًا:
 *   - endpoint paths مسموحة (regex)
 *   - أسماء حقول تُثبت القدرة
 *   - حد أدنى من الحقول
 *
 * القاعدة:
 *   endpoint 200 + حقول كافية → CONFIRMED_READ
 *   endpoint 200 فقط          → PARTIAL_READ
 *   حقول فقط                  → PARTIAL_READ
 *   لا شيء                    → UNKNOWN
 *
 * قدرات الكتابة تبقى UNKNOWN دائمًا في Discovery.
 */

import {
  CapabilityEvidenceV2,
  CapabilityState,
  DiscoveredEndpoint,
  Evidence,
  FieldEvidence,
} from './types';

interface CapabilityRequirement {
  endpointPatterns: RegExp[];
  fieldNames: Set<string>;
  minFields: number;
}

const SIGNAL_FIELDS = new Set([
  'rsrp', 'rsrq', 'rssi', 'sinr', 'snr', 'cqi',
  'lte_rsrp', 'lte_rsrq', 'lte_rssi', 'lte_snr', 'lte_sinr',
  'nr_rsrp', 'nr_rsrq', 'nr_sinr',
  'z5g_rsrp', 'z5g_rsrq', 'z5g_sinr',
  'nr5g_rsrp', 'nr5g_rsrq', 'nr5g_sinr',
  'pci', 'lte_pci', 'nr_pci', 'nr5g_pci',
]);

const BAND_FIELDS = new Set([
  'band', 'lte_band', 'nr_band', 'wan_active_band',
  'earfcn', 'arfcn', 'nrarfcn', 'lte_earfcn',
  'bandwidth', 'dl_bandwidth', 'ul_bandwidth',
]);

const CELL_FIELDS = new Set([
  'cell_id', 'cellid', 'lte_cell_id',
  'enodeb_id', 'gnb_id', 'tac',
]);

const CA_FIELDS = new Set([
  'wan_lte_ca', 'lte_ca_pcell_band', 'lte_ca_pcell_bandwidth',
  'lte_multi_ca_scell_info', 'lte_ca_scell_info',
]);

const TRAFFIC_FIELDS = new Set([
  'realtime_tx_thrpt', 'realtime_rx_thrpt',
  'realtime_tx_bytes', 'realtime_rx_bytes',
]);

const REQUIREMENTS: Record<string, CapabilityRequirement> = {
  signal: {
    endpointPatterns: [
      /\/api\/device\/signal$/i,
      /\/goform\/goform_get_cmd_process$/i,
    ],
    fieldNames: SIGNAL_FIELDS,
    minFields: 2,
  },
  bands: {
    endpointPatterns: [
      /\/api\/net\/net-mode$/i,
      /\/api\/net\/net-mode-list$/i,
    ],
    fieldNames: BAND_FIELDS,
    minFields: 1,
  },
  cells: {
    endpointPatterns: [
      /\/api\/device\/seccellinfo$/i,
      /\/api\/device\/nbrcellinfo$/i,
    ],
    fieldNames: CELL_FIELDS,
    minFields: 1,
  },
  carrierAggregation: {
    endpointPatterns: [/\/api\/device\/seccellinfo$/i],
    fieldNames: CA_FIELDS,
    minFields: 1,
  },
  deviceInfo: {
    endpointPatterns: [
      /\/api\/device\/information$/i,
      /\/api\/device\/basic_information$/i,
    ],
    fieldNames: new Set(),
    minFields: 0,
  },
  traffic: {
    endpointPatterns: [/\/api\/monitoring\/traffic-statistics$/i],
    fieldNames: TRAFFIC_FIELDS,
    minFields: 0,
  },
  usage: {
    endpointPatterns: [/\/api\/monitoring\/month_statistics$/i],
    fieldNames: new Set(),
    minFields: 0,
  },
  sms: {
    endpointPatterns: [/\/api\/sms\/sms-list$/i],
    fieldNames: new Set(),
    minFields: 0,
  },
};

function endpointHit(cap: string, endpoints: DiscoveredEndpoint[]): boolean {
  const req = REQUIREMENTS[cap];
  if (!req) return false;
  return endpoints.some(
    (e) =>
      e.status === 200 &&
      req.endpointPatterns.some((re) => re.test(e.path)),
  );
}

function fieldCount(cap: string, fields: FieldEvidence): number {
  const req = REQUIREMENTS[cap];
  if (!req || req.fieldNames.size === 0) return 0;
  let n = 0;
  for (const k of Object.keys(fields)) {
    if (req.fieldNames.has(k.toLowerCase())) n++;
  }
  return n;
}

export function evaluateCapability(
  cap: string,
  endpoints: DiscoveredEndpoint[],
  fields: FieldEvidence,
  now: number,
): Evidence<CapabilityState> {
  const req = REQUIREMENTS[cap];
  if (!req) {
    return {
      value: 'UNKNOWN',
      source: 'static',
      confidence: 'UNKNOWN',
      at: now,
      volatility: 'static',
    };
  }

  const hit = endpointHit(cap, endpoints);
  const n = fieldCount(cap, fields);

  if (hit && (req.minFields === 0 || n >= req.minFields)) {
    return {
      value: 'CONFIRMED_READ',
      source: 'api',
      confidence: 'CONFIRMED',
      at: now,
      volatility: 'slow',
    };
  }

  if (hit || n > 0) {
    return {
      value: 'PARTIAL_READ',
      source: hit ? 'api' : 'field_probe',
      confidence: 'OBSERVED',
      at: now,
      volatility: 'slow',
    };
  }

  return {
    value: 'UNKNOWN',
    source: 'static',
    confidence: 'UNKNOWN',
    at: now,
    volatility: 'static',
  };
}

function writeUnknown(now: number): Evidence<CapabilityState> {
  return {
    value: 'UNKNOWN',
    source: 'static',
    confidence: 'UNKNOWN',
    at: now,
    volatility: 'static',
  };
}

export function buildCapabilityEvidence(
  endpoints: DiscoveredEndpoint[],
  signalFields: FieldEvidence,
  bandFields: FieldEvidence,
  cellFields: FieldEvidence,
): CapabilityEvidenceV2 {
  const now = Date.now();
  const sig = evaluateCapability('signal', endpoints, signalFields, now);
  const bands = evaluateCapability('bands', endpoints, bandFields, now);
  const cells = evaluateCapability('cells', endpoints, cellFields, now);

  return {
    signal: sig,
    lte: sig,
    nr: sig,
    bands,
    cells,
    neighborCells: cells,
    carrierAggregation: evaluateCapability('carrierAggregation', endpoints, signalFields, now),
    deviceInfo: evaluateCapability('deviceInfo', endpoints, {}, now),
    traffic: evaluateCapability('traffic', endpoints, {}, now),
    usage: evaluateCapability('usage', endpoints, {}, now),
    sms: evaluateCapability('sms', endpoints, {}, now),
    bandLock: writeUnknown(now),
    cellLock: writeUnknown(now),
    reboot: writeUnknown(now),
    block: writeUnknown(now),
  };
}
