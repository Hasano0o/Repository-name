/**
 * ReadOnlySafetyPolicy — PHASE 2
 *
 * طبقة مستقلة تقرر مصير أي Discovery request قبل تنفيذه:
 *   ALLOW | DENY | REQUIRE_USER_CONFIRMATION
 *
 * المبادئ:
 *  - لا تعتمد على HTTP method وحده (GET ليس Read-Only تلقائيًا).
 *  - allowlist + deny rules (ليس blacklist فقط).
 *  - host validation أولاً (SSRF protection).
 *  - query params تُحلَّل مستقلة، مع كشف encoding.
 *  - ZTE goform يُعامل بحذر خاص.
 *  - Huawei /api/* لا يُسمح به تلقائيًا.
 *  - LuCI لا يُعتبر آمنًا بالكامل.
 *  - لا تعتمد على redirect — HTTP layer مسؤول عن إعادة الفحص.
 *
 * غير مسموح في PHASE 2:
 *  - ربط مع probe.ts / fetch / http.ts
 *  - تعديل credentials / endpoints
 *  - Login
 *  - globalThis.fetch interception
 */

import { isLanHost } from '../utils/host';
import {
  PolicyCode,
  PolicyDecision,
  PolicyInput,
  PolicyResult,
} from './types';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

/** ZTE goform_get_cmd_process — أوامر قراءة معروفة (whitelist) */
const ZTE_READ_CMDS: ReadonlySet<string> = new Set([
  // Signal
  'rssi', 'rsrp', 'rsrq', 'sinr', 'snr',
  'lte_rsrp', 'lte_rsrq', 'lte_snr', 'lte_sinr', 'lte_rssi',
  // Cell / PCI / ARFCN
  'lte_pci', 'pci', 'cell_id', 'lte_cell_id', 'enodeb_id',
  'lte_band', 'band', 'wan_active_band', 'wan_active_channel',
  'lte_freq', 'lte_earfcn',
  // CA
  'wan_lte_ca', 'lte_ca_pcell_band', 'lte_ca_pcell_bandwidth', 'lte_ca_pcell_freq',
  'lte_ca_scell_band', 'lte_ca_scell_bandwidth',
  'lte_multi_ca_scell_info', 'lte_ca_scell_info',
  // Neighbor cells
  'ngbr_cell_info',
  // Network
  'network_type', 'network_provider', 'network_provider_fullname',
  'signalbar', 'rmcc', 'rmnc', 'ppp_status',
  'modem_main_state', 'sim_card_state',
  // WAN (reads of values — privacy handled by sanitize())
  'wan_ipaddr', 'static_wan_ipaddr', 'wan_apn',
  // Traffic / usage
  'realtime_tx_bytes', 'realtime_rx_bytes',
  'realtime_tx_thrpt', 'realtime_rx_thrpt', 'realtime_time',
  'monthly_tx_bytes', 'monthly_rx_bytes', 'monthly_time',
  'data_volume_limit_switch',
  // Version / model
  'hardware_version', 'cr_version', 'wa_inner_version', 'web_version',
  'model_name', 'device_name',
  // 5G NSA (ZTE naming)
  'Z5g_rsrp', 'Z5g_rsrq', 'Z5g_SINR', 'Z5g_snr', 'Z5g_dlEarfcn',
  'Z5g_CELL_ID', 'Z5g_state',
  // 5G NR (SA naming)
  'nr5g_pci', 'nr5g_action_band', 'nr5g_action_channel', 'nr5g_cell_id',
  'nr_rsrp', 'nr_sinr',
  // Lock state READ (not write)
  'nr5g_sa_band_lock', 'lte_band_lock', 'wan_lte_band_lock',
  'pcimode', 'lock_band',
]);

/** ZTE — أوامر مصادقة/تسجيل دخول — تُرفض دائمًا في Discovery */
const ZTE_AUTH_CMDS: ReadonlySet<string> = new Set(['RD', 'LD']);

/** Huawei — Authentication/token endpoints — always DENY in Discovery */
const HUAWEI_AUTH_ENDPOINTS: ReadonlyArray<RegExp> = [
  /^\/api\/webserver\/SesTokInfo$/,
  /^\/api\/webserver\/token$/,
  /^\/api\/user\/state-login$/,
];

