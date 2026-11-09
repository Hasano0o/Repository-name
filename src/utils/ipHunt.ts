/**
 * «دوّر لي على آي بي ممتاز» — منطق القرار بدون react-native (tests/ipHunt.test.ts).
 * عضو (Al، ٩ نوفمبر): تغيير الآي بي ياخذ وقت ومحاولات كثيرة لين يطلع آي بي بنقه ممتاز لسيرفر اللعبة.
 * التطبيق يكرر: آي بي جديد ← نقيس البنق ← وصلنا الهدف؟ نوقف : مرة ثانية (حد أقصى).
 * ما نقدر نرجع لآي بي قديم — لو خلصت المحاولات نقول وش كان أفضل رقم.
 */
/** changed: undefined = ما قرينا الآي بي (مو «نفسه») · down = سرعة التنزيل Mbps لو العضو طلبها */
export interface HuntTry { n: number; ip?: string; median?: number; loss: number; changed?: boolean; down?: number }

/** أهداف البنق المعروضة — «أقل من الحين» (٨٠٪ من الحالي) + أرقام ثابتة */
export function huntTargets(base?: number): number[] {
  const fixed = [40, 60, 80];
  if (!base || base <= 25) return fixed;
  const rel = Math.max(20, Math.round((base * 0.8) / 5) * 5);
  return [...new Set([rel, ...fixed])].filter(t => t < base).sort((a, b) => a - b).slice(0, 4);
}

/**
 * «تلقائي» (حسن ٩ نوفمبر): بدل رقم يختاره العضو — نوقف أول ما يطلع آي بي أحسن من الحين بوضوح:
 * البنق أقل ٢٠٪ (و٥ms على الأقل)، والسرعة (لو نقيسها) ما نزلت أكثر من ١٠٪. ما نتجاوز الزين ونضيّعه.
 */
export interface AutoGoal { auto: true; base: number; baseDown?: number }
export type HuntGoal = number | AutoGoal;
export const autoTarget = (g: AutoGoal) => Math.min(Math.round(g.base * 0.8), g.base - 5);

export function huntHit(t: HuntTry, goal: HuntGoal): boolean {
  if (t.median === undefined || t.loss >= 20) return false;
  if (typeof goal === 'number') return t.median <= goal;
  if (t.median > autoTarget(goal)) return false;
  return goal.baseDown === undefined || t.down === undefined || t.down >= goal.baseDown * 0.9;
}

/** نوقف؟ وصلنا · خلصت المحاولات · الشركة ترجّع نفس الآي بي مرتين ورا بعض (القطع السريع ما يغيّر) */
export function huntStop(tries: HuntTry[], target: HuntGoal, max: number): 'hit' | 'max' | 'stuck' | null {
  const last = tries[tries.length - 1];
  if (last && huntHit(last, target)) return 'hit';
  if (tries.length >= 2 && tries[tries.length - 1].changed === false && tries[tries.length - 2].changed === false) return 'stuck';
  if (tries.length >= max) return 'max';
  return null;
}

export function huntBest(tries: HuntTry[]): HuntTry | null {
  let b: HuntTry | null = null;
  for (const t of tries) if (t.median !== undefined && t.loss < 50 && (!b || t.median < b.median!)) b = t;
  return b;
}

/** أسرع تنزيل بين المحاولات (عضو: «أضف أفضل سرعة تنزيل مع البنق») */
export function huntFastest(tries: HuntTry[]): HuntTry | null {
  let b: HuntTry | null = null;
  for (const t of tries) if (t.down !== undefined && t.down > 0 && (!b || t.down > b.down!)) b = t;
  return b;
}
