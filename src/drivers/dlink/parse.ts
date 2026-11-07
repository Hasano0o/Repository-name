/**
 * D-Link DWR-2000M / DWR-3000M — تحويل ردود /acfun/ لصيغة Bandly (ملف صافي بدون react-native — عليه اختبارات).
 * الحقول من جداول صفحة الراوتر نفسها:
 *   getMobileNetStatusParams ← info.basic {fabricator, productType, imei, imsi, ccid, hardwareVersion, softwareVersion, ledLevel}
 *                              info.rf[] {rsrp, rsrq, rssi, sinr, pcid, cellid, enodebid, earfcn "DL/UL", bandwidth, plmn,
 *                                         CQI, DLMCS, RANK, duplexMode, transmissionMode} + (3000M) frequencyBand, caInfo, caActive
 *   InternetStatus           ← info.MobileNetwork {operators, networkStatus, netType, signalIndicator, ipAddress, imei,
 *                              primary_dns_server, sub_dns_server, connectionTime} · info.systemMode
 *   ConnectedClients         ← info.clients[] {macAddress, ipv4Address, ipv6Address, interfaceName}
 *   getBandLockInfo          ← info {bandLockEnabled, netType, "4G": {allBands: "1,3,…", enabledBand: "…"}, "5G": {…}}
 * الصفحة ما تقول هل السطر 4G أو 5G ← نعرفه من التردد (nXX) أو رقم القناة (NR-ARFCN أكبر من 100000).
 */
import type { Signal, Carrier, CellTower, ConnectedDevice, BandConfig } from '../types';
import { bandOfArfcn } from '../../utils/arfcn';

/** أول رقم في النص («-95dBm» ← -95، «1850/19850» ← 1850). فاضي/غير رقم ← undefined */
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}
const str = (v: unknown) => { const s = String(v ?? '').trim(); return s && s !== '--' && s.toLowerCase() !== 'n/a' ? s : undefined; };

export interface DlRow {
  tech: 'LTE' | 'NR';
  band?: number;
  arfcn?: string;
  pci?: string;
  cellId?: string;
  enodebId?: string;
  bandwidth?: number;
  rsrp?: number; rsrq?: number; rssi?: number; sinr?: number;
  cqi?: number; dlMcs?: number; rank?: number;
  plmn?: string;
  caActive?: boolean;
}

/* حقول الإشارة بأي اسم: «rsrp» · «nrRsrp» · «NR_RSRP» · «ss_rsrp» … — نشيل البادئة والشرطات ونقارن */
const FIELD: Record<string, RegExp> = {
  rsrp: /^rsrp$/, rsrq: /^rsrq$/, rssi: /^rssi$/, sinr: /^(sinr|snr)$/, pci: /^(pcid|pci|physicalcellid)$/,
  cellid: /^(cellid|ci|eci|nci)$/, enodebid: /^(enodebid|enbid|gnodebid|gnbid)$/, arfcn: /^(earfcn|arfcn|nrarfcn|channel|dlearfcn)$/,
  bw: /^(bandwidth|bw|dlbandwidth)$/, cqi: /^cqi$/, mcs: /^(dlmcs|mcs)$/, rank: /^(rank|ri)$/, plmn: /^plmn$/, band: /^(frequencyband|band|nrband|lteband)$/,
};
const NR_PREFIX = /^(nr5g|nr|5g|ss)[_-]?/i;
const LTE_PREFIX = /^(lte|4g)[_-]?/i;
const norm = (k: string) => k.replace(NR_PREFIX, '').replace(LTE_PREFIX, '').replace(/[_\-\s]/g, '').toLowerCase();
const SIG_KEY = /rsrp|sinr|rsrq|pcid|earfcn|arfcn/i;

/** كل الكائنات اللي فيها حقول إشارة (rf[] أول، وبعدها أي مكان ثاني في الرد — عمق ٣) */
function candidates(info: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();
  const walk = (v: any, d: number) => {
    if (!v || typeof v !== 'object' || seen.has(v) || d > 3) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(x => walk(x, d + 1)); return; }
    if (Object.keys(v).some(k => SIG_KEY.test(k) && v[k] !== null && typeof v[k] !== 'object')) out.push(v);
    for (const k of Object.keys(v)) if (v[k] && typeof v[k] === 'object') walk(v[k], d + 1);
  };
  walk(info?.rf, 0);
  for (const k of Object.keys(info ?? {})) if (k !== 'rf' && k !== 'basic') walk(info[k], 0);
  return out;
}

