/**
 * Evidence Collector — PHASE 4A
 *
 * يستخرج Evidence<T> من الردود المُنظَّفة (بعد safeDiscoveryFetch + sanitize).
 *
 * قواعد صارمة:
 *   HTML: فقط <title> و <meta name=...> — لا <input>، لا hidden.
 *   XML:  فقط حقول في قائمة SAFE_FIELD_NAMES.
 *   JSON: نفس القاعدة.
 *   لا استخراج لأي حقل حساس.
 *   volatility تُحدَّد صراحة من كل builder.
 */

import {
  Evidence,
  EvidenceSource,
  EvidenceVolatility,
  FieldEvidence,
} from './types';
import { MASK } from './sanitize';

export interface HtmlExtractOptions {
  source: EvidenceSource;
  now?: number;
}

// ──────────────── HTML extraction ────────────────

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  return m ? m[1].trim() : '';
}

function extractMeta(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\s+([^>]+?)\/?>/gi)) {
    const attrs = m[1];
    const nameM = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
    const contentM = attrs.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (!nameM || !contentM) continue;
    const name = nameM[1].toLowerCase().trim();
    // رفض أي meta باسم حساس
    if (/password|token|session|cookie|ssid|imei|imsi|mac|auth/i.test(name)) continue;
    out[name] = contentM[1];
  }
  return out;
}

const VENDOR_RE =
  /huawei|zte|zyxel|tp-?link|d-?link|netgear|nokia|alcatel|mikrotik|openwrt|tcl|inseego/i;

function makeStr(
  v: string | null,
  source: EvidenceSource,
  vol: EvidenceVolatility,
  now: number,
): Evidence<string> {
  if (v === null) {
    return { value: null, source, confidence: 'UNKNOWN', at: now, volatility: vol };
  }
  return { value: v, source, confidence: 'OBSERVED', at: now, volatility: vol };
}

export function extractIdentityFromHtml(
  html: string,
  opts: HtmlExtractOptions,
): {
  vendor: Evidence<string>;
  model: Evidence<string>;
  firmware: Evidence<string>;
  hardwareVersion: Evidence<string>;
} {
  const now = opts.now ?? Date.now();
  const title = extractTitle(html);
  const meta = extractMeta(html);

  let vendorVal: string | null = null;
  const gen = meta['generator'] ?? '';
  const mGen = gen.match(VENDOR_RE);
  if (mGen) vendorVal = mGen[0];
  if (!vendorVal && title) {
    const mTitle = title.match(VENDOR_RE);
    if (mTitle) vendorVal = mTitle[0];
  }

  return {
    vendor: makeStr(vendorVal, opts.source, 'static', now),
    model: makeStr(null, opts.source, 'static', now),
    firmware: makeStr(null, opts.source, 'slow', now),
    hardwareVersion: makeStr(null, opts.source, 'static', now),
  };
}

// ──────────────── Field extraction ────────────────

const SIGNAL_NAMES = new Set([
  'rsrp', 'rsrq', 'rssi', 'sinr', 'snr', 'cqi',
  'lte_rsrp', 'lte_rsrq', 'lte_rssi', 'lte_snr', 'lte_sinr',
  'nr_rsrp', 'nr_rsrq', 'nr_sinr',
  'z5g_rsrp', 'z5g_rsrq', 'z5g_sinr',
  'nr5g_rsrp', 'nr5g_rsrq', 'nr5g_sinr',
  'pci', 'lte_pci', 'nr_pci', 'nr5g_pci',
  'txpower', 'tx_power', 'mcs', 'dl_mcs', 'ul_mcs',
  'rank', 'streams', 'dl_streams',
  'signalbar', 'signal_bar', 'signal_strength', 'signal_icon',
]);

const BAND_NAMES = new Set([
  'band', 'lte_band', 'nr_band', 'wan_active_band',
  'nr5g_action_band', 'nr5g_band', 'nr5g_sa_band',
  'earfcn', 'arfcn', 'nrarfcn', 'lte_earfcn',
  'nr5g_action_channel', 'nr5g_dlEarfcn',
  'bandwidth', 'dl_bandwidth', 'ul_bandwidth',
  'freq', 'frequency',
]);

const CELL_NAMES = new Set([
  'cell_id', 'cellid', 'lte_cell_id',
  'nr5g_cell_id', 'nr5g_sa_cell_id',
  'enodeb_id', 'gnb_id', 'tac',
]);

function parseJsonFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/"([\w.\-]+)"\s*:\s*(?:"([^"]*)"|(-?\d+(?:\.\d+)?))/g)) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

function parseXmlFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/<([A-Za-z_][\w.\-]*)>([^<]{1,4000})<\/\1>/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

function buildFieldEvidence(
  fields: Record<string, string>,
  allowlist: Set<string>,
  source: EvidenceSource,
  vol: EvidenceVolatility,
  now: number,
): FieldEvidence {
  const out: FieldEvidence = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!allowlist.has(k.toLowerCase())) continue;
    if (v === MASK) continue;
    out[k] = {
      value: v,
      source,
      confidence: 'OBSERVED',
      at: now,
      volatility: vol,
    };
  }
  return out;
}

export function extractSignalFields(
  body: string,
  kind: 'json' | 'xml',
  opts: HtmlExtractOptions,
): FieldEvidence {
  const now = opts.now ?? Date.now();
  const fields = kind === 'json' ? parseJsonFields(body) : parseXmlFields(body);
  return buildFieldEvidence(fields, SIGNAL_NAMES, opts.source, 'dynamic', now);
}

export function extractBandFields(
  body: string,
  kind: 'json' | 'xml',
  opts: HtmlExtractOptions,
): FieldEvidence {
  const now = opts.now ?? Date.now();
  const fields = kind === 'json' ? parseJsonFields(body) : parseXmlFields(body);
  return buildFieldEvidence(fields, BAND_NAMES, opts.source, 'slow', now);
}

export function extractCellFields(
  body: string,
  kind: 'json' | 'xml',
  opts: HtmlExtractOptions,
): FieldEvidence {
  const now = opts.now ?? Date.now();
  const fields = kind === 'json' ? parseJsonFields(body) : parseXmlFields(body);
  return buildFieldEvidence(fields, CELL_NAMES, opts.source, 'dynamic', now);
}
