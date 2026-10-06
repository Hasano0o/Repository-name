/**
 * قراءة ملصق الراوتر: رمز QR للواي فاي، أو سطور النص المقروءة بالكاميرا.
 * كل شي يصير على الجوال — ما نرسل أي شي للسيرفر.
 */
import { isLanHost } from './host';

export interface WifiCreds {
  ssid: string;
  password: string;
  /** WPA / WEP / nopass */
  security?: string;
}

export interface LabelData {
  host?: string;
  username?: string;
  /** كلمة سر صفحة الإدارة */
  adminPassword?: string;
  wifi?: Partial<WifiCreds>;
}

// ─── رمز QR للواي فاي: WIFI:T:WPA;S:<اسم>;P:<كلمة>;H:false;; ───

/** يقسم على ; مع احترام الهروب \; */
function splitEscaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
    if (c === sep) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

export function parseWifiQr(data: string): WifiCreds | null {
  const raw = (data ?? '').trim();
  if (!/^WIFI:/i.test(raw)) return null;
  const fields: Record<string, string> = {};
  for (const part of splitEscaped(raw.slice(5), ';')) {
    const i = part.indexOf(':');
    if (i > 0) fields[part.slice(0, i).toUpperCase()] = part.slice(i + 1);
  }
  if (!fields.S) return null;
  return { ssid: fields.S, password: fields.P ?? '', security: fields.T || 'WPA' };
}

const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');

/** نص QR يصوّره الضيف بكاميرا جواله ويتصل مباشرة */
export function wifiQrText(w: WifiCreds): string {
  const t = !w.password ? 'nopass' : (w.security || 'WPA');
  return `WIFI:T:${t};S:${esc(w.ssid)};${w.password ? `P:${esc(w.password)};` : ''};`;
}

// ─── قراءة نص الملصق ───

/** نشيل الرموز اللي تلصق بالقيمة: «: ： = -» والمسافات */
const clean = (v: string) => v.replace(/^[\s:：=\-–>|]+/, '').replace(/[\s|]+$/, '').trim();

type Kind = 'ssid' | 'wifiKey' | 'user' | 'adminPw' | 'host';

/** الترتيب مهم: الأخص أول (WLAN Key قبل Password العامة) */
const LABELS: { kind: Kind; re: RegExp }[] = [
  { kind: 'ssid', re: /^(?:wi-?fi\s*name|wlan\s*name|ssid(?:\s*\(?(?:2\.4|5)\s*g(?:hz)?\)?)?|network\s*name|wireless\s*name|اسم\s*(?:الشبكة|الواي\s*فاي))/i },
  { kind: 'wifiKey', re: /^(?:wlan\s*key|wi-?fi\s*(?:key|password|pass(?:word)?|pwd)|wireless\s*(?:key|password)|wpa2?\s*(?:key|psk)?|network\s*key|key|كلمة\s*(?:مرور|سر)\s*(?:الواي\s*فاي|الشبكة))/i },
  { kind: 'user', re: /^(?:user\s*name|username|user|login\s*name|اسم\s*المستخدم)/i },
  { kind: 'adminPw', re: /^(?:admin\s*(?:password|pass|pwd|key)|login\s*(?:password|pwd)|web\s*(?:password|pwd)|management\s*password|device\s*password|password|pwd|كلمة\s*(?:مرور|سر)(?:\s*الإدارة)?)/i },
  { kind: 'host', re: /^(?:ip(?:\s*address)?|web\s*(?:address|ui|management)|login\s*address|management\s*address|default\s*(?:ip|gateway)|gateway|عنوان)/i },
];

const IP_RE = /\b((?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3})\b/;

/** «Password: admin  Username: admin» في سطر واحد — نقسمه */
function splitPairs(line: string): string[] {
  const parts = line.split(/\s{2,}|\s*\|\s*|\t/).map(x => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [line];
}

export function parseLabelText(lines: string[]): LabelData {
  const out: LabelData = {};
  const flat = lines.flatMap(splitPairs).map(l => l.trim()).filter(Boolean);
  const set = (kind: Kind, v: string) => {
    v = clean(v);
    if (!v || v.length > 64) return;
    if (kind === 'host') {
      const m = v.match(IP_RE);
      if (m && !out.host) out.host = m[1];
      return;
    }
    if (kind === 'ssid') { out.wifi = { ...out.wifi }; if (!out.wifi.ssid) out.wifi.ssid = v; return; }
    if (kind === 'wifiKey') { out.wifi = { ...out.wifi }; if (!out.wifi.password) out.wifi.password = v.replace(/\s+/g, ''); return; }
    if (kind === 'user') { if (!out.username) out.username = v.split(/\s+/)[0]; return; }
    if (kind === 'adminPw') { if (!out.adminPassword) out.adminPassword = v.split(/\s+/)[0]; }
  };

  for (let i = 0; i < flat.length; i++) {
    const line = flat[i];
    // عنوان الراوتر في أي سطر (http://192.168.8.1 ...)
    const ip = line.match(IP_RE);
    if (ip && !out.host && isLanHost(ip[1])) out.host = ip[1];

    for (const { kind, re } of LABELS) {
      const m = line.match(re);
      if (!m) continue;
      const rest = clean(line.slice(m[0].length));
      // التسمية لحالها في سطر — القيمة في السطر اللي بعده
      if (rest) set(kind, rest);
      else if (i + 1 < flat.length && !LABELS.some(l => l.re.test(flat[i + 1]))) set(kind, flat[i + 1]);
      break;
    }
  }
  return out;
}

/** كم معلومة طلعت — عشان نقول للمستخدم إذا القراءة ما نفعت */
export function labelCount(d: LabelData): number {
  return [d.host, d.username, d.adminPassword, d.wifi?.ssid, d.wifi?.password].filter(Boolean).length;
}
