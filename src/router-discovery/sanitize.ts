/**
 * Sanitization — PHASE 3
 * Moved from src/utils/probe.ts (PHASE 1b) to break circular imports
 * between probe.ts and safeRequest.ts.
 */

export const MASK = '«محذوف»';

const SAFE_FIELD_NAMES = /^(rsrp|rsrq|rssi|sinr|snr|cqi|mcs|tx_?power|txpower|rank|streams|dl_?mcs|ul_?mcs|dl_?streams|pci|earfcn|arfcn|nr_?arfcn|nrarfcn|cell_?id|cellid|enodeb|enodeb_?id|enb_?id|gnb_?id|tac|band|nr_?band|lte_?band|band_?width|bandwidth|dl_?bandwidth|ul_?bandwidth|bw|freq|frequency|channel|mcc|mnc|plmn|network_?type|net_?type|signalbar|signal_?bar|signal_?icon|signal_?strength|signal_?level|network_?provider|operator|sim_?state|sim_?status|connection_?status|ppp_?status|modem_?state|modem_?main_?state|ca_?state|ca_?band|scell|pcell|ngbr|network_?mode|nr5g_?state|z5g_?state)$/i;

const SENSITIVE_FIELD_NAMES = new RegExp(
  [
    'pass(?!enger)', 'pwd', 'passwd', 'password',
    'pin', 'puk',
    'secret', 'apikey', 'api_?key',
    'token', 'access_?token', 'refresh_?token', 'auth_?token',
    'nonce', 'proof', 'salt', 'challenge',
    'session',
    'cookie', 'authorization', 'bearer',
    'credential',
    '\\bkey\\b',
    'imei', 'imeisv', 'imsi', 'iccid', 'meid', 'esn',
    'msisdn',
    'serial_?number', 'serial_?no', 'serialnum', '\\bserial\\b',
    'device_?serial',
    '\\bsn\\b',
    'udid', 'device_?id',
    'ssid',
    'wifi_?name', 'wifiname',
    'wlan_?name', 'wlanname',
    'network_?name',
    'host_?name', 'hostname',
    'actual_?name', 'actualname',
    'device_?name', 'devicename',
    'router_?name', 'routername',
    'wan_?name',
    'apn_?name', 'apnname', 'apn_?profile_?name',
    'profile_?name', 'profilename',
    'user_?name', 'username', 'login_?user',
    'apn_?user', 'ppp_?user',
    '\\bname\\b',
    'phone_?number', 'mobile_?number', 'sim_?number',
    'phone', 'mobile',
    'email', 'mail',
    'mac_?addr', 'macaddr', 'hwaddr', '\\bmac\\b',
    'sms_?content', 'message_?content', 'text_?content',
    'sms_?text',
  ].join('|'),
  'i',
);

const WIFI_NAME_LIKE = /^(wifi|wlan|ssid)(_?\d+)?(_?[0-9a-z]+)?$/i;

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

function looksLikeIMEI(v: string): boolean {
  return /^\d{15}$/.test(v) && luhnValid(v);
}
function looksLikeICCID(v: string): boolean {
  if (!/^\d{18,22}$/.test(v)) return false;
  if (!v.startsWith('89')) return false;
  return luhnValid(v);
}
function looksLikeMAC(v: string): boolean {
  return /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(v);
}
function looksLikeToken(v: string): boolean {
  return /^[A-Za-z0-9+/]{40,}={0,2}$/.test(v);
}

function fieldDecision(name: string): boolean | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  if (SAFE_FIELD_NAMES.test(n)) return false;
  if (SENSITIVE_FIELD_NAMES.test(n)) return true;
  if (WIFI_NAME_LIKE.test(n)) return true;
  return undefined;
}

function maskValue(value: string): string {
  if (looksLikeMAC(value)) return MASK;
  if (looksLikeIMEI(value)) return MASK;
  if (looksLikeICCID(value)) return MASK;
  if (looksLikeToken(value)) return MASK;
  return value;
}

export function sanitizeField(key: string, value: string): string {
  const d = fieldDecision(key);
  if (d === false) return value;
  if (d === true) return MASK;
  return maskValue(value);
}

export function sanitize(raw: string): string {
  if (!raw) return raw;
  let t = raw;
  t = t.replace(/<([A-Za-z_][\w.\-]*)>([^<]{1,4000})<\/\1>/g, (m, tag, val) => {
    const d = fieldDecision(String(tag));
    if (d === false) return m;
    if (d === true) return '<' + tag + '>' + MASK + '</' + tag + '>';
    const masked = maskValue(String(val));
    return masked === val ? m : '<' + tag + '>' + masked + '</' + tag + '>';
  });
  t = t.replace(/"([\w.\-]+)"\s*:\s*"([^"]{0,4000})"/g, (m, k, val) => {
    const d = fieldDecision(String(k));
    if (d === false) return m;
    if (d === true) return '"' + k + '":"' + MASK + '"';
    const masked = maskValue(String(val));
    return masked === val ? m : '"' + k + '":"' + masked + '"';
  });
  t = t.replace(/([\w.\-]{2,40})\s*[:=]\s*(["']?)([^\s;,&"'<>]{1,400})\2/g,
    (m, k, _q, val) => {
      const d = fieldDecision(String(k));
      if (d === false) return m;
      if (d === true) return k + '=' + MASK;
      const masked = maskValue(String(val));
      return masked === val ? m : k + '=' + masked;
    });
  t = t.replace(/\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, MASK);
  t = t.replace(/\b(SessionID|Set-Cookie|stok)\s*[=:]\s*[^\s;"'&<]+/gi,
    (_m, name) => name + '=' + MASK);
  t = t.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, MASK);
  t = t.replace(/\b(\d{14,22})\b/g, (m) => {
    if (looksLikeIMEI(m) || looksLikeICCID(m)) return MASK;
    return m;
  });
  return t;
}