/** Huawei — مسارات GET معروفة بأنها قراءة فقط (بدون auth endpoints) */
const HUAWEI_SAFE_GET: ReadonlyArray<RegExp> = [
  /^\/api\/device\/information$/,
  /^\/api\/device\/basic_information$/,
  /^\/api\/device\/signal$/,
  /^\/api\/device\/seccellinfo$/,
  /^\/api\/device\/nbrcellinfo$/,
  /^\/api\/monitoring\/status$/,
  /^\/api\/monitoring\/traffic-statistics$/,
  /^\/api\/monitoring\/month_statistics$/,
  /^\/api\/monitoring\/start_date$/,
  /^\/api\/net\/current-plmn$/,
  /^\/api\/net\/net-mode$/,
  /^\/api\/net\/net-mode-list$/,
  /^\/api\/net\/net-feature-switch$/,
  /^\/api\/net\/lock-freq$/,
  /^\/api\/wlan\/host-list$/,
  /^\/api\/wlan\/multi-macfilter-settings$/,
  /^\/api\/dhcp\/settings$/,
  /^\/api\/dialup\/profiles$/,
];

/** صفحات Discovery الأساسية — HTML فقط */
const SAFE_DISCOVERY_PATHS: ReadonlyArray<RegExp> = [
  /^\/$/,
  /^\/index\.html$/,
  /^\/home\.html$/,
  /^\/html\/index\.html$/,
  /^\/html\/home\.html$/,
  /^\/login$/,
  /^\/login\.html$/,
  /^\/favicon\.ico$/,
  /^\/robots\.txt$/,
];

/** مقاطع path خطرة (مطابقة كاملة بعد تجريد الامتداد) */
const DANGEROUS_SEGMENT_NAMES: ReadonlySet<string> = new Set([
  'reboot', 'restart', 'reset', 'factory', 'factory_reset', 'factory-reset',
  'restore', 'write', 'save', 'apply', 'delete', 'remove', 'update',
  'send', 'send_sms', 'sendsms', 'lock', 'unlock', 'set', 'config',
  'configure', 'format',
]);

/** بادئة مقاطع خطرة (مثل reboot_، write_، set_) */
const DANGEROUS_SEGMENT_PREFIX_RE = /^(reboot|restart|reset|factory|restore|write|save|apply|delete|remove|update|send|set|format)_/i;

/** قيم query خطرة (أي key) */
const DANGEROUS_ACTION_VALUES: ReadonlySet<string> = new Set([
  'reboot', 'restart', 'reset', 'factory', 'factory_reset', 'factory-reset',
  'restore', 'write', 'save', 'apply', 'delete', 'remove', 'update', 'set',
  'format',
]);

/** مفاتيح query التي قيمتها تحتاج فحصًا */
const DANGEROUS_QUERY_ACTION_KEYS: ReadonlySet<string> = new Set([
  'action', 'op', 'oper', 'operation', 'mode', 'do', 'task',
  'command', 'cmd', 'goformid', 'goform',
]);

/** بادئة أوامر كتابة (ZTE/Huawei) — أي value يبدأ بـ SET_/WRITE_/... |
 *  يُرفض */
const DANGEROUS_CMD_PREFIX_RE = /^(SET|WRITE|DELETE|REBOOT|RESET|REMOVE|UPDATE|FACTORY|RESTART|FORMAT)_/i;

/** ZTE endpoints */
const ZTE_WRITE_PATH_RE = /^\/goform\/goform_set_cmd_process$/i;
const ZTE_READ_PATH_RE = /^\/goform\/goform_get_cmd_process$/i;

/** LuCI root (صفحة عامة) — تُسمح كصفحة discovery */
const LUCI_ROOT_RE = /^\/cgi-bin\/luci\/?$/i;

/** مصادر ثابتة (JS/CSS/source-map) — قراءة فقط */
const STATIC_RESOURCE_RE = /^\/[\w.\-]+\/([\w.\-]+\/)*[\w.\-]+\.(js|js\.map|css)$/i;

// ═══════════════════════════════════════════════════════════════════════
// Result helpers
// ═══════════════════════════════════════════════════════════════════════

