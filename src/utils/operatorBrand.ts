/**
 * اسم الشركة من اللي يرسله البرج/الراوتر ← اسم نظيف + لون الشركة (شارة بدل الشعار — الشعارات حقوق).
 * الأبراج ترسل أحياناً إضافات مؤقتة: «Zain HAJJ EXPO» / «stc ksa HAJJ EXPO» (معرض الحج ٨–١١ نوفمبر ٢٠٢٦)
 * ← نعرض اسم الشركة بس. شركة ما نعرفها ← الاسم مثل ما هو. بدون react-native (tests/operatorBrand.test.ts).
 */
export type Brand = 'stc' | 'zain' | 'mobily' | 'salam' | 'virgin' | 'lebara';

const LABEL: Record<Brand, string> = { stc: 'stc', zain: 'زين', mobily: 'موبايلي', salam: 'سلام', virgin: 'فيرجن', lebara: 'ليبارا' };
/** نفس ألوان «أفضل شركة في منطقتك» */
export const BRAND_COLOR: Record<Brand, string> = {
  stc: '#4f2d7f', zain: '#1f9e63', mobily: '#0d7fc6', salam: '#e0a100', virgin: '#d61f26', lebara: '#3b4fc4',
};
export const OTHER_COLOR = '#64748b';

export function brandOf(name?: string | null): { key: Brand | null; label: string } {
  const raw = String(name ?? '').replace(/\s+/g, ' ').trim();
  const n = raw.toLowerCase();
  if (!n) return { key: null, label: '' };
  let key: Brand | null = null;
  if (/zain|زين|420\s?-?04/.test(n)) key = 'zain';
  else if (/mobily|موبايلي|etihad|etisalat|اتحاد|420\s?-?03/.test(n)) key = 'mobily';
  else if (/\bstc\b|al ?jawal|الجوال|saudi telecom|الاتصالات السعودية|420\s?-?01|ksa-?stc/.test(n)) key = 'stc';
  else if (/salam|سلام/.test(n)) key = 'salam';
  else if (/virgin|فيرجن/.test(n)) key = 'virgin';
  else if (/lebara|ليبارا/.test(n)) key = 'lebara';
  return key ? { key, label: LABEL[key] } : { key: null, label: raw.slice(0, 24) };
}

export const brandColor = (name?: string | null) => {
  const k = brandOf(name).key;
  return k ? BRAND_COLOR[k] : OTHER_COLOR;
};
