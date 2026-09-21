// فحص تردد واحد بتفاصيل كاملة: قوة، نقاء، استقرار، قطعات، سرعة، ثبات البرج.
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { RouterDriver, Signal } from '../drivers/types';
import { trafficBurst } from './nrprobe';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export type TestMode = 'quick' | 'full';

export interface BandSample {
  t: number;
  rsrp?: number;
  sinr?: number;
  rsrq?: number;
  pci?: string;
  connected: boolean;
}

export interface BandTestResult {
  tech: 'LTE' | 'NR';
  band: number;
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;

  rsrpMin?: number; rsrpMax?: number; rsrpAvg?: number;
  sinrMin?: number; sinrMax?: number; sinrAvg?: number;
  rsrqAvg?: number;

  disconnectCount: number;
  totalSamples: number;
  onlinePct: number; // 0..100

  speedMbps?: number;
  downloadBytes?: number;

  pciChanges: number;
  primaryPci?: string;

  durationMs: number;
  samples: BandSample[];
}

export interface TestOptions {
  mode: TestMode;
  onProgress?: (partial: Partial<BandTestResult> & { elapsedMs: number }) => void;
  isCancelled?: () => boolean;
}

const QUICK_MS = 6000;
const FULL_MS = 55000;
const SAMPLE_INTERVAL_MS = 2500;
const SPEED_MS = 8000;

async function readSignal(
  r: SavedRouter,
  tech: 'LTE' | 'NR',
): Promise<{ sig: Signal | null; connected: boolean }> {
  try {
    return await withSession(r, async (d: RouterDriver) => {
      const connected = d.isConnected
        ? await d.isConnected().catch(() => true)
        : true;
      const sig = d.getSignal
        ? await d.getSignal().catch(() => null)
        : null;
      return { sig, connected };
    }, false);
  } catch {
    return { sig: null, connected: false };
  }
}

function extract(tech: 'LTE' | 'NR', s: Signal | null):
  { rsrp?: number; sinr?: number; rsrq?: number; pci?: string } {
  if (!s) return {};
  if (tech === 'NR') {
    return { rsrp: s.nrRsrp, sinr: s.nrSinr, rsrq: s.nrRsrq, pci: s.nrPci };
  }
  return { rsrp: s.rsrp, sinr: s.sinr, rsrq: s.rsrq, pci: s.pci };
}

export async function testBand(
  r: SavedRouter,
  tech: 'LTE' | 'NR',
  band: number,
  opts: TestOptions = { mode: 'quick' },
): Promise<BandTestResult> {
  const { mode, onProgress, isCancelled = () => false } = opts;
  const durationMs = mode === 'full' ? FULL_MS : QUICK_MS;

  const result: BandTestResult = {
    tech,
    band,
    status: 'testing',
    disconnectCount: 0,
    totalSamples: 0,
    onlinePct: 100,
    pciChanges: 0,
    durationMs,
    samples: [],
  };

  const start = Date.now();
  const rsrps: number[] = [];
  const sinrs: number[] = [];
  const rsrqs: number[] = [];
  let firstPci: string | undefined;

  const report = () => {
    if (!onProgress) return;
    onProgress({
      ...result,
      rsrpAvg: avg(rsrps),
      sinrAvg: avg(sinrs),
      rsrpMin: rsrps.length ? Math.min(...rsrps) : undefined,
      rsrpMax: rsrps.length ? Math.max(...rsrps) : undefined,
      sinrMin: sinrs.length ? Math.min(...sinrs) : undefined,
      sinrMax: sinrs.length ? Math.max(...sinrs) : undefined,
      rsrqAvg: avg(rsrqs),
      primaryPci: firstPci,
      elapsedMs: Date.now() - start,
    });
  };

  while (Date.now() - start < durationMs) {
    if (isCancelled()) {
      result.status = 'pending';
      result.samples = [];
      return result;
    }

    const { sig, connected } = await readSignal(r, tech);
    const ext = extract(tech, sig);
    const sample: BandSample = {
      t: Date.now() - start,
      connected,
      rsrp: ext.rsrp,
      sinr: ext.sinr,
      rsrq: ext.rsrq,
      pci: ext.pci,
    };
    result.samples.push(sample);
    result.totalSamples++;
    if (!connected) result.disconnectCount++;
    if (sample.rsrp !== undefined) rsrps.push(sample.rsrp);
    if (sample.sinr !== undefined) sinrs.push(sample.sinr);
    if (sample.rsrq !== undefined) rsrqs.push(sample.rsrq);
    if (sample.pci) {
      if (!firstPci) firstPci = sample.pci;
      else if (sample.pci !== firstPci) result.pciChanges++;
    }
    report();

    const elapsed = Date.now() - start;
    if (elapsed >= durationMs) break;
    await sleep(Math.min(SAMPLE_INTERVAL_MS, durationMs - elapsed));
  }

  // الفحص الدقيق: قياس سرعة فعلية في النهاية
  if (mode === 'full' && !isCancelled()) {
    report();
    try {
      const burstStart = Date.now();
      const bytes = await trafficBurst(SPEED_MS, 30_000_000, isCancelled);
      const seconds = Math.max(1, (Date.now() - burstStart) / 1000);
      result.downloadBytes = bytes;
      result.speedMbps =
        Math.round(((bytes * 8) / (seconds * 1_000_000)) * 10) / 10;
    } catch {
      // نتجاهل فشل قياس السرعة
    }
  }

  if (result.totalSamples > 0) {
    result.onlinePct = Math.round(
      ((result.totalSamples - result.disconnectCount) / result.totalSamples) * 100,
    );
  }
  result.rsrpAvg = avg(rsrps);
  result.rsrpMin = rsrps.length ? Math.min(...rsrps) : undefined;
  result.rsrpMax = rsrps.length ? Math.max(...rsrps) : undefined;
  result.sinrAvg = avg(sinrs);
  result.sinrMin = sinrs.length ? Math.min(...sinrs) : undefined;
  result.sinrMax = sinrs.length ? Math.max(...sinrs) : undefined;
  result.rsrqAvg = avg(rsrqs);
  result.primaryPci = firstPci;
  result.status = 'done';
  report();
  return result;
}

