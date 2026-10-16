/**
 * المستشار الذكي — محرك توصية محلي **حتمي** (قواعد وأوزان ثابتة، مو تخمين).
 * يقرأ فقط: ما يغيّر أي شي في الراوتر. يقارن إعدادك الحالي بالأبراج اللي يشوفها الراوتر
 * وبالقياسات اللي سجلناها قبل (بنق الأبراج + نتائج التجارب)، ويقول:
 * وش الأفضل، ليش، وكم ثقتنا، ووش البيانات الناقصة.
 *
 * قواعد الأمانة:
 * - المقارنة عادلة: نقارن بنفس المقاييس المتوفرة عند الطرفين بس (ما نقارن SINR بـ RSRQ).
 * - إشارة أقوى ≠ أسرع. بدون قياس فعلي نقول «متوقع» والثقة منخفضة.
 * - للألعاب: بدون بنق مقاس ما نقول إنه أفضل للعب.
 * - لو البيانات ما تكفي: «غير حاسمة» بدل توصية.
 *
 * ملف بدون react-native — عشان الاختبارات تشتغل في Node.
 */
import { friendlyBand } from './bands';

export type Tech = 'LTE' | 'NR';
export type Goal = 'overall' | 'gaming';

/** بنق مقاس فعلاً (درجة اللعب من ١٠٠ محسوبة بـ gameScore) */
export interface PingEvidence {
  median: number;
  jitter: number;
  loss: number;
  score: number;
  at: number;
}

export interface TrialEvidence {
  verdict: 'better' | 'same' | 'worse' | 'noconn';
  change?: number;
  at: number;
}

export interface CurrentState {
  tech: Tech;
  band?: number;
  pci?: string;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  /** عدد النواقل المدموجة الحين */
  carriers: number;
  /** وصف التجميعة الحالية (B3 + n78 …) */
  combo?: string;
  /** كم قراءة ناجحة أخذنا للوضع الحالي */
  samples: number;
  ping?: PingEvidence;
  /** كل الخلايا اللي الراوتر شغال عليها الحين (الأساسي + 5G في NSA + المدموجة) — مو مرشحين */
  serving?: { tech: Tech; pci: string }[];
}

