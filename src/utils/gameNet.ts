/**
 * «تعزيز اللعب» — منطق بدون react-native (يتختبر على node):
 *   1. Bufferbloat: كم يرتفع البنق لما الخط محمّل (تنزيل / رفع) — سبب اللاق «فجأة» لما أحد يحمّل.
 *   2. NAT / CGNAT / IPv6: هل «NAT مفتوح» ممكن أصلاً على خطك — بصراحة.
 *   3. وضع المباراة: إيقاف مؤقت لأجهزة يختارها العضو، مع حماية جواله نفسه.
 * التشغيل الفعلي (fetch، الراوتر) في src/services/gameBoost.ts.
 */

/* ═══════════ 1. Bufferbloat ═══════════ */

export type BloatGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
const GRADES: BloatGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

export interface PingStats { median: number; p90: number; lossPct: number; n: number }

export function pingStats(values: (number | null)[]): PingStats {
  const ok = values.filter((v): v is number => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b);
  const lossPct = values.length ? Math.round(((values.length - ok.length) / values.length) * 100) : 100;
  if (!ok.length) return { median: 0, p90: 0, lossPct, n: 0 };
  const at = (q: number) => ok[Math.min(ok.length - 1, Math.floor(q * ok.length))];
  return { median: Math.round(at(0.5)), p90: Math.round(at(0.9)), lossPct, n: ok.length };
}

/**
 * الدرجة من زيادة البنق تحت الحمل (نفس سلّم اختبارات Bufferbloat المعروفة):
 * أقل من 5ms A+ · 30 A · 60 B · 200 C · 400 D · أكثر F. فقد ٢٠٪+ تحت الحمل ← درجة أسوأ.
 */
export function bloatGrade(addedMs: number, lossPct = 0): BloatGrade {
  let i = addedMs < 5 ? 0 : addedMs < 30 ? 1 : addedMs < 60 ? 2 : addedMs < 200 ? 3 : addedMs < 400 ? 4 : 5;
  if (lossPct >= 20) i = Math.min(5, i + 1);
  return GRADES[i];
}

export const worseGrade = (a: BloatGrade, b: BloatGrade): BloatGrade => (GRADES.indexOf(a) >= GRADES.indexOf(b) ? a : b);

export interface BloatPhase {
  stats: PingStats;
  /** زيادة البنق (الوسيط تحت الحمل − الوسيط والخط فاضي) */
  addedMs: number;
  grade: BloatGrade;
  /** السرعة اللي انضغط فيها الخط وقت القياس */
  mbps: number;
}

export interface BloatResult {
  idle: PingStats;
  down: BloatPhase;
  up: BloatPhase;
  grade: BloatGrade;
  /** وين المشكلة أكبر */
  worst: 'down' | 'up';
}

export interface LoadHandle { stop(): Promise<number> }

export interface BloatDeps {
  ping(): Promise<number | null>;
  /** يبدأ ضغط تنزيل/رفع ويستمر لين stop() — يرجّع كم بايت انتقل */
  startLoad(kind: 'down' | 'up'): LoadHandle;
  sleep(ms: number): Promise<void>;
  now(): number;
  cancelled?(): boolean;
  onStep?(step: 'idle' | 'down' | 'up', ms: number | null): void;
}

export interface BloatOpts { idleN?: number; loadMs?: number; rampMs?: number; gapMs?: number }

export class BloatCancelled extends Error {
  constructor() { super('انلغى الفحص'); }
}

