/**
 * «هل يفيدك مسرّع؟» — المنطق الصافي (بدون react-native، عليه اختبارات).
 *
 * الطريق المباشر:  الجوال ← سيرفر اللعبة            (نقيسه من الجوال)
 * طريق المسرّع:    الجوال ← سيرفرنا ← سيرفر اللعبة  (الجزء الأول من الجوال، والثاني يقيسه سيرفرنا كل دقيقتين)
 * القياسين نفس الطريقة (HTTPS بعد التسخين) فالمقارنة عادلة. نضيف كلفة النفق (WireGuard) تقريباً.
 */

export const TUNNEL_MS = 3;
/** أقل فرق نعتبره «يفيد» — أقل منه ما يحس فيه اللاعب */
export const GAIN_MIN = 10;

export interface Leg { median: number; jitter: number; lossPct: number; samples: number }

export type AccelKind = 'helps' | 'small' | 'no' | 'fail';

export interface AccelVerdict {
  kind: AccelKind;
  direct: number;
  /** البنق المتوقع عبر المسرّع */
  via: number;
  /** كم ينقص (موجب = أحسن) */
  gain: number;
  /** التذبذب المتوقع عبر المسرّع */
  viaJitter: number;
  /** الفقد المتوقع عبر المسرّع */
  viaLoss: number;
}

export function accelVerdict(direct: Leg | null, toServer: Leg | null, serverToGame: Leg | null): AccelVerdict {
  const fail: AccelVerdict = { kind: 'fail', direct: direct?.median ?? 0, via: 0, gain: 0, viaJitter: 0, viaLoss: 0 };
  if (!toServer?.samples || !serverToGame?.samples) return fail;
  const via = Math.round(toServer.median + serverToGame.median + TUNNEL_MS);
  const viaJitter = Math.round(toServer.jitter + serverToGame.jitter);
  const viaLoss = Math.min(100, Math.round(toServer.lossPct + serverToGame.lossPct));
  // الطريق المباشر ما رد أبداً وطريقنا يرد = المسرّع يفيد أكيد
  if (!direct?.samples) return { kind: 'helps', direct: 0, via, gain: 0, viaJitter, viaLoss };
  const gain = Math.round(direct.median - via);
  // الفقد يفرق أكثر من البنق في الألعاب
  // بس لو البنق مو أبطأ بشكل واضح — تقرير ٢٧ نوفمبر: الدمام «يستفيد» ٥١٪ ومباشر 113 ← عبرنا 203 (طريق سيرفرنا مكسور)
  const lossBetter = direct.lossPct - viaLoss >= 10 && gain > -GAIN_MIN;
  const kind: AccelKind = gain >= GAIN_MIN || lossBetter ? 'helps' : gain >= 4 ? 'small' : 'no';
  return { kind, direct: direct.median, via, gain, viaJitter, viaLoss };
}

/** إعدادات المسرّع من الرسيفر — نتأكد من شكلها قبل نستخدمها */
export interface AccelServer { id: string; name: string; url: string }

export function parseAccelConfig(j: any): AccelServer[] {
  const list = Array.isArray(j?.servers) ? j.servers : [];
  return list
    .filter((x: any) => x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.url === 'string' && /^https:\/\/[^\s/]+$/.test(x.url.replace(/\/+$/, '')))
    .map((x: any) => ({ id: x.id.slice(0, 20), name: x.name.slice(0, 40), url: x.url.replace(/\/+$/, '') }));
}
