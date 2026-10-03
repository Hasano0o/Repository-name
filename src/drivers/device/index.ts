import { PermissionsAndroid, Platform } from 'react-native';
import {
  RouterDriver, Capability, Signal, SignalSnapshot, CellTower, Carrier,
  NetworkInfo, DeviceDetails,
} from '../types';
import { buildSnapshot } from '../../utils/snapshot';
import { bandOfArfcn } from '../../utils/arfcn';
import { cellModuleAvailable, cellNative, RawCell } from '../../../modules/bandly-cell/src';

/**
 * «هذا الجهاز» — يقرأ الإشارة من شريحة الجهاز اللي عليه التطبيق.
 * للأجهزة اللي تشتغل بنظام أندرويد (هب 5G منزلي مقفول بدون صفحة إدارة)،
 * أو لقياس الإشارة بالجوال نفسه. ما فيه شبكة ولا كلمة مرور.
 */
export const DEVICE_HOST = 'device';
export const DEVICE_DRIVER_ID = 'device';

export const isDeviceHost = (host?: string) => host === DEVICE_HOST;
/** للعرض: بدل كلمة device نكتب «هذا الجهاز» */
export const hostLabel = (host?: string) => (isDeviceHost(host) ? 'هذا الجهاز' : host ?? '');

export const deviceReadingSupported = (): boolean => {
  if (Platform.OS !== 'android' || !cellModuleAvailable()) return false;
  try { return cellNative().isSupported(); } catch { return false; }
};

/** يطلب صلاحية الموقع (وحالة الهاتف) — أندرويد ما يعطي الأبراج بدونها */
export async function ensureCellPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const P = PermissionsAndroid.PERMISSIONS;
    const res = await PermissionsAndroid.requestMultiple([
      P.ACCESS_FINE_LOCATION, P.ACCESS_COARSE_LOCATION, P.READ_PHONE_STATE,
    ]);
    const ok = (k: string) => res[k as keyof typeof res] === PermissionsAndroid.RESULTS.GRANTED;
    return ok(P.ACCESS_FINE_LOCATION) || ok(P.ACCESS_COARSE_LOCATION);
  } catch {
    return false;
  }
}

const n = (x: number | null | undefined): number | undefined =>
  x === null || x === undefined || !Number.isFinite(x) ? undefined : x;

/** أندرويد 9 يرجع SINR بوحدة 0.1 dB (190 = 19)، والأحدث بالـ dB — نوحّدها */
function sinrDb(x: number | null | undefined): number | undefined {
  const v = n(x);
  if (v === undefined) return undefined;
  const db = Math.abs(v) > 40 ? v / 10 : v;
  return Math.round(db * 10) / 10;
}

function bandOf(c: RawCell): number | undefined {
  if (c.bands && c.bands.length) return c.bands[0];
  const ch = c.tech === 'NR' ? n(c.arfcn) : n(c.earfcn);
  return ch === undefined ? undefined : bandOfArfcn(c.tech, ch);
}

const str = (x: number | string | null | undefined) =>
  x === null || x === undefined || x === '' ? undefined : String(x);

interface Reading {
  cells: RawCell[];
  operator?: string;
  bandwidths: number[];
  raw: string;
  at: number;
}

export class DeviceDriver implements RouterDriver {
  id = DEVICE_DRIVER_ID;
  name = 'هذا الجهاز';
  capabilities: Capability[] = ['signal', 'cells'];

  private last: Reading | null = null;
  private pending: Promise<Reading> | null = null;

  async detect(host: string): Promise<boolean> {
    return isDeviceHost(host) && deviceReadingSupported();
  }

  async login(): Promise<void> {
    if (!cellModuleAvailable()) {
      throw new Error('هذي الميزة تحتاج آخر نسخة من Bandly — حمّلها من البوت وثبّتها');
    }
    if (!cellNative().hasPermission()) {
      throw new Error('اسمح لـ Bandly بصلاحية الموقع من إعدادات الجوال عشان نقدر نقرأ الإشارة والأبراج');
    }
  }

  async logout(): Promise<void> { /* ما فيه جلسة */ }

  /** قراءة وحدة مشتركة لكل الدوال خلال ثانية — بدل ما نسأل المودم ثلاث مرات */
  private async read(): Promise<Reading> {
    if (this.last && Date.now() - this.last.at < 900) return this.last;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const nat = cellNative();
      const cells = await nat.getCells();
      let operator: string | undefined;
      let bandwidths: number[] = [];
      let raw = '';
      try {
        const sv = nat.serviceInfo();
        operator = sv.operator || undefined;
        bandwidths = (sv.bandwidths ?? []).filter(b => b > 0);
        raw = sv.raw ?? '';
      } catch { /* حالة الخدمة اختيارية */ }
      const r: Reading = { cells: cells ?? [], operator, bandwidths, raw, at: Date.now() };
      this.last = r;
      return r;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }

  private split(r: Reading) {
    const reg = r.cells.filter(c => c.registered);
    const lte = reg.filter(c => c.tech === 'LTE');
    const nr = reg.find(c => c.tech === 'NR');
    const pcc = lte[0];
    return { pcc, scc: lte.slice(1), nr, neighbors: r.cells.filter(c => !c.registered) };
  }

