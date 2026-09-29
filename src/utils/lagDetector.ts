import AsyncStorage from '@react-native-async-storage/async-storage';

/* ═══ كاشف اللاق ═══
 * نجمع عينات بنق كل ثانية، وعينات من الراوتر كل ٥ ثواني،
 * وبعدها نطلع «حوادث اللاق» ونربط كل حادثة بسببها الأرجح. */

export interface PingSample { t: number; ms: number | null }
export interface RouterSample {
  t: number;
  pci?: string;
  band?: string;
  nrBand?: string;
  nrOn?: boolean;
  sinr?: number;
  rsrp?: number;
  /** بين الجوال والراوتر — null يعني ما رد */
  wifiMs?: number | null;
  /** سرعة التنزيل الكلية على الراوتر (بايت/ثانية) */
  downBps?: number;
}
export interface Gap { from: number; to: number }

export type Cause = 'handover' | 'nr' | 'wifi' | 'signal' | 'traffic' | 'network';

export const CAUSE_TEXT: Record<Cause, { title: string; fix: string; icon: string }> = {
  handover: { icon: '🗼', title: 'الراوتر نقل لبرج أو تردد ثاني', fix: 'ثبّت البرج من «الأبراج» أو ثبّت التردد الأفضل من مُحسّن اللعبة' },
  nr: { icon: '⚡', title: 'انقطع 5G ورجع لـ4G', fix: 'جرّب «4G فقط» في مُحسّن اللعبة — أثبت وقت اللعب' },
  wifi: { icon: '📶', title: 'الواي فاي بين الجهاز والراوتر', fix: 'قرّب من الراوتر، استخدم شبكة 5GHz، أو وصّل كيبل' },
  signal: { icon: '📉', title: 'إشارة الراوتر نزلت', fix: 'وجّه الأنتنا من مساعد التوجيه، أو غيّر مكان الراوتر' },
  traffic: { icon: '📥', title: 'جهاز ثاني كان يحمّل', fix: 'افصل الأجهزة اللي تحمّل وقت اللعب من «الأجهزة»' },
  network: { icon: '🌐', title: 'زحمة البرج أو الطريق للسيرفر', fix: 'شوف «أفضل وقت للعب»، أو جرّب تردد ثاني من مُحسّن اللعبة' },
};

export interface Incident {
  from: number;
  to: number;
  worstMs: number | null;
  lost: number;
  cause: Cause;
  detail?: string;
}

export interface LagReport {
  startedAt: number;
  endedAt: number;
  region: string;
  /** نسبة الوقت اللي فعلاً راقبناه (الباقي كان التطبيق بالخلفية) */
  coveragePct: number;
  samples: number;
  avgMs: number;
  baseMs: number;
  jitter: number;
  lossPct: number;
  lagSecs: number;
  incidents: Incident[];
  causes: Partial<Record<Cause, number>>;
  topCause?: Cause;
  score: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** البنق «الطبيعي» — الوسيط مع استبعاد الربع الأعلى */
export function baseline(pings: PingSample[]): number {
  const v = pings.map(p => p.ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return 0;
  return median(v.slice(0, Math.max(1, Math.ceil(v.length * 0.75))));
}

export const isSpike = (ms: number | null, base: number) => ms === null || (base > 0 && ms > Math.max(base * 1.8, base + 40));

function causeOf(inc: { from: number; to: number }, routers: RouterSample[], base: number): { cause: Cause; detail?: string } {
  const win = routers.filter(r => r.t >= inc.from - 10000 && r.t <= inc.to + 8000);
  const before = routers.filter(r => r.t < inc.from - 10000).slice(-6);
  const ref = before.length ? before : routers.slice(0, 6);

  // ١) تغيّر البرج أو التردد
  const all = [...ref.slice(-1), ...win];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i];
    if (a.pci && b.pci && a.pci !== b.pci) return { cause: 'handover', detail: `برج ${a.pci} ← ${b.pci}` };
    if (a.band && b.band && a.band !== b.band) return { cause: 'handover', detail: `${a.band} ← ${b.band}` };
  }
  // ٢) سقوط 5G
  for (let i = 1; i < all.length; i++) {
    if (all[i - 1].nrOn && all[i].nrOn === false) return { cause: 'nr' };
  }
  // ٣) الواي فاي
  const wifiBad = win.filter(r => r.wifiMs === null || (r.wifiMs !== undefined && r.wifiMs > 80));
  if (wifiBad.length && wifiBad.length >= Math.ceil(win.filter(r => r.wifiMs !== undefined).length / 2)) {
    return { cause: 'wifi' };
  }
  // ٤) نزول الإشارة
  const refSinr = median(ref.map(r => r.sinr).filter((x): x is number => x !== undefined));
  const minSinr = Math.min(...win.map(r => r.sinr ?? 99));
  if (ref.length && minSinr !== 99 && refSinr - minSinr >= 5) {
    return { cause: 'signal', detail: `SINR ${refSinr.toFixed(0)} ← ${minSinr.toFixed(0)}` };
  }
  // ٥) تحميل من جهاز ثاني
  const maxDown = Math.max(0, ...win.map(r => r.downBps ?? 0));
  if (maxDown > 1.5 * 1024 * 1024) {
    return { cause: 'traffic', detail: `${(maxDown / 1048576).toFixed(1)} ميقابايت/ث` };
  }
  void base;
  return { cause: 'network' };
}