export interface Candidate {
  tech: Tech;
  band?: number;
  pci: string;
  arfcn?: string;
  /** متوسط القراءات */
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  /** في كم قراءة ظهر هالبرج */
  samples: number;
  ping?: PingEvidence;
  trial?: TrialEvidence;
  /** من ترددات شبكتك؟ undefined = ما نعرف شبكتك */
  onOperator?: boolean;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Scored {
  c: Candidate;
  /** الدرجة على نفس الأساس مع الحالي (٠..١) */
  score: number;
  current: number;
  gain: number;
  /** المقاييس اللي انبنت عليها المقارنة */
  basis: ('power' | 'quality' | 'latency')[];
  confidence: Confidence;
  reasons: string[];
  /** قياس فعلي (بنق أو تجربة) مو بس قراءة إشارة */
  measured: boolean;
}

export interface Excluded { c: Candidate; reason: string }

export interface Verdict {
  kind: 'switch' | 'stay' | 'inconclusive';
  goal: Goal;
  best?: Scored;
  ranked: Scored[];
  excluded: Excluded[];
  confidence: Confidence;
  /** جملة الخلاصة */
  headline: string;
  /** وش ينقصنا عشان نكون متأكدين أكثر */
  missing: string[];
}

// ─── الأوزان (ثابتة وقابلة للاختبار) ───
const WEIGHTS: Record<Goal, { power: number; quality: number; latency: number }> = {
  overall: { power: 0.35, quality: 0.35, latency: 0.3 },
  gaming: { power: 0.15, quality: 0.2, latency: 0.65 },
};
/** أقل فرق نعتبره تحسّن حقيقي (مو تذبذب قراءات) */
export const MIN_GAIN = 0.08;
/** للألعاب بدون بنق مقاس: نطلب فرق إشارة كبير عشان حتى نذكره */
const SIGNAL_ONLY_GAMING_GAIN = 0.15;
const PING_MAX_AGE = 7 * 86400_000;
const TRIAL_MAX_AGE = 14 * 86400_000;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const power = (rsrp: number) => clamp01((rsrp + 120) / 45);
const sinrQ = (sinr: number) => clamp01((sinr + 5) / 30);
const rsrqQ = (rsrq: number) => clamp01((rsrq + 20) / 17);

const fresh = (p: PingEvidence | undefined, now: number) => (p && now - p.at <= PING_MAX_AGE ? p : undefined);

/** يبدأ بالعربي («برج 45 — 4G 700 · يوصل بعيد») عشان ما يتلخبط ترتيب الكلام مع الأرقام */
const nameOf = (c: Pick<Candidate, 'tech' | 'band' | 'pci'>) =>
  `برج ${c.pci} — ${c.tech === 'NR' ? '5G' : '4G'} ${friendlyBand(c.tech, c.band)}`;

/** مقارنة عادلة: نفس المقاييس عند الطرفين */
function compare(cur: CurrentState, c: Candidate, goal: Goal, now: number) {
  const w = WEIGHTS[goal];
  const basis: Scored['basis'] = [];
  let a = 0, b = 0, wsum = 0;
  if (cur.rsrp !== undefined && c.rsrp !== undefined) {
    basis.push('power');
    a += w.power * power(cur.rsrp); b += w.power * power(c.rsrp); wsum += w.power;
  }
  if (cur.sinr !== undefined && c.sinr !== undefined) {
    basis.push('quality');
    a += w.quality * sinrQ(cur.sinr); b += w.quality * sinrQ(c.sinr); wsum += w.quality;
  } else if (cur.rsrq !== undefined && c.rsrq !== undefined) {
    basis.push('quality');
    a += w.quality * rsrqQ(cur.rsrq); b += w.quality * rsrqQ(c.rsrq); wsum += w.quality;
  }
  const cp = fresh(cur.ping, now);
  const np = fresh(c.ping, now);
  if (cp && np) {
    basis.push('latency');
    a += w.latency * (cp.score / 100); b += w.latency * (np.score / 100); wsum += w.latency;
  }
  if (!wsum) return null;
  return { current: a / wsum, score: b / wsum, basis };
}

function reasonsFor(cur: CurrentState, c: Candidate, basis: Scored['basis'], now: number): string[] {
  const out: string[] = [];
  if (basis.includes('power') && cur.rsrp !== undefined && c.rsrp !== undefined) {
    const d = Math.round(c.rsrp - cur.rsrp);
    if (Math.abs(d) >= 3) out.push(d > 0 ? `الإشارة أقوى بـ ${d} dB` : `الإشارة أضعف بـ ${-d} dB`);
  }
  if (basis.includes('quality')) {
    if (cur.sinr !== undefined && c.sinr !== undefined) {
      const d = Math.round(c.sinr - cur.sinr);
      if (Math.abs(d) >= 2) out.push(d > 0 ? `نقاء الإشارة أفضل (+${d} dB)` : `نقاء الإشارة أقل (${d} dB)`);
    } else if (cur.rsrq !== undefined && c.rsrq !== undefined) {
      const d = Math.round(c.rsrq - cur.rsrq);
      if (Math.abs(d) >= 2) out.push(d > 0 ? 'جودة الإشارة أفضل (تداخل أقل)' : 'جودة الإشارة أقل (تداخل أكثر)');
    }
  }
  const cp = fresh(cur.ping, now);
  const np = fresh(c.ping, now);
  if (basis.includes('latency') && cp && np) {
    const d = Math.round(cp.median - np.median);
    if (Math.abs(d) >= 5) out.push(d > 0 ? `البنق أقل بـ ${d} ms (مقاس)` : `البنق أعلى بـ ${-d} ms (مقاس)`);
    const j = Math.round(cp.jitter - np.jitter);
    if (Math.abs(j) >= 5) out.push(j > 0 ? `التذبذب أقل بـ ${j} ms` : `التذبذب أعلى بـ ${-j} ms`);
  }
  if (c.trial && now - c.trial.at <= TRIAL_MAX_AGE && c.trial.verdict === 'better') {
    out.push(`جربناه قبل وكان أفضل${c.trial.change !== undefined ? ` بـ ${Math.round(c.trial.change * 100)}٪` : ''}`);
  }
  return out;
}

function confidenceOf(cur: CurrentState, c: Candidate, basis: Scored['basis'], now: number): Confidence {
  const trialBetter = !!(c.trial && now - c.trial.at <= TRIAL_MAX_AGE && c.trial.verdict === 'better');
  if (basis.includes('latency') && cur.samples >= 3 && (c.samples >= 2 || trialBetter)) return 'high';
  if ((basis.includes('quality') && c.samples >= 2) || trialBetter) return 'medium';
  return 'low';
}

export function advise(cur: CurrentState | null, cands: Candidate[], goal: Goal, now = Date.now()): Verdict {
  const missing: string[] = [];
  if (!cur || (cur.rsrp === undefined && cur.sinr === undefined)) {
    return {
      kind: 'inconclusive', goal, ranked: [], excluded: [], confidence: 'low',
      headline: 'ما قدرنا نقرأ إشارتك الحالية — تأكد إنك متصل بشبكة الراوتر وجرّب مرة ثانية.',
      missing: ['قراءة الإشارة الحالية'],
    };
  }
  if (cur.samples < 3) missing.push('قراءات أكثر للوضع الحالي');
  if (!fresh(cur.ping, now)) missing.push('قياس بنق لوضعك الحالي');

  const excluded: Excluded[] = [];
  const ranked: Scored[] = [];
  const seen = new Set<string>();
  for (const c of cands) {
    const k = `${c.tech}:${c.pci}:${c.arfcn ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // البرج اللي أنت عليه الحين = خط الأساس، مو مرشح
    if (cur.pci && c.pci === cur.pci && c.tech === cur.tech) continue;
    if (cur.serving?.some(x => x.tech === c.tech && x.pci === c.pci)) continue;
    if (c.onOperator === false) { excluded.push({ c, reason: 'مو من ترددات شبكتك' }); continue; }
    if (c.trial && now - c.trial.at <= TRIAL_MAX_AGE && (c.trial.verdict === 'worse' || c.trial.verdict === 'noconn')) {
      excluded.push({ c, reason: c.trial.verdict === 'noconn' ? 'جربناه قبل وما اتصل الراوتر عليه' : 'جربناه قبل وكان أسوأ' });
      continue;
    }
    const cmp = compare(cur, c, goal, now);
    if (!cmp) { excluded.push({ c, reason: 'ما عندنا قراءة نقارنها بوضعك' }); continue; }
    const measured = cmp.basis.includes('latency') || !!(c.trial && c.trial.verdict === 'better');
    ranked.push({
      c,
      score: cmp.score,
      current: cmp.current,
      gain: cmp.score - cmp.current,
      basis: cmp.basis,
      confidence: confidenceOf(cur, c, cmp.basis, now),
      reasons: reasonsFor(cur, c, cmp.basis, now),
      measured,
    });
  }
  // الترتيب: الفرق أول، وعند التعادل القياس الفعلي قبل القراءة
  ranked.sort((x, y) => (y.gain - x.gain) || (Number(y.measured) - Number(x.measured)));

  if (!ranked.length) {
    if (!cands.length) missing.push('أبراج ثانية يشوفها الراوتر');
    return {
      kind: 'inconclusive', goal, ranked, excluded, confidence: 'low', missing,
      headline: cands.length
        ? 'ما فيه برج ثاني نقدر نقارنه بوضعك بأمانة — الأبراج اللي شفناها مستبعدة أو ناقصة القراءات.'
        : 'الراوتر ما يعرض أبراج ثانية حولك — ما نقدر نقارن. وضعك الحالي هو الوحيد المتاح.',
    };
  }

  const top = ranked[0];
  const gamingNoPing = goal === 'gaming' && !top.basis.includes('latency');
  if (gamingNoPing) missing.push('بنق مقاس على الأبراج المرشحة (من «فحص بنق الأبراج»)');
  const need = gamingNoPing ? SIGNAL_ONLY_GAMING_GAIN : MIN_GAIN;

  if (top.gain >= need) {
    const conf: Confidence = gamingNoPing ? 'low' : top.confidence;
    const what = nameOf(top.c);
    const headline = gamingNoPing
      ? `${what} إشارته أفضل بوضوح، بس ما قسنا البنق عليه — للألعاب جرّبه بـ«فحص بنق الأبراج» قبل ما تثبّت.`
      : top.measured
        ? `${what} أفضل من وضعك الحالي${goal === 'gaming' ? ' للألعاب' : ''} — مبني على قياس فعلي.`
        : `${what} متوقع يكون أفضل من وضعك الحالي — مبني على قراءة الإشارة بس، مو قياس سرعة.`;
    return { kind: 'switch', goal, best: top, ranked, excluded, confidence: conf, headline, missing };
  }

  // ما فيه شي أفضل بفرق واضح
  const conf: Confidence = cur.samples >= 3 && ranked.length >= 2 ? (fresh(cur.ping, now) ? 'high' : 'medium') : 'low';
  return {
    kind: 'stay', goal, best: undefined, ranked, excluded, confidence: conf, missing,
    headline: goal === 'gaming' && !ranked.some(r => r.basis.includes('latency'))
      ? 'من قراءة الإشارة، وضعك الحالي هو الأفضل — بس ما عندنا بنق مقاس على الأبراج الثانية للحكم على اللعب.'
      : 'وضعك الحالي هو الأفضل من اللي نقدر نقارنه — ما ننصحك تغيّر.',
  };
}

export const CONF_LABEL: Record<Confidence, string> = { high: 'ثقة عالية', medium: 'ثقة متوسطة', low: 'ثقة منخفضة' };
export const candidateName = nameOf;

/** يجمع قراءات أبراج من عدة لقطات: متوسط لكل برج + كم مرة ظهر */
export function mergeCellSamples(
  rounds: { tech: Tech; band?: number; pci?: string; arfcn?: string; rsrp?: number; rsrq?: number; sinr?: number; kind?: string }[][],
): Candidate[] {
  const acc = new Map<string, { c: Candidate; r: number[]; q: number[]; s: number[] }>();
  for (const round of rounds) {
    const inRound = new Set<string>();
    for (const x of round) {
      if (!x.pci) continue;
      const k = `${x.tech}:${x.pci}:${x.arfcn ?? ''}`;
      let a = acc.get(k);
      if (!a) {
        a = { c: { tech: x.tech, band: x.band, pci: x.pci, arfcn: x.arfcn, samples: 0 }, r: [], q: [], s: [] };
        acc.set(k, a);
      }
      if (!inRound.has(k)) { a.c.samples++; inRound.add(k); }
      if (x.rsrp !== undefined) a.r.push(x.rsrp);
      if (x.rsrq !== undefined) a.q.push(x.rsrq);
      if (x.sinr !== undefined) a.s.push(x.sinr);
      if (!a.c.band && x.band) a.c.band = x.band;
    }
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((p, v) => p + v, 0) / xs.length : undefined);
  return [...acc.values()].map(({ c, r, q, s }) => ({ ...c, rsrp: avg(r), rsrq: avg(q), sinr: avg(s) }));
}
