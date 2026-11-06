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

export function rowsFrom(info: any): DlRow[] {
  const rf = info?.rf;
  const list: any[] = Array.isArray(rf) ? rf : rf && typeof rf === 'object' ? [rf] : [];
  const out: DlRow[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const fb = String(r.frequencyBand ?? '').trim();
    const arfcn = num(r.earfcn);
    const nrByName = /^n\d+/i.test(fb) || /nr|5g/i.test(fb);
    const tech: 'LTE' | 'NR' = nrByName || (arfcn !== undefined && arfcn > 100000) ? 'NR' : 'LTE';
    const band = num(fb.replace(/^[bn]/i, '')) ?? (arfcn !== undefined ? bandOfArfcn(tech, arfcn) : undefined);
    const row: DlRow = {
      tech, band: band && band > 0 ? band : undefined,
      arfcn: arfcn !== undefined ? String(arfcn) : undefined,
      pci: num(r.pcid) !== undefined ? String(num(r.pcid)) : undefined,
      cellId: str(r.cellid), enodebId: str(r.enodebid),
      bandwidth: num(r.bandwidth),
      rsrp: num(r.rsrp), rsrq: num(r.rsrq), rssi: num(r.rssi), sinr: num(r.sinr),
      cqi: num(r.CQI), dlMcs: num(r.DLMCS), rank: num(r.RANK),
      plmn: str(r.plmn),
      caActive: r.caActive === undefined ? undefined : !!r.caActive && String(r.caActive) !== '0' && String(r.caActive).toLowerCase() !== 'false',
    };
    // سطر فاضي (بدون إشارة ولا برج) ما نحسبه
    if (row.rsrp === undefined && row.pci === undefined && row.arfcn === undefined) continue;
    out.push(row);
  }
  return out;
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
  s.network = n && p ? '5G NSA' : n ? '5G SA' : p ? (/5g/i.test(nt) ? '5G' : '4G') : (nt || undefined);
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
