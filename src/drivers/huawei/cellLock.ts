/**
 * بناء وقراءة طلبات net/lock-freq (تثبيت الخلية) في هواوي — دوال صافية بدون شبكة،
 * عشان نختبرها في Node بدون راوتر.
 */
import type { CellLockState } from '../types';

export type Tech = 'LTE' | 'NR';

const tag = (xml: string, t: string) =>
  xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1];

export const sectionName = (tech: Tech) => (tech === 'NR' ? 'nr_info' : 'lte_info');

export function sectionXml(name: string, mode: string, entries: string[], allBands: string) {
  return '<' + name + '><lock_mode>' + mode + '</lock_mode><freq_infos>' +
    entries.join('') + '</freq_infos><all_bands>' + allBands + '</all_bands></' + name + '>';
}

/** أقسام القفل الحالية كما رجعها الراوتر (المحتوى الداخلي لكل قسم) */
export interface LockRaw { lte: string; nr: string }

export function parseLockRaw(xml: string): LockRaw {
  return { lte: tag(xml, 'lte_info') ?? '', nr: tag(xml, 'nr_info') ?? '' };
}

export const isSectionLocked = (sec: string) => !!sec && (tag(sec, 'lock_mode') ?? '0') !== '0';

export function parseCellLocks(raw: LockRaw): CellLockState[] {
  const out: CellLockState[] = [];
  for (const [tech, sec] of [['LTE', raw.lte], ['NR', raw.nr]] as const) {
    if (!isSectionLocked(sec)) continue;
    const pci = (tag(sec, 'pci') ?? '').trim();
    if (!pci) continue;
    const band = parseInt(tag(sec, 'band') ?? '', 10);
    out.push({ tech, pci, band: Number.isFinite(band) ? band : undefined, arfcn: (tag(sec, 'freq') ?? '').trim() || undefined });
  }
  return out;
}

/**
 * طلب تثبيت خلية لتقنية وحدة.
 * التقنية الثانية: لو عليها قفل، نرسلها **كما قرأناها** من الراوتر (ما نمسحها) —
 * قبل كانت تنرسل lock_mode=0 فكان تثبيت 5G يفك تثبيت 4G والعكس.
 * وضع الشبكة 4G فقط (03) ما يرسل قسم 5G، و5G فقط (08) ما يرسل قسم 4G — مثل صفحة الراوتر.
 */
export function buildCellLockBody(o: {
  tech: Tech;
  pci: string;
  arfcn: string;
  band?: number;
  mode: string;
  current: LockRaw;
  netMode: string;
}): string {
  const entry = '<freq_info>' +
    (o.band ? '<band>' + o.band + '</band>' : '<band></band>') +
    '<freq>' + o.arfcn + '</freq><pci>' + o.pci + '</pci></freq_info>';
  const otherTech: Tech = o.tech === 'NR' ? 'LTE' : 'NR';
  const otherName = sectionName(otherTech);
  const otherRaw = otherTech === 'NR' ? o.current.nr : o.current.lte;
  const mine = sectionXml(sectionName(o.tech), o.mode, [entry], o.band ? String(o.band) : '');
  const rest = isSectionLocked(otherRaw)
    ? '<' + otherName + '>' + otherRaw + '</' + otherName + '>'
    : sectionXml(otherName, '0', [], '');
  const lte = o.tech === 'LTE' ? mine : rest;
  const nr = o.tech === 'NR' ? mine : rest;
  if (o.netMode === '03') return lte;
  if (o.netMode === '08') return nr;
  return lte + nr;
}

/** فك تثبيت تقنية وحدة أو الاثنتين */
export function buildUnlockBody(tech?: Tech): string {
  if (tech === 'LTE') return sectionXml('lte_info', '0', [], '');
  if (tech === 'NR') return sectionXml('nr_info', '0', [], '');
  return sectionXml('lte_info', '0', [], '') + sectionXml('nr_info', '0', [], '');
}

/** هل القراءة بعد الأمر تثبت إن الخلية المطلوبة مقفولة فعلاً؟ */
export function lockMatches(locks: CellLockState[], tech: Tech, pci: string, arfcn: string): boolean {
  const l = locks.find(x => x.tech === tech);
  if (!l || l.pci !== pci) return false;
  return !l.arfcn || !arfcn || l.arfcn === arfcn;
}

/**
 * قسم قفل ترددات (lock_mode 3) مثل صفحة «تحديد النطاق» بالراوتر:
 * freq_infos = اللي تقدر تكون أساسي، all_bands = كل المسموح. فاضي = بدون قفل (0).
 * لازم يبقى تردد واحد على الأقل «أساسي + ثانوي» (شرط الراوتر).
 */
export function bandLockSection(name: string, bands: number[], scellOnly: number[] = []): string {
  const all = [...new Set(bands)];
  if (!all.length) return sectionXml(name, '0', [], '');
  let prim = all.filter(b => !scellOnly.includes(b));
  if (!prim.length) prim = all;
  return sectionXml(name, '3', prim.map(b => '<freq_info><band>' + b + '</band></freq_info>'), all.join(','));
}
