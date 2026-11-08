/**
 * «ثبّت للعب» (مُحسّن الألعاب) — قرار متى نرجّع إعداد العضو. بدون react-native (tests/gameLock.test.ts).
 *
 * ليش: المحسّن يثبّت تردد واحد (مثلاً B8) لأنه أقل بنق وقت القياس — بس تردد واحد = بدون دمج، وبعد ساعات
 * (زحمة الليل / البرج يقطعه) يعلق الراوتر عليه والنت يوقف لين إعادة تشغيل. عضو MC801A (stc) ٨ نوفمبر.
 * الحين التثبيت للعب **مؤقت** (ساعتين افتراضياً) و**ينفك لحاله لو النت طاح**.
 */
export interface GameLock {
  routerId: string;
  at: number;
  /** null = دائم (بس ينفك لو النت طاح) */
  until: number | null;
  label: string;
  kind: 'band' | 'lteOnly';
  /** اللي طبّقناه (عشان نعرف لو العضو غيّره بنفسه ← ما نلمسه) */
  applied: { lte: number[]; nr: number[]; mode?: string };
  /** إعداده قبل */
  prev: { lte: number[]; nr: number[]; mode: string };
}

export type GameLockVerdict = 'expired' | 'down' | 'gone' | null;

const same = (a: number[], b: number[]) => {
  const x = [...a].sort((p, q) => p - q), y = [...b].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * gone = الإعداد الحالي مو اللي طبّقناه (العضو غيّره / رجّعه) ← ننسى بدون ما نكتب شي.
 * expired = خلص الوقت ← نرجّع إعداده. down = النت طايح وهو على تثبيت اللعب ← نرجّع على طول.
 */
export function gameLockVerdict(
  g: GameLock, now: number,
  cfg: { locked: number[]; nrLocked: number[]; mode: string } | null,
  online: boolean | undefined,
): GameLockVerdict {
  if (cfg) {
    const still = g.kind === 'lteOnly'
      ? !!g.applied.mode && cfg.mode === g.applied.mode
      : same(cfg.locked, g.applied.lte) && same(cfg.nrLocked, g.applied.nr);
    if (!still) return 'gone';
  }
  if (g.until !== null && now >= g.until) return 'expired';
  if (online === false) return 'down';
  return null;
}

export function gameLockLeft(g: GameLock, now: number): string {
  if (g.until === null) return 'دائم';
  const m = Math.max(0, Math.round((g.until - now) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} س${m % 60 ? ` و${m % 60} د` : ''}` : `${m} د`;
}
