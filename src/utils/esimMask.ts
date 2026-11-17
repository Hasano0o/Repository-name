/** نخفي الأرقام الطويلة (ICCID ١٩–٢٠ · EID ٣٢ · IMSI ١٥ · جوال) قبل ما ترسل ردود eSIM للسيرفر — أول ٤ تبقى (تعرّف الشركة) */
export function maskLongDigits(t: string): string {
  return t.replace(/\d{9,}/g, d => d.slice(0, 4) + '*'.repeat(d.length - 4));
}
