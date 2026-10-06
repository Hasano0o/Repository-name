import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Carrier, RouterDriver, Signal } from '../drivers/types';
import { SavedRouter } from '../store/routers';
import { withSession, withRouterLock, dropSession } from '../store/sessions';
import { getBaseline } from '../store/baseline';
import { driverById } from '../drivers/registry';
import { trafficBurst } from './nrprobe';
import { isNoService } from './signal';

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
  /** رقم الخلية الأساسية — نكشف فيه هل تغيّر البرج أثناء القياس */
  pci?: string;
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
  let pci: string | undefined;
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
      pci = sig.pci ?? pci;
    } catch {}
    if (i < samples - 1) await sleep(2500);
  }
  if (!caps.length) return null;
  return { cap: avg(caps)!, rsrp: avg(rs), sinr: avg(ss), bw, carriers: n, nr, bands, pci };
}

export async function waitOnline(r: SavedRouter, timeoutMs: number, isCancelled: () => boolean) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !isCancelled()) {
    await sleep(3000);
    try {
      const ok = await withSession(r, async d => {
        // الإشارة نفسها هي الحكم: لو فيه قراءة برج والمودم ما يقول «خدمة محدودة» = رجعت
        const s = d.getSignal ? await d.getSignal().catch(() => null) : null;
        if (s && (s.rsrp !== undefined || s.nrRsrp !== undefined)) return !isNoService(s);
        if (s && isNoService(s)) return false;
        return d.isConnected ? await d.isConnected() : !d.getSignal;
      }, false);
      if (ok) return true;
    } catch {}
  }
  return false;
}

// ─── الإنقاذ: يرجّع الراوتر لإعداداته الأصلية بدون إعادة ضبط مصنع ───

/** هل نوع هذا الراوتر يدعم «رجّع الإعدادات الأصلية»؟ */
export function canRescue(r: SavedRouter | null | undefined): boolean {
  if (!r) return false;
  const d = driverById(r.driverId);
  return !!d?.restoreAll;
}

/**
 * يفك كل الأقفال ويرجع الإعدادات الأصلية ويعيد التشغيل، وينتظر الراوتر يرجع.
 * يعيد المحاولة لو الراوتر كان في نص إعادة تشغيل. يرجع true لو رجع الاتصال.
 */
export async function rescueRouter(r: SavedRouter, say: (s: string) => void = () => {}): Promise<boolean> {
  const baseline = await getBaseline(r.id);
  let lastErr: unknown;
  let sent = false;
  for (let i = 0; i < 5 && !sent; i++) {
    if (i) { say('الراوتر ما رد — نعيد المحاولة...'); await sleep(10000); }
    try {
      dropSession(r.id);
      say('نفك كل الأقفال ونرجّع الإعدادات الأصلية...');
      await withSession(r, d => {
        if (!d.restoreAll) throw new Error('هذا النوع من الراوترات ما يدعم الإرجاع التلقائي');
        return d.restoreAll(baseline);
      }, false);
      sent = true;
    } catch (e) {
      lastErr = e;
      if (/ما يدعم/.test(String((e as any)?.message))) break;
    }
  }
  if (!sent) throw lastErr ?? new Error('ما قدرنا نوصل للراوتر');
  dropSession(r.id);
  say('الراوتر يعيد التشغيل — ننتظره يرجع (دقيقتين تقريباً)...');
  await sleep(25000);
  return waitOnline(r, 180000, () => false);
}

/**
 * «رجّع الإشارة»: ما نرجع لإعداد سابق (ممكن يكون هو بعد مقفول على برج ميت) —
 * نفك كل التثبيتات ونخلي الراوتر يلقط أقوى برج بنفسه، والمستخدم بعدها يتحكم براحته.
 * ١. فك تثبيت الأبراج + الترددات على التلقائي (بدون إعادة تشغيل — أسرع)
 * ٢. ما رجع؟ الإنقاذ الكامل (الإعدادات الأصلية + إعادة تشغيل) أو إعادة تشغيل عادية
 */
