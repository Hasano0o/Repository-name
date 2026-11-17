/**
 * «وش بتلعب؟» (١٧ نوفمبر — طلب حسن): الألعاب الأشهر في السوق السعودي، وكل لعبة لها:
 *  - مناطق تطلع أول في «سيرفر لعبتك» (الباقي يبان بـ «اعرض كل الدول» — ما نخفي شي)
 *  - حساسيتها للبنق + الهدف (ms) — عشان نقول للعضو وش يهمه فعلاً
 * أسماء الألعاب نص بس — بدون شعارات (حقوق).
 * صافي بدون react-native — اختبارات tests/games.test.ts (ومعرّفات المناطق لازم تكون في REGIONS).
 */

export type GameSense = 'high' | 'mid' | 'low';

export interface GameDef {
  id: string;
  name: string;
  /** سطر صغير تحت الاسم */
  kind: string;
  emoji: string;
  /** تدرّج البلاطة [فاتح، غامق] */
  colors: [string, string];
  sense: GameSense;
  /** البنق اللي نعتبره ممتاز لهالنوع */
  goodMs: number;
  /** أول المناطق في القائمة (الأقرب للسعودية أول). فاضي = ما يفرق */
  regions: string[];
  /** نصيحة قصيرة خاصة باللعبة */
  tip: string;
  /** كونسول ← نوريه NAT */
  console?: boolean;
}

const ME = ['sa-ruh', 'sa-jed', 'sa', 'ae', 'qa'];

export const GAMES: GameDef[] = [
  {
    id: 'pubg', name: 'ببجي موبايل', kind: 'باتل رويال', emoji: '🪂', colors: ['#f6b73c', '#c2410c'],
    sense: 'high', goodMs: 60, regions: [...ME, 'tr', 'eu', 'in', 'sg'],
    tip: 'داخل اللعبة اختار «الشرق الأوسط» من تغيير الخادم — وكل ملّي ثانية تفرق في القنص',
  },
  {
    id: 'freefire', name: 'فري فاير', kind: 'باتل رويال', emoji: '🔥', colors: ['#fb7185', '#be123c'],
    sense: 'high', goodMs: 70, regions: [...ME, 'in', 'sg', 'eu'],
    tip: 'اللعبة خفيفة على النت، بس اللاق المفاجئ يقتلك — ثبات البنق أهم من رقمه',
  },
  {
    id: 'cod', name: 'كول أوف ديوتي', kind: 'تصويب', emoji: '🎯', colors: ['#94a3b8', '#334155'],
    sense: 'high', goodMs: 60, regions: [...ME, 'eu', 'tr'],
    tip: 'التصويب يحتاج بنق ثابت — شغّل «وضع المباراة» لو أحد بالبيت يحمّل',
  },
  {
    id: 'fortnite', name: 'فورتنايت', kind: 'باتل رويال', emoji: '🏗️', colors: ['#a78bfa', '#5b21b6'],
    sense: 'high', goodMs: 60, regions: [...ME, 'eu'],
    tip: 'من الإعدادات اختار منطقة «الشرق الأوسط» للمطابقة',
  },
  {
    id: 'fc', name: 'كورة', kind: 'FC و eFootball', emoji: '⚽', colors: ['#4ade80', '#15803d'],
    sense: 'mid', goodMs: 80, regions: [...ME, 'eu', 'tr'],
    tip: 'التأخير يبان في التمرير والتسديد — والأونلاين يحتاج NAT مفتوح',
  },
  {
    id: 'roblox', name: 'روبلوكس', kind: 'ألعاب متنوعة', emoji: '🧱', colors: ['#60a5fa', '#1d4ed8'],
    sense: 'mid', goodMs: 100, regions: ['eu', 'ae', 'sa-ruh', 'tr', 'in'],
    tip: 'السيرفر يتغيّر حسب التجربة — الأهم ثبات النت وما فيه تحميل بالخلفية',
  },
  {
    id: 'strategy', name: 'استراتيجية', kind: 'كلاش و Last War', emoji: '🏰', colors: ['#fbbf24', '#a16207'],
    sense: 'low', goodMs: 200, regions: [],
    tip: 'البنق ما يفرق كثير هنا — يهمك إن النت ما ينقطع وقت الهجوم',
  },
  {
    id: 'console', name: 'كونسول', kind: 'PS و Xbox', emoji: '🕹️', colors: ['#38bdf8', '#0e7490'],
    sense: 'high', goodMs: 60, regions: [...ME, 'eu'], console: true,
    tip: 'أكثر مشكلة بالكونسول «NAT Type 3» — افحص NAT من «تعزيز اللعب»',
  },
  {
    id: 'other', name: 'لعبة ثانية', kind: 'أي لعبة', emoji: '🎮', colors: ['#c084fc', '#7e22ce'],
    sense: 'mid', goodMs: 80, regions: [],
    tip: 'اختار من «أي سيرفر أقرب؟» المنطقة اللي فيها أقل بنق',
  },
];

export const GAME_KEY = 'bandly.game';

export const gameById = (id?: string | null): GameDef | undefined => GAMES.find(g => g.id === id);

export const SENSE_WORD: Record<GameSense, string> = { high: 'يهمها البنق جداً', mid: 'البنق يهمها', low: 'البنق ما يفرق كثير' };

/** لما يختار لعبة: نغيّر المنطقة بس لو منطقته الحالية مو من مناطق اللعبة */
export function regionForGame(g: GameDef | undefined, current: string): string {
  if (!g || !g.regions.length || g.regions.includes(current)) return current;
  return g.regions[0];
}

/** ترتيب «أول ٣»: الأقرب من القياس — بس من مناطق اللعبة لو لها مناطق، وبعدها مناطق اللعبة بترتيبها */
export function preferOrder(g: GameDef | undefined, ranked?: string[]): string[] | undefined {
  if (!g || !g.regions.length) return ranked;
  const r = (ranked ?? []).filter(id => g.regions.includes(id));
  return [...r, ...g.regions.filter(id => !r.includes(id))];
}

/** حكم البنق حسب اللعبة */
export function pingWord(g: GameDef, ms: number): 'great' | 'ok' | 'bad' {
  if (ms <= g.goodMs) return 'great';
  if (ms <= g.goodMs * 1.8) return 'ok';
  return 'bad';
}
