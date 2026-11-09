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

export const huntHit = (t: HuntTry, target: number) =>
  t.median !== undefined && t.median <= target && t.loss < 20;

/** نوقف؟ وصلنا · خلصت المحاولات · الشركة ترجّع نفس الآي بي مرتين ورا بعض (القطع السريع ما يغيّر) */
export function huntStop(tries: HuntTry[], target: number, max: number): 'hit' | 'max' | 'stuck' | null {
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
