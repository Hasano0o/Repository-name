/**
 * قراءة كل تردد لحاله (حسن ٢٨ نوفمبر — فكرة من تطبيق منافس: كل ناقل له RSRP/SINR/RSRQ/PCI).
 * يرتّب النواقل (الأساسي أول) ويقيّم كل واحد، ويعلّم الثانوي الضعيف اللي ممكن يبطّئ.
 * صافي بدون react-native — عليه اختبارات (tests/carrierQuality.test.ts).
 * الحدود نفسها اللي في src/utils/signal.ts (rsrpLevel / sinrLevel).
 */
export type CqLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface CqCarrier {
  tech: 'LTE' | 'NR';
  band: number;
  role: 'PCC' | 'SCC';
  pci?: string;
  bandwidth?: number;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
}

export interface CqRow extends CqCarrier {
  level: CqLevel;
  /** ثانوي ضعيف — ممكن ينزّل السرعة */
  weak: boolean;
  /** كم أضعف من الأساسي (dB) — بس لو الفرق واضح */
  behind?: number;
}

const grade = (v: number | undefined, a: number, b: number, c: number): CqLevel =>
  v === undefined ? 'unknown' : v >= a ? 'excellent' : v >= b ? 'good' : v >= c ? 'fair' : 'poor';
const ORDER: CqLevel[] = ['poor', 'fair', 'good', 'excellent'];

/** قيمة RSRP منطقية (بعض الراوترات تعطي 0 أو أرقام غلط للثانوي) */
export const okRsrp = (v?: number) => (typeof v === 'number' && v <= -44 && v >= -140 ? v : undefined);
export const okSinr = (v?: number) => (typeof v === 'number' && v >= -20 && v <= 50 ? v : undefined);
export const okRsrq = (v?: number) => (typeof v === 'number' && v >= -34 && v < 0 ? v : undefined);

/** تقييم ناقل: الأضعف بين القوة (RSRP) والنظافة (SINR) */
export function carrierLevel(c: { rsrp?: number; sinr?: number }): CqLevel {
  const ls = [grade(okRsrp(c.rsrp), -80, -90, -100), grade(okSinr(c.sinr), 20, 13, 0)].filter(l => l !== 'unknown');
  if (!ls.length) return 'unknown';
  return ls.reduce((a, b) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b));
}

/** فيه قراءة لثانوي واحد على الأقل؟ (وإلا ما نعرض القسم) */
export function hasPerCarrier(list: CqCarrier[] | null | undefined): boolean {
  return (list ?? []).some(c => c.role === 'SCC' && (okRsrp(c.rsrp) !== undefined || okSinr(c.sinr) !== undefined));
}

/** الفرق اللي نعتبره «أضعف بوضوح» من الأساسي */
export const BEHIND_DB = 10;

export function carrierRows(list: CqCarrier[] | null | undefined): CqRow[] {
  const all = (list ?? []).filter(c => c.band > 0);
  const pcc = all.find(c => c.role === 'PCC');
  const rest = all.filter(c => c !== pcc);
  const sorted = pcc ? [pcc, ...rest] : rest;
  return sorted.map(c => {
    const rsrp = okRsrp(c.rsrp), sinr = okSinr(c.sinr), rsrq = okRsrq(c.rsrq);
    const level = carrierLevel({ rsrp, sinr });
    let behind: number | undefined;
    // نقارن بنفس التقنية بس (5G على تردد عالي أضعف طبيعي من 4G)
    const ref = c.role === 'SCC' && pcc && pcc.tech === c.tech ? okRsrp(pcc.rsrp) : undefined;
    if (ref !== undefined && rsrp !== undefined && ref - rsrp >= BEHIND_DB) behind = Math.round(ref - rsrp);
    const weak = c.role === 'SCC' && (level === 'poor' || behind !== undefined);
    return { ...c, rsrp, sinr, rsrq, level, weak, behind };
  });
}

/** جملة قصيرة تحت القائمة — أضعف ثانوي (أو لا شي) */
export function weakNote(rows: CqRow[]): string | null {
  const w = rows.filter(r => r.weak);
  if (!w.length) return null;
  const lbl = (r: CqRow) => (r.tech === 'NR' ? 'n' : 'B') + r.band;
  if (w.length > 1) return `${w.map(lbl).join(' · ')} ضعيفة — ممكن تنزّل سرعة الدمج`;
  const r = w[0];
  return r.behind !== undefined
    ? `${lbl(r)} أضعف من الأساسي بـ ${r.behind} dB — ممكن ينزّل سرعة الدمج`
    : `${lbl(r)} ضعيف — ممكن ينزّل سرعة الدمج`;
}