/** يجمع العينات المتتالية المرتفعة في حوادث */
export function findIncidents(pings: PingSample[], routers: RouterSample[], base: number): Incident[] {
  const out: Incident[] = [];
  let cur: { from: number; to: number; worst: number | null; lost: number; n: number } | null = null;
  const flush = () => {
    if (cur && (cur.n >= 2 || cur.lost > 0)) {
      const c = causeOf(cur, routers, base);
      out.push({ from: cur.from, to: cur.to, worstMs: cur.worst, lost: cur.lost, ...c });
    }
    cur = null;
  };
  for (const p of pings) {
    if (isSpike(p.ms, base)) {
      if (cur && p.t - cur.to <= 3000) {
        cur.to = p.t;
        cur.n++;
        if (p.ms === null) cur.lost++;
        else cur.worst = cur.worst === null ? p.ms : Math.max(cur.worst, p.ms);
      } else {
        flush();
        cur = { from: p.t, to: p.t, worst: p.ms, lost: p.ms === null ? 1 : 0, n: 1 };
      }
    } else if (cur && p.t - cur.to > 3000) {
      flush();
    }
  }
  flush();
  return out;
}

export function buildReport(
  startedAt: number, endedAt: number, region: string,
  pings: PingSample[], routers: RouterSample[], gaps: Gap[],
): LagReport {
  const base = baseline(pings);
  const ok = pings.map(p => p.ms).filter((x): x is number => x !== null);
  const lost = pings.length - ok.length;
  let diffs = 0;
  for (let i = 1; i < ok.length; i++) diffs += Math.abs(ok[i] - ok[i - 1]);
  const jitter = ok.length > 1 ? Math.round(diffs / (ok.length - 1)) : 0;
  const incidents = findIncidents(pings, routers, base);
  const causes: Partial<Record<Cause, number>> = {};
  let lagSecs = 0;
  for (const i of incidents) {
    causes[i.cause] = (causes[i.cause] ?? 0) + 1;
    lagSecs += Math.max(1, Math.round((i.to - i.from) / 1000) + 1);
  }
  const topCause = (Object.keys(causes) as Cause[]).sort((a, b) => (causes[b] ?? 0) - (causes[a] ?? 0))[0];
  const total = Math.max(1, endedAt - startedAt);
  const gapMs = gaps.reduce((a, g) => a + (g.to - g.from), 0);
  const watched = Math.max(1, total - gapMs);
  const lossPct = pings.length ? Math.round((lost / pings.length) * 100) : 0;
  const lagPct = Math.min(100, (lagSecs * 1000 / watched) * 100);
  const avgMs = ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : 0;
  const score = pings.length
    ? Math.max(0, Math.min(100, Math.round(100 - Math.max(0, base - 15) * 0.4 - jitter * 1.2 - lossPct * 6 - lagPct * 1.5)))
    : 0;
  return {
    startedAt, endedAt, region,
    coveragePct: Math.round((watched / total) * 100),
    samples: pings.length,
    avgMs, baseMs: Math.round(base), jitter, lossPct, lagSecs,
    incidents, causes, topCause, score,
  };
}

/* ═══ سجل الجلسات ═══ */
const KEY = (routerId: string) => `bandly.lagsessions.${routerId}`;

export async function listLagSessions(routerId: string): Promise<LagReport[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(routerId));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function saveLagSession(routerId: string, r: LagReport): Promise<void> {
  const list = await listLagSessions(routerId);
  list.push({ ...r, incidents: r.incidents.slice(-40) });
  try { await AsyncStorage.setItem(KEY(routerId), JSON.stringify(list.slice(-20))); } catch {}
}

export const fmtClock = (t: number) => {
  const d = new Date(t);
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

export const fmtDur = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return m ? `${m} د ${s} ث` : `${s} ث`;
};
