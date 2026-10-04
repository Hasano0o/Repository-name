import AsyncStorage from '@react-native-async-storage/async-storage';

/* ═══ حارس 5G — لكل راوتر ═══
 * لو الراوتر مثبّت على ترددات (مثلاً 5G 3500 بس) وطاح النت أو اختفى 5G،
 * الحارس يرجّعه للتلقائي بنفسه، ولما تستقر الإشارة يحاول يرجع لتركيبتك مرة.
 */

export interface GuardState {
  on: boolean;
  /** التركيبة اللي كانت قبل ما نرجع للتلقائي — نحاول نرجع لها لاحقاً */
  saved?: { lte: number[]; nr: number[] };
  fellBackAt?: number;
  /** سبب آخر رجوع (للإشعار والعرض) */
  reason?: string;
  /** كم فحص متتالي 5G غايب */
  nrMiss?: number;
  /** ما نحاول نرجع للتركيبة قبل هالوقت (لو فشلت المحاولة) */
  noRetryUntil?: number;
  /** وقت آخر محاولة رجوع — نتأكد بالفحص اللي بعده إنها ثبتت */
  retriedAt?: number;
}

const KEY = (id: string) => `bandly.guard5g.${id}`;

export async function getGuard(routerId: string): Promise<GuardState> {
  try {
    const raw = await AsyncStorage.getItem(KEY(routerId));
    if (raw) return { on: false, ...JSON.parse(raw) };
  } catch {}
  return { on: false };
}

export async function saveGuard(routerId: string, g: GuardState): Promise<void> {
  try { await AsyncStorage.setItem(KEY(routerId), JSON.stringify(g)); } catch {}
}
