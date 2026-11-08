/**
 * جيب M2A-77 (MiFi، فيرموير M2A_77_EU — ليبيا ٨ نوفمبر) — قراءة الردود. بدون react-native (ينختبر).
 * من صفحاته نفسها: debug.html (cmd 100 = معلومات الشبكة) · bandSelect.html (181/182) · js/devicemanagement.js (215).
 */
import type { Signal, ConnectedDevice } from '../types';

/** 2147483647 = «ما فيه قيمة» عندهم (debug.html: if (res.rsrp !== 2147483647)) */
const INVALID = 2147483647;
export function val(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n !== INVALID ? n : undefined;
}
const str = (v: unknown) => { const n = val(v); return n === undefined ? (typeof v === 'string' && v && !/2147483647/.test(v) ? v : undefined) : String(n); };

/** رقم التردد من «3» / «B3» / «LTE BAND 3» / «n78» */
export function bandNo(v: unknown): number | undefined {
  const m = String(v ?? '').match(/(\d{1,3})/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n < 300 ? n : undefined;
}

/** cmd 100 ← الإشارة. internet_conn == 3 = 5G (ss_rsrp / ss_sinr)، غيره 4G (rsrp / sinr) */
export function m2aSignal(r: any): Signal {
  const nr = Number(r?.internet_conn) === 3;
  const b = bandNo(r?.band);
  if (nr) {
    return {
      network: '5G', nrBand: b ? `n${b}` : undefined, nrArfcn: str(r?.earfcn), nrPci: str(r?.pci),
      nrRsrp: val(r?.ss_rsrp), nrSinr: val(r?.ss_sinr), cellId: str(r?.cellid), nrActiveFromStatus: true,
    };
  }
  return {
    network: val(r?.rsrp) !== undefined ? '4G' : undefined, band: b ? `B${b}` : undefined,
    earfcn: str(r?.earfcn), pci: str(r?.pci), cellId: str(r?.cellid),
    rsrp: val(r?.rsrp), sinr: val(r?.sinr),
  };
}

/** cmd 215 ← conn_dev [{mac, ipv, name, iface, forbid}] (forbid == 1 = محظور) */
export function m2aDevices(r: any): ConnectedDevice[] {
  const list: any[] = Array.isArray(r?.conn_dev) ? r.conn_dev : [];
  const out: ConnectedDevice[] = [];
  for (const d of list) {
    const mac = String(d?.mac ?? '').toUpperCase();
    if (!/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/.test(mac)) continue;
    out.push({ mac, ip: String(d?.ipv ?? d?.ip ?? '') || undefined, name: String(d?.name ?? '') || undefined, blocked: Number(d?.forbid) === 1 });
  }
  return out;
}

/** cmd 181 ← {LTE:{support:[اسم…], enable:[0|1…]}, NR:{…}} ← أرقام المدعوم والمفعّل */
export function m2aBands(group: any): { supported: number[]; enabled: number[] } {
  const sup: unknown[] = Array.isArray(group?.support) ? group.support : [];
  const en: unknown[] = Array.isArray(group?.enable) ? group.enable : [];
  const supported: number[] = [], enabled: number[] = [];
  sup.forEach((s, i) => {
    const n = bandNo(s);
    if (n === undefined) return;
    supported.push(n);
    if (Number(en[i]) === 1) enabled.push(n);
  });
  return { supported, enabled };
}

/** قائمة enable جديدة بنفس ترتيب support — bands فاضي = الكل */
export function enableList(group: any, bands: number[]): number[] {
  const sup: unknown[] = Array.isArray(group?.support) ? group.support : [];
  return sup.map(s => { const n = bandNo(s); return n !== undefined && (bands.length === 0 || bands.includes(n)) ? 1 : 0; });
}

// ═══ Base64 بـ UTF-8 — نفس base64.js في صفحتهم (نص الرسائل عربي) ═══
const K = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function b64enc(s: string): string {
  const b = Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));
  let o = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    o += K[(n >> 18) & 63] + K[(n >> 12) & 63] + (i + 1 < b.length ? K[(n >> 6) & 63] : '=') + (i + 2 < b.length ? K[n & 63] : '=');
  }
  return o;
}
export function b64dec(s: string): string {
  const clean = String(s ?? '').replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (K.indexOf(clean[i]) << 18) | (K.indexOf(clean[i + 1]) << 12) | ((K.indexOf(clean[i + 2] ?? 'A') & 63) << 6) | (K.indexOf(clean[i + 3] ?? 'A') & 63);
    bytes.push((n >> 16) & 255);
    if (clean[i + 2] !== undefined) bytes.push((n >> 8) & 255);
    if (clean[i + 3] !== undefined) bytes.push(n & 255);
  }
  try { return decodeURIComponent(escape(String.fromCharCode(...bytes))); } catch { return String.fromCharCode(...bytes); }
}

/** cmd 210 ← sms_rev [{_id, phonenumber, time, txt(base64), type, read}] · type 1 = واردة · 2 = مرسلة · 5 = فشل الإرسال */
export function m2aSms(r: any, box: 'inbox' | 'sent') {
  const list: any[] = Array.isArray(r?.sms_rev) ? r.sms_rev : [];
  return list
    .filter(m => box === 'inbox' ? Number(m?.type) === 1 : Number(m?.type) === 2 || Number(m?.type) === 5)
    .map(m => ({ index: String(m?._id ?? ''), phone: String(m?.phonenumber ?? ''), content: b64dec(m?.txt), date: String(m?.time ?? ''), unread: Number(m?.read) === 0 }))
    .filter(m => m.index !== '');
}

/** وضع الشبكة — قائمة select#networkselection في mobileconnection.html (3G وحده معلّق عندهم) */
export const M2A_MODES = [
  { value: '0', label: '5G/4G/3G (تلقائي)' },
  { value: '1', label: '4G/3G' },
  { value: '4', label: '5G بس' },
  { value: '5', label: '4G بس' },
];
