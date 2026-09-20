import { CellTower, RouterDriver } from '../drivers/types';

const URL = 'https://speed.cloudflare.com/__down?bytes=8000000';

/**
 * تحميل قصير يصحّي وصلة 5G النائمة (شبكات NSA لا تضيف 5G إلا عند وجود بيانات).
 * خيطان متوازيان لمدة محددة، بسقف أعلى للاستهلاك. يرجع عدد البايتات المكتملة (تقدير أدنى).
 */
export async function trafficBurst(
  durationMs = 9000,
  capBytes = 40_000_000,
  isCancelled: () => boolean = () => false,
): Promise<number> {
  const end = Date.now() + durationMs;
  let used = 0;
  const worker = async () => {
    while (Date.now() < end && used < capBytes && !isCancelled()) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), Math.max(400, end - Date.now()));
      try {
        const r = await fetch(`${URL}&r=${Math.random()}`, { signal: ctrl.signal });
        const b = await r.arrayBuffer();
        used += b.byteLength;
      } catch {
        // انتهى الوقت أو انقطع — طبيعي
      } finally {
        clearTimeout(t);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return used;
}

const key = (c: CellTower) => `${c.tech}:${c.band ?? '?'}:${c.pci ?? '?'}`;

/** يجمع خلايا 5G التي تظهر أثناء التحميل — من قائمة الأبراج ومن قراءة الإشارة */
export async function collectNr(
  d: RouterDriver,
  into: Map<string, CellTower>,
): Promise<void> {
  const [cells, sig] = await Promise.all([
    d.getCells ? d.getCells().catch(() => [] as CellTower[]) : Promise.resolve([] as CellTower[]),
    d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
  ]);

  for (const c of cells) {
    if (c.tech !== 'NR') continue;
    const k = key(c);
    const cur = into.get(k);
    if (!cur || (c.rsrp ?? -999) > (cur.rsrp ?? -999)) into.set(k, c);
  }

  // الخلية الخادمة لـ5G قد لا تظهر في القائمة لكنها تظهر في قراءة الإشارة
  if (sig && sig.nrRsrp !== undefined) {
    const m = (sig.nrBand ?? '').match(/(\d+)/);
    const nr: CellTower = {
      kind: 'secondary',
      tech: 'NR',
      band: m ? parseInt(m[1], 10) : undefined,
      pci: sig.nrPci,
      arfcn: sig.nrArfcn,
      rsrp: sig.nrRsrp,
      rsrq: sig.nrRsrq,
      sinr: sig.nrSinr,
    };
    const k = key(nr);
    const cur = into.get(k);
    if (!cur || (nr.rsrp ?? -999) > (cur.rsrp ?? -999)) into.set(k, nr);
  }
}

export const mb = (bytes: number) => Math.max(1, Math.round(bytes / 1e6));
