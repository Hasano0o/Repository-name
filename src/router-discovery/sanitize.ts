/**
 * Sanitization — PHASE 5G (Hardening)
 *
 * المبادئ:
 *   1. normalizeFieldName → يطابق camelCase / kebab / snake بنفس القاعدة.
 *   2. SAFE exact match (radio/network) — أعلى أولوية.
 *   3. SAFE structured patterns.
 *   4. SENSITIVE exact / structured match.
 *   5. SENSITIVE substring فقط لمجموعة محدودة جدًا (بدون 'name').
 *   6. value-based masking (MAC، Luhn IMEI/ICCID، base64 طويل).
 *
 * لا oversanitization:
 *   - لا قاعدة رقمية عامة.
 *   - 'name' ليس substring حساسًا (فقط exact 'name' أو 'hostname'/'devicename'...).
 *   - `pass` يُعالج بـ structured rule (prefix + suffix whitelist).
 *
 * لا dependency، لا شبكة، لا تخزين.
 */

export const MASK = '«محذوف»';

// ═══════════════════════════════════════════════════════════════════════
// Normalization
// ═══════════════════════════════════════════════════════════════════════

/** يزيل كل ما ليس [a-z0-9] ويصغّر الحروف. */
function normalizeFieldName(name: string): string {
  if (typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ═══════════════════════════════════════════════════════════════════════
// SAFE — قيم القياس/الشبكة/المعلومات — لا تُمس أبدًا
// ═══════════════════════════════════════════════════════════════════════

const SAFE_EXACT = new Set<string>([
  // Signal
  'rsrp', 'rsrq', 'rssi', 'sinr', 'snr', 'cqi',
  'lterrsrp', 'lterrsrq', 'lterrssi', 'ltesnr', 'ltesinr',
  'nrrrsrp', 'nrrrsrq', 'nrrsinr',
  'z5grsrp', 'z5grsrq', 'z5gsinr', 'z5gsnr',
  'nr5grsrp', 'nr5grsrq', 'nr5gsinr',
  // Link
  'mcs', 'dlmcs', 'ulmcs', 'txpower', 'rank', 'streams', 'dlstreams',
  // Cell
  'pci', 'ltpci', 'ltepci', 'nrpci', 'nr5gpci',
  'earfcn', 'arfcn', 'nrarfcn', 'lteearfcn',
  'cellid', 'ltecellid', 'nr5gcellid', 'nr5g sacellid',
  'enodebid', 'enbid', 'gnbid',
  'tac',
  // Band / freq
  'band', 'nrband', 'lteband', 'wanactiveband', 'nr5gactionband',
  'bandwidth', 'dlbandwidth', 'ulbandwidth', 'bw',
  'freq', 'frequency', 'channel', 'nr5gactionchannel',
  'ltecappcellband', 'ltecappcellbandwidth', 'ltecappcellfreq',
  'ltecascellband', 'ltecascellbandwidth', 'wanlteca',
  'ltemulticascellinfo', 'ltecascellinfo',
  'scell', 'pcell', 'ngbr',
  // PLMN / Network
  'mcc', 'mnc', 'plmn',
  'networktype', 'networkmode', 'nettype',
  'signalbar', 'signalicon', 'signalstrength', 'signallevel',
  'networkprovider', 'operator',
  'simstate', 'simstatus',
  'connectionstatus', 'pppstatus',
  'modemstate', 'modemmainstate',
  'nr5gstate', 'z5gstate',
  // Identity (radio-only, non-sensitive)
  'model', 'modelname',
  'vendor', 'manufacturer', 'brand',
  'softwareversion', 'hardwareversion', 'firmware',
]);

// كلمات SAFE كـ substring (لأنها كلمات مركبة قد تحتوي prefixes)
const SAFE_PATTERNS: readonly RegExp[] = [
  // Radio prefixes — يجب أن يُتبع بـ suffix رقمي/شرطة أو نهاية الكلمة (لا يُلتصق بـ 'name'/'ssid')
  /^(lte|nr|nr5g|z5g|wan|signal|network|sim|modem|ca|cell|band|freq|pci|arfcn|earfcn)(rsrp|rsrq|rssi|sinr|snr|cqi|pci|band|freq|channel|type|mode|state|status|bar|icon|provider|mcc|mnc|carrier|earfcn|arfcn|bandwidth|bw|id)/,
  // Suffix radio
  /(rsrp|rsrq|rssi|sinr|snr|cqi)$/,
  /^(dl|ul)(bw|mcs|bandwidth|streams)$/,
];

function isSafe(norm: string): boolean {
  if (!norm) return false;
  if (SAFE_EXACT.has(norm)) return true;
  for (const re of SAFE_PATTERNS) {
    if (re.test(norm)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// SENSITIVE — exact / structured (بدون substring عشوائي)
// ═══════════════════════════════════════════════════════════════════════

const SENSITIVE_EXACT = new Set<string>([
  // Credentials
  'password', 'passwd', 'passcode', 'pwd',
  'pin', 'puk',
  'secret', 'apikey', 'privatekey',
  'token', 'authtoken', 'accesstoken', 'refreshtoken', 'authToken',
  'session', 'sessionid', 'sessiontoken',
  'cookie', 'authorization', 'bearer', 'credential',
  // Identifiers
  'imei', 'imeisv', 'imsi', 'iccid', 'meid', 'esn',
  'serial', 'serialnumber', 'serialno', 'deviceserial',
  'sn', 'udid',
  'mac', 'macaddr', 'macaddress', 'hwaddr', 'physaddr',
  // Network names / identifiers
  'ssid', 'wifissid', 'wlanssid', 'ssidname',
  'wifiname', 'wlanname', 'networkname',
  'hostname', 'actualname',
  'devicename', 'routername', 'wanname',
  'profilename',
  // Generic standalone 'name' — exact only (لا substring عام)
  'name',
  // Personal
  'username', 'user', 'login', 'loginuser',
  'userpassword', 'adminpassword',
  'phone', 'phonenumber', 'mobile', 'mobilenumber', 'msisdn', 'userphone', 'simnumber',
  'email', 'emailaddress',
  // Messages
  'smscontent', 'messagecontent', 'textcontent', 'smstext',
  // WAN identifiers
  'wanipaddr', 'staticwanipaddr', 'wanapn', 'apnname', 'apnuser', 'pppuser',
]);

/**
 * بعض الكلمات الحساسة كـ substring — محدودة جدًا:
 *   - prefix محدد (لا general 'name').
 *   - نحن نستخدمها فقط لكلمات مركبة متوقعة مثل: userPassword → contains 'password'.
 *     ومع ذلك نضعها في exact list.
 *
 * → عمليًا: بدون substring عام.
 */

/**
 * يُعيد true إذا كان الاسم يحتوي على كلمة SENSITIVE exact
 * كجزء من normalized name + يستوفي شرط الحدود.
 *
 * المنطق:
 *   - نطابق الاسم الكامل (exact).
 *   - أو نطابق كلمة داخلية (split على حدود الكلمات الأصلية قبل normalization).
 */

/**
 * قاعدة pass بمنطق structured:
 *   - يبدأ بـ pass أو pwd وليس من الكلمات المسموحة (passenger/passive/compass/bypass).
 *   - أو ينتهي بـ password / passwd / pwd.
 */
const PASS_ALLOWED = new Set(['passenger', 'passive', 'compass', 'bypass', 'passthrough']);

function isSensitivePassLike(raw: string, norm: string): boolean {
  const lower = raw.toLowerCase();
  if (PASS_ALLOWED.has(norm)) return false;
  // starts with pass/pwd (but not passenger etc.)
  if (/^pass/.test(lower)) {
    // extract first token up to next separator
    const firstToken = lower.split(/[^a-z0-9]/)[0];
    if (PASS_ALLOWED.has(firstToken)) return false;
    return true;
  }
  if (/^pwd/.test(lower)) return true;
  // ends with password/passwd/pwd/passcode
  if (/(password|passwd|passcode|pwd)$/i.test(lower)) return true;
  return false;
}

/**
 * أنماط حساسة محددة جدًا — لتفادي oversanitization.
 * - ssidN / ssid_X → ssid + لاحقة
 * - wifiXXXXX / wlanXXXXX → wifi/wlan + شيء (لكن SAFE أولًا)
 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /^ssid\d*$/,
  /^ssid(\d|_|[a-z])+$/,
  /^wifi\w*$/,
  /^wlan\w*$/,
];

function isSensitiveField(raw: string): boolean {
  const norm = normalizeFieldName(raw);
  if (!norm) return false;
  if (SENSITIVE_EXACT.has(norm)) return true;
  if (isSensitivePassLike(raw, norm)) return true;
  for (const re of SENSITIVE_PATTERNS) {
    if (re.test(norm)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// Value-based masking (Luhn + MAC + base64)
// ═══════════════════════════════════════════════════════════════════════

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

function maskValue(value: string): string {
  if (looksLikeMAC(value)) return MASK;
  if (looksLikeIMEI(value)) return MASK;
  if (looksLikeICCID(value)) return MASK;
  if (looksLikeToken(value)) return MASK;
  return value;
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

export function sanitizeField(key: string, value: string): string {
  if (isSafe(normalizeFieldName(key))) return value;
  if (isSensitiveField(key)) return MASK;
  return maskValue(value);
}

export function sanitize(raw: string): string {
  if (!raw) return raw;
  let t = raw;

  // 1. XML: <tag>value</tag>
  t = t.replace(/<([A-Za-z_][\w.\-]*)>([^<]{1,4000})<\/\1>/g, (m, tag, val) => {
    const v = String(val);
    if (isSafe(normalizeFieldName(String(tag)))) return m;
    if (isSensitiveField(String(tag))) return '<' + tag + '>' + MASK + '</' + tag + '>';
    const masked = maskValue(v);
    return masked === v ? m : '<' + tag + '>' + masked + '</' + tag + '>';
  });

  // 2. JSON: "key":"value"
  t = t.replace(/"([\w.\-]+)"\s*:\s*"([^"]{0,4000})"/g, (m, k, val) => {
    const v = String(val);
    if (isSafe(normalizeFieldName(String(k)))) return m;
    if (isSensitiveField(String(k))) return '"' + k + '":"' + MASK + '"';
    const masked = maskValue(v);
    return masked === v ? m : '"' + k + '":"' + masked + '"';
  });

  // 3. key=value / key: value
  t = t.replace(
    /([\w.\-]{2,40})\s*[:=]\s*(["']?)([^\s;,&"'<>]{1,400})\2/g,
    (m, k, _q, val) => {
      const v = String(val);
      if (isSafe(normalizeFieldName(String(k)))) return m;
      if (isSensitiveField(String(k))) return k + '=' + MASK;
      const masked = maskValue(v);
      return masked === v ? m : k + '=' + masked;
    },
  );

  // 4. Standalone patterns
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
