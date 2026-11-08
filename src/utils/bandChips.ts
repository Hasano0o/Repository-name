/**
 * مربعات الترددات الصغيرة (الرئيسية وبطاقة الراوتر) — نفس اللي في «الأساسي والثانوي»:
 * الأساسي أزرق · الثانوي 4G برتقالي · 5G بنفسجي.
 * المصدر الأول النواقل (getCarriers)، ولو ما فيه نكمّل من سطر الإشارة (band / nrBand).
 * بدون react-native — ينختبر في tests/bandChips.test.ts.
 */
export type BandChipKind = 'pcc' | 'lte' | 'nr';
export interface BandChip { label: string; kind: BandChipKind }

interface CarrierLike { tech: 'LTE' | 'NR'; band: number; role: 'PCC' | 'SCC' }
interface SignalLike { band?: string; nrBand?: string }

const lteOf = (band?: string): string[] => {
  if (!band) return [];
  const b = [...band.matchAll(/\bB(\d+)/gi)].map(m => `B${m[1]}`);
  if (b.length) return b;
  const t = band.trim();
  return /^\d+$/.test(t) ? [`B${t}`] : [];
};
const nrOf = (sig?: SignalLike | null): string[] => [
  ...[...String(sig?.band ?? '').matchAll(/\bn(\d+)/gi)].map(m => `n${m[1]}`),
  ...[...String(sig?.nrBand ?? '').matchAll(/n?(\d+)/gi)].map(m => `n${m[1]}`),
];

const label = (c: CarrierLike) => (c.tech === 'NR' ? 'n' : 'B') + c.band;

export function bandChips(carriers?: CarrierLike[] | null, sig?: SignalLike | null): BandChip[] {
  const out: BandChip[] = [];
  const seen = new Set<string>();
  const push = (l: string, kind: BandChipKind) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ label: l, kind });
  };
  const lte = lteOf(sig?.band);
  let list = (carriers ?? []).filter(c => Number.isFinite(c.band) && c.band > 0);
  // نواقل قديمة (الأساسي تغيّر بعدها) ← نتجاهلها ونمشي على الإشارة لين تنقرى من جديد
  const p0 = list.find(c => c.role === 'PCC');
  if (p0 && p0.tech === 'LTE' && lte[0] && lte[0].toLowerCase() !== label(p0).toLowerCase()) list = [];
  const pcc = list.find(c => c.role === 'PCC');
  if (pcc) push(label(pcc), 'pcc');
  // لو النواقل ما فيها أساسي، أول تردد 4G في الإشارة هو الأساسي
  if (!pcc && lte[0]) push(lte[0], 'pcc');
  for (const c of list) if (c.role === 'SCC' && c.tech === 'LTE') push(label(c), 'lte');
  for (const l of lte) push(l, 'lte');
  const nr = [...list.filter(c => c.role === 'SCC' && c.tech === 'NR').map(label), ...nrOf(sig)];
  // 5G لحاله (SA): أول تردد 5G هو الأساسي
  for (const l of nr) push(l, out.length ? 'nr' : 'pcc');
  return out;
}
