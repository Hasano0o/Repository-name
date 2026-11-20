/**
 * TP-Link 4G القديمة (TL-MR100 «300Mbps Wireless N 4G LTE Router» وأخواتها MR6400/MR200) — منطق صافي بدون شبكة.
 * من ملف «مو مدعوم؟» عضو (٢٠ نوفمبر ٢٠٢٦، 192.168.1.1): index.html + lib.js + encrypt.js + tpEncrypt.js + oid_str.js.
 *
 * يختلف عن Archer NX200 (درايفر tplink-gdpr): ما فيه gdprProxy.js، والأوامر بالصيغة القديمة (مو JSON):
 *   "1&1\r\n[LTE_NET_STATUS#2,1,0,0,0,0#0,0,0,0,0,0]0,0\r\n[WAN_LTE_LINK_CFG#2,1,0,0,0,0#0,0,0,0,0,0]1,0\r\n"
 *   الرد: "[2,1,0,0,0,0]0\r\nrfInfoRsrp=-95\r\n…[error]0"
 */
import type { Signal } from '../types';

/** صفحة الدخول القديمة: oid_str.js + encrypt.js + lib.js، بدون gdprProxy/proxy.js (هذيك NX200) */
export function mrIsLoginPage(t: string): boolean {
  return /oid_str\.js/.test(t) && /encrypt\.js/.test(t) && /\blib\.js/.test(t) && !/(gdprProxy|\/proxy)\.js/.test(t);
}

/** INCLUDE_LOGIN_GDPR_ENCRYPT من كود الصفحة — null = ما لقيناه */
export function mrGdprFlag(t: string): boolean | null {
  const m = /INCLUDE_LOGIN_GDPR_ENCRYPT\s*[=:]\s*(!0|!1|true|false|\d)/.exec(t);
  if (!m) return null;
  return m[1] === '!0' || m[1] === 'true' || (/^\d$/.test(m[1]) && m[1] !== '0');
}

/** أنواع الأوامر في lib.js */
export const ACT = { GET: 1, SET: 2, ADD: 3, DEL: 4, GL: 5, GS: 6, OP: 7, CGI: 8 } as const;
export interface MrAct { type: number; oid: string; stack?: string; pstack?: string; attrs?: string[] }

/** جسم الطلب بالصيغة القديمة (مثل $.exe في lib.js) */
export function mrReq(acts: MrAct[]): string {
  const types = acts.map(a => String(a.type)).join('&');
  const blocks = acts.map((a, i) => {
    const at = a.attrs ?? [];
    return `[${a.oid}#${a.stack ?? '0,0,0,0,0,0'}#${a.pstack ?? '0,0,0,0,0,0'}]${i},${at.length}\r\n${at.length ? at.join('\r\n') + '\r\n' : ''}`;
  }).join('');
  return `${types}\r\n${blocks}`;
}

export interface MrBlock { stack: string; idx: number; f: Record<string, string> }
/** الرد: كتل «[stack]رقم» وتحتها key=value · «[error]N» آخر شي */
export function mrParse(text: string): { blocks: MrBlock[]; error: number | null } {
  const blocks: MrBlock[] = [];
  let error: number | null = null;
  let cur: MrBlock | null = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const e = /^\[error\](-?\d+)/.exec(line);
    if (e) { error = Number(e[1]); cur = null; continue; }
    const h = /^\[([\d,]+)\](\d+)\s*$/.exec(line);
    if (h) { cur = { stack: h[1], idx: Number(h[2]), f: {} }; blocks.push(cur); continue; }
    const kv = /^([A-Za-z_][\w.]*)=(.*)$/.exec(line);
    if (kv && cur) cur.f[kv[1]] = kv[2];
  }
  return { blocks, error };
}

/** رد الدخول: «$.ret=0;» (ممكن مشفّر) — null = ما فيه */
export function mrRet(t: string): number | null {
  const m = /\$\.ret\s*=\s*(-?\d+)/.exec(t ?? '');
  return m ? Number(m[1]) : null;
}
export const MR_ERR_PWD = 71233;

/** TokenID من الصفحة بعد الدخول: var token="…" */
export function mrToken(t: string): string | null {
  return /\bvar\s+token\s*=\s*"([^"]+)"/.exec(t ?? '')?.[1] ?? null;
}