function allow(code: PolicyCode, rule: string, reason: string): PolicyResult {
  return { decision: 'ALLOW', code, reason, rule };
}
function deny(code: PolicyCode, rule: string, reason: string): PolicyResult {
  return { decision: 'DENY', code, reason, rule };
}
function confirm(code: PolicyCode, rule: string, reason: string): PolicyResult {
  return { decision: 'REQUIRE_USER_CONFIRMATION', code, reason, rule };
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * يفكّ encoding آمنًا — مرة أو مرتين (double-encoding محتمل).
 * يرجع النص الأصلي عند الفشل — لا يرمي.
 */
function safeDecode(s: string): string {
  if (!s) return s;
  if (!s.includes('%')) return s;
  try {
    const once = decodeURIComponent(s);
    if (!once.includes('%')) return once;
    try {
      return decodeURIComponent(once);
    } catch {
      return once;
    }
  } catch {
    return s;
  }
}

/** يستخرج اسم الـ segment بدون امتداد (reboot.cgi → reboot) */
function stripExtension(seg: string): string {
  return seg.replace(/\.[a-z0-9]{1,8}$/i, '');
}

/** هل مقطع المسار خطر؟ */
function isDangerousSegment(seg: string): boolean {
  const lower = safeDecode(seg).toLowerCase();
  const stripped = stripExtension(lower);
  if (DANGEROUS_SEGMENT_NAMES.has(stripped)) return true;
  if (DANGEROUS_SEGMENT_PREFIX_RE.test(stripped)) return true;
  return false;
}

/** هل هذا الزوج (key, value) خطر؟ */
function isDangerousQueryPair(key: string, value: string): boolean {
  const k = safeDecode(key).toLowerCase().trim();
  const v = safeDecode(value).toLowerCase().trim();

  // قيمة خطرة صريحة (أي مفتاح)
  if (DANGEROUS_ACTION_VALUES.has(v)) return true;
  // بادئة أمر كتابة (SET_* / WRITE_* / ...)
  if (DANGEROUS_CMD_PREFIX_RE.test(v)) return true;

  // مفتاح خطري + قيمة إضافية خطرة (مثل action=... التي قد لا تكون في القائمة)
  if (DANGEROUS_QUERY_ACTION_KEYS.has(k)) {
    if (v === 'login' || v === 'logout' || v === 'signin' || v === 'signout') {
      return true;
    }
  }

  // المفتاح نفسه فعل كتابة (نادر، لكن احتياط)
  if (DANGEROUS_ACTION_VALUES.has(k)) return true;

  return false;
}

/** استخراج أوامر ZTE من query (تدعم cmd=a,b,c و cmd متعدد) */
function getZteCommands(url: URL): string[] {
  const cmds: string[] = [];
  for (const [k, raw] of url.searchParams.entries()) {
    if (k.toLowerCase() !== 'cmd') continue;
    for (const c of raw.split(',')) {
      const t = c.trim();
      if (t) cmds.push(t);
    }
  }
  return cmds;
}

// ═══════════════════════════════════════════════════════════════════════
// Main policy
// ═══════════════════════════════════════════════════════════════════════

/**
 * يفحص طلب Discovery ويقرر مصيره.
 * ترتيب الفحص:
 *   1. URL validity
 *   2. Host (LAN-only)
 *   3. Method (GET فقط)
 *   4. Path traversal
 *   5. Auth context
 *   6. Dangerous query
 *   7. Dangerous segments
 *   8. ZTE write → DENY
 *   9. ZTE read → cmd check
 *  10. Huawei safe whitelist
 *  11. Huawei unknown /api → DENY
 *  12. Safe discovery pages
 *  13. LuCI
 *  14. Default DENY
 */
export function evaluatePolicy(input: PolicyInput): PolicyResult {
  // ── 1. URL validity
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return deny('INVALID_URL', 'url.parse', 'URL is not parseable');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return deny('INVALID_URL', 'url.protocol', 'Only http/https allowed');
  }

  // ── 2. Host validation (SSRF)
  if (!isLanHost(url.hostname)) {
    return deny('UNSAFE_HOST', 'host.not-lan', 'Host is not a LAN address');
  }
  // userinfo in URL = suspicious
  if (url.username || url.password) {
    return deny('UNSAFE_HOST', 'url.userinfo', 'URL contains userinfo');
  }

  // ── 3. Method validation
  const method = input.method.trim().toUpperCase();
  if (method !== 'GET') {
    return deny(
      'NON_GET_METHOD',
      'method.not-get',
      'Only GET is allowed in Discovery',
    );
  }

  // ── 4. Path traversal
  // WHATWG URL parser normalizes '..' away from url.pathname, so we
  // inspect the RAW path portion of input.url (including URL-encoded
  // variants like %2e%2e) before the normalization hid them.
  const rawPathMatch = input.url.match(/^https?:\/\/[^/?#]+([^?#]*)/i);
  const rawPath = rawPathMatch ? rawPathMatch[1] : '';
  const decodedRawPath = safeDecode(rawPath);
  if (decodedRawPath.includes('..') || url.pathname.includes('..')) {
    return deny('PATH_TRAVERSAL', 'path.traversal', 'Path contains ".."');
  }

  // ── 5. Auth context
  if (input.context?.hasAuth === true) {
    return confirm(
      'AUTH_CONTEXT',
      'context.has-auth',
      'Request carries auth context',
    );
  }

  // ── 5.5. Huawei auth/token endpoints — always DENY in Discovery
  for (const re of HUAWEI_AUTH_ENDPOINTS) {
    if (re.test(url.pathname)) {
      return deny(
        'AUTH_ENDPOINT',
        'huawei.auth.endpoint',
        'Huawei auth/token endpoint is forbidden in Discovery',
      );
    }
  }

  // ── 5.6. cmd/command/goformId query outside ZTE read endpoint → DENY
  let hasCmdParam = false;
  for (const [k] of url.searchParams.entries()) {
    const lk = k.toLowerCase();
    if (lk === 'cmd' || lk === 'command' || lk === 'goformid') {
      hasCmdParam = true;
      break;
    }
  }
  if (hasCmdParam && !ZTE_READ_PATH_RE.test(url.pathname)) {
    return deny(
      'UNKNOWN_ENDPOINT',
      'query.cmd-outside-zte',
      'Command query parameter outside ZTE read endpoint',
    );
  }

  // ── 6. Dangerous query (per-pair)
  for (const [k, v] of url.searchParams.entries()) {
    if (isDangerousQueryPair(k, v)) {
      return deny(
        'DANGEROUS_QUERY',
        'query.dangerous',
        `Query parameter "${k}" contains dangerous value`,
      );
    }
  }

  // ── 7. Dangerous path segments
  const segments = url.pathname.split('/').filter(Boolean);
  for (const seg of segments) {
    if (isDangerousSegment(seg)) {
      return deny(
        'DANGEROUS_PATH',
        'path.segment.dangerous',
        `Path segment "${seg}" is dangerous`,
      );
    }
  }

  // ── 8. ZTE write endpoint
  if (ZTE_WRITE_PATH_RE.test(url.pathname)) {
    return deny(
      'WRITE_GOFORM',
      'zte.goform.write',
      'ZTE set_cmd_process is a write endpoint',
    );
  }

  // ── 9. ZTE read endpoint — cmd whitelist
  if (ZTE_READ_PATH_RE.test(url.pathname)) {
    const cmds = getZteCommands(url);
    if (cmds.length === 0) {
      return deny(
        'UNKNOWN_ZTE_CMD',
        'zte.cmd.empty',
        'ZTE get_cmd_process requires a cmd parameter',
      );
    }
    for (const c of cmds) {
      if (ZTE_AUTH_CMDS.has(c)) {
        return deny(
          'AUTH_ENDPOINT',
          'zte.auth.cmd',
          `ZTE auth command "${c}" is forbidden in Discovery`,
        );
      }
      if (!ZTE_READ_CMDS.has(c)) {
        return deny(
          'UNKNOWN_ZTE_CMD',
          'zte.cmd.unknown',
          `ZTE cmd "${c}" is not in read-only whitelist`,
        );
      }
    }
    return allow(
      'SAFE_READ',
      'zte.cmd.read-only',
      'All ZTE commands are read-only',
    );
  }

  // ── 10. Huawei safe whitelist
  for (const re of HUAWEI_SAFE_GET) {
    if (re.test(url.pathname)) {
      return allow(
        'SAFE_READ',
        'huawei.whitelist',
        'Huawei GET endpoint is in read-only whitelist',
      );
    }
  }

  // ── 11. Huawei unknown /api/*
  if (url.pathname.toLowerCase().startsWith('/api/')) {
    return deny(
      'UNKNOWN_ENDPOINT',
      'huawei.unknown',
      'Unknown Huawei /api/* endpoint — not in whitelist',
    );
  }

  // ── 12. Safe discovery pages
  for (const re of SAFE_DISCOVERY_PATHS) {
    if (re.test(url.pathname)) {
      return allow(
        'SAFE_DISCOVERY_PAGE',
        'discovery.page',
        'Static discovery page',
      );
    }
  }

  // ── 12.5. Static resources (JS/CSS/source-map)
  if (STATIC_RESOURCE_RE.test(url.pathname)) {
    return allow(
      'SAFE_READ',
      'discovery.static-resource',
      'Static JS/CSS/source-map resource',
    );
  }

  // ── 13. LuCI
  if (url.pathname.toLowerCase().startsWith('/cgi-bin/luci')) {
    if (LUCI_ROOT_RE.test(url.pathname)) {
      return allow(
        'SAFE_DISCOVERY_PAGE',
        'luci.root',
        'LuCI root page',
      );
    }
    return confirm(
      'UNKNOWN_ENDPOINT',
      'luci.unknown',
      'LuCI endpoint — action not verified',
    );
  }

  // ── 14. Default: deny
  return deny(
    'UNKNOWN_ENDPOINT',
    'default.unknown',
    'Endpoint is not in allowlist',
  );
}
