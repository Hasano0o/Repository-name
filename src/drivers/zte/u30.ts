/**
 * ZTE U30 Pro (صفحة UFI «mu3351» — knockout + require.js): أوامر الترددات من service.js الحقيقي
 * (ملفات صفحة الراوتر ٢٧ أكتوبر). تختلف عن MU5001 كلياً:
 *   • 4G:  LTE_BAND_LOCK  lte_band_lock="1,3,8"   (قائمة أرقام، مو قناع hex زي BAND_SELECT)
 *   • 5G:  NR_BAND_LOCK   nr_band_lock="1,78"
 *   • المدعوم: frequency_support_4g / frequency_support_5g (مصفوفات)
 *   • الأبراج: CELL_LOCK (pci,earfcn,rat 12=4G) · UNLOCK_ALL_CELL · locked_cell_info · neighbor_cell_info
 *   • صفحة الراوتر نفسها تعيد التشغيل بعد أي تغيير ترددات/أبراج («lan_confirm_reopen» ثم restart)
 *   • التوقيع AD = SHA256(SHA256(wa_inner_version + cr_version) + RD) بأحرف كبيرة = صيغة «sha:wa+cr»
 * ملف صافي (بدون react-native) — عليه اختبارات. يشتغل بس لموديل u30Pro (ما يمر على MU5001 أبداً).
 */
import type { ZteIo } from './extras';

/** أوامر الكتابة المسموحة على U30 Pro — غيرها (الواي فاي…) لسا محجوب لأنه يقول success وما يغيّر شي */
export const U30_WRITES = [
  'LTE_BAND_LOCK', 'NR_BAND_LOCK', 'UNLOCK_ALL_CELL', 'SET_BEARER_PREFERENCE',
  'REBOOT_DEVICE', 'DISCONNECT_NETWORK', 'CONNECT_NETWORK',
];

/** القيم الافتراضية في config.js لو الراوتر ما رجّع قائمته */
export const U30_DEF_LTE = [1, 3, 5, 8, 34, 39, 40, 41];
export const U30_DEF_NR = [1, 5, 8, 28, 41, 78];

const ok = (out: string) => /"?result"?\s*:\s*"?success"?/i.test(out || '');

/** "1,3,8" أو "[1,3,8]" أو ["1","3"] ← [1,3,8] مرتبة بدون تكرار */
export function u30List(v: unknown): number[] {
  let arr: unknown[] = [];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('[')) { try { const j = JSON.parse(s); if (Array.isArray(j)) arr = j; } catch {} }
    else arr = s.split(/[,;\s]+/);
  }
  const out = arr.map(x => parseInt(String(x).replace(/^[BbNn]/, ''), 10)).filter(n => Number.isFinite(n) && n > 0 && n < 512);
  return [...new Set(out)].sort((a, b) => a - b);
}

export async function u30Supported(io: ZteIo): Promise<{ lte: number[]; nr: number[] }> {
  const r = await io.get(['frequency_support_4g', 'frequency_support_5g']).catch(() => ({} as Record<string, string>));
  const lte = u30List(r.frequency_support_4g);
  const nr = u30List(r.frequency_support_5g);
  return { lte: lte.length ? lte : U30_DEF_LTE, nr: nr.length ? nr : U30_DEF_NR };
}

export interface U30Lock { lte: number[]; nr: number[]; mode: string }

