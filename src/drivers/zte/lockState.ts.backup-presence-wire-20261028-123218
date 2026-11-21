/**
 * لقطة إعدادات القفل في ZTE — دوال صافية بدون شبكة (تنختبر في Node).
 *
 * اللقطة = قيم المفاتيح الثمانية كما رجعها الراوتر:
 * ترددات 4G (قناع)، ترددات 5G (ثلاث صيغ حسب الفيرموير)، وضع الشبكة، قفل برج 4G وقفل برج 5G.
 */
/** قناع ترددات 4G (hex) ← قائمة — نسخة صغيرة هنا عشان الملف يبقى بدون أي استيراد */
function decodeBandMask(mask: string): number[] {
  const hex = mask.trim().replace(/^0x/i, '');
  if (!hex || !/^[0-9a-f]+$/i.test(hex)) return [];
  const big = BigInt('0x' + hex);
  const out: number[] = [];
  for (let i = 0; i < 128; i++) if ((big >> BigInt(i)) & 1n) out.push(i + 1);
  return out;
}

export const ZTE_LOCK_KEYS = [
  'lte_band_lock', 'nr5g_nsa_band_lock', 'nr5g_sa_band_lock', 'nr5g_band_lock', 'net_select',
  'lte_pci_lock', 'lte_earfcn_lock', 'nr5g_cell_lock',
] as const;

export type ZteLockData = Record<string, string>;

const nrList = (v?: string) =>
  [...new Set((v ?? '').split(',').map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
const pick = (o: ZteLockData, ...keys: string[]) => {
  for (const k of keys) { const v = o[k]; if (v !== undefined && v !== '') return v; }
  return undefined;
};

export const lteBands = (d: ZteLockData) =>
  (d.lte_band_lock ? decodeBandMask(d.lte_band_lock) : []).slice().sort((a, b) => a - b);
export const nrBands = (d: ZteLockData) => nrList(pick(d, 'nr5g_nsa_band_lock', 'nr5g_band_lock', 'nr5g_sa_band_lock'));

/** قفل برج 4G: «pci/earfcn» أو off (الفاضي والصفر = بدون قفل) */
export function lteCell(d: ZteLockData): string {
  const ear = (d.lte_earfcn_lock ?? '').trim();
  const pci = (d.lte_pci_lock ?? '').trim();
  return ear && ear !== '0' ? `${pci}/${ear}` : 'off';
}
/** قفل برج 5G: «pci/arfcn/band» أو off */
export function nrCell(d: ZteLockData): string {
  const f = (d.nr5g_cell_lock ?? '').split(',').map(x => x.trim());
  return f.length >= 2 && f[1] && f[1] !== '0' ? f.slice(0, 3).join('/') : 'off';
}

/** ترمي لو القراءة ناقصة — ما نجرّب وإحنا ما نعرف وش نرجّع */
/**
 * يتحقق من وجود المفاتيح الأساسية في رد الراوتر قبل تسوية القيم.
 * مفاتيح 5G والأبراج اختيارية لاختلاف دعمها بين الفيرمويرات.
 */
export function checkLockResponse(r: Record<string, string>): void {
  if (!Object.prototype.hasOwnProperty.call(r, 'lte_band_lock')) {
    throw new Error('الراوتر لم يُرجع مفتاح ترددات 4G');
  }
  if (!Object.prototype.hasOwnProperty.call(r, 'net_select')) {
    throw new Error('الراوتر لم يُرجع مفتاح وضع الشبكة');
  }
}

export function checkComplete(d: ZteLockData): void {
  if (!(d.lte_band_lock ?? '').trim()) throw new Error('ما قدرنا نقرأ ترددات 4G من الراوتر');
  if (!(d.net_select ?? '').trim()) throw new Error('ما قدرنا نقرأ وضع الشبكة من الراوتر');
}

export type ZtePart = 'mode' | 'lte' | 'nr' | 'lteCell' | 'nrCell';

/** الأجزاء اللي تختلف عن اللقطة */
export function zteDiff(snap: ZteLockData, cur: ZteLockData): ZtePart[] {
  const out: ZtePart[] = [];
  if ((snap.net_select ?? '').trim() !== (cur.net_select ?? '').trim()) out.push('mode');
  if (lteBands(snap).join(',') !== lteBands(cur).join(',')) out.push('lte');
  // ترددات 5G: لو اللقطة ما فيها قائمة (فيرموير ما يعطيها) ما نقدر نرجّعها ولا نحاسب عليها
  if (nrBands(snap).length && nrBands(snap).join(',') !== nrBands(cur).join(',')) out.push('nr');
  if (lteCell(snap) !== lteCell(cur)) out.push('lteCell');
  if (nrCell(snap) !== nrCell(cur)) out.push('nrCell');
  return out;
}

export const ZTE_PART_LABEL: Record<ZtePart, string> = {
  mode: 'وضع الشبكة',
  lte: 'ترددات 4G',
  nr: 'ترددات 5G',
  lteCell: 'قفل برج 4G',
  nrCell: 'قفل برج 5G',
};

const MODE_TEXT: Record<string, string> = {
  Only_LTE: '4G فقط', Only_5G: '5G فقط', LTE_AND_5G: '4G + 5G', WL_AND_5G: 'تلقائي',
};

export function zteSummary(d: ZteLockData): string {
  const lc = lteCell(d);
  const nc = nrCell(d);
  const lte = lc !== 'off' ? `برج ${lc.split('/')[0]}` : lteBands(d).map(b => 'B' + b).join('+') || '—';
  const nr = nc !== 'off' ? `برج ${nc.split('/')[0]}` : nrBands(d).map(b => 'n' + b).join('+') || 'تلقائي';
  const m = (d.net_select ?? '').trim();
  return `4G: ${lte} · 5G: ${nr} · الشبكة: ${MODE_TEXT[m] ?? (m || '—')}`;
}
