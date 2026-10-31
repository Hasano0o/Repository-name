/**
 * FiberHome — الفيرموير الجديد (LG6851F، /fh_api/): تحويل ردود الراوتر لأشكال التطبيق.
 * كل دالة هنا من صفحة الراوتر نفسها (ملف AUTH من عضو، ٣١ أكتوبر — /src/content/pages/*.js):
 *   carrierAggregation.js · device.js · trafficStat.js · smsInbox.js · configManage.js · ipv4Settings.js · antennaSet.js · simInfo.js
 * بدون react-native — تنختبر في Node.
 */
import type { Carrier, ConnectedDevice, SmsMessage, ApnProfile, DnsConfig, AntennaInfo } from '../types';

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v: unknown): number | undefined => {
  const m = str(v).match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
};
export const listOf = (r: any): any[] => (Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : []);

/* ═══ الدمج (carrierAggregation.js) ═══
 * PCC = الأساسي (4G في NSA) · PCC2 = أساسي الـ 5G (في NSA يجي مع الـ4G) · SCC×4 = الثانويات (State "activated").
 * الصفحة تعرض النص كما هو؛ نطلّع التقنية من Type/Band (NR/5G/n78) والرقم من Band.
 */
export interface FhCellRaw { Type?: string; State?: string; Band?: string; Pci?: string; Arfcn?: string; DlBandWidth?: string; RSRP?: string; RSRQ?: string; SINR?: string }
const techOf = (c: FhCellRaw): 'LTE' | 'NR' => (/\bNR\b|5G|^n\d|NR5G/i.test(`${str(c.Type)} ${str(c.Band)}`) ? 'NR' : 'LTE');
const bandOf = (c: FhCellRaw) => { const m = str(c.Band).match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : undefined; };
/** عرض القناة بالميقا — الصفحة تعرض النص كما هو ("20MHz" أو "100") — نقبل بين 1.4 و 400 بس */
const bwOf = (v: unknown) => { const n = num(v); return n !== undefined && n >= 1.4 && n <= 400 ? n : undefined; };
const neg = (v: unknown) => { const n = num(v); return n !== undefined && n < 0 && n > -160 ? n : undefined; };

function carrierOf(c: FhCellRaw, role: 'PCC' | 'SCC'): Carrier | null {
  const band = bandOf(c);
  if (!band) return null;
  return {
    tech: techOf(c), band, role,
    arfcn: str(c.Arfcn) || undefined, pci: str(c.Pci) || undefined,
    bandwidth: bwOf(c.DlBandWidth), rsrp: neg(c.RSRP), rsrq: neg(c.RSRQ), sinr: num(c.SINR),
  };
}

export function carriersFromCA(pcc: FhCellRaw | null, pcc2: FhCellRaw | null, scc: FhCellRaw[]): Carrier[] {
  const out: Carrier[] = [];
  const active = (c: FhCellRaw | null) => !!c && /PCC/i.test(str(c.Type));
  if (active(pcc)) { const x = carrierOf(pcc!, 'PCC'); if (x) out.push(x); }
  // أساسي الـ5G في NSA: الأساسي عندنا هو الـ4G، فالـ5G ينعرض ثانوي (مثل باقي الدرايفرات)
  if (active(pcc2)) { const x = carrierOf(pcc2!, out.length ? 'SCC' : 'PCC'); if (x) out.push(x); }
  for (const c of scc) {
    if (str(c.State) !== 'activated') continue;
    const x = carrierOf(c, out.length ? 'SCC' : 'PCC');
    if (x) out.push(x);
  }
  return out;
}

/* ═══ الأجهزة (device.js + global_var.js hostObj) ═══
 * InternetAccess: الصفحة «مسموح» لو < 2 · الحظر = "2" · الاسم DevName (اللي سمّاه المستخدم) وإلا HostName.
 */
export interface FhHost { child_node_idx?: string; HostName?: string; DevName?: string; MACAddress?: string; IPAddress?: string; Active?: string; InternetAccess?: string }
const macOf = (v: unknown) => str(v).toUpperCase();
const ipv4 = (v: unknown) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(str(v)) && str(v) !== '0.0.0.0' ? str(v) : undefined);
const nameOf = (h: FhHost) => str(h.DevName) || str(h.HostName) || undefined;
export const hostBlocked = (h: FhHost) => Number(str(h.InternetAccess)) >= 2;
export function devicesFrom(hosts: FhHost[]): ConnectedDevice[] {
  return hosts.filter(h => str(h.Active) === '1' && macOf(h.MACAddress))
    .map(h => ({ mac: macOf(h.MACAddress), ip: ipv4(h.IPAddress), name: nameOf(h), blocked: hostBlocked(h) }));
}
export function blockedFrom(hosts: FhHost[]): ConnectedDevice[] {
  return hosts.filter(h => hostBlocked(h) && macOf(h.MACAddress))
    .map(h => ({ mac: macOf(h.MACAddress), ip: ipv4(h.IPAddress), name: nameOf(h), blocked: true }));
}

