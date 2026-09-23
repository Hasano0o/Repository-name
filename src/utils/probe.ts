// وضع الاستكشاف: يبصم أي راوتر ويطلع تقرير منظّف من أي بيانات حساسة.

import { isLanHost } from './host';
import { saveDiscovery, fingerprintFrom, guessApiStyle } from '../store/discovery';

export interface ProbeStep {
  label: string; path: string; status: number | 'ERR'; ms: number;
  type: string; title: string; size: number; sample: string;
}
export interface ProbeReport {
  schema: 1; at: string; guess: string; hints: string[]; steps: ProbeStep[];
}
interface Target { label: string; path: string; brand?: string; match?: RegExp }

const TARGETS: Target[] = [
  { label: 'الصفحة الرئيسية', path: '/' },
  { label: 'هواوي — جلسة', path: '/api/webserver/SesTokInfo', brand: 'huawei', match: /SesInfo|TokInfo/i },
  { label: 'هواوي — معلومات', path: '/api/device/basic_information', brand: 'huawei', match: /devicename|classify/i },
  { label: 'ZTE — حالة', path: '/goform/goform_get_cmd_process?isTest=false&cmd=modem_main_state,network_type,signalbar', brand: 'zte', match: /modem_main_state|network_type/i },
  { label: 'ZTE — إشارة', path: '/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=rssi,rsrp,rsrq,lte_snr,lte_band,lte_pci,cell_id,Z5g_rsrp,Z5g_SINR,Z5g_dlEarfcn,nr5g_pci,nr5g_action_band,ngbr_cell_info,wan_active_band', brand: 'zte', match: /rsrp|Z5g/i },
  { label: 'ZTE — إصدار', path: '/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=cr_version,wa_inner_version,web_version', brand: 'zte', match: /version/i },
  { label: 'OpenWrt — LuCI', path: '/cgi-bin/luci/', brand: 'openwrt', match: /luci|openwrt/i },
  { label: 'OpenWrt — ubus', path: '/ubus', brand: 'openwrt', match: /jsonrpc|ubus/i },
  { label: 'MikroTik — webfig', path: '/webfig/', brand: 'mikrotik', match: /mikrotik|routeros|webfig/i },
  { label: 'MikroTik — REST', path: '/rest/system/resource', brand: 'mikrotik', match: /routeros|version/i },
  { label: 'TP-Link', path: '/cgi-bin/luci/;stok=/login', brand: 'tplink', match: /tp-link|tplink|stok/i },
  { label: 'Nokia/Alcatel', path: '/cgi-bin/index.html', brand: 'nokia', match: /nokia|alcatel/i },
  { label: 'عام — status.json', path: '/status.json' },
  { label: 'عام — api/status', path: '/api/status' },
];

const SENSITIVE =
  /(tok|ses|nonce|proof|salt|challenge|ssid|wlan|wifi|pass|pwd|passwd|token|cookie|session|secret|key|auth|imei|imsi|iccid|meid|msisdn|phone|number|sn\b|serial|ssid|wifi_?name|mac|username|user_?name|login|apn_?user|pin|puk|content|message|sms)/i;
const MASK = '«محذوف»';

export function sanitizeField(key: string, value: string): string {
  if (SENSITIVE.test(key)) return MASK;
  return sanitize(value);
}