export async function runBloat(d: BloatDeps, o: BloatOpts = {}): Promise<BloatResult> {
  const idleN = o.idleN ?? 12;
  const loadMs = o.loadMs ?? 8000;
  const rampMs = o.rampMs ?? 1500;
  const gapMs = o.gapMs ?? 250;
  const stop = () => { if (d.cancelled?.()) throw new BloatCancelled(); };

  const idleVals: (number | null)[] = [];
  for (let i = 0; i < idleN; i++) {
    stop();
    const v = await d.ping();
    idleVals.push(v);
    d.onStep?.('idle', v);
    await d.sleep(gapMs);
  }
  const idle = pingStats(idleVals);
  if (!idle.n) throw new Error('الخادم ما رد والخط فاضي — تأكد إنك متصل بالنت وأعد الفحص');

  const phase = async (kind: 'down' | 'up'): Promise<BloatPhase> => {
    const h = d.startLoad(kind);
    const t0 = d.now();
    const vals: (number | null)[] = [];
    let bytes = 0;
    try {
      while (d.now() - t0 < loadMs) {
        stop();
        const v = await d.ping();
        // أول ثانية ونص: الحمل لسا يتصاعد — ما تنحسب
        if (d.now() - t0 >= rampMs) { vals.push(v); d.onStep?.(kind, v); }
        await d.sleep(gapMs);
      }
    } finally {
      // الإلغاء أو أي خطأ ← نوقف التحميل دايماً (ما يكمل ياكل باقة العضو)
      bytes = await h.stop().catch(() => 0);
    }
    const secs = Math.max(0.5, (d.now() - t0) / 1000);
    const stats = pingStats(vals);
    // كل القياسات ضاعت تحت الحمل = الخط يختنق كامل
    const addedMs = stats.n ? Math.max(0, stats.median - idle.median) : 999;
    return { stats, addedMs, grade: bloatGrade(addedMs, stats.lossPct), mbps: Math.round(((bytes * 8) / secs / 1e6) * 10) / 10 };
  };

  const down = await phase('down');
  await d.sleep(1000); // نخلي الخط يهدأ بين التنزيل والرفع
  const up = await phase('up');
  const grade = worseGrade(down.grade, up.grade);
  return { idle, down, up, grade, worst: GRADES.indexOf(up.grade) > GRADES.indexOf(down.grade) ? 'up' : 'down' };
}

export function bloatWord(g: BloatGrade): string {
  switch (g) {
    case 'A+': return 'ممتاز — التحميل ما يأثر على لعبك';
    case 'A': return 'ممتاز — تأثير بسيط ما تحسه';
    case 'B': return 'جيد — ممكن لاق خفيف لو أحد يحمّل';
    case 'C': return 'متوسط — بتحس باللاق وقت التحميل';
    case 'D': return 'ضعيف — التحميل يخرّب اللعب';
    default: return 'سيئ جداً — أي تحميل يقطع اللعب';
  }
}

/** النصيحة — بصدق: لو المشكلة في الرفع غالباً من البرج/الشركة، والحل اللي بيدنا نوقف التحميل وقت اللعب */
export function bloatAdvice(r: BloatResult): string[] {
  const out: string[] = [];
  if (r.grade === 'A+' || r.grade === 'A') {
    out.push('خطك يتحمل التحميل وقت اللعب — ما تحتاج تسوي شي.');
    return out;
  }
  const p = r[r.worst];
  const what = r.worst === 'up' ? 'الرفع (سناب، نسخ الصور، البث)' : 'التنزيل (تحديثات، يوتيوب، نتفلكس)';
  out.push(`لما يصير ${what} البنق يزيد حوالي ${p.addedMs >= 999 ? 'لين ينقطع' : `${p.addedMs}ms`}.`);
  out.push('شغّل «وضع المباراة» تحت يوقف الأجهزة الثانية وقت اللعب، وترجع لحالها بعدها.');
  if (r.worst === 'up') out.push('أوقف النسخ الاحتياطي التلقائي للصور (iCloud / Google Photos) وقت اللعب — هو أكثر شي يضغط الرفع.');
  else out.push('أوقف التحديثات التلقائية في البلايستيشن/الإكس بوكس والجوالات وقت اللعب.');
  out.push('على شبكات الجوال جزء من التأخير من البرج نفسه — تحسين الإشارة (توجيه الأنتنا أو تردد أهدى) يقلله.');
  return out;
}

/* ═══════════ 2. NAT / CGNAT / IPv6 ═══════════ */