/**
 * درجة مقارنة موسّعة (0..1):
 * 35% قوة (RSRP) | 30% نقاء (SINR) | 20% استقرار | 15% سرعة
 * + عقوبة على القطعات وتغيّر البرج.
 */
export function scoreResult(res: BandTestResult): number {
  if (res.status !== 'done') return 0;
  const p = res.rsrpAvg === undefined
    ? 0.3
    : Math.max(0, Math.min(1, (res.rsrpAvg + 120) / 45));
  const s = res.sinrAvg === undefined
    ? 0.3
    : Math.max(0, Math.min(1, (res.sinrAvg + 5) / 30));
  const stability = res.onlinePct / 100;
  const speed = res.speedMbps === undefined
    ? 0.5
    : Math.max(0, Math.min(1, res.speedMbps / 50));
  const penalty = Math.min(0.35, res.pciChanges * 0.06 + res.disconnectCount * 0.05);
  const raw = p * 0.35 + s * 0.3 + stability * 0.2 + speed * 0.15 - penalty;
  return Math.max(0, Math.min(1, raw));
}

export function testLabel(res: BandTestResult): string {
  const sc = scoreResult(res);
  if (sc >= 0.8) return 'ممتاز';
  if (sc >= 0.6) return 'جيد جداً';
  if (sc >= 0.4) return 'جيد';
  if (sc >= 0.25) return 'مقبول';
  return 'ضعيف';
}

/** ملخص عربي لسبب الترجيح/الخسارة */
export function verdictText(best: BandTestResult, cur: BandTestResult): string | null {
  if (best.band === cur.band && best.tech === cur.tech) return null;
  const parts: string[] = [];
  if (cur.disconnectCount > 0) {
    parts.push(`يقطع ${cur.disconnectCount} مرة`);
  }
  if (cur.pciChanges > 0) {
    parts.push(`يغيّر البرج ${cur.pciChanges} مرة`);
  }
  if (best.sinrAvg !== undefined && cur.sinrAvg !== undefined) {
    const diff = best.sinrAvg - cur.sinrAvg;
    if (Math.abs(diff) >= 2) {
      parts.push(`فرق نقاء ${diff > 0 ? '+' : ''}${diff.toFixed(1)}dB`);
    }
  }
  if (best.speedMbps !== undefined && cur.speedMbps !== undefined) {
    const ratio = best.speedMbps / Math.max(0.1, cur.speedMbps);
    if (ratio >= 1.3 || ratio <= 0.7) {
      parts.push(`سرعة ${ratio >= 1 ? '×' + ratio.toFixed(1) : '÷' + (1 / ratio).toFixed(1)}`);
    }
  }
  return parts.length ? parts.join(' · ') : null;
}
