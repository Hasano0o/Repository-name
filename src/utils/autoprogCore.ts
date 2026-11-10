/**
 * «برمج لي جهازي» — القلب (بدون react-native ولا شبكة، عليه اختبارات).
 *
 * الرسيفر يطابق ملفات صفحة الراوتر مع عائلاتنا ويقترح درايفر. الاقتراح ما ينحسب صح إلا لو
 * الدرايفر **دخل وقرأ إشارة حقيقية** من راوتر العضو — هذا الملف يسوي هالتجربة ويحكم عليها.
 * قراءة بس: دخول + قراءة إشارة + خروج. ولا أمر تغيير.
 */
import type { RouterDriver, Signal } from '../drivers/types';

export interface Verdict {
  /** match = من ملفاته · known = بصمة صفحته تبرمجت عند عضو قبل · none = للمبرمج */
  status: 'match' | 'known' | 'none';
  id?: string;
  driver?: string;
  label?: string;
  /** بصمة الصفحة عند الرسيفر — نسأله فيها لاحقاً وش مفتوح (caps) */
  key?: string;
  /** دوال التغيير اللي أمرها موجود في كود صفحة الراوتر — فاضية = قراءة بس */
  writes?: string[];
}
export const NO_VERDICT: Verdict = { status: 'none' };

/** رد السيرفر ← حكم نثق فيه: لازم رقم حالة ودرايفر موجود في هالنسخة من التطبيق */
export function parseVerdict(j: unknown, have: string[]): Verdict {
  const o = j as any;
  if (!o || typeof o !== 'object') return NO_VERDICT;
  if (o.status !== 'match' && o.status !== 'known') return NO_VERDICT;
  const id = String(o.id ?? ''), driver = String(o.driver ?? '');
  if (!/^[a-f0-9]{8,32}$/.test(id) || !have.includes(driver)) return NO_VERDICT;
  return {
    status: o.status, id, driver, label: String(o.label ?? driver).slice(0, 40),
    key: /^[a-f0-9]{8,40}$/.test(String(o.key ?? '')) ? String(o.key) : '',
    writes: cleanWrites(o.writes),
  };
}

/** أسماء دوال بس (حروف) — أي شي ثاني من السيرفر ينرمى */
export function cleanWrites(w: unknown): string[] {
  return Array.isArray(w) ? [...new Set(w.filter(x => typeof x === 'string' && /^[a-zA-Z]{3,30}$/.test(x)) as string[])].slice(0, 40) : [];
}

/** اللي نرسله من البصمة: سيرفر الراوتر وأسماء ملفات الصفحة وخانات الدخول (أسماء بس) */
export function fpPayload(fp: { server?: string; scripts?: string[]; loginFields?: string[] } | null | undefined) {
  if (!fp) return null;
  return { server: fp.server ?? '', scripts: (fp.scripts ?? []).slice(0, 20), loginFields: (fp.loginFields ?? []).slice(0, 20) };
}

const inRange = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/**
 * الخانات اللي فيها قراءة إشارة حقيقية. لازم قوة إشارة (RSRP/RSSI) بمدى منطقي —
 * صفر أو -1 أو نص فاضي = الدرايفر «قرأ» رد مو مفهوم، مو إشارة.
 */
export function signalFields(s: Signal | null | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (inRange(s.rsrp, -150, -30)) out.push('rsrp');
  if (inRange(s.nrRsrp, -150, -30)) out.push('nrRsrp');
  if (inRange(s.rssi, -120, -20)) out.push('rssi');
  if (!out.length) return [];
  if (inRange(s.sinr, -30, 50)) out.push('sinr');
  if (inRange(s.nrSinr, -30, 50)) out.push('nrSinr');
  if (inRange(s.rsrq, -40, 0)) out.push('rsrq');
  if (s.band) out.push('band');
  if (s.nrBand) out.push('nrBand');
  if (s.pci) out.push('pci');
  return out;
}

export interface TrialResult {
  ok: boolean;
  /** وين وقف: password (الكلمة غلط — مو عيب البرمجة) · login · signal · skipped (العضو ما جرّب) */
  stage: 'password' | 'login' | 'signal' | 'skipped';
  err: string;
  got: string[];
}

const PW_WRONG = /كلمة المرور|كلمة السر|الكلمة غلط|password|108006|108002|محاولات كثيرة|مقفول/i;
const clip = (e: unknown) => String((e as any)?.message ?? e ?? '').replace(/\s+/g, ' ').slice(0, 200);

/** الإشارة من getSignal، ولو الدرايفر ما عنده إلا getSnapshot ناخذ منها */
async function readSignal(d: RouterDriver): Promise<Signal | null> {
  if (d.getSignal) return d.getSignal();
  if (!d.getSnapshot) return null;
  const sn = await d.getSnapshot();
  return {
    rsrp: sn.lte?.rsrp, rsrq: sn.lte?.rsrq, sinr: sn.lte?.sinr, rssi: sn.lte?.rssi,
    band: sn.lte?.band !== undefined ? String(sn.lte.band) : undefined, pci: sn.lte?.pci,
    nrRsrp: sn.nr?.rsrp, nrSinr: sn.nr?.sinr, nrBand: sn.nr?.band !== undefined ? String(sn.nr.band) : undefined,
  };
}

/**
 * تجربة الدرايفر المقترح على راوتر العضو: دخول ← قراءة إشارة ← خروج.
 * ما ينادي أي دالة غير login / getSignal / getSnapshot / logout.
 */
