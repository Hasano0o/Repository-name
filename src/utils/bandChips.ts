/**
 * مربعات الترددات الصغيرة (الرئيسية وبطاقة الراوتر) — نفس اللي في «الأساسي والثانوي»:
 * الأساسي أزرق · الثانوي 4G برتقالي · 5G بنفسجي.
 * المصدر الأول النواقل (getCarriers)، ولو ما فيه نكمّل من سطر الإشارة (band / nrBand).
 * بدون react-native — ينختبر في tests/bandChips.test.ts.
 */
/** idle = مثبّت/كان مدموج بس مو شغال الحين (يشبك وقت التحميل) — مربع باهت بحد متقطع */
export type BandChipKind = 'pcc' | 'lte' | 'nr' | 'idle';
export interface BandChip { label: string; kind: BandChipKind }

interface CarrierLike { tech: 'LTE' | 'NR'; band: number; role: 'PCC' | 'SCC'; arfcn?: string; pci?: string; bandwidth?: number }
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

/** ناقلين بنفس الباند = ناقلين فعلاً (دمج داخل نفس الباند، مثل B3 15MHz + B3 20MHz)
 *  بس لو فيه فرق مؤكد: ARFCN أو PCI أو عرض النطاق. بدون فرق = نفس الناقل مكرر. */
const differs = (a: CarrierLike, b: CarrierLike) => {
  const d = <T,>(x?: T, y?: T) => x !== undefined && x !== '' && y !== undefined && y !== '' && String(x) !== String(y);
  return d(a.arfcn, b.arfcn) || d(a.pci, b.pci) || d(a.bandwidth, b.bandwidth);
};

export function bandChips(carriers?: CarrierLike[] | null, sig?: SignalLike | null): BandChip[] {
  const out: BandChip[] = [];
  const seen = new Set<string>();
  const push = (l: string, kind: BandChipKind) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ label: l, kind });
  };
  const taken: CarrierLike[] = [];
  const pushCarrier = (c: CarrierLike, kind: BandChipKind) => {
    const l = label(c);
    if (taken.some(t => label(t) === l && !differs(t, c))) return;
    taken.push(c);
    seen.add(l.toLowerCase());
    out.push({ label: l, kind });
  };
  const lte = lteOf(sig?.band);
  let list = (carriers ?? []).filter(c => Number.isFinite(c.band) && c.band > 0);
  // نواقل قديمة (الأساسي تغيّر بعدها) ← نتجاهلها ونمشي على الإشارة لين تنقرى من جديد
  const p0 = list.find(c => c.role === 'PCC');
  if (p0 && p0.tech === 'LTE' && lte[0] && lte[0].toLowerCase() !== label(p0).toLowerCase()) list = [];
  const pcc = list.find(c => c.role === 'PCC');
  if (pcc) pushCarrier(pcc, 'pcc');
  // لو النواقل ما فيها أساسي، أول تردد 4G في الإشارة هو الأساسي
  if (!pcc && lte[0]) push(lte[0], 'pcc');
  for (const c of list) if (c.role === 'SCC' && c.tech === 'LTE') pushCarrier(c, 'lte');
  for (const l of lte) push(l, 'lte');
  // 5G لحاله (SA): أول تردد 5G هو الأساسي
  for (const c of list) if (c.role === 'SCC' && c.tech === 'NR') pushCarrier(c, out.length ? 'nr' : 'pcc');
  for (const l of nrOf(sig)) push(l, out.length ? 'nr' : 'pcc');
  return out;
}

/**
 * نضيف الترددات المثبّتة (أو آخر دمج) اللي ما شبكت الحين كمربعات «idle» بعد الشغالة —
 * حسن ٩ نوفمبر: البانر يقول «مثبّت على B1 + B3 + B20» وخانة الترددات فيها B3 بس = يبان تناقض.
 */
export function withIdle(chips: BandChip[], extra: (string | undefined | null)[]): BandChip[] {
  const have = new Set(chips.map(c => c.label.toLowerCase()));
  const out = [...chips];
  for (const raw of extra) {
    const m = String(raw ?? '').trim().match(/^([bn])?(\d+)$/i);
    if (!m) continue;
    const l = (m[1] && m[1].toLowerCase() === 'n' ? 'n' : 'B') + m[2];
    if (have.has(l.toLowerCase())) continue;
    have.add(l.toLowerCase());
    out.push({ label: l, kind: 'idle' });
  }
  return out;
}