/* ═══ الرسائل (smsInbox.js — get_sms_data) ═══
 * الرد: {<مفتاح>: {session_phone, message_itemN: {rcvorsend:"recv"|"send", msg_content, time, childnode, isOpened}}}
 * المعرّف عندنا "recv:<childnode>" / "send:<childnode>" — الحذف يحتاج أي قائمة (x_SMS_recv_msg_obj / x_SMS_send_msg_obj).
 */
export function smsFrom(data: unknown, box: 'inbox' | 'sent' = 'inbox'): SmsMessage[] {
  const want = box === 'sent' ? 'send' : 'recv';
  const out: SmsMessage[] = [];
  if (!data || typeof data !== 'object') return out;
  for (const s of Object.values(data as Record<string, any>)) {
    if (!s || typeof s !== 'object') continue;
    const phone = str(s.session_phone);
    for (const [k, m] of Object.entries(s)) {
      if (!k.includes('message_item') || !m || typeof m !== 'object') continue;
      const mm = m as Record<string, unknown>;
      if (str(mm.rcvorsend) !== want || !str(mm.msg_content) || !str(mm.childnode)) continue;
      out.push({ index: `${want}:${str(mm.childnode)}`, phone, content: str(mm.msg_content), date: str(mm.time), unread: want === 'recv' && str(mm.isOpened) === '0' });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
export function smsRef(index: string): { box: 'recv' | 'send'; idx: string } | null {
  const m = String(index ?? '').match(/^(recv|send):(\d+)$/);
  return m ? { box: m[1] as 'recv' | 'send', idx: m[2] } : null;
}
/** send_msg: GSM_UCS2 لو فيه حرف ≥ 1000 (العربي) — نفس الصفحة */
export const smsSchema = (text: string) => ([...text].some(c => c.charCodeAt(0) >= 1000) ? 'GSM_UCS2' : 'GSM_8BIT');

/* ═══ APN (configManage.js) ═══
 * AuthenticationType: 0 بدون · 1 PAP · 2 CHAP · 3 PAP/CHAP — نفس قيم التطبيق (0/1/2). الملف ١ = الافتراضي (الصفحة تعرضه بدون تعديل).
 * الكلمة ما نقرأها.
 */
export interface FhApn { child_node_idx?: string; ProfileName?: string; Enable?: string; AuthenticationType?: string; APN?: string; UserName?: string }
export function apnsFrom(rows: FhApn[]): ApnProfile[] {
  return rows.filter(r => str(r.child_node_idx)).map(r => ({
    index: str(r.child_node_idx), name: str(r.ProfileName) || str(r.APN), apn: str(r.APN),
    username: str(r.UserName) || undefined, authMode: str(r.AuthenticationType) || '0',
    current: str(r.Enable) === '1', readOnly: str(r.child_node_idx) === '1',
  }));
}

/* ═══ DNS (ipv4Settings.js) ═══
 * DNSConfigType (DNSManualEnable) "1" يدوي · DNSServers "a,b" — والتلقائي = عنوان الراوتر نفسه.
 * الصفحة تعرض النوع بس لبعض المشغّلين (COMMON… و SA_STC) — غيرهم ما نكتب.
 */
export const DNS_OPERATORS = /^(COMMON|COMMON_INTL|COMMON_EUR|COMMON_NA|SA_STC|KEN_SARAFI)$/;
export function dnsFrom(type: unknown, servers: unknown): DnsConfig {
  const manual = str(type) === '1';
  const [a, b] = str(servers).split(',').map(x => x.trim());
  return manual ? { manual: true, primary: a || undefined, secondary: b || undefined } : { manual: false };
}

/* ═══ الأنتنا (antennaSet.js) ═══
 * AntennaOutterSwitch 0 داخلية / 1 خارجية · AntennaOutterType (LG6851F بس): 0 تلقائي · 1 N41 · 2 N78/N77
 * الوضع عندنا رقم واحد: 0 داخلية · 10 خارجية تلقائي · 11 خارجية N41 · 12 خارجية N78/N77
 */
export const FH_ANTENNA_OPTIONS = [
  { v: 0, label: 'داخلية', sub: 'بدون أنتنا خارجية' },
  { v: 10, label: 'خارجية', sub: 'تلقائي' },
  { v: 11, label: 'خارجية', sub: 'n41 بس' },
  { v: 12, label: 'خارجية', sub: 'n78/n77 بس' },
];
export function antennaFrom(sw: unknown, type: unknown, withType: boolean): AntennaInfo {
  const s = str(sw), t = str(type);
  const mode = s === '0' ? 0 : s === '1' ? (withType && /^[0-2]$/.test(t) ? 10 + Number(t) : 10) : undefined;
  return {
    mode, canSet: s === '0' || s === '1',
    raw: [['AntennaOutterSwitch', s], ...(withType ? [['AntennaOutterType', t] as [string, string]] : [])],
    options: withType ? FH_ANTENNA_OPTIONS : FH_ANTENNA_OPTIONS.slice(0, 2),
  };
}
export function antennaValues(mode: number, withType: boolean): { sw: string; type?: string } | null {
  if (mode === 0) return { sw: '0' };
  if (mode === 10) return withType ? { sw: '1', type: '0' } : { sw: '1' };
  if (withType && (mode === 11 || mode === 12)) return { sw: '1', type: String(mode - 10) };
  return null;
}
