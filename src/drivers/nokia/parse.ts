/**
 * Nokia FastMile 5G Gateway — قراءة ردود الصفحة (ملفات صفحة حقيقية ٢٧ و٣١ أكتوبر، أسماء الخانات من كود الصفحة نفسه):
 *   fastmile_radio_status_web_app.cgi:
 *     cell_LTE_stats_cfg[0].stat: RSRPCurrent RSRQCurrent SNRCurrent RSSICurrent PhysicalCellID Band DownlinkEarfcn
 *     cell_5G_stats_cfg[0].stat:  RSRPCurrent RSRQCurrent SNRCurrent PhysicalCellID Band Downlink_NR_ARFCN
 *     cell_CA_stats_cfg[0].ca: X_ALU_COM_DLCarrierAggregationNumberOfEntries + ca[1..]: PhysicalCellID ScellBand ScellChannel
 *     cellular_stats[0]: BytesReceived BytesSent · apn_cfg[0]: APN X_ALU_COM_IPAddressV4
 *   الصفحة تعتبر القراءة صالحة بس لو RSRP بين ‎-140 و ‎-44 (غيرها = مو متصل بهالتقنية).
 *   dashboard_device_info_status_web_app.cgi:
 *     device_app_status[0]: Description SerialNumber HardwareVersion SoftwareVersion UpTime
 *     device_cfg[]: HostName MACAddress IPAddress InterfaceType Active X_ALU_COM_IsBeacon
 * ملف صافي (عليه اختبارات).
 */
import type { Signal, Carrier, CellTower, ConnectedDevice } from '../types';

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s && s !== 'N/A' ? s : undefined;
};
/** «B3» «3» «LTE BAND 3» «n78» «NR78» ← رقم */
export function bandNum(v: unknown): number | undefined {
  const m = String(v ?? '').match(/(\d+)/);
  const n = m ? Number(m[1]) : NaN;
  return n > 0 && n < 1000 ? n : undefined;
}
const valid = (rsrp: number | undefined) => rsrp !== undefined && rsrp >= -140 && rsrp <= -44;

export interface NkRaw { lte?: any; nr?: any; ca?: any; cell?: any; apn?: any }

export function rawFrom(r: any): NkRaw {
  return {
    lte: r?.cell_LTE_stats_cfg?.[0]?.stat,
    nr: r?.cell_5G_stats_cfg?.[0]?.stat,
    ca: r?.cell_CA_stats_cfg?.[0]?.ca,
    cell: r?.cellular_stats?.[0],
    apn: r?.apn_cfg?.[0],
  };
}

/** الخلايا المدموجة (SCC) — ca[1], ca[2]… لين يخلص */
export function sccFrom(ca: any): { band?: number; nr: boolean; arfcn?: string; pci?: string }[] {
  const out: { band?: number; nr: boolean; arfcn?: string; pci?: string }[] = [];
  if (!ca || typeof ca !== 'object') return out;
  for (let i = 1; i <= 8 && ca[i]; i++) {
    const c = ca[i];
    out.push({ band: bandNum(c.ScellBand), nr: /^\s*n/i.test(String(c.ScellBand ?? '')), arfcn: str(c.ScellChannel), pci: str(c.PhysicalCellID) });
  }
  return out;
}

export function signalFrom(raw: NkRaw): Signal {
  const s: Signal = {};
  const lr = num(raw.lte?.RSRPCurrent), nr = num(raw.nr?.RSRPCurrent);
  const lteOn = valid(lr), nrOn = valid(nr);
  if (lteOn) {
    const b = bandNum(raw.lte.Band);
    s.rsrp = lr; s.rsrq = num(raw.lte.RSRQCurrent); s.sinr = num(raw.lte.SNRCurrent); s.rssi = num(raw.lte.RSSICurrent);
    s.pci = str(raw.lte.PhysicalCellID); s.earfcn = str(raw.lte.DownlinkEarfcn);
    if (b) s.band = 'B' + b;
  }
  if (nrOn) {
    const b = bandNum(raw.nr.Band);
    s.nrRsrp = nr; s.nrRsrq = num(raw.nr.RSRQCurrent); s.nrSinr = num(raw.nr.SNRCurrent);
    s.nrPci = str(raw.nr.PhysicalCellID); s.nrArfcn = str(raw.nr.Downlink_NR_ARFCN);
    if (b) s.nrBand = 'n' + b;
    s.nrActiveFromStatus = true;
  }
  const scc = sccFrom(raw.ca);
  const entries = num(raw.ca?.X_ALU_COM_DLCarrierAggregationNumberOfEntries) ?? 0;
  const n = Math.max(scc.length, entries);
  if (lteOn && n > 0) s.caCount = 1 + n;
  s.network = nrOn && lteOn ? '5G NSA' : nrOn ? '5G SA' : lteOn ? (n > 0 ? '4G+' : '4G') : undefined;
  return s;
}

export function carriersFrom(raw: NkRaw): Carrier[] {
  const s = signalFrom(raw);
  const out: Carrier[] = [];
  const lb = bandNum(s.band), nb = bandNum(s.nrBand);
  if (lb) out.push({ tech: 'LTE', band: lb, role: 'PCC', arfcn: s.earfcn, pci: s.pci, rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr });
  else if (nb && s.network === '5G SA') out.push({ tech: 'NR', band: nb, role: 'PCC', arfcn: s.nrArfcn, pci: s.nrPci, rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr });
  if (out.length) for (const c of sccFrom(raw.ca)) if (c.band) out.push({ tech: c.nr ? 'NR' : 'LTE', band: c.band, role: 'SCC', arfcn: c.arfcn, pci: c.pci });
  if (nb && s.network === '5G NSA') out.push({ tech: 'NR', band: nb, role: 'SCC', arfcn: s.nrArfcn, pci: s.nrPci, rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr });
  return out;
}

export function cellsFrom(s: Signal): CellTower[] {
  const out: CellTower[] = [];
  if (s.rsrp !== undefined) out.push({ kind: 'serving', tech: 'LTE', arfcn: s.earfcn, band: bandNum(s.band), pci: s.pci, rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr, rssi: s.rssi });
  if (s.nrRsrp !== undefined) out.push({ kind: 'serving', tech: 'NR', arfcn: s.nrArfcn, band: bandNum(s.nrBand), pci: s.nrPci, rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr });
  return out;
}

/** الأجهزة المتصلة الحين — نفس فلتر الصفحة: Active ومو «بيكون» (مقوّي نوكيا) */
export function devicesFrom(r: any): ConnectedDevice[] {
  const list: any[] = Array.isArray(r?.device_cfg) ? r.device_cfg : [];
  return list
    .filter(d => d && d.Active && Number(d.X_ALU_COM_IsBeacon) !== 1 && d.MACAddress)
    .map(d => ({ mac: String(d.MACAddress).toUpperCase(), ip: str(d.IPAddress), name: str(d.HostName) }));
}