const numOf = (v: unknown): number | undefined => {
  const s = String(v ?? '').trim();
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return Number(s);
};

/**
 * الإشارة من LTE_NET_STATUS (+ WAN_LTE_LINK_CFG): أسماء الحقول ما شفناها للحين (صفحة الحالة بعد الدخول) —
 * نطابق بالاسم بدون حساسية (rfInfoRsrp · rsrp · …). القيم الصفر/الفاضية = ما فيه قراءة.
 * SNR في نسخ TP-Link بوحدة ٠٫١ dB (NX200) ← لو أكبر من ٤٠ نقسمه على ١٠.
 */
export function mrSignal(fields: Record<string, string>): Signal {
  const pick = (re: RegExp) => { for (const [k, v] of Object.entries(fields)) if (re.test(k)) { const n = numOf(v); if (n !== undefined) return n; } return undefined; };
  const s: Signal = {};
  const rsrp = pick(/rsrp$/i), rsrq = pick(/rsrq$/i), rssi = pick(/rssi$/i);
  let sinr = pick(/(snr|sinr)$/i);
  if (rsrp !== undefined && rsrp < 0) s.rsrp = rsrp;
  if (rsrq !== undefined && rsrq < 0) s.rsrq = rsrq;
  if (rssi !== undefined && rssi < 0) s.rssi = rssi;
  if (sinr !== undefined && s.rsrp !== undefined) { if (Math.abs(sinr) > 40) sinr = sinr / 10; s.sinr = Math.round(sinr * 10) / 10; }
  const band = pick(/band$/i);
  if (band !== undefined && band > 0 && band < 300) s.band = 'B' + band;
  const ch = pick(/(channel|earfcn)$/i);
  if (ch !== undefined && ch > 0) s.earfcn = String(ch);
  const pci = pick(/pci$/i);
  if (pci !== undefined && pci >= 0 && pci < 1008) s.pci = String(pci);
  const cid = Object.entries(fields).find(([k]) => /cell_?id$/i.test(k))?.[1];
  if (cid && cid !== '0') s.cellId = cid;
  if (s.rsrp !== undefined) s.network = '4G';
  return s;
}

/** اسم الشركة من أي حقل يشبهه (ispName · operatorName · networkName · spn) */
export function mrOperator(fields: Record<string, string>): string | undefined {
  for (const [k, v] of Object.entries(fields)) {
    if (/(isp|operator|network|spn|plmn)_?name$/i.test(k) || /^(isp|spn|operator)$/i.test(k)) {
      const t = String(v ?? '').trim();
      if (t && !/^\d+$/.test(t)) return t;
    }
  }
  return undefined;
}

/** أوامر القراءة اللي يسحبها FULL (كلها ACT_GET بدون حقول = كل الحقول) */
export const MR_READ_OIDS: { oid: string; stacks: string[] }[] = [
  { oid: 'LTE_NET_STATUS', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0', '0,0,0,0,0,0'] },
  { oid: 'WAN_LTE_LINK_CFG', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0'] },
  { oid: 'WAN_LTE_INTF_CFG', stacks: ['2,0,0,0,0,0', '1,0,0,0,0,0'] },
  { oid: 'LTE_BANDINFO', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0', '0,0,0,0,0,0'] },
  { oid: 'LTE_BAND_SEL', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0', '0,0,0,0,0,0'] },
  { oid: 'LTE_SEARCH_BAND', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0', '0,0,0,0,0,0'] },
  { oid: 'LTE_CELL_LOCK', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0', '0,0,0,0,0,0'] },
  { oid: 'LTE_NET_SEL', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0'] },
  { oid: 'LTE_WAN_CFG', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0'] },
  { oid: 'LTE_PROF_STAT', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0'] },
  { oid: 'LTE_PLMN_LOCK', stacks: ['2,1,0,0,0,0', '1,0,0,0,0,0'] },
  { oid: 'LTE_SMS_CONFIG', stacks: ['2,1,0,0,0,0'] },
  { oid: 'IGD_DEV_INFO', stacks: ['0,0,0,0,0,0'] },
];