export function sanitize(raw: string): string {
  let t = raw;
  t = t.replace(/<([A-Za-z_][\w.\-]*)>([^<]{1,4000})<\/\1>/g, (m, tag) =>
    SENSITIVE.test(tag) ? '<' + tag + '>' + MASK + '</' + tag + '>' : m);
  t = t.replace(/"([\w.\-]+)"\s*:\s*"([^"]{0,4000})"/g, (m, k) =>
    SENSITIVE.test(k) ? '"' + k + '":"' + MASK + '"' : m);
  t = t.replace(/([\w.\-]{2,40})\s*[:=]\s*(["']?)([^\s;,&"'<>]{1,400})\2/g,
    (m, k) => (SENSITIVE.test(k) ? k + '=' + MASK : m));
  t = t.replace(/\b[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}\b/g, MASK);
  t = t.replace(/\b[0-9A-Fa-f]{12}\b/g, MASK);
  t = t.replace(/\+?\d[\d\s\-()]{8,16}\d/g, MASK);
  t = t.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, MASK);
  t = t.replace(/\b\d{10,}\b/g, MASK);
  t = t.replace(/(SessionID|Set-Cookie|stok)\s*[=:]\s*[^\s;"'&<]+/gi, '$1=' + MASK);
  return t;
}

function titleOf(body: string): string {
  const m = body.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

async function one(host: string, t: Target, timeoutMs: number): Promise<ProbeStep> {
  const base = host.startsWith('http') ? host.replace(/\/+$/, '') : 'http://' + host.replace(/\/+$/, '');
  const url = base + t.path;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET', credentials: 'include', signal: ctrl.signal,
      headers: { Referer: base + '/', 'X-Requested-With': 'XMLHttpRequest' },
    });
    const body = await res.text();
    return {
      label: t.label, path: t.path, status: res.status, ms: Date.now() - started,
      type: (res.headers.get('content-type') || '').split(';')[0],
      title: sanitize(titleOf(body)).slice(0, 120), size: body.length,
      sample: sanitize(body).slice(0, 2500),
    };
  } catch {
    return { label: t.label, path: t.path, status: 'ERR', ms: Date.now() - started, type: '', title: '', size: 0, sample: '' };
  } finally { clearTimeout(timer); }
}

export async function runProbe(
  host: string,
  onStep?: (done: number, total: number, label: string) => void,
  timeoutMs = 6000,
): Promise<ProbeReport> {
  // ═══ حماية SSRF: نتأكد أن host محلي ═══
  if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي');
  const steps: ProbeStep[] = [];
  const score: Record<string, number> = {};
  const hints: string[] = [];
  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    onStep?.(i, TARGETS.length, t.label);
    const st = await one(host, t, timeoutMs);
    steps.push(st);
    if (typeof st.status === 'number' && st.status < 400 && st.size > 0) {
      const hay = st.sample + ' ' + st.title;
      if (t.brand && (!t.match || t.match.test(hay))) score[t.brand] = (score[t.brand] || 0) + 2;
      for (const [b, re] of [
        ['huawei', /huawei|brovi|hilink/i], ['zte', /zte|\bmu5\d{3}\b/i],
        ['openwrt', /openwrt|luci/i], ['mikrotik', /mikrotik|routeros/i],
        ['tplink', /tp-?link/i], ['nokia', /nokia|alcatel/i],
      ] as const) if (re.test(hay)) score[b] = (score[b] || 0) + 1;
    }
  }
  onStep?.(TARGETS.length, TARGETS.length, 'تم');
  const alive = steps.filter(s => typeof s.status === 'number' && s.status < 400 && s.size > 0);
  if (alive.length === 0) hints.push('ما رد أي عنوان — تأكد إنك متصل بشبكة الراوتر وإن العنوان صحيح.');
  if (steps.some(s => s.status === 401 || s.status === 403)) hints.push('بعض العناوين تحتاج تسجيل دخول — التقرير ناقص شوي لكنه مفيد.');
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return { schema: 1, at: new Date().toISOString(), guess: best ? best[0] : 'غير معروف', hints, steps };
}

