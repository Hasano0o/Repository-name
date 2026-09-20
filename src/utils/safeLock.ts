import AsyncStorage from '@react-native-async-storage/async-storage';
import { Carrier, RouterDriver, Signal } from '../drivers/types';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { trafficBurst } from './nrprobe';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** لقطة واحدة للوضع: الإشارة + النواقل + سعة تقديرية */
export interface Snapshot {
  rsrp?: number;
  sinr?: number;
  /** مجموع عرض النطاق بالميقاهرتز */
  bw: number;
  carriers: number;
  nr: boolean;
  /** مؤشر سعة نسبي (للمقارنة فقط — مو سرعة حقيقية) */
  cap: number;
  bands: string;
}

const mhz = (s?: string) => {
  const m = (s ?? '').match(/(\d+(?:\.\d+)?)\s*MHz/i);
  return m ? parseFloat(m[1]) : undefined;
};

/** شانون المبسط: العرض × log2(1+SINR) — نسقف SINR عند 25 لأن الراوتر ما يستفيد فوقها */
const shannon = (bw: number, sinr?: number) => {
  const s = Math.min(25, Math.max(-5, sinr ?? 0));
  return bw * Math.log2(1 + Math.pow(10, s / 10));
};

function capacityOf(sig: Signal, carriers: Carrier[], withNr: boolean) {
  const list = carriers.filter(c => withNr || c.tech === 'LTE');
  if (!list.length) {
    // ما عندنا نواقل — نعتمد على الخلية الأساسية فقط
    const bw = mhz(sig.band) ?? mhz(sig.dlBandwidth) ?? 20;
    let cap = shannon(bw, sig.sinr);
    let total = bw;
    let n = 1;
    if (withNr && sig.nrRsrp !== undefined) {
      const nbw = mhz(sig.nrDlBandwidth) ?? 40;
      cap += shannon(nbw, sig.nrSinr);
      total += nbw;
      n++;
    }
    return { cap, bw: total, n, bands: [sig.band ?? '', sig.nrBand ?? ''].filter(Boolean).join(' + ') };
  }
  let cap = 0;
  let bw = 0;
  for (const c of list) {
    const b = c.bandwidth ?? (c.tech === 'NR' ? 40 : 10);
    const pccSinr = c.tech === 'NR' ? sig.nrSinr : sig.sinr;
    cap += shannon(b, c.sinr ?? pccSinr);
    bw += b;
  }
  const bands = list.map(c => (c.tech === 'NR' ? `n${c.band}` : `B${c.band}`)).join(' + ');
  return { cap, bw, n: list.length, bands };
}

/** يقيس الوضع كم مرة ويرجع المتوسط */
export async function snapshot(r: SavedRouter, withNr = false, samples = 3): Promise<Snapshot | null> {
  const caps: number[] = [];
  const rs: number[] = [];
  const ss: number[] = [];
  let bw = 0;
  let n = 0;
  let nr = false;
  let bands = '';
  for (let i = 0; i < samples; i++) {
    try {
      const { sig, carriers } = await withSession(r, async (d: RouterDriver) => {
        const s = d.getSignal ? await d.getSignal() : ({} as Signal);
        const c = d.getCarriers ? await d.getCarriers().catch(() => [] as Carrier[]) : [];
        return { sig: s, carriers: c };
      }, false);
      if (sig.rsrp === undefined) continue;
      const res = capacityOf(sig, carriers, withNr);
      caps.push(res.cap);
      rs.push(sig.rsrp);
      if (sig.sinr !== undefined) ss.push(sig.sinr);
      bw = Math.max(bw, res.bw);
      n = Math.max(n, res.n);
      nr = nr || sig.nrRsrp !== undefined;
      bands = res.bands || bands;
    } catch {}
    if (i < samples - 1) await sleep(2500);
  }
  if (!caps.length) return null;
  return { cap: avg(caps)!, rsrp: avg(rs), sinr: avg(ss), bw, carriers: n, nr, bands };
}

export async function waitOnline(r: SavedRouter, timeoutMs: number, isCancelled: () => boolean) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !isCancelled()) {
    await sleep(3000);
    try {
      const ok = await withSession(r, async d => {
        const conn = d.isConnected ? await d.isConnected() : true;
        if (!conn) return false;
        const s = d.getSignal ? await d.getSignal() : null;
        return !s || s.rsrp !== undefined;
      }, false);
      if (ok) return true;
    } catch {}
  }
  return false;
}

export type TrialVerdict = 'better' | 'same' | 'worse' | 'noconn';

export interface TrialResult {
  verdict: TrialVerdict;
  kept: boolean;
  before: Snapshot | null;
  after: Snapshot | null;
  /** نسبة التغير في السعة (0.3 = أفضل ٣٠٪) */
  change?: number;
}

export interface Trial {
  key: string;
  label: string;
  at: number;
  verdict: TrialVerdict;
  change?: number;
}

/** أقل من كذا نعتبره أسوأ ونرجع — وفوق كذا نعتبره أفضل */
const WORSE = -0.15;
const BETTER = 0.1;

/**
 * يطبق تغيير (قفل تردد/برج) بأمان:
 * يقيس قبل ← يطبق ← ينتظر الاتصال ← يقيس بعد ← لو صار أسوأ يرجع تلقائياً.
 * withNr: نصحّي 5G بتحميل قصير وقت القياس (يستهلك باقة) — للتغييرات اللي تخص 5G.
 */
