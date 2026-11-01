import { Signal } from '../types';

/**
 * Pro7 (LuCI ثيم bigtmt) — صفحة admin/status/nr تطلب XHR.get('<root>/admin/status/nr', {status: 1}) ← JSON.
 * أسماء الحقول من كود الصفحة نفسها (ملف FULL ٢ نوفمبر):
 *   mode · name (الشركة) · signal (= «Signal Strength» بـ dBm — RSRP) · rsrq · sinr · PCI · ECGI · frequency · arfcn
 *   band · band_width · freq_band_ind · nsa_band · nsa_band_width · nsa_earfcn · nsa_pci · nsa_rsrp · nsa_rsrq · nsa_sinr
 *   sa_pci · data_status (CONNECT/DISCONNECT) · reg_status · sim_status · net_ipv4 …
 * صيغة القيم نفسها ما شفناها (ممكن «-95» أو «-95 dBm» أو «B3»/«3») ← نقرأ الرقم بس، وأي قيمة خارج المعقول تنشال.
 */
export type Pro7Status = Record<string, unknown>;

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
/** أول رقم في النص — بحدود معقولة وإلا undefined (ما نعرض أرقام غلط) */
export function num(v: unknown, lo: number, hi: number): number | undefined {
  const m = s(v).match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
}
const bandNo = (v: unknown) => s(v).match(/(\d{1,3})\s*$/)?.[1] ?? s(v).match(/\d{1,3}/)?.[0];
const id = (v: unknown) => { const x = s(v); return x && x !== '-' && !/^0+$/.test(x) ? x : undefined; };

export function pro7Network(mode: unknown): string | undefined {
  const m = s(mode).toUpperCase();
  if (m === 'LTE') return '4G';
  if (m === 'NR5G-NSA') return '5G NSA';
  if (m === 'NR5G-SA' || m === '5G') return '5G SA';
  if (m === 'WCDMA') return '3G';
  return undefined;
}

export function pro7Signal(j: Pro7Status): Signal {
  const network = pro7Network(j.mode);
  const sa = network === '5G SA';
  const nsa = network === '5G NSA';
  const out: Signal = { network };
  if (sa) {
    const b = bandNo(j.band);
    out.nrBand = b ? 'n' + b : undefined;
    out.nrPci = id(j.sa_pci) ?? id(j.PCI);
    out.nrArfcn = id(j.arfcn) ?? id(j.frequency);
    out.nrDlBandwidth = num(j.band_width, 1, 400)?.toString();
    out.nrRsrp = num(j.signal, -156, -31);
    out.nrRsrq = num(j.rsrq, -43, 20);
    out.nrSinr = num(j.sinr, -23, 40);
    out.cellId = id(j.ECGI);
    out.nrActiveFromStatus = true;
    return out;
  }
  const b = bandNo(j.band);
  out.band = b ? 'B' + b : undefined;
  out.pci = id(j.PCI);
  out.earfcn = id(j.arfcn) ?? id(j.frequency);
  out.cellId = id(j.ECGI);
  out.dlBandwidth = num(j.band_width, 1, 100)?.toString();
  out.rsrp = num(j.signal, -150, -30);
  out.rsrq = num(j.rsrq, -40, 0);
  out.sinr = num(j.sinr, -30, 50);
  if (nsa) {
    const nb = bandNo(j.nsa_band);
    out.nrBand = nb ? 'n' + nb : undefined;
    out.nrPci = id(j.nsa_pci);
    out.nrArfcn = id(j.nsa_earfcn);
    out.nrDlBandwidth = num(j.nsa_band_width, 1, 400)?.toString();
    out.nrRsrp = num(j.nsa_rsrp, -156, -31);
    out.nrRsrq = num(j.nsa_rsrq, -43, 20);
    out.nrSinr = num(j.nsa_sinr, -23, 40);
    out.nrActiveFromStatus = true;
  }
  return out;
}