export async function freeRelease(r: SavedRouter, say: (s: string) => void = () => {}): Promise<boolean> {
  say('نفك كل التثبيتات عشان الراوتر يلقط أقوى برج...');
  let released = false;
  for (let i = 0; i < 3 && !released; i++) {
    if (i) await sleep(5000);
    try {
      dropSession(r.id);
      await withSession(r, async d => {
        if (d.unlockCell) { try { await d.unlockCell(); } catch {} }
        if (d.setBand) { try { await d.setBand([], []); } catch {} }
      }, false);
      released = true;
    } catch {}
  }
  if (released) {
    say('ننتظر الراوتر يلقط أقوى برج...');
    // المودم ياخذ وقت يمسح الأبراج — نعطيه دقيقة ونص قبل ما نعيد التشغيل
    if (await waitOnline(r, 90000, () => false)) return true;
  }
  if (canRescue(r)) {
    try { return await rescueRouter(r, say); } catch {}
    return false;
  }
  say('ما رجعت الإشارة — نعيد تشغيل الراوتر...');
  try {
    dropSession(r.id);
    await withSession(r, async d => { if (d.reboot) await d.reboot(); }, false);
  } catch {}
  dropSession(r.id);
  await sleep(25000);
  return waitOnline(r, 180000, () => false);
}

export type TrialVerdict = 'better' | 'same' | 'worse' | 'noconn';

export interface TrialResult {
  verdict: TrialVerdict;
  kept: boolean;
  before: Snapshot | null;
  after: Snapshot | null;
  /** نسبة التغير في السعة (0.3 = أفضل ٣٠٪) */
  change?: number;
  /** رجّعنا الإعداد لكن الراوتر ما رجع أونلاين — يحتاج تدخّل المستخدم */
  restoreFailed?: boolean;
  /** تغيّر البرج الأساسي أثناء القياس — المقارنة صارت تقديرية */
  towerChanged?: boolean;
  /** ثبتنا الجديد بناءً على طلب المستخدم رغم أنه أسوأ */
  userKeptAnyway?: boolean;
  /** فكّينا كل التثبيتات (الراوتر على التلقائي يلقط أقوى برج) */
  freed?: boolean;
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
export interface SafeApplyOpts {
  r: SavedRouter;
  key: string;
  label: string;
  apply: (d: RouterDriver) => Promise<void>;
  revert: (d: RouterDriver) => Promise<void>;
  onStatus?: (s: string) => void;
  isCancelled?: () => boolean;
  withNr?: boolean;
}

/** يطبّق بأمان، ومقفول لكل راوتر عشان ما تشتغل عمليتان معاً */
export function safeApply(o: SafeApplyOpts): Promise<TrialResult> {
  return withRouterLock(o.r.id, () => safeApplyInner(o));
}

async function safeApplyInner(o: SafeApplyOpts): Promise<TrialResult> {
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
    // ما اتصل: أهم شي ترجع الإشارة — نفك كل شي ويلقط أقوى برج (مو الإعداد السابق)
    say('ما اتصل — نرجّع الإشارة...');
    const back = await freeRelease(o.r, say);
    const res: TrialResult = { verdict: 'noconn', kept: false, before, after: null, restoreFailed: !back, freed: true };
    await record(o.r.id, o.key, o.label, res);
    return res;
  }

  say('ننتظر الإشارة تستقر...');
  await sleep(6000);
  say('نقيس بعد التغيير...');
  const after = await measure();

  const change = before && after && before.cap > 0 ? (after.cap - before.cap) / before.cap : undefined;
  const towerChanged = !!(before?.pci && after?.pci && before.pci !== after.pci);
  let verdict: TrialVerdict = 'same';
  if (!after) verdict = 'noconn';
  else if (change !== undefined && change <= WORSE) verdict = 'worse';
  else if (change !== undefined && change >= BETTER) verdict = 'better';
  let kept = verdict === 'better' || verdict === 'same';
  let userKeptAnyway = false;
  let restoreFailed = false;

  // لو الجديد أسوأ — نسأل المستخدم: يثبت الجديد أم نرجع للسابق؟
  if (verdict === 'worse') {
    say('الجديد أضعف — ننتظر قرارك...');
    const decision = await askUserOnWorse({
      before, after, change, label: o.label,
    });
    if (decision === 'keep') {
      userKeptAnyway = true;
      kept = true;
      say('ثبّتنا الجديد بناءً على طلبك.');
    }
  }

  if (!kept) {
    say('نرجع الإعداد السابق...');
    try { await withSession(o.r, o.revert, false); } catch {}
    let back = await waitOnline(o.r, 45000, () => false);
    // السابق ما رجّع الخدمة — نفك كل شي ويلقط أقوى برج
    if (!back) back = await freeRelease(o.r, say);
    restoreFailed = !back;
  }