export async function u30ReadLock(io: ZteIo): Promise<U30Lock> {
  const r = await io.get(['lte_band_lock', 'nr_band_lock', 'net_select']);
  return { lte: u30List(r.lte_band_lock), nr: u30List(r.nr_band_lock), mode: (r.net_select || '').trim() };
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every(x => b.includes(x));

/**
 * يكتب ترددات 4G/5G (القائمة الفاضية = كل المدعوم). يرجّع true لو فعلاً تغيّر شي (يحتاج إعادة تشغيل).
 * ما نرسل أمر لقيمة هي نفسها الحالية.
 */
export async function u30SetBands(io: ZteIo, lte: number[] | 'keep', nr?: number[]): Promise<boolean> {
  const cur = await u30ReadLock(io);
  const sup = await u30Supported(io);
  let changed = false;
  if (lte !== 'keep') {
    const want = lte.length ? u30List(lte) : sup.lte;
    if (!same(want, cur.lte)) {
      const out = await io.act({ goformId: 'LTE_BAND_LOCK', lte_band_lock: want.join(',') });
      if (!ok(out)) throw u30Rejected('تثبيت ترددات 4G', out);
      changed = true;
    }
  }
  if (nr) {
    const want = nr.length ? u30List(nr) : sup.nr;
    // «أي 5G» والراوتر ما فيه قفل 5G مكتوب أصلاً ← ما فيه شي نغيّره
    if (!(nr.length === 0 && cur.nr.length === 0) && !same(want, cur.nr)) {
      const out = await io.act({ goformId: 'NR_BAND_LOCK', nr_band_lock: want.join(',') });
      if (!ok(out)) throw u30Rejected('تثبيت ترددات 5G', out);
      changed = true;
    }
  }
  return changed;
}

export function u30Rejected(what: string, out: string): Error {
  const raw = (out || '').replace(/\s+/g, ' ').slice(0, 60);
  return new Error(`الراوتر رفض ${what}. لو صفحة الراوتر مفتوحة في متصفح، سكّرها وجرّب (${raw || 'بدون رد'})`);
}

/** «مفتوح» = كل المدعوم مختار (أو القائمة فاضية) */
export function u30Locked(cur: number[], sup: number[]): number[] {
  if (!cur.length) return [];
  return sup.every(b => cur.includes(b)) ? [] : cur;
}

export interface U30Cell { tech: 'LTE' | 'NR'; pci: string; arfcn: string }

function arr(raw: Record<string, unknown> | null, key: string): Record<string, unknown>[] {
  let v: unknown = raw?.[key];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = []; } }
  return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : [];
}
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/** الأبراج المثبّتة (من صفحة الراوتر أو قبل) — rat 12 = 4G، غيره 5G */
export async function u30CellLocks(io: ZteIo): Promise<U30Cell[]> {
  const raw = await io.getRaw('locked_cell_info');
  return arr(raw, 'locked_cell_info')
    .map(c => ({ tech: str(c.rat) === '12' ? 'LTE' as const : 'NR' as const, pci: str(c.pci), arfcn: str(c.earfcn) }))
    .filter(c => c.pci && c.arfcn);
}

/** يفك كل الأبراج — بس لو فيه تثبيت فعلاً (ما نرسل أمر لراوتر نظيف). true = انفك شي */
export async function u30UnlockAll(io: ZteIo): Promise<boolean> {
  const had = await u30CellLocks(io).catch(() => [] as U30Cell[]);
  if (!had.length) return false;
  const out = await io.act({ goformId: 'UNLOCK_ALL_CELL' });
  if (!ok(out)) throw u30Rejected('فك التثبيت على البرج', out);
  return true;
}

export interface U30Neighbor { band?: number; arfcn: string; pci: string; rsrp?: number; rsrq?: number; sinr?: number }

export async function u30Neighbors(io: ZteIo): Promise<U30Neighbor[]> {
  const raw = await io.getRaw('neighbor_cell_info');
  const n = (v: unknown) => { const x = parseFloat(str(v)); return Number.isFinite(x) ? x : undefined; };
  return arr(raw, 'neighbor_cell_info').map(c => ({
    band: u30List(str(c.band))[0],
    arfcn: str(c.earfcn),
    pci: str(c.pci),
    rsrp: n(c.rsrp), rsrq: n(c.rsrq), sinr: n(c.sinr),
  })).filter(c => c.pci && c.arfcn);
}

const MODE_LABEL: Record<string, string> = {
  WL_AND_5G: 'تلقائي', LTE_AND_5G: '4G + 5G', Only_5G: '5G فقط', Only_LTE: '4G فقط', WCDMA_AND_LTE: '4G/3G',
};
export function u30Summary(d: U30Lock): string {
  const lte = d.lte.length ? d.lte.map(b => 'B' + b).join('+') : 'الكل';
  const nr = d.nr.length ? d.nr.map(b => 'n' + b).join('+') : 'الكل';
  return `4G: ${lte} · 5G: ${nr}${d.mode ? ' · ' + (MODE_LABEL[d.mode] ?? d.mode) : ''}`;
}

/** الفروقات بين اللقطة والحالي — بالعربي للعرض */
export function u30Diff(want: U30Lock, cur: U30Lock): string[] {
  const out: string[] = [];
  if (!same(want.lte, cur.lte)) out.push('ترددات 4G');
  if (!same(want.nr, cur.nr)) out.push('ترددات 5G');
  if (want.mode && want.mode !== cur.mode) out.push('وضع الشبكة');
  return out;
}
