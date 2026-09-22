import { BandConfig, Carrier, CellTower, RouterDriver, Signal } from '../drivers/types';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { snapshot, waitOnline, Snapshot } from './safeLock';
import { trafficBurst } from './nrprobe';
import { measureLatency, LatencyResult } from './latency';
import { loadHistory } from '../store/history';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const comboName = (bands: number[]) => bands.map(b => `B${b}`).join('+');

/**
 * ترددات 4G اللي تستاهل التجربة: اللي شغالة الحين + اللي لها برج قوي حولك (ومدعومة في الراوتر).
 * حد أقصى ٤ عشان التجربة ما تطول.
 */
export function labBands(cfg: BandConfig, carriers: Carrier[], cells: CellTower[], seen: number[] = []): number[] {
  const score = new Map<number, number>();
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

/** تركيبات الدمج 4G (٢ فأكثر) — الأكبر أول، بحد أقصى ٦ */
export function labCombos(bands: number[]): number[][] {
  const out: number[][] = [];
  const n = bands.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const c = bands.filter((_, i) => mask & (1 << i));
    if (c.length >= 2) out.push(c);
  }
  return out.sort((a, b) => b.length - a.length).slice(0, 6);
}

/** ═══ تركيبة موحّدة: 4G (فردي/مزدوج) + 5G (اختياري) ═══ */
export interface Combo {
  lte: number[];
  nr: number[];
}

/**
 * يبني كل التركيبات اللي تستاهل التجربة:
 *  - 4G فردي (كل تردد لحاله)
 *  - 4G مزدوج (التركيبات الأكثر منطقية)
 *  - 4G + 5G (NSA) — الأهم لحالتك
 */
export function buildAllCombos(lteBands: number[], nrBands: number[]): Combo[] {
  const out: Combo[] = [];
  const seen = new Set<string>();
  const push = (lte: number[], nr: number[]) => {
    const k = lte.join('+') + '|' + nr.join('+');
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ lte: [...lte], nr: [...nr] });
  };

  // 4G فردي — كل واحد لحاله
  for (const b of lteBands) push([b], []);

  // 4G + 5G — كل 4G مع كل 5G
  for (const nr of nrBands) {
    for (const lte of lteBands) {
      push([lte], [nr]);
    }
  }

  // 4G مزدوج — أزواج من اللي عندنا
  for (let i = 0; i < lteBands.length; i++) {
    for (let j = i + 1; j < lteBands.length; j++) {
      push([lteBands[i], lteBands[j]], []);
    }
  }

  return out.slice(0, 12);
}

export interface LabRow {
  /** ترددات 4G */
  bands: number[];
  /** ترددات 5G — فاضية = بدون 5G */
  nrBands?: number[];
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;
  snap?: Snapshot | null;
  /** سرعة تنزيل فعلية Mbps */
  speedMbps?: number;
  /** ping (median ms) */
  pingMs?: number;
  /** 5G نشط فعلاً (من القياس) */
  nrActive?: boolean;
}

/**
 * يجرب كل تركيبة: يثبّت ← ينتظر الاتصال ← يستقر ← يقيس (إشارة + سرعة + بنق). وبالآخر يرجع الإعداد الأصلي دائماً.
 */
export async function runCaLab(o: {
  r: SavedRouter;
  cfg: BandConfig;
  rows: LabRow[];
  update: (i: number, p: Partial<LabRow>) => void;
  isCancelled: () => boolean;
  /** قياس سرعة فعلية — يستهلك ~٢٠ ميقا لكل تركيبة */
  measureSpeed?: boolean;
}): Promise<void> {
  const { r, cfg, rows, update, isCancelled, measureSpeed = false } = o;
  try {
    for (let i = 0; i < rows.length; i++) {
      if (isCancelled()) break;
      const row = rows[i];
      const lte = row.bands;
      const nr = row.nrBands ?? [];
      update(i, { status: 'testing', note: 'نثبّت...' });
      try {
        const nrLock = nr.length ? nr : cfg.nrLocked;
        await withSession(r, d => d.setBand!(lte, nrLock), false);
        update(i, { note: 'ننتظر الاتصال...' });
        const ok = await waitOnline(r, 40000, isCancelled);
        if (isCancelled()) { update(i, { status: 'pending', note: undefined }); break; }
        if (!ok) { update(i, { status: 'failed', note: 'ما اتصل على هالتركيبة' }); continue; }

        // لو فيها 5G: نصحّي بتحميل قصير
        if (nr.length) {
          update(i, { note: 'نصحّي 5G...' });
          await trafficBurst(4500, 10_000_000, isCancelled).catch(() => 0);
        }
        update(i, { note: 'ننتظر الدمج يستقر...' });
        await sleep(4000);

        update(i, { note: 'نقيس الإشارة...' });
        const snap = await snapshot(r, nr.length > 0, 3);
        const nrActive = !!snap?.nr;

        // سرعة + بنق
        let speedMbps: number | undefined;
        let pingMs: number | undefined;
        if (measureSpeed && !isCancelled()) {
          update(i, { note: 'نقيس السرعة...' });
          try {
            const t0 = Date.now();
            const bytes = await trafficBurst(6500, 25_000_000, isCancelled);
            const secs = Math.max(1, (Date.now() - t0) / 1000);
            speedMbps = Math.round((bytes * 8) / (secs * 1_000_000) * 10) / 10;
          } catch {}
          if (!isCancelled()) {
            update(i, { note: 'نقيس الاستجابة...' });
            try {
              const lat: LatencyResult = await measureLatency(6);
              if (lat.samples) pingMs = lat.median;
            } catch {}
          }
        }

        update(i, {
          status: snap ? 'done' : 'failed',
          snap, speedMbps, pingMs, nrActive,
          note: snap ? undefined : 'فشل القياس',
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

// ─── كاشف مرساة 5G ───
export interface AnchorRow {
  band: number;
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;
  nrActive?: boolean;
  nrSeen?: boolean;
  nrBand?: number;
  nrRsrp?: number;
  lteRsrp?: number;
}

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