export function reportText(r: ProbeReport, model: string, notes: string): string {
  const head = [
    '=== تقرير استكشاف راوتر ===',
    'الوقت: ' + r.at,
    'الموديل (من العميل): ' + (model || '—'),
    'التخمين: ' + r.guess,
    'ملاحظات: ' + (notes || '—'),
    ...r.hints.map(h => '! ' + h),
    '',
  ].join('\n');
  const body = r.steps.map(s => [
    '--- ' + s.label + ' [' + s.path + ']',
    'status=' + s.status + '  ms=' + s.ms + '  type=' + s.type + '  size=' + s.size + (s.title ? '  title=' + s.title : ''),
    s.sample ? s.sample : '(لا يوجد رد)',
    '',
  ].join('\n')).join('\n');
  return head + body;
}

export const ZTE_CANDIDATES: string[] = [
  'rssi','rsrp','rsrq','sinr','snr','lte_rsrp','lte_rsrq','lte_snr','lte_sinr','lte_rssi',
  'lte_pci','pci','cell_id','lte_cell_id','enodeb_id','lte_band','band','wan_active_band',
  'wan_active_channel','lte_freq','lte_earfcn','wan_lte_ca','lte_ca_pcell_band',
  'lte_ca_pcell_bandwidth','lte_ca_pcell_freq','lte_ca_scell_band','lte_ca_scell_bandwidth',
  'lte_multi_ca_scell_info','lte_ca_scell_info','ngbr_cell_info','network_type',
  'network_provider','network_provider_fullname','signalbar','rmcc','rmnc','ppp_status',
  'modem_main_state','sim_card_state','wan_ipaddr','static_wan_ipaddr','wan_apn',
  'realtime_tx_bytes','realtime_rx_bytes','realtime_tx_thrpt','realtime_rx_thrpt','realtime_time',
  'monthly_tx_bytes','monthly_rx_bytes','monthly_time','data_volume_limit_switch',
  'hardware_version','cr_version','wa_inner_version','web_version','model_name','device_name',
  'Z5g_rsrp','Z5g_rsrq','Z5g_SINR','Z5g_snr','Z5g_dlEarfcn','Z5g_CELL_ID','Z5g_state',
  'nr5g_pci','nr5g_action_band','nr5g_action_channel','nr5g_cell_id','nr_rsrp','nr_sinr',
  'nr5g_sa_band_lock','lte_band_lock','wan_lte_band_lock','pcimode','lock_band','RD','AD',
];

export interface FieldHit { key: string; value: string }

