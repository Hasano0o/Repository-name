/**
 * «اشحن رصيدك» (١٦ نوفمبر) — شحن شريحة الراوتر ببطاقة الشحن من التطبيق. صافي بدون react-native (عليه اختبارات).
 * الأكواد (بحث ١٦ نوفمبر):
 *  • STC (سوا): شحن `*155*البطاقة#` (أو SMS «155*البطاقة#» إلى 1500) · الرصيد `*166#` — stc.com.sa / أدلة الأكواد
 *  • زين: شحن `*141*البطاقة#` · الرصيد `*142#` (sa.zain.com يذكر *142# للرصيد)
 *  • موبايلي: شحن `*1400*البطاقة#` (وبعض الخطوط تطلب الهوية: `*1400*البطاقة*الهوية#`) · الرصيد `*1411#`
 * ما نرسل شي لشركة ما نعرفها — الكود الغلط ممكن يكون أمر ثاني عند الشركة.
 */
export type Carrier = 'stc' | 'zain' | 'mobily';

export const CARRIER_NAME: Record<Carrier, string> = { stc: 'STC', zain: 'زين', mobily: 'موبايلي' };

/** الشركة من اسم الشبكة اللي يعطيه الراوتر (STC / stc KSA / Al Jawal / Zain SA / Mobily / 42001…) */
export function carrierOf(name?: string | null): Carrier | null {
  const n = (name ?? '').toLowerCase();
  if (!n) return null;
  if (/zain|زين|42004/.test(n)) return 'zain';
  if (/mobily|موبايلي|etisalat|42003/.test(n)) return 'mobily';
  if (/stc|sawa|al ?jawal|الاتصالات|سوا|42001/.test(n)) return 'stc';
  return null;
}

/** أرقام البطاقة بس (الأرقام العربية ← لاتينية، والمسافات والشرطات تنشال) */
export function cleanCard(s: string): string {
  return (s ?? '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '');
}
/** طول معقول لرقم بطاقة شحن (السعودية ١٢–١٨ غالباً) */
export const cardOk = (c: string) => /^\d{10,20}$/.test(c);
export const idOk = (c: string) => /^[12]\d{9}$/.test(c);

/** رقم البطاقة من سطور الصورة (OCR): أطول تسلسل أرقام ١٠–٢٠ بعد شيل المسافات داخل السطر */
export function cardFromLines(lines: string[]): string | null {
  let best: string | null = null;
  for (const l of lines) {
    for (const m of cleanSpaces(l).match(/\d{10,20}/g) ?? []) if (!best || m.length > best.length) best = m;
  }
  return best;
}
function cleanSpaces(l: string): string {
  return l.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/(\d)[\s\-–]+(?=\d)/g, '$1');
}

export function rechargeUssd(c: Carrier, card: string, id?: string): string {
  if (c === 'stc') return `*155*${card}#`;
  if (c === 'zain') return `*141*${card}#`;
  return id ? `*1400*${card}*${id}#` : `*1400*${card}#`;
}
export function balanceUssd(c: Carrier): string {
  return c === 'stc' ? '*166#' : c === 'zain' ? '*142#' : '*1411#';
}
/** بديل SMS (راوتر بدون USSD) — بس للي نعرف رقمه الرسمي */
export function rechargeSms(c: Carrier, card: string): { to: string; text: string } | null {
  return c === 'stc' ? { to: '1500', text: `155*${card}#` } : null;
}
/** أرقام اللي ترد بنتيجة الشحن (نلقط ردها من رسائل الراوتر) */
export const REPLY_FROM: Record<Carrier, RegExp> = {
  stc: /^(1500|900|stc|sawa)/i,
  zain: /^(959|zain|1717)/i,
  mobily: /^(1400|1411|1100|mobily)/i,
};
/** رقم البطاقة مخفي في العرض (آخر ٤ بس) */
export const maskCard = (c: string) => (c.length > 4 ? '•'.repeat(Math.min(8, c.length - 4)) + c.slice(-4) : c);
