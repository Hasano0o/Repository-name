/* ═══ رقم القناة ← التردد ═══
 * نطلع التردد من رقم القناة لحاله، عشان ما يصير المستخدم يكتب B1 مع قناة B3 بالغلط. */

const LTE: [number, number, number][] = [
  [1, 0, 599], [3, 1200, 1949], [5, 2400, 2649], [7, 2750, 3449], [8, 3450, 3799],
  [20, 6150, 6449], [28, 9210, 9659], [38, 37750, 38249], [40, 38650, 39649],
  [41, 39650, 41589], [42, 41590, 43589], [43, 43590, 45589], [71, 68586, 68935],
];

// NR-ARFCN (الوصلة الهابطة). الترتيب مهم: الأضيق أولاً (n78 قبل n77، n28 قبل n20)
const NR: [number, number, number][] = [
  [78, 620000, 653333], [77, 620000, 680000], [41, 499200, 537999], [40, 460000, 480000],
  [38, 514000, 524000], [1, 422000, 434000], [3, 361000, 376000], [8, 185000, 192000],
  [28, 151600, 160600], [20, 158200, 164200], [79, 693334, 733333],
];

export function bandOfArfcn(tech: 'LTE' | 'NR', arfcn: number): number | undefined {
  const t = tech === 'NR' ? NR : LTE;
  return t.find(([, a, b]) => arfcn >= a && arfcn <= b)?.[0];
}

export const PCI_MAX = { LTE: 503, NR: 1007 } as const;

export interface ManualCheck {
  ok: boolean;
  band?: number;
  error?: string;
}

export function checkManual(tech: 'LTE' | 'NR', arfcnTxt: string, pciTxt: string): ManualCheck {
  const a = arfcnTxt.trim();
  const p = pciTxt.trim();
  if (!a && !p) return { ok: false };
  if (a && !/^\d+$/.test(a)) return { ok: false, error: 'رقم القناة لازم يكون أرقام بس' };
  if (p && !/^\d+$/.test(p)) return { ok: false, error: 'رقم الخلية (PCI) لازم يكون أرقام بس' };
  const band = a ? bandOfArfcn(tech, Number(a)) : undefined;
  if (a && band === undefined) {
    return { ok: false, error: tech === 'NR' ? 'رقم القناة هذا ما يطابق أي تردد 5G معروف' : 'رقم القناة هذا ما يطابق أي تردد 4G معروف' };
  }
  if (p && Number(p) > PCI_MAX[tech]) return { ok: false, band, error: `رقم الخلية لازم يكون بين 0 و ${PCI_MAX[tech]}` };
  if (!a || !p) return { ok: false, band };
  return { ok: true, band };
}