export async function probeFields(
  read: (fields: string[]) => Promise<Record<string, string>>,
  candidates: string[] = ZTE_CANDIDATES,
  chunk = 20,
  onStep?: (done: number, total: number) => void,
): Promise<FieldHit[]> {
  const hits: FieldHit[] = [];
  for (let i = 0; i < candidates.length; i += chunk) {
    const part = candidates.slice(i, i + chunk);
    onStep?.(Math.min(i + chunk, candidates.length), candidates.length);
    try {
      const r = await read(part);
      for (const k of part) {
        const v = r[k];
        if (v !== undefined && v !== '' && v !== 'null') {
          hits.push({ key: k, value: sanitizeField(k, String(v)).slice(0, 160) });
        }
      }
    } catch {}
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────────
// أدوات مساعدة داخلية
// ─────────────────────────────────────────────────────────────────

function resolveUrl(base: string, path: string): string | null {
  if (!path) return null;
  const p = path.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('//')) return 'http:' + p;
  if (p.startsWith('/')) return base + p;
  return base + '/' + p.replace(/^\.\//, '');
}

async function fetchText(url: string, refererBase: string, timeoutMs: number): Promise<string> {
  // ═══ حماية: نرفض أي URL خارج الشبكة المحلية ═══
  try {
    const u = new URL(url);
    if (!isLanHost(u.host)) return '';
  } catch { return ''; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      credentials: 'include',
      signal: ctrl.signal,
      headers: { Referer: refererBase + '/' },
    });
    if (!res.ok) return '';
    return (await res.text()).slice(0, 1500000);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function extractScriptUrls(home: string): string[] {
  const urls = new Set<string>();
  for (const m of home.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.js[^"']*)["']/gi)) urls.add(m[1]);
  for (const m of home.matchAll(/["']([\w./-]+\.js)(?:\?[^"']*)?["']/g)) urls.add(m[1]);
  return [...urls];
}

/**
 * يلتقط أسماء الأوامر من نص JS/HTML مهما كانت صيغتها:
 *   cmd=foo,bar   |   cmd:"foo"   |   "cmd":"foo"   |   data:{cmd:"foo"}
 *   cmd:["foo","bar"]   |   cmd=["foo","bar"]
 *   goformId="LOGIN"    |   "goformId":"LOGIN"
 */
function scanCommands(txt: string, cmds: Set<string>, goforms: Set<string>): void {
  // cmd: [ "a", "b" ]
  for (const m of txt.matchAll(/["']?cmd["']?\s*[=:]\s*\[([^\]]{1,4000})\]/g)) {
    for (const s of m[1].matchAll(/["']([A-Za-z0-9_\-:]{3,80})["']/g)) cmds.add(s[1]);
  }
  // cmd=foo أو cmd:"foo" — مع استثناء لو جاي بعده قوس مربع
  for (const m of txt.matchAll(/["']?cmd["']?\s*[=:]\s*(?!\[)["']?([A-Za-z0-9_\-:]{3,80}(?:\s*,\s*[A-Za-z0-9_\-:]{3,80})*)/g)) {
    for (const c of m[1].split(',')) {
      const k = c.trim();
      if (k.length > 2) cmds.add(k);
    }
  }
  // goformId
  for (const m of txt.matchAll(/["']?goformId["']?\s*[=:]\s*["']([A-Za-z0-9_]{3,80})["']/g)) {
    goforms.add(m[1]);
  }
}

// ─────────────────────────────────────────────────────────────────
// حصاد السلاسل من JS — تصنيف
// ─────────────────────────────────────────────────────────────────

export interface HarvestStrings {
  signal: string[];
  paths: string[];
  commands: string[];
}

const SIGNAL_KEY_RE =
  /(rsrp|rsrq|rssi|sinr|snr|pci|cell_?id|enodeb|earfcn|arfcn|\bband\b|bandwidth|\bbw\b|freq|mcc|mnc|network|nr5g|z5g|lte|ngbr|ca_|scell|pcell|signal|lock_band|band_lock)/i;
const COMMAND_KEY_RE = /^[A-Z][A-Z0-9_]{2,60}$/;

/**
 * يستخرج كل السلاسل النصية من ملف JS ويصنّفها:
 *   signal  — أسماء حقول لها علاقة بالإشارة (rsrp/pci/band...)
 *   paths   — مسارات داخلية (/api/... , /goform/... ) أو روابط
 *   commands — أوامر بأسلوب ALL_CAPS (LOGIN, BAND_SELECT...)
 */
export function harvestStrings(js: string): HarvestStrings {
  const signal = new Set<string>();
  const paths = new Set<string>();
  const commands = new Set<string>();
  for (const m of js.matchAll(/["']([^"'\\\n\r]{3,200})["']/g)) {
    const s = m[1];
    if (s.length > 80) continue;
    if (/^\/[A-Za-z0-9_\-./?=&%:]{2,200}$/.test(s) || /^https?:\/\//i.test(s)) {
      paths.add(s);
      continue;
    }
    if (COMMAND_KEY_RE.test(s)) {
      commands.add(s);
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9_]{2,60}$/.test(s) && SIGNAL_KEY_RE.test(s)) {
      signal.add(s);
    }
  }
  return {
    signal: [...signal].sort(),
    paths: [...paths].sort(),
    commands: [...commands].sort(),
  };
}

// ─────────────────────────────────────────────────────────────────
// حصاد webpack chunks + source maps
// ─────────────────────────────────────────────────────────────────

export interface WebpackWalk {
  chunkUrls: string[];
  contents: string[];
}

/**
 * يلتقط روابط webpack chunks من ملف JS رئيسي بدون تشغيل أي كود، بناءً على:
 *   1) كل نص ينتهي بـ .js داخل الملف
 *   2) import("./...") الديناميكي
 *   3) __webpack_require__.u = "prefix" + n + ".js" → نولّد أرقام 0..15
 *   4) chunk map {"0":"hexhash", ...} → نطبّق نفس prefix/suffix
 *   5) webpackChunk.push([...]) — احتياطي
 * ثم يجلب محتوى كل chunk (بسقف 12) ويرجعه للفحص.
 */
export async function walkWebpackChunks(
  mainJs: string,
  host: string,
  timeoutMs = 12000,
): Promise<WebpackWalk> {
  const base = host.startsWith('http') ? host.replace(/\/+$/, '') : 'http://' + host.replace(/\/+$/, '');
  const candidates = new Set<string>();

  for (const m of mainJs.matchAll(/["']([\w./\-]{2,200}\.js)(?:\?[^"']*)?["']/g)) {
    candidates.add(m[1]);
  }
  for (const m of mainJs.matchAll(/import\s*\(\s*["']([^"']{1,200})["']\s*\)/g)) {
    candidates.add(m[1]);
  }

  let prefix = '';
  let suffix = '';
  const uFn = mainJs.match(
    /__webpack_require__\.u\s*=\s*[^;]{0,400}?["']([^"']*?)["']\s*\+\s*[A-Za-z_$][\w$]*\s*\+\s*["']([^"']*?\.js)["']/,
  );
  if (uFn) {
    prefix = uFn[1];
    suffix = uFn[2];
    for (let i = 0; i < 16; i++) candidates.add(prefix + i + suffix);
  }

  if (prefix || suffix) {
    const mapBlock = mainJs.match(
      /\{["']?\d+["']?\s*:\s*["'][A-Za-z0-9_\-]{4,40}["'](?:\s*,\s*["']?\d+["']?\s*:\s*["'][A-Za-z0-9_\-]{4,40}["']){2,}\}/,
    );
    if (mapBlock) {
      for (const m of mapBlock[0].matchAll(/["']([A-Za-z0-9_\-]{4,40})["']/g)) {
        candidates.add(prefix + m[1] + suffix);
      }
    }
  }

  for (const m of mainJs.matchAll(/webpackChunk[^;]{0,400}/g)) {
    for (const s of m[0].matchAll(/["']([\w./\-]{2,200}\.js)["']/g)) candidates.add(s[1]);
  }

  const chunkUrls: string[] = [];
  for (const c of candidates) {
    const u = resolveUrl(base, c);
    if (!u || !u.startsWith(base)) continue;
    if (chunkUrls.includes(u)) continue;
    chunkUrls.push(u);
    if (chunkUrls.length >= 12) break;
  }

  const contents: string[] = [];
  for (const u of chunkUrls) {
    const txt = await fetchText(u, base, timeoutMs);
    if (txt) contents.push(txt);
  }

  return { chunkUrls, contents };
}

/**
 * يحاول جلب source map لملف JS معين (jsUrl + ".map") ويجمع sourcesContent.
 * يرجع null إذا ما كان فيه source map أو تعذّر جلبها.
 */
export async function trySourceMap(jsUrl: string, timeoutMs = 8000): Promise<string | null> {
  if (!jsUrl) return null;
  const url = jsUrl.replace(/\.js(\?.*)?$/i, '.js.map$1');
  if (url === jsUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
    if (!res.ok) return null;
    const txt = await res.text();
    try {
      const j = JSON.parse(txt) as { sourcesContent?: unknown };
      if (!Array.isArray(j.sourcesContent)) return null;
      const parts: string[] = [];
      for (const s of j.sourcesContent) {
        if (typeof s === 'string' && s.length > 0) parts.push(s);
      }
      return parts.join('\n\n');
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────
// الحصاد الأساسي (يبقى كما هو للتوافق مع app/probe.tsx)
// ─────────────────────────────────────────────────────────────────

export interface Harvest { scripts: string[]; cmds: string[]; goforms: string[] }

const EXTRA_SCRIPTS = [
  '/js/app.js', '/js/main.js', '/js/config/config.js', '/js/index.js',
  '/js/lib/app.js', '/js/common.js', '/js/status.js', '/js/lang/lang_ar.js',
  // مسارات Huawei محدّثة (H138 وما بعده)
  '/html/index.html', '/html/home.html',
  '/lib/emui-jquery.js', '/../lib/emui-jquery.js',
  '/core.js', '/base64x.js',
  '/js/jquery.js', '/js/jquery.min.js',
  '/api/device/information', '/api/device/signal',
  '/api/monitoring/status', '/api/monitoring/traffic-statistics',
  '/api/net/current-plmn', '/api/net/net-mode',
  '/api/user/state-login', '/api/webserver/SesTokInfo',
];

/** يسحب ملفات الواجهة ويستخرج منها أسماء الأوامر الحقيقية */
export async function harvestCommands(
  host: string,
  onStep?: (done: number, total: number, label: string) => void,
  timeoutMs = 12000,
): Promise<Harvest> {
  // ═══ حماية SSRF: نتأكد أن host محلي ═══
  if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي');
  const base = host.startsWith('http') ? host.replace(/\/+$/, '') : 'http://' + host.replace(/\/+$/, '');
  const home = await fetchText(base + '/', base, timeoutMs);
  const srcs = extractScriptUrls(home);
  for (const e of EXTRA_SCRIPTS) srcs.push(e);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const s of srcs) {
    const u = resolveUrl(base, s);
    if (!u || !u.startsWith(base) || seen.has(u)) continue;
    seen.add(u);
    urls.push(u);
    if (urls.length >= 16) break;
  }
  const cmds = new Set<string>();
  const goforms = new Set<string>();
  const okScripts: string[] = [];
  scanCommands(home, cmds, goforms);
  for (let i = 0; i < urls.length; i++) {
    onStep?.(i + 1, urls.length + 1, urls[i].replace(base, ''));
    const txt = await fetchText(urls[i], base, timeoutMs);
    if (!txt) continue;
    okScripts.push(urls[i].replace(base, '') + ' (' + txt.length + ')');
    scanCommands(txt, cmds, goforms);
  }
  onStep?.(urls.length + 1, urls.length + 1, 'تم');
  const junk = /^(true|false|null|undefined|function|return|isTest|multi_data)$/i;
  return {
    scripts: okScripts.map(s => sanitize(s)),
    cmds: [...cmds].filter(c => !junk.test(c)).map(c => sanitize(c)).sort(),
    goforms: [...goforms].map(g => sanitize(g)).sort(),
  };
}

/** يرشّح الأوامر اللي لها علاقة بالإشارة والترددات */
export function signalish(cmds: string[]): string[] {
  const re = /(rsrp|rsrq|rssi|sinr|snr|band|pci|cell|earfcn|arfcn|freq|nr5g|z5g|5g|lte|ngbr|ca_|lock|signal|network)/i;
  return cmds.filter(c => re.test(c));
}

// ─────────────────────────────────────────────────────────────────
// الحصاد العميق — يدمج harvestCommands + harvestStrings + walkWebpackChunks + trySourceMap
// ─────────────────────────────────────────────────────────────────

export interface DeepHarvest extends Harvest {
  chunkUrls: string[];
  sourceMaps: string[];
  strings: HarvestStrings;
}

/**
 * حصاد شامل من راوتر محلي:
 *   1) يسحب الصفحة الرئيسية وملفات JS الظاهرة
 *   2) يطبّق harvestStrings على كل ملف (تصنيف سلاسل)
 *   3) يمشي على webpack chunks لكل ملف (walkWebpackChunks)
 *   4) يجرب source maps (trySourceMap)
 *   5) يجمع كل الأوامر (scanCommands) وكل السلاسل في كائن واحد منظّف
 */
export async function deepCommandHarvest(
  host: string,
  onStep?: (done: number, total: number, label: string) => void,
  timeoutMs = 12000,
): Promise<DeepHarvest> {
  // ═══ حماية SSRF: نتأكد أن host محلي ═══
  if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي');
  const base = host.startsWith('http') ? host.replace(/\/+$/, '') : 'http://' + host.replace(/\/+$/, '');
  const cmds = new Set<string>();
  const goforms = new Set<string>();
  const signalSet = new Set<string>();
  const pathSet = new Set<string>();
  const commandSet = new Set<string>();
  const chunkSet = new Set<string>();
  const sourceMaps: string[] = [];
  const scriptLabels: string[] = [];

  const absorb = (txt: string) => {
    scanCommands(txt, cmds, goforms);
    const hs = harvestStrings(txt);
    for (const s of hs.signal) signalSet.add(s);
    for (const s of hs.paths) pathSet.add(s);
    for (const s of hs.commands) commandSet.add(s);
  };

  onStep?.(0, 1, 'جلب الصفحة الرئيسية');
  const home = await fetchText(base + '/', base, timeoutMs);
  absorb(home);
  const srcs = extractScriptUrls(home);
  for (const e of EXTRA_SCRIPTS) srcs.push(e);

  const seen = new Set<string>();
  const scriptUrls: string[] = [];
  for (const s of srcs) {
    const u = resolveUrl(base, s);
    if (!u || !u.startsWith(base) || seen.has(u)) continue;
    seen.add(u);
    scriptUrls.push(u);
    if (scriptUrls.length >= 20) break;
  }

  const total = scriptUrls.length;
  for (let i = 0; i < total; i++) {
    const u = scriptUrls[i];
    onStep?.(i + 1, total + 1, u.replace(base, ''));
    const txt = await fetchText(u, base, timeoutMs);
    if (!txt) continue;
    scriptLabels.push(u.replace(base, '') + ' (' + txt.length + ')');
    absorb(txt);

    const wk = await walkWebpackChunks(txt, base, timeoutMs);
    for (const c of wk.chunkUrls) chunkSet.add(c);
    for (const c of wk.contents) absorb(c);

    const sm = await trySourceMap(u, timeoutMs);
    if (sm) {
      sourceMaps.push(u.replace(base, ''));
      absorb(sm);
    }
  }
  onStep?.(total + 1, total + 1, 'تم');

  // حفظ بصمة الاستكشاف في الذاكرة — أسماء فقط، لا أسرار
  try {
    const discovery = {
      paths: [...pathSet],
      commands: [...cmds],
      goforms: [...goforms],
    };
    const fingerprint = fingerprintFrom(discovery);
    const apiStyle = guessApiStyle(discovery);
    await saveDiscovery({
      host: base,
      fingerprint,
      apiStyle,
      signalFields: [...signalSet],
      commands: [...cmds, ...goforms],
    });
  } catch { /* فشل التخزين لا يكسر الحصاد */ }

  const junk = /^(true|false|null|undefined|function|return|isTest|multi_data)$/i;
  const safe = (s: string) => sanitize(s).slice(0, 200);

  return {
    scripts: scriptLabels.map(safe),
    cmds: [...cmds].filter(c => !junk.test(c)).map(safe).sort(),
    goforms: [...goforms].map(safe).sort(),
    chunkUrls: [...chunkSet].map(safe).slice(0, 60),
    sourceMaps: sourceMaps.map(safe),
    strings: {
      signal: [...signalSet].map(safe).sort(),
      paths: [...pathSet].map(safe).sort(),
      commands: [...commandSet].map(safe).sort(),
    },
  };
}