function rowOf(fields: Record<string, unknown>, hintNr: boolean): DlRow | null {
  const g = (f: keyof typeof FIELD) => { const k = Object.keys(fields).find(x => FIELD[f].test(x)); return k === undefined ? undefined : fields[k]; };
  const fb = String(g('band') ?? '').trim();
  const arfcn = num(g('arfcn'));
  const nrByName = /^n\d+/i.test(fb) || /nr|5g/i.test(fb);
  const tech: 'LTE' | 'NR' = hintNr || nrByName || (arfcn !== undefined && arfcn > 100000) ? 'NR' : 'LTE';
  const band = num(fb.replace(/^[bn]/i, '')) ?? (arfcn !== undefined ? bandOfArfcn(tech, arfcn) : undefined);
  const pci = num(g('pci'));
  const caA = fields['caactive'];
  const row: DlRow = {
    tech, band: band && band > 0 ? band : undefined,
    arfcn: arfcn !== undefined ? String(arfcn) : undefined,
    pci: pci !== undefined ? String(pci) : undefined,
    cellId: str(g('cellid')), enodebId: str(g('enodebid')),
    bandwidth: num(g('bw')),
    rsrp: num(g('rsrp')), rsrq: num(g('rsrq')), rssi: num(g('rssi')), sinr: num(g('sinr')),
    cqi: num(g('cqi')), dlMcs: num(g('mcs')), rank: num(g('rank')),
    plmn: str(g('plmn')),
    caActive: caA === undefined ? undefined : !!caA && String(caA) !== '0' && String(caA).toLowerCase() !== 'false',
  };
  // قيم مستحيلة (0 أو أكبر من صفر لـ RSRP) = ما فيه قراءة
  if (row.rsrp !== undefined && (row.rsrp >= 0 || row.rsrp < -160)) row.rsrp = undefined;
  if (row.rsrp === undefined && row.pci === undefined && row.arfcn === undefined) return null;
  return row;
}

export function rowsFrom(info: any): DlRow[] {
  const out: DlRow[] = [];
  for (const r of candidates(info)) {
    // نفس الكائن ممكن فيه 4G و 5G مع بعض (lteRsrp + nrRsrp) — نقسمه بالبادئة
    const groups: Record<'lte' | 'nr' | 'plain', Record<string, unknown>> = { lte: {}, nr: {}, plain: {} };
    for (const k of Object.keys(r)) {
      if (r[k] !== null && typeof r[k] === 'object') continue;
      const g = NR_PREFIX.test(k) ? 'nr' : LTE_PREFIX.test(k) ? 'lte' : 'plain';
      groups[g][norm(k)] = r[k];
    }
    const shared = groups.plain;
    const parts: [Record<string, unknown>, boolean][] = [];
    if (Object.keys(groups.lte).some(k => /rsrp|sinr|pci|arfcn/.test(k))) parts.push([{ ...shared, ...groups.lte }, false]);
    if (Object.keys(groups.nr).some(k => /rsrp|sinr|pci|arfcn/.test(k))) parts.push([{ ...shared, ...groups.nr }, true]);
    if (!parts.length) parts.push([shared, false]);
    for (const [f, nr] of parts) {
      const row = rowOf(f, nr);
      if (row && !out.some(o => o.tech === row.tech && o.pci === row.pci && o.arfcn === row.arfcn && o.rsrp === row.rsrp)) out.push(row);
    }
  }
  return out;
}

/** نوع الشبكة من InternetStatus.netType («NR5G-NSA» · «LTE» · «NR5G-SA») */
export function netLabel(nt: string): string | undefined {
  const t = nt.toUpperCase();
  if (!t) return undefined;
  if (/NSA/.test(t)) return '5G NSA';
  if (/(NR|5G)/.test(t)) return /SA/.test(t) ? '5G SA' : '5G';
  if (/LTE|4G/.test(t)) return '4G';
  if (/WCDMA|UMTS|HSPA|3G/.test(t)) return '3G';
  return nt;
}