export async function runTrial(d: RouterDriver, host: string, username: string, password: string, waitMs = 1500): Promise<TrialResult> {
  try {
    await d.login(host, username, password);
  } catch (e) {
    const err = clip(e);
    return { ok: false, stage: PW_WRONG.test(err) ? 'password' : 'login', err, got: [] };
  }
  try {
    let got: string[] = [];
    let last = '';
    // بعض الراوترات ترجّع أول قراءة فاضية مباشرة بعد الدخول — مرتين بفاصل قصير
    for (let i = 0; i < 2 && !got.length; i++) {
      if (i) await new Promise(res => setTimeout(res, waitMs));
      try { got = signalFields(await readSignal(d)); last = ''; } catch (e) { last = clip(e); }
    }
    if (got.length) return { ok: true, stage: 'signal', err: '', got };
    return { ok: false, stage: 'signal', err: last || 'دخلنا بس ما فيه قراءة إشارة', got: [] };
  } finally {
    try { await d.logout(); } catch { /* الخروج اختياري */ }
  }
}

// ═══ اكتشاف الميزات: وش يقرأ هالدرايفر فعلاً من راوتر العضو ═══

/** القراءات اللي نجرّبها (كلها قراءة — ولا وحدة تغيّر شي). الاسم للعضو، أو '' = نجرّبها بدون ما نعرضها */
export const DISCOVER_READS: [string, string][] = [
  ['getNetworkInfo', 'معلومات الشبكة'], ['getDeviceDetails', 'تفاصيل الجهاز'], ['getBandConfig', 'الترددات'],
  ['getCells', 'الأبراج'], ['getCarriers', 'الدمج'], ['getDevices', 'الأجهزة المتصلة'], ['getTraffic', 'السرعة الحية'],
  ['getUsage', 'الاستهلاك'], ['getTemps', 'الحرارة'], ['listSms', 'الرسائل'], ['getWifiRadios', 'قناة الواي فاي'],
  ['getExtras', 'مركز التحكم'], ['getDns', 'DNS'], ['getApnProfiles', 'APN'], ['getDataPlan', 'الباقة'],
  ['getBlockedDevices', ''], ['getNetStandard', ''], ['getCellLock', ''], ['getActiveLock', ''], ['getModems', ''], ['getDeviceUsage', ''],
];
/** أوامر التغيير بأسماء يفهمها العضو (للعرض بس) */
export const WRITE_LABELS: [string, string][] = [
  ['setBand', 'تثبيت الترددات'], ['setNetworkMode', 'وضع الشبكة'], ['reboot', 'إعادة التشغيل'], ['reconnectData', 'آي بي جديد'],
  ['reattach', 'آي بي جديد'], ['sendSms', 'إرسال الرسائل'], ['blockDevice', 'حظر الأجهزة'],
];
export function writeLabels(writes: string[] | undefined): string[] {
  const w = new Set(writes ?? []);
  return [...new Set(WRITE_LABELS.filter(([m]) => w.has(m)).map(([, l]) => l))];
}

export interface Discovery {
  /** الدالة ← اشتغلت؟ (الدوال اللي مو في الدرايفر أصلاً ما تنكتب) */
  reads: Record<string, boolean>;
  /** انقطعنا في النص (الراوتر طلّعنا / الشبكة طاحت) — النتيجة ما ينبنى عليها */
  aborted: boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error('انتهت المهلة')), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
}

/**
 * يجرّب كل قراءة مرة وحدة على راوتر العضو. قراءة ردّت بدون خطأ = موجودة.
 * ٤ فشل ورا بعض ← نتأكد بالإشارة: لو هي كمان طاحت فالمشكلة في الاتصال مو في الميزات ← نوقف وما نحفظ شي.
 */
export async function discoverReads(
  d: RouterDriver, onStep?: (done: number, total: number) => void, timeoutMs = 9000, gapMs = 250,
): Promise<Discovery> {
  const reads: Record<string, boolean> = {};
  const list = DISCOVER_READS.filter(([m]) => typeof (d as any)[m] === 'function');
  let streak = 0;
  for (let i = 0; i < list.length; i++) {
    const m = list[i][0];
    onStep?.(i, list.length);
    try {
      await withTimeout(Promise.resolve((d as any)[m]()), timeoutMs);
      reads[m] = true; streak = 0;
    } catch {
      reads[m] = false; streak++;
      if (streak >= 4) {
        try { if (!signalFields(await withTimeout(readSignal(d), timeoutMs)).length) throw new Error('no signal'); streak = 0; }
        catch { return { reads, aborted: true }; }
      }
    }
    if (gapMs) await new Promise(res => setTimeout(res, gapMs));
  }
  onStep?.(list.length, list.length);
  return { reads, aborted: false };
}

/** القراءات اللي تنخفي بعد الاكتشاف */
export function hiddenReads(reads: Record<string, boolean>): string[] {
  return Object.keys(reads).filter(m => reads[m] === false);
}
/** للعرض: وش لقينا ووش ما لقينا (الأسماء المعروضة بس) */
export function discoverySummary(reads: Record<string, boolean>): { found: string[]; missing: string[] } {
  const found: string[] = [], missing: string[] = [];
  for (const [m, label] of DISCOVER_READS) {
    if (!label || !(m in reads)) continue;
    (reads[m] ? found : missing).push(label);
  }
  return { found, missing };
}
