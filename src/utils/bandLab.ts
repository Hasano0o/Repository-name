import { BandConfig, Carrier, CellTower, RouterDriver, Signal } from '../drivers/types';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { snapshot, waitOnline, Snapshot } from './safeLock';
import { trafficBurst } from './nrprobe';
import { loadHistory } from '../store/history';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const comboName = (bands: number[]) => bands.map(b => `B${b}`).join('+');

/**
 * ترددات 4G اللي تستاهل التجربة: اللي شغالة الحين + اللي لها برج قوي حولك (ومدعومة في الراوتر).
 * حد أقصى ٤ عشان التجربة ما تطول.
 */
export function labBands(cfg: BandConfig, carriers: Carrier[], cells: CellTower[], seen: number[] = []): number[] {
  const score = new Map<number, number>();
  // ترددات شفناها مدموجة قبل (بعض الراوترات ما تدمج وهي فاضية)
  for (const b of seen) score.set(b, -60);
  for (const c of carriers) if (c.tech === 'LTE') score.set(c.band, Math.max(score.get(c.band) ?? -999, (c.rsrp ?? -100) + 50));
  for (const c of cells) {
    if (c.tech !== 'LTE' || !c.band || c.rsrp === undefined || c.rsrp < -112) continue;
    score.set(c.band, Math.max(score.get(c.band) ?? -999, c.rsrp));
  }
  return [...score.entries()]
    .filter(([b]) => cfg.supported.includes(b))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([b]) => b)
    .sort((a, b) => a - b);
}

/** ترددات 4G اللي ظهرت في سجل الإشارة آخر ٧ أيام */
export async function seenBands(routerId: string): Promise<number[]> {
  const since = Date.now() - 7 * 86400000;
  const out = new Set<number>();
  for (const s of await loadHistory(routerId)) {
    if (s.t < since || !s.band) continue;
    for (const m of s.band.matchAll(/\bB(\d+)/g)) out.add(parseInt(m[1], 10));
  }
  return [...out];
}

/** تركيبات الدمج (٢ فأكثر) — الأكبر أول، بحد أقصى ٦ */
export function labCombos(bands: number[]): number[][] {
  const out: number[][] = [];
  const n = bands.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const c = bands.filter((_, i) => mask & (1 << i));
    if (c.length >= 2) out.push(c);
  }
  return out.sort((a, b) => b.length - a.length).slice(0, 6);
}

export interface LabRow {
  bands: number[];
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;
  snap?: Snapshot | null;
}

/**
 * يجرب كل تركيبة: يثبّت ← ينتظر الاتصال ← يستقر ← يقيس. وبالآخر يرجع الإعداد الأصلي دائماً.
 */
export async function runCaLab(o: {
  r: SavedRouter;
  cfg: BandConfig;
  rows: LabRow[];
  update: (i: number, p: Partial<LabRow>) => void;
  isCancelled: () => boolean;
}): Promise<void> {
  const { r, cfg, rows, update, isCancelled } = o;
  try {
    for (let i = 0; i < rows.length; i++) {
      if (isCancelled()) break;
      const combo = rows[i].bands;
      update(i, { status: 'testing', note: 'نثبّت التركيبة...' });
      try {
        await withSession(r, d => d.setBand!(combo, cfg.nrLocked), false);
        update(i, { note: 'ننتظر الاتصال...' });
        const ok = await waitOnline(r, 40000, isCancelled);
        if (isCancelled()) { update(i, { status: 'pending', note: undefined }); break; }
        if (!ok) { update(i, { status: 'failed', note: 'ما اتصل على هالتركيبة' }); continue; }
        update(i, { note: 'ننتظر الدمج يستقر...' });
        await sleep(7000);
        update(i, { note: 'نقيس...' });
        const snap = await snapshot(r, false, 3);
        update(i, { status: snap ? 'done' : 'failed', snap, note: snap ? undefined : 'ما قدرنا نقيس' });
      } catch (e: any) {
        update(i, { status: 'failed', note: e?.message ?? 'خطأ' });
      }
    }
  } finally {
    try { await withSession(r, d => d.setBand!(cfg.locked, cfg.nrLocked), false); } catch {}
    await waitOnline(r, 45000, () => false);
  }
}