export function signalFrom(info: any, mobile?: any): Signal {
  const rows = rowsFrom(info);
  const lte = rows.filter(r => r.tech === 'LTE');
  const nr = rows.filter(r => r.tech === 'NR');
  const p = lte[0];
  const n = nr[0];
  const s: Signal = {};
  if (p) {
    Object.assign(s, {
      band: p.band ? 'B' + p.band : undefined, earfcn: p.arfcn, pci: p.pci, cellId: p.cellId, enodebId: p.enodebId,
      rsrp: p.rsrp, rsrq: p.rsrq, rssi: p.rssi, sinr: p.sinr, cqi: p.cqi, dlMcs: p.dlMcs, dlStreams: p.rank,
      dlBandwidth: p.bandwidth !== undefined ? String(p.bandwidth) : undefined,
    });
  }
  if (n) {
    Object.assign(s, {
      nrBand: n.band ? 'n' + n.band : undefined, nrArfcn: n.arfcn, nrPci: n.pci,
      nrRsrp: n.rsrp, nrRsrq: n.rsrq, nrSinr: n.sinr, nrCqi: n.cqi, nrDlMcs: n.dlMcs, nrRank: n.rank,
      nrDlBandwidth: n.bandwidth !== undefined ? String(n.bandwidth) : undefined,
    });
  }
  const nt = String(mobile?.netType ?? '').trim();
  const lbl = netLabel(nt);
  s.network = n && p ? '5G NSA' : n ? (lbl === '5G NSA' ? lbl : '5G SA') : p ? (lbl && /^5G/.test(lbl) ? lbl : '4G') : lbl;
  if (!n && lbl && /^5G/.test(lbl)) s.nrActiveFromStatus = true;
  if (lte.length > 1) {
    s.caCount = lte.length;
    const bw = lte.reduce((a, r) => a + (r.bandwidth ?? 0), 0);
    if (bw > 0) s.caBandwidthMhz = bw;
  }
  for (const k of Object.keys(s) as (keyof Signal)[]) if (s[k] === undefined) delete s[k];
  return s;
}

export function carriersFrom(info: any): Carrier[] {
  const rows = rowsFrom(info);
  const out: Carrier[] = [];
  for (const tech of ['LTE', 'NR'] as const) {
    rows.filter(r => r.tech === tech && r.band).forEach((r, i) => out.push({
      tech, band: r.band!, role: i === 0 ? 'PCC' : 'SCC', arfcn: r.arfcn, pci: r.pci, bandwidth: r.bandwidth,
      rsrp: r.rsrp, rsrq: r.rsrq, sinr: r.sinr,
    }));
  }
  return out;
}

export function cellsFrom(info: any): CellTower[] {
  const rows = rowsFrom(info);
  const seen = { LTE: 0, NR: 0 };
  return rows.map(r => ({
    kind: seen[r.tech]++ === 0 ? 'serving' as const : 'secondary' as const,
    tech: r.tech, arfcn: r.arfcn, band: r.band, pci: r.pci, cellId: r.cellId, rsrp: r.rsrp, rsrq: r.rsrq, sinr: r.sinr, rssi: r.rssi,
  }));
}

/** الاتصال قائم؟ networkStatus («Connected») أو فيه إشارة */
export function connectedFrom(mobile: any, info?: any): boolean {
  const st = String(mobile?.networkStatus ?? '').toLowerCase();
  if (/disconnect|no service|not|fail|limited/.test(st)) return false;
  if (/connect|online|ok|up/.test(st)) return true;
  return rowsFrom(info).some(r => r.rsrp !== undefined);
}

export function devicesFrom(info: any): ConnectedDevice[] {
  const list: any[] = Array.isArray(info?.clients) ? info.clients : [];
  return list
    .map(c => ({
      mac: String(c?.macAddress ?? '').trim().toLowerCase(),
      ip: str(c?.ipv4Address) ?? str(c?.ipv6Address),
      name: str(c?.hostName) ?? str(c?.hostname) ?? str(c?.deviceName) ?? str(c?.interfaceName),
    }))
    .filter(d => /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(d.mac));
}

const nums = (v: unknown) => String(v ?? '').split(/[,\s]+/).map(x => num(x.replace(/^[bn]/i, ''))).filter((x): x is number => x !== undefined && x > 0);

/**
 * قراءة الترددات (عرض بس — الكتابة مقفولة لين يتأكد الدخول ميدانياً).
 * «مقفول» = bandLockEnabled والنوع المختار؛ غير كذا كل المتاح.
 */
export function bandConfigFrom(info: any): BandConfig {
  const on = !!info?.bandLockEnabled && String(info.bandLockEnabled) !== 'false';
  const nt = String(info?.netType ?? '');
  const lte = info?.['4G'] ?? {};
  const nrKey = info?.['5G'] ? '5G' : info?.['5GNSA'] ? '5GNSA' : '5GNAS';
  const nr = info?.[nrKey] ?? {};
  const lteAll = nums(lte.allBands), nrAll = nums(nr.allBands);
  return {
    supported: lteAll,
    locked: on && nt === '4G' ? nums(lte.enabledBand) : [],
    nrSupported: nrAll,
    nrLocked: on && /^5G/.test(nt) ? nums(nr.enabledBand) : [],
    mode: on ? nt : 'AUTO',
    modes: [],
    lockKinds: { lte: on && nt === '4G' ? 'band' : 'none', nr: on && /^5G/.test(nt) ? 'band' : 'none' },
  };
}

