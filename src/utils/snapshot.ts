// بناء SignalSnapshot موحّد من أي درايفر.
// دوال نقية (بدون شبكة) عدا driverSnapshot التي تنادي الدرايفر.
import {
  Signal, Carrier, CellTower, SignalSnapshot, SignalSnapshotHealth,
  RouterDriver,
} from '../drivers/types';

/** تصنيف رقمي 0–100 إلى تسمية عربية قصيرة. */
export function qualityLabel(score: number): 'ممتاز' | 'جيد' | 'متوسط' | 'ضعيف' {
  if (score >= 75) return 'ممتاز';
  if (score >= 50) return 'جيد';
  if (score >= 25) return 'متوسط';
  return 'ضعيف';
}

/** يبني درجة صحّة تقريبية من RSRP و SINR. يرجع undefined لو ما فيه بيانات كافية. */
export function healthScore(s: Signal | null | undefined): number | undefined {
  if (!s) return undefined;
  const parts: number[] = [];
  if (s.rsrp !== undefined) {
    // RSRP: -140 ضعيف → 0، -80 ممتاز → 100
    const n = Math.max(0, Math.min(100, ((s.rsrp + 140) / 60) * 100));
    parts.push(n);
  }
  if (s.sinr !== undefined) {
    // SINR: 0 ضعيف → 0، 20 ممتاز → 100
    const n = Math.max(0, Math.min(100, (s.sinr / 20) * 100));
    parts.push(n);
  }
  if (!parts.length) return undefined;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function parseBandNum(v?: string): number | undefined {
  if (!v) return undefined;
  const m = String(v).match(/(\d+)/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseNum(v?: string): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

/** يحوّل Signal + Carrier[] + CellTower[] إلى SignalSnapshot موحّد. */
export function buildSnapshot(
  signal: Signal | null | undefined,
  carriers: Carrier[] | null | undefined,
  cells: CellTower[] | null | undefined,
  source: { driverId: string; driverName: string; tech?: string },
): SignalSnapshot {
  const s = signal ?? {};
  const hasLte =
    s.rsrp !== undefined || s.pci !== undefined || s.band !== undefined ||
    s.earfcn !== undefined || s.cellId !== undefined;
  const hasNr =
    s.nrRsrp !== undefined || s.nrPci !== undefined || s.nrBand !== undefined ||
    s.nrArfcn !== undefined;

  const lte = hasLte ? {
    pci: s.pci,
    cellId: s.cellId,
    earfcn: s.earfcn,
    band: parseBandNum(s.band),
    bandwidth: parseNum(s.dlBandwidth),
    rsrp: s.rsrp,
    rsrq: s.rsrq,
    sinr: s.sinr,
    rssi: s.rssi,
    cqi: s.cqi,
    dlMcs: s.dlMcs,
    ulMcs: s.ulMcs,
    txPower: s.txPower,
    dlStreams: s.dlStreams,
    enodebId: s.enodebId,
  } : undefined;

  const nr = hasNr ? {
    pci: s.nrPci,
    arfcn: s.nrArfcn,
    band: parseBandNum(s.nrBand),
    bandwidth: parseNum(s.nrDlBandwidth),
    rsrp: s.nrRsrp,
    rsrq: s.nrRsrq,
    sinr: s.nrSinr,
    cqi: s.nrCqi,
    dlMcs: s.nrDlMcs,
    txPower: s.nrTxPower,
    rank: s.nrRank,
    available: s.nrAvailable,
  } : undefined;

  const score = healthScore(s);
  const health: SignalSnapshotHealth | undefined = score !== undefined ? {
    score,
    quality: qualityLabel(score),
    cqi: s.cqi,
    dlMcs: s.dlMcs,
    ulMcs: s.ulMcs,
  } : undefined;

  const neighbors = (cells ?? []).filter(c => c.kind === 'neighbor');

  return {
    lte,
    nr,
    ca: carriers ?? [],
    neighbors,
    health,
    source: {
      driverId: source.driverId,
      driverName: source.driverName,
      tech: source.tech ?? s.network,
      at: Date.now(),
    },
  };
}

/**
 * يستخرج snapshot من أي درايفر:
 *  - لو عنده getSnapshot → يستخدمها مباشرة.
 *  - وإلا يبنيها من getSignal + getCarriers + getCells.
 *  يرجع null لو ما فيه أي بيانات.
 */
export async function driverSnapshot(d: RouterDriver): Promise<SignalSnapshot | null> {
  if (d.getSnapshot) {
    try { return await d.getSnapshot(); } catch { return null; }
  }
  const signal = d.getSignal ? await d.getSignal().catch(() => null) : null;
  const carriers = d.getCarriers ? await d.getCarriers().catch(() => []) : [];
  const cells = d.getCells ? await d.getCells().catch(() => []) : [];
  if (!signal && !carriers.length && !cells.length) return null;
  return buildSnapshot(signal, carriers, cells, {
    driverId: d.id,
    driverName: d.name,
  });
}