export async function safeApply(o: {
  r: SavedRouter;
  key: string;
  label: string;
  apply: (d: RouterDriver) => Promise<void>;
  revert: (d: RouterDriver) => Promise<void>;
  onStatus?: (s: string) => void;
  isCancelled?: () => boolean;
  withNr?: boolean;
}): Promise<TrialResult> {
  const say = o.onStatus ?? (() => {});
  const cancelled = o.isCancelled ?? (() => false);
  const measure = async () => {
    if (!o.withNr) return snapshot(o.r, false);
    const burst = trafficBurst(11000, 25_000_000, cancelled);
    await sleep(2500);
    const s = await snapshot(o.r, true);
    await burst.catch(() => 0);
    return s;
  };

  say('نقيس الوضع الحالي...');
  const before = await measure();

  say('نطبّق التغيير...');
  await withSession(o.r, o.apply, false);

  say('ننتظر الراوتر يتصل...');
  const online = await waitOnline(o.r, 45000, cancelled);
  if (!online) {
    say('ما اتصل — نرجع الإعداد السابق...');
    try { await withSession(o.r, o.revert, false); } catch {}
    await waitOnline(o.r, 45000, () => false);
    const res: TrialResult = { verdict: 'noconn', kept: false, before, after: null };
    await record(o.r.id, o.key, o.label, res);
    return res;
  }

  say('ننتظر الإشارة تستقر...');
  await sleep(6000);
  say('نقيس بعد التغيير...');
  const after = await measure();

  const change = before && after && before.cap > 0 ? (after.cap - before.cap) / before.cap : undefined;
  let verdict: TrialVerdict = 'same';
  if (!after) verdict = 'noconn';
  else if (change !== undefined && change <= WORSE) verdict = 'worse';
  else if (change !== undefined && change >= BETTER) verdict = 'better';

  const kept = verdict === 'better' || verdict === 'same';
  if (!kept) {
    say('صار أسوأ — نرجع الإعداد السابق...');
    try { await withSession(o.r, o.revert, false); } catch {}
    await waitOnline(o.r, 45000, () => false);
  }
  const res: TrialResult = { verdict, kept, before, after, change };
  await record(o.r.id, o.key, o.label, res);
  return res;
}

// ─── ذاكرة التجارب: نتعلم من اللي جربناه قبل ───

const tKey = (id: string) => `lock-trials:${id}`;

export async function loadTrials(routerId: string): Promise<Trial[]> {
  try {
    const raw = await AsyncStorage.getItem(tKey(routerId));
    return raw ? (JSON.parse(raw) as Trial[]) : [];
  } catch {
    return [];
  }
}

async function record(routerId: string, key: string, label: string, res: TrialResult) {
  try {
    const list = await loadTrials(routerId);
    list.unshift({ key, label, at: Date.now(), verdict: res.verdict, change: res.change });
    await AsyncStorage.setItem(tKey(routerId), JSON.stringify(list.slice(0, 60)));
  } catch {}
}

/** آخر تجربة لنفس التغيير — عشان ننبه قبل ما نعيده */
export async function lastTrial(routerId: string, key: string): Promise<Trial | undefined> {
  return (await loadTrials(routerId)).find(t => t.key === key);
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}٪`;

/** جملة مفهومة عن تجربة سابقة */
export function trialNote(t: Trial): string {
  const days = Math.floor((Date.now() - t.at) / 86400000);
  const when = days <= 0 ? 'اليوم' : days === 1 ? 'أمس' : `قبل ${days} أيام`;
  if (t.verdict === 'worse') return `جربناه ${when} وكان أسوأ${t.change !== undefined ? ` بـ ${pct(t.change)}` : ''} فرجعناه.`;
  if (t.verdict === 'noconn') return `جربناه ${when} وما اتصل الراوتر عليه.`;
  if (t.verdict === 'better') return `جربناه ${when} وكان أفضل${t.change !== undefined ? ` بـ ${pct(t.change)}` : ''}.`;
  return `جربناه ${when} وما فرق كثير.`;
}

const fmtSnap = (s: Snapshot | null) =>
  s
    ? `${s.bands || '—'} · ${s.carriers > 1 ? `${s.carriers} نواقل · ` : ''}${Math.round(s.bw)} MHz` +
      `${s.rsrp !== undefined ? ` · ${Math.round(s.rsrp)} dBm` : ''}${s.sinr !== undefined ? ` · SINR ${Math.round(s.sinr)}` : ''}`
    : 'ما قدرنا نقيس';

/** عنوان ونص رسالة النتيجة */
export function trialMessage(res: TrialResult, label: string): { title: string; body: string } {
  const b = `قبل: ${fmtSnap(res.before)}\nبعد: ${fmtSnap(res.after)}`;
  switch (res.verdict) {
    case 'better':
      return { title: '✅ صار أفضل', body: `${label} رفع السعة المتوقعة تقريباً ${pct(res.change!)} — خليناه.\n\n${b}` };
    case 'same':
      return {
        title: '➖ ما فرق كثير',
        body: `${label} ما غيّر شي واضح${res.change !== undefined ? ` (${res.change >= 0 ? '+' : '−'}${pct(res.change)})` : ''} — خليناه، وتقدر تلغيه متى ما بغيت.\n\n${b}`,
      };
    case 'worse':
      return {
        title: '↩️ رجعنا الإعداد السابق',
        body: `${label} خلّى الاتصال أسوأ بـ ${pct(res.change!)}${res.before && res.after && res.after.carriers < res.before.carriers ? ' — غالباً لأنه أوقف دمج الترددات' : ''}، فرجعنا إعدادك تلقائياً.\n\n${b}`,
      };
    default:
      return { title: '↩️ ما اتصل', body: `الراوتر ما اتصل بعد ${label}، فرجعنا إعدادك السابق تلقائياً.` };
  }
}