/* ═══ الترددات: رموز الراوتر نفسه ═══ allBands ممكن «1,3» أو «B1,B3» — نرسل بنفس صيغته */
export function bandTokens(list: unknown): { n: number; t: string }[] {
  return String(list ?? '').split(',').map(t => t.trim()).filter(Boolean)
    .map(t => ({ n: num(t.replace(/^[bn]/i, '')) ?? NaN, t })).filter(x => Number.isFinite(x.n) && x.n > 0);
}
/** مفتاح 5G في getBandLockInfo: «5G» أو «5GNSA» (3000M) أو «5GNAS» (2000M) */
export function nrKeys(info: any): string[] { return ['5G', '5GNSA', '5GNAS'].filter(k => info?.[k] && typeof info[k] === 'object'); }

/* ═══ وضع الشبكة (getMobileNetworkBasicConfig.netType) ═══ نفس رموز بقية الدرايفرات: 00 تلقائي · 03 4G · 02 3G */
export const DL_MODES: { code: string; value: string; label: string; five?: boolean }[] = [
  { code: '00', value: 'AUTO', label: 'تلقائي' },
  { code: 'dl:5G', value: '5G', label: '5G فقط', five: true },
  { code: '03', value: '4G', label: '4G فقط' },
  { code: '02', value: '3G', label: '3G فقط' },
];
export const modeCode = (v: unknown) => DL_MODES.find(m => m.value === String(v ?? '').toUpperCase())?.code ?? String(v ?? '');

/* ═══ الرسائل ═══ getsmsList ← info.smsList [{id, number, content (HTML مرمّز), time}] */
export function htmlDecode(s: string): string {
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
export function smsFrom(info: any, box: 'inbox' | 'sent'): import('../types').SmsMessage[] {
  const list: any[] = Array.isArray(info?.smsList) ? info.smsList : [];
  return list.filter(x => x && x.id !== undefined).map(x => ({
    index: String(x.id), phone: String(x.number ?? ''), content: htmlDecode(String(x.content ?? '')), date: String(x.time ?? ''),
    // الصفحة ما تعرض «مقروءة/غير مقروءة» — نعتمد على خانة status لو موجودة
    unread: box === 'inbox' && x.status !== undefined ? /unread|^0$|new/i.test(String(x.status)) : false,
  }));
}

/**
 * رقم الجوال ← (رمز الدولة، الرقم) مثل خانات الصفحة: countryCode «+966» (/^[0+]\d{1,4}$/) و contacts أرقام ١–١١.
 * دولي (+/00) ← رمز الدولة من القائمة · محلي يبدأ بـ 0 ← رمز دولة الشريحة (MCC) والرقم بدون الصفر · قصير (خدمات) كما هو.
 */
const CC = ['966', '971', '965', '973', '974', '968', '967', '962', '963', '964', '961', '218', '216', '213', '212', '249', '20', '90', '92', '91', '1', '44'];
const MCC_CC: Record<string, string> = { '420': '966', '424': '971', '419': '965', '426': '973', '427': '974', '422': '968', '606': '218', '421': '967', '416': '962', '602': '20' };
export function splitPhone(phone: string, plmn?: string): { countryCode: string; number: string } | null {
  let p = String(phone ?? '').replace(/[\s()-]/g, '');
  const cc0 = MCC_CC[String(plmn ?? '').slice(0, 3)] ?? '966';
  if (/^\+|^00/.test(p)) {
    p = p.replace(/^\+|^00/, '');
    const cc = CC.find(c => p.startsWith(c) && p.length - c.length >= 4);
    if (!cc) return null;
    const n = p.slice(cc.length).replace(/^0/, '');
    return /^\d{1,11}$/.test(n) ? { countryCode: '+' + cc, number: n } : null;
  }
  if (!/^\d+$/.test(p)) return null;
  if (p.length <= 6) return { countryCode: '+' + cc0, number: p };
  const n = p.replace(/^0/, '');
  return /^\d{1,11}$/.test(n) ? { countryCode: '+' + cc0, number: n } : null;
}

/** NR SCS للتثبيت: n77/78/79 = 30 (TDD) · FDD = 15 · غيرها ما نخمّن (نفس قاعدة Pro 7) */
export function nrScs(band?: number): number | undefined {
  if (!band) return undefined;
  if ([77, 78, 79].includes(band)) return 30;
  if ([1, 3, 5, 7, 8, 20, 28, 71].includes(band)) return 15;
  return undefined;
}