  async getSignal(): Promise<Signal> {
    const r = await this.read();
    const { pcc, nr } = this.split(r);
    const nrConnected = /nrState\s*=\s*CONNECTED|mIs5GConnected\s*=\s*true/i.test(r.raw);
    const nrAvail = /nrState\s*=\s*NOT_RESTRICTED/i.test(r.raw);
    const ca = r.bandwidths.length > 1;
    const network = nr || nrConnected ? (pcc ? '5G NSA' : '5G') : pcc ? (ca ? 'LTE-A' : 'LTE') : undefined;
    const ci = n(pcc?.ci);
    const pccBand = pcc ? bandOf(pcc) : undefined;
    const bw = n(pcc?.bandwidth);
    return {
      network,
      band: pccBand !== undefined ? String(pccBand) : undefined,
      cellId: str(ci),
      enodebId: ci !== undefined ? String(Math.floor(ci / 256)) : undefined,
      pci: str(pcc?.pci),
      earfcn: str(pcc?.earfcn),
      dlBandwidth: bw !== undefined ? `${Math.round(bw / 1000)}MHz` : undefined,
      rsrp: n(pcc?.rsrp),
      rsrq: n(pcc?.rsrq),
      sinr: sinrDb(pcc?.rssnr),
      rssi: n(pcc?.rssi),
      cqi: n(pcc?.cqi),
      nrBand: nr && bandOf(nr) !== undefined ? String(bandOf(nr)) : undefined,
      nrPci: str(nr?.pci),
      nrArfcn: str(nr?.arfcn),
      nrRsrp: n(nr?.rsrp),
      nrRsrq: n(nr?.rsrq),
      nrSinr: sinrDb(nr?.sinr),
      nrActiveFromStatus: nrConnected || undefined,
      nrAvailable: !nr && !nrConnected && nrAvail ? 3 : undefined,
    };
  }

  async getCarriers(): Promise<Carrier[]> {
    const r = await this.read();
    const { pcc, scc, nr } = this.split(r);
    const out: Carrier[] = [];
    const mk = (c: RawCell, role: 'PCC' | 'SCC', bwKhz?: number): Carrier | null => {
      const band = bandOf(c);
      if (band === undefined) return null;
      const bw = n(c.bandwidth) ?? bwKhz;
      return {
        tech: c.tech, band, role,
        arfcn: str(c.tech === 'NR' ? c.arfcn : c.earfcn),
        pci: str(c.pci),
        bandwidth: bw !== undefined ? Math.round(bw / 1000) : undefined,
        rsrp: n(c.rsrp), rsrq: n(c.rsrq),
        sinr: sinrDb(c.tech === 'NR' ? c.sinr : c.rssnr),
      };
    };
    if (pcc) { const x = mk(pcc, 'PCC', r.bandwidths[0]); if (x) out.push(x); }
    scc.forEach((c, i) => { const x = mk(c, 'SCC', r.bandwidths[i + 1]); if (x) out.push(x); });
    if (nr) { const x = mk(nr, 'SCC'); if (x) out.push(x); }
    return out;
  }

  async getCells(): Promise<CellTower[]> {
    const r = await this.read();
    const { pcc, scc, nr, neighbors } = this.split(r);
    const tower = (c: RawCell, kind: CellTower['kind']): CellTower => ({
      kind, tech: c.tech,
      arfcn: str(c.tech === 'NR' ? c.arfcn : c.earfcn),
      band: bandOf(c),
      pci: str(c.pci),
      cellId: c.tech === 'NR' ? str(c.nci) : str(c.ci),
      rsrp: n(c.rsrp), rsrq: n(c.rsrq),
      sinr: sinrDb(c.tech === 'NR' ? c.sinr : c.rssnr),
      rssi: n(c.rssi),
    });
    const out: CellTower[] = [];
    if (pcc) out.push(tower(pcc, 'serving'));
    if (nr) out.push(tower(nr, 'serving'));
    for (const c of scc) out.push(tower(c, 'secondary'));
    for (const c of neighbors) {
      if (n(c.pci) === undefined && n(c.rsrp) === undefined) continue;
      out.push(tower(c, 'neighbor'));
    }
    return out;
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    const ca = await this.getCarriers().catch(() => [] as Carrier[]);
    const cells = await this.getCells().catch(() => [] as CellTower[]);
    return buildSnapshot(sig, ca, cells, { driverId: this.id, driverName: this.name });
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const r = await this.read();
    const { pcc, nr } = this.split(r);
    const sig = await this.getSignal();
    return {
      operator: r.operator,
      connected: !!(pcc || nr),
      mode: sig.network,
      supports5g: nr || sig.nrActiveFromStatus || sig.nrAvailable ? true : undefined,
    };
  }

  async isConnected(): Promise<boolean> {
    return !!(await this.getNetworkInfo()).connected;
  }

  async getDeviceDetails(): Promise<DeviceDetails> {
    const d = cellNative().deviceInfo();
    const model = [d.manufacturer, d.model].filter(Boolean).join(' ');
    return {
      model: model || undefined,
      software: d.android ? `Android ${d.android}` : undefined,
      operator: d.operator || d.simOperator || undefined,
      simStatus: d.simState === 5 ? 'جاهزة' : d.simState === 1 ? 'ما فيه شريحة' : undefined,
    };
  }
}