export type IpKind = 'private' | 'cgnat' | 'public' | 'v6' | 'invalid';

export function ipKind(ip?: string): IpKind {
  const s = (ip ?? '').trim();
  if (!s) return 'invalid';
  if (s.includes(':')) return 'v6';
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return 'invalid';
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some(x => x > 255)) return 'invalid';
  if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  return 'public';
}

export type NatKind = 'public' | 'cgnat' | 'offwifi' | 'unknown';

export interface NatInput {
  /** آي بي الراوتر من الشركة (من صفحة الراوتر) */
  wan?: string;
  /** الآي بي كما تشوفه المواقع */
  pub?: string;
  /** عنوان IPv6 عام لو الاتصال يطلع عليه */
  v6?: string;
  /** false = الجوال مو على واي فاي الراوتر (القياس لشريحة الجوال) */
  onWifi?: boolean;
}

export interface NatVerdict {
  kind: NatKind;
  title: string;
  detail: string;
  fix: string[];
  v6: boolean;
  /** فتح المنافذ / UPnP / DMZ بيفيد فعلاً؟ */
  portsHelp: boolean;
}

export function natVerdict(i: NatInput): NatVerdict {
  const v6 = ipKind(i.v6) === 'v6';
  const v6Line = v6
    ? 'عندك IPv6 شغال ✅ — بعض الألعاب والأجهزة (مثل إكس بوكس) تقدر تتصل فيه مباشرة وتتجاوز الآي بي المشترك.'
    : 'ما عندك IPv6 — لو شركتك تدعمه، تفعيله في إعدادات APN (IPv4v6) يساعد بعض الألعاب.';
  if (i.onWifi === false) {
    return {
      kind: 'offwifi', v6, portsHelp: false,
      title: 'جوالك مو على واي فاي الراوتر',
      detail: 'اللي قسناه هو خط شريحة جوالك، مو الراوتر.',
      fix: ['اتصل بواي فاي الراوتر وأعد الفحص.'],
    };
  }
  const wk = ipKind(i.wan);
  const pk = ipKind(i.pub);
  if (wk === 'cgnat' || wk === 'private' || (wk === 'public' && pk === 'public' && i.wan!.trim() !== i.pub!.trim())) {
    return {
      kind: 'cgnat', v6, portsHelp: false,
      title: 'الشركة تعطيك آي بي مشترك (CGNAT)',
      detail: `آي بي راوترك ${i.wan} ${wk === 'public' ? `غير الآي بي اللي يطلع للإنترنت (${i.pub})` : 'مو آي بي إنترنت'} — يعني شركتك تجمع مشتركين كثير على عنوان واحد. هذا الطبيعي في شبكات الجوال.`,
      fix: [
        'فتح المنافذ وDMZ وUPnP في الراوتر ما يقدرون يخلون NAT «مفتوح» على هالخط — المشكلة عند الشركة مو عندك.',
        'أغلب ألعاب الجوال (ببجي، كود موبايل، فري فاير) ما تتأثر. اللي يتأثر: الدردشة الصوتية والاستضافة في ألعاب الكونسول.',
        'الحل الوحيد الأكيد: تطلب من شركتك «آي بي عام» أو «ثابت» (غالباً خدمة مدفوعة).',
        v6Line,
      ],
    };
  }
  if (wk === 'public' && (pk === 'public' ? i.wan!.trim() === i.pub!.trim() : true)) {
    return {
      kind: 'public', v6, portsHelp: true,
      title: 'عندك آي بي عام ✅',
      detail: `راوترك واصل للإنترنت بعنوان خاص فيه (${i.wan}) — NAT مفتوح ممكن.`,
      fix: [
        'شغّل UPnP من «مركز التحكم» — أغلب الألعاب والكونسولات تفتح منافذها بنفسها.',
        'لو لسا «NAT مقيّد»: حط جهاز اللعب في DMZ (جهاز واحد بس).',
        'الآي بي العام يتغير مع إعادة التشغيل غالباً — هذا عادي.',
      ],
    };
  }
  return {
    kind: 'unknown', v6, portsHelp: false,
    title: 'ما قدرنا نحدد نوع الآي بي',
    detail: i.pub ? `الآي بي اللي يطلع للإنترنت ${i.pub}، بس راوترك ما يعطينا آي بي الشركة حقه عشان نقارن.` : 'ما وصلنا لموقع يعطينا الآي بي — ممكن حاجب إعلانات أو VPN.',
    fix: ['على شبكات الجوال الأغلب CGNAT (آي بي مشترك).', v6Line],
  };
}

