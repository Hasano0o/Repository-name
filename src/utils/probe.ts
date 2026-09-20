// وضع الاستكشاف: يبصم أي راوتر ويطلع تقرير منظّف من أي بيانات حساسة.

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
      title: sanitize(titleOf(body)).slice(0, 120), size: body.length, sample: sanitize(body).slice(0, 2500),
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

export interface Harvest { scripts: string[]; cmds: string[]; goforms: string[] }

const EXTRA_SCRIPTS = [
  '/js/app.js', '/js/main.js', '/js/config/config.js', '/js/index.js',
  '/js/lib/app.js', '/js/common.js', '/js/status.js', '/js/lang/lang_ar.js',
];

/** يسحب ملفات الواجهة ويستخرج منها أسماء الأوامر الحقيقية */
export async function harvestCommands(
  host: string,
  onStep?: (done: number, total: number, label: string) => void,
  timeoutMs = 12000,
): Promise<Harvest> {
  const base = host.startsWith('http') ? host.replace(/\/+$/, '') : 'http://' + host.replace(/\/+$/, '');

  const grab = async (url: string): Promise<string> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { credentials: 'include', signal: ctrl.signal, headers: { Referer: base + '/' } });
      if (!res.ok) return '';
      return (await res.text()).slice(0, 1500000);
    } catch { return ''; } finally { clearTimeout(timer); }
  };

  const home = await grab(base + '/');
  const srcs = new Set<string>();
  for (const m of home.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.js[^"']*)["']/gi)) srcs.add(m[1]);
  for (const m of home.matchAll(/["']([\w./-]+\.js)(?:\?[^"']*)?["']/g)) srcs.add(m[1]);
  for (const e of EXTRA_SCRIPTS) srcs.add(e);

  const urls = [...srcs]
    .map(s => (s.startsWith('http') ? s : base + (s.startsWith('/') ? '' : '/') + s.replace(/^\.\//, '')))
    .filter(u => u.startsWith(base))
    .slice(0, 16);

  const cmds = new Set<string>();
  const goforms = new Set<string>();
  const okScripts: string[] = [];

  const scan = (txt: string) => {
    for (const m of txt.matchAll(/cmd\s*[=:]\s*["']?([A-Za-z0-9_,]{3,400})/g))
      for (const c of m[1].split(',')) { const k = c.trim(); if (k.length > 2) cmds.add(k); }
    for (const m of txt.matchAll(/goformId\s*[=:]\s*["']([A-Za-z0-9_]{3,60})["']/g)) goforms.add(m[1]);
  };

  scan(home);
  for (let i = 0; i < urls.length; i++) {
    onStep?.(i + 1, urls.length + 1, urls[i].replace(base, ''));
    const txt = await grab(urls[i]);
    if (!txt) continue;
    okScripts.push(urls[i].replace(base, '') + ' (' + txt.length + ')');
    scan(txt);
  }
  onStep?.(urls.length + 1, urls.length + 1, 'تم');

  const junk = /^(true|false|null|undefined|function|return|isTest|multi_data)$/i;
  return {
    scripts: okScripts,
    cmds: [...cmds].filter(c => !junk.test(c)).sort(),
    goforms: [...goforms].sort(),
  };
}

/** يرشّح الأوامر اللي لها علاقة بالإشارة والترددات */
export function signalish(cmds: string[]): string[] {
  const re = /(rsrp|rsrq|rssi|sinr|snr|band|pci|cell|earfcn|arfcn|freq|nr5g|z5g|5g|lte|ngbr|ca_|lock|signal|network)/i;
  return cmds.filter(c => re.test(c));
}
