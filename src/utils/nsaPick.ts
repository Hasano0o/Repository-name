/**
 * شاشة «دمج 4G + 5G» — اختيار العضو بنفسه (طلب عضو ١٣ نوفمبر) وعرض النواقل.
 */
export interface Combo { lte: number[]; nr: number[] }

/** «B3 + B3 + n78» (ناقلين على نفس التردد) ← «B3×2 + n78» */
export function squashBands(t: string): string {
  const parts = t.split('+').map(x => x.trim()).filter(Boolean);
  const order: string[] = [];
  const n = new Map<string, number>();
  for (const p of parts) { if (!n.has(p)) order.push(p); n.set(p, (n.get(p) ?? 0) + 1); }
  return order.map(p => (n.get(p)! > 1 ? `${p}×${n.get(p)}` : p)).join(' + ');
}

/** التركيبات من اختيار العضو: كل 5G اختاره مع كل الـ4G اللي اختارها */
export function manualCombos(lte: number[], nr: number[]): Combo[] {
  if (!lte.length || !nr.length) return [];
  const l = [...lte].sort((a, b) => a - b);
  return [...nr].sort((a, b) => a - b).slice(0, 6).map(b => ({ lte: l, nr: [b] }));
}