/** نفس الشبكة المحلية؟ (الجوال والراوتر على /24 واحد) — يكفي لراوترات البيت */
export function sameLan(selfIp?: string, routerHost?: string): boolean | undefined {
  const h = (routerHost ?? '').replace(/^https?:\/\//, '').split(/[/:]/)[0];
  if (!selfIp || ipKind(selfIp) !== 'private' || ipKind(h) !== 'private') return undefined;
  return selfIp.split('.').slice(0, 3).join('.') === h.split('.').slice(0, 3).join('.');
}

/**
 * آي بي جوالك على شبكة الراوتر من سطور ICE (WebRTC «typ host»).
 * الجوال عنده أكثر من عنوان (الواي فاي + شريحة الجوال اللي ممكن تكون 10.x) ← ناخذ اللي على نفس شبكة الراوتر بس.
 */
export function pickLanIp(candidates: string[], routerHost?: string): string | undefined {
  const ips = new Set<string>();
  for (const c of candidates) {
    const p = String(c ?? '').replace(/^a=/, '').trim().split(/\s+/);
    // candidate:<foundation> <component> <proto> <priority> <ip> <port> typ <type>
    const typ = p[p.indexOf('typ') + 1];
    if (p.length < 8 || typ !== 'host') continue;
    if (ipKind(p[4]) === 'private') ips.add(p[4]);
  }
  for (const ip of ips) if (sameLan(ip, routerHost)) return ip;
  return undefined;
}

/* ═══════════ 3. وضع المباراة ═══════════ */

export interface MatchDevice { mac: string; ip?: string; name?: string; blocked?: boolean }

export const normMac = (m: string) => m.trim().toUpperCase().replace(/-/g, ':');

/** هذا جوالك؟ (نفس الآي بي) — ما نسمح نوقفه أبداً: لو انحظر، التطبيق ما يقدر يرجّعه */
export const isSelf = (d: MatchDevice, selfIp?: string) => !!selfIp && !!d.ip && d.ip.trim() === selfIp.trim();

/**
 * اللي بنوقفه فعلاً: المختارين − جوالك − اللي محظورين أصلاً (ما نرجّعهم بعد المباراة لأنهم محظورين من قبل).
 * لو ما عرفنا آي بي جوالك ← ما نوقف أي شي (ما نخاطر).
 */
export function matchTargets(devices: MatchDevice[], selected: string[], selfIp?: string, blockedBefore: string[] = []): MatchDevice[] {
  if (!selfIp) return [];
  const sel = new Set(selected.map(normMac));
  const pre = new Set(blockedBefore.map(normMac));
  return devices.filter(d => sel.has(normMac(d.mac)) && !pre.has(normMac(d.mac)) && !d.blocked && !isSelf(d, selfIp));
}

export interface MatchState {
  routerId: string;
  devices: { mac: string; name?: string }[];
  at: number;
  until: number;
}

export const MATCH_DURATIONS = [30, 60, 90, 120] as const;

export const matchExpired = (s: MatchState | null, now: number) => !!s && now >= s.until;

export function matchLeft(s: MatchState, now: number): string {
  const m = Math.max(0, Math.ceil((s.until - now) / 60000));
  const h = Math.floor(m / 60);
  const hw = h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`;
  return m >= 60 ? `${hw}${m % 60 ? ` و${m % 60} دقيقة` : ''}` : `${m} دقيقة`;
}