// ─── كاشف مرساة 5G ───

export interface AnchorRow {
  band: number;
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;
  /** 5G اتصل فعلاً (NSA) وهذا التردد أساسي */
  nrActive?: boolean;
  /** شاف برج 5G على الأقل */
  nrSeen?: boolean;
  nrBand?: number;
  nrRsrp?: number;
  lteRsrp?: number;
}

/** 5G من الإشارة أو من أبراج 5G اللي يشوفها الراوتر */
async function readNr(d: RouterDriver): Promise<{ active: boolean; band?: number; rsrp?: number; lte?: number }> {
  const sig: Signal = d.getSignal ? await d.getSignal() : ({} as Signal);
  if (sig.nrRsrp !== undefined) {
    const m = (sig.nrBand ?? '').match(/(\d+)/);
    return { active: true, band: m ? parseInt(m[1], 10) : undefined, rsrp: sig.nrRsrp, lte: sig.rsrp };
  }
  const cells: CellTower[] = d.getCells ? await d.getCells().catch(() => []) : [];
  const nr = cells.filter(c => c.tech === 'NR' && c.rsrp !== undefined).sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))[0];
  return { active: false, band: nr?.band, rsrp: nr?.rsrp, lte: sig.rsrp };
}

/**
 * لكل تردد 4G: نثبّته لحاله (يصير هو الأساسي) ← نحمّل ١٢ ثانية عشان 5G يصحى ← نشوف هل اتصل 5G.
 * يستهلك تقريباً ٢٥ ميقا لكل تردد.
 */
export async function runAnchorScan(o: {
  r: SavedRouter;
  cfg: BandConfig;
  rows: AnchorRow[];
  update: (i: number, p: Partial<AnchorRow>) => void;
  isCancelled: () => boolean;
}): Promise<void> {
  const { r, cfg, rows, update, isCancelled } = o;
  try {
    for (let i = 0; i < rows.length; i++) {
      if (isCancelled()) break;
      const band = rows[i].band;
      update(i, { status: 'testing', note: 'نثبّت التردد...' });
      try {
        await withSession(r, d => d.setBand!([band], cfg.nrLocked), false);
        update(i, { note: 'ننتظر الاتصال...' });
        const ok = await waitOnline(r, 40000, isCancelled);
        if (isCancelled()) { update(i, { status: 'pending', note: undefined }); break; }
        if (!ok) { update(i, { status: 'failed', note: 'ما فيه تغطية على هالتردد' }); continue; }

        update(i, { note: 'نصحّي 5G بتحميل قصير...' });
        const burst = trafficBurst(12000, 30_000_000, isCancelled);
        await sleep(2500);
        let best: { active: boolean; band?: number; rsrp?: number; lte?: number } = { active: false };
        const end = Date.now() + 10000;
        while (Date.now() < end && !isCancelled()) {
          try {
            const x = await withSession(r, readNr, false);
            const better = (x.active && !best.active) ||
              (x.active === best.active && (x.rsrp ?? -999) > (best.rsrp ?? -999));
            if (better) best = x;
          } catch {}
          await sleep(1500);
        }
        await burst.catch(() => 0);
        update(i, {
          status: 'done',
          nrActive: best.active,
          nrSeen: best.rsrp !== undefined,
          nrBand: best.band,
          nrRsrp: best.rsrp,
          lteRsrp: best.lte,
          note: undefined,
        });
      } catch (e: any) {
        update(i, { status: 'failed', note: e?.message ?? 'خطأ' });
      }
    }
  } finally {
    try { await withSession(r, d => d.setBand!(cfg.locked, cfg.nrLocked), false); } catch {}
    await waitOnline(r, 45000, () => false);
  }
}
