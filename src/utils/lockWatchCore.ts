/**
 * «حارس التثبيت» (٢٨ نوفمبر — شكوى عضو: «أضبط أفضل إعداد والبنق ينزل، بس بعد ١٠ ساعات يثقل ودروبات وأضطر أسوي رسيت»).
 * السبب الغالب: التثبيت على برج/تردد يكون الأفضل وقت الضبط، وبعد ساعات البرج يزحم أو يضعف والراوتر ما يقدر ينتقل.
 * الحارس يحفظ القراءة وقت ما العضو ثبّت، ويقارن فيها بالخلفية: لو صارت أسوأ بوضوح فحصين ورا بعض ← يرجّع إعداده
 * اللي كان قبل التثبيت (أو يسأله). منطق صافي — عليه اختبارات.
 */
export interface WatchBase { rsrp?: number; sinr?: number; pci?: string }
export interface WatchSig { rsrp?: number; sinr?: number; pci?: string }

/** فرق يعتبر «أسوأ بوضوح» — أكبر من تذبذب القراءة العادي */
export const SINR_DROP = 6;
export const RSRP_DROP = 8;
/** ما نحكم قبل كذا بعد التثبيت (الإشارة تستقر) */
export const SETTLE_MS = 20 * 60_000;
/** كم فحص سيء ورا بعض قبل ما نتصرف */
export const BAD_NEEDED = 2;
export const MAX_PER_DAY = 2;

export type WatchVerdict = { kind: 'ok' } | { kind: 'worse' | 'down'; reason: string };

export function watchVerdict(base: WatchBase, cur: WatchSig | null, online: boolean): WatchVerdict {
  if (!online) return { kind: 'down', reason: 'النت طاح وهو مثبّت' };
  if (!cur || cur.rsrp === undefined) return { kind: 'ok' };
  const why: string[] = [];
  if (base.sinr !== undefined && cur.sinr !== undefined && base.sinr - cur.sinr >= SINR_DROP && cur.sinr < 10) {
    why.push(`جودة الإشارة SINR نزلت من ${Math.round(base.sinr)} إلى ${Math.round(cur.sinr)}`);
  }
  if (base.rsrp !== undefined && base.rsrp - cur.rsrp >= RSRP_DROP) {
    why.push(`قوة الإشارة نزلت من ${Math.round(base.rsrp)} إلى ${Math.round(cur.rsrp)}`);
  }
  return why.length ? { kind: 'worse', reason: why.join(' · ') } : { kind: 'ok' };
}

export interface WatchState {
  at: number;
  label: string;
  base: WatchBase;
  /** إعداد الراوتر قبل أول تثبيت (LockSnapshot) — اللي نرجّعه. null = نفك للتلقائي */
  prev: unknown | null;
  /** ملخص الإعداد المثبّت (readLockState.summary) — لو تغيّر = العضو غيّره بنفسه ← ننسى */
  applied?: string;
  bad?: number;
  day?: string;
  acts?: number;
  /** آخر سؤال للعضو (وضع «اسألني») — ما نكرره قبل ساعتين */
  askedAt?: number;
}

export type WatchStep =
  | { do: 'none'; state: WatchState }
  | { do: 'forget' }
  | { do: 'act'; reason: string; state: WatchState };

/** القرار لكل فحص — بدون أي شبكة */
export function watchStep(w: WatchState, v: WatchVerdict, now: number, day: string, appliedNow?: string): WatchStep {
  if (appliedNow !== undefined && w.applied !== undefined && appliedNow !== w.applied) return { do: 'forget' };
  let s: WatchState = { ...w, applied: w.applied ?? appliedNow };
  if (s.day !== day) s = { ...s, day, acts: 0 };
  if (now - s.at < SETTLE_MS) return { do: 'none', state: s };
  if (v.kind === 'ok') return { do: 'none', state: { ...s, bad: 0 } };
  s = { ...s, bad: (s.bad ?? 0) + 1 };
  if ((s.bad ?? 0) < BAD_NEEDED || (s.acts ?? 0) >= MAX_PER_DAY) return { do: 'none', state: s };
  return { do: 'act', reason: v.reason, state: s };
}
