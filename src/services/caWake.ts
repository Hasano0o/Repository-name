/**
 * «الدمج يرجع وقت التحميل» — الحل (حسن ٩ نوفمبر: «تضايق الصراحة»):
 * الراوتر ما يضيف النواقل الثانوية إلا وفيه بيانات ماشية. فلما الشاشة تشوف ناقل واحد والراوتر مثبّت على أكثر
 * (أو دمج قبل)، نحمّل بالخلفية ٤ ثواني بس (حد ٥ ميقا) ونقرأ النواقل وقتها — ونعرض الدمج الحقيقي بألوانه
 * في صفحة الراوتر و«الأساسي والثانوي». مرة كل ١٠ دقايق كحد أقصى لكل راوتر (ونص ساعة لو ما لقينا دمج مرتين)،
 * والتطبيق قدّام. قراءة بس — ما نغيّر أي إعداد في الراوتر.
 */
import { AppState } from 'react-native';
import { SavedRouter } from '../store/routers';
import { withSession, isRouterBusy } from '../store/sessions';
import { trafficBurst } from '../utils/nrprobe';
import type { Carrier, Signal } from '../drivers/types';
import { diag } from './diag';

export interface WokeCa { carriers: Carrier[]; signal: Signal | null; at: number }

const cache = new Map<string, WokeCa>();
const lastTry = new Map<string, number>();
const running = new Set<string>();
const subs = new Set<(id: string) => void>();
const MIN_GAP = 10 * 60_000;
/** ما لقينا دمج مرتين ورا بعض ← نوقف نص ساعة (البرج ما يدمج هنا — ما نحرق باقة) */
const misses = new Map<string, number>();
const MISS_GAP = 30 * 60_000;
export const WOKE_FRESH = 10 * 60_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function getWoke(id: string): WokeCa | null {
  const w = cache.get(id);
  return w && Date.now() - w.at < WOKE_FRESH ? w : null;
}
export function onWoke(fn: (id: string) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

const scc = (l: Carrier[]) => l.filter(c => c.role === 'SCC').length;

export async function wakeCa(r: SavedRouter, force = false): Promise<WokeCa | null> {
  if (running.has(r.id) || AppState.currentState !== 'active' || isRouterBusy(r)) return getWoke(r.id);
  const gap = (misses.get(r.id) ?? 0) >= 2 ? MISS_GAP : MIN_GAP;
  if (!force && Date.now() - (lastTry.get(r.id) ?? 0) < gap) return getWoke(r.id);
  running.add(r.id);
  lastTry.set(r.id, Date.now());
  try {
    let stop = false;
    const burst = trafficBurst(4500, 5_000_000, () => stop).catch(() => 0);
    let best: WokeCa | null = null;
    for (const wait of [1800, 1400, 1200]) {
      await sleep(wait);
      const got = await withSession(r, async d => {
        const [c, s] = await Promise.all([
          d.getCarriers ? d.getCarriers().catch(() => [] as Carrier[]) : Promise.resolve([] as Carrier[]),
          d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
        ]);
        return { carriers: c, signal: s, at: Date.now() } as WokeCa;
      }, false).catch(() => null);
      if (got && (!best || scc(got.carriers) > scc(best.carriers))) best = got;
    }
    stop = true;
    const used = await burst;
    diag(`[cawake] نواقل وقت التحميل: ${best ? best.carriers.map(c => (c.tech === 'NR' ? 'n' : 'B') + c.band).join('+') || '—' : 'ما وصلنا'} · ${Math.round(used / 1e5) / 10}MB`);
    if (best && scc(best.carriers) > 0) {
      misses.delete(r.id);
      cache.set(r.id, best);
      subs.forEach(f => { try { f(r.id); } catch {} });
    } else misses.set(r.id, (misses.get(r.id) ?? 0) + 1);
    return getWoke(r.id);
  } finally {
    running.delete(r.id);
  }
}