  const res: TrialResult = { verdict, kept, before, after, change, restoreFailed, towerChanged, userKeptAnyway };
  await record(o.r.id, o.key, o.label, res);
  return res;
}

/** نص تفصيلي لإشارة الـ snapshot */
function fmtSnapFull(s: Snapshot | null): string {
  if (!s) return '—';
  const parts: string[] = [];
  if (s.rsrp !== undefined) parts.push(`RSRP ${Math.round(s.rsrp)} dBm`);
  if (s.sinr !== undefined) parts.push(`SINR ${Math.round(s.sinr)} dB`);
  parts.push(`${s.carriers} نواقل`);
  if (s.bw) parts.push(`${Math.round(s.bw)} MHz`);
  if (s.bands) parts.push(s.bands);
  return parts.join(' · ');
}

/**
 * يسأل المستخدم لما الجديد يطلع أسوأ:
 *  - «موافق — ثبّت الجديد»  → نخليه (المستخدم يعرف مصلحته)
 *  - «رجّعني للسابق»         → نرجع الإعداد
 */
function askUserOnWorse(info: {
  before: Snapshot | null;
  after: Snapshot | null;
  change?: number;
  label: string;
}): Promise<'keep' | 'revert'> {
  return new Promise(resolve => {
    const pct = info.change !== undefined
      ? `${Math.round(Math.abs(info.change) * 100)}٪`
      : 'أضعف';
    const msg =
      `الجديد أضعف بـ ${pct}.\n\n` +
      `⚪ الحالي (قبل):\n${fmtSnapFull(info.before)}\n\n` +
      `🟣 المختار (بعد):\n${fmtSnapFull(info.after)}\n\n` +
      `وش تبي نسوي؟`;
    Alert.alert(
      `⚠️ ${info.label}`,
      msg,
      [
        {
          text: 'رجّعني للسابق',
          style: 'cancel',
          onPress: () => resolve('revert'),
        },
        {
          text: 'موافق — ثبّت الجديد',
          onPress: () => resolve('keep'),
        },
      ],
      { cancelable: false },
    );
  });
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
  const warn = res.restoreFailed ? '⚠️ ما قدرنا نتأكد إن الراوتر رجع — لو النت مقطوع، افتح الراوتر في التطبيق واضغط «رجّع الإعدادات الأصلية» (بدون إعادة ضبط مصنع).\n\n' : '';
  const tower = res.towerChanged ? '\n\n(لاحظنا تغيّر البرج أثناء القياس — المقارنة تقديرية)' : '';
  switch (res.verdict) {
    case 'better':
      return { title: '✅ صار أفضل', body: `${label} رفع السعة المتوقعة تقريباً ${pct(res.change!)} — خليناه.\n\n${b}${tower}` };
    case 'same':
      return {
        title: '➖ ما فرق كثير',
        body: `${label} ما غيّر شي واضح${res.change !== undefined ? ` (${res.change >= 0 ? '+' : '−'}${pct(res.change)})` : ''} — خليناه، وتقدر تلغيه متى ما بغيت.\n\n${b}`,
      };
    case 'worse':
      if (res.userKeptAnyway) {
        return {
          title: '⚠️ ثبّتنا الجديد (بناءً على طلبك)',
          body: `${label} كان أضعف بـ ${pct(res.change!)} — بس ثبتّناه بأمرك.\n\n${b}${tower}\n\n💡 إذا تبي ترجع للسابق، اذهب لشاشة الأبراج → «رجوع للتلقائي».`,
        };
      }
      return {
        title: '↩️ رجعنا الإعداد السابق',
        body: `${warn}${label} خلّى الاتصال أسوأ بـ ${pct(res.change!)}${res.before && res.after && res.after.carriers < res.before.carriers ? ' — غالباً لأنه أوقف دمج الترددات' : ''}، فرجعنا إعدادك تلقائياً.\n\n${b}${tower}`,
      };
    default:
      if (res.freed && !res.restoreFailed) {
        return { title: '↩️ ما اتصل — ورجّعنا الإشارة', body: `الراوتر ما اتصل بعد ${label}، ففكّينا كل التثبيتات وخليناه يلقط أقوى برج تلقائياً.\n\nالإشارة رجعت — تقدر تجرّب إعداد ثاني براحتك.` };
      }
      return { title: '↩️ ما اتصل', body: `${warn}الراوتر ما اتصل بعد ${label}، فحاولنا نفك كل التثبيتات ونرجّع الإشارة.` };
  }
}
