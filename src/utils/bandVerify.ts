/**
 * «هل الراوتر فعلاً اتصل على التردد اللي طلبناه؟» — شكاوى أعضاء ٢١ نوفمبر ٢٠٢٦:
 * المُحسّن والتحسين التلقائي كانوا ينسبون نتيجة B3 لـ B40 لما الراوتر يتجاهل التثبيت ويبقى على تردده،
 * فيطلع «B40 أفضل» ويدمجه — وB40 مو موجود عند برج العضو أصلاً.
 * دوال صافية (بدون شبكة) عشان تنختبر.
 */
import type { Signal, Carrier } from '../drivers/types';

export interface Serving { lte: number[]; nr: number[] }

const num = (v?: string | number) => Number(String(v ?? '').match(/\d+/)?.[0] ?? NaN);
const uniq = (xs: number[]) => [...new Set(xs.filter(b => Number.isFinite(b) && b > 0))];

/** الترددات اللي الراوتر متصل عليها الحين (من النواقل، وإلا من قراءة الإشارة) */
export function servingBands(sig: Signal | null | undefined, carriers: Carrier[] | null | undefined): Serving {
  const cs = carriers ?? [];
  if (cs.length) {
    return { lte: uniq(cs.filter(c => c.tech === 'LTE').map(c => c.band)), nr: uniq(cs.filter(c => c.tech === 'NR').map(c => c.band)) };
  }
  const lte = sig && sig.rsrp !== undefined ? uniq([num(sig.band)]) : [];
  const nr = sig && (sig.nrRsrp !== undefined || sig.nrActiveFromStatus) ? uniq([num(sig.nrBand)]) : [];
  return { lte, nr };
}

const L = (b: number) => 'B' + b;
const N = (b: number) => 'n' + b;

/**
 * يقارن المطلوب بالمتصل عليه. ok=false = التجربة ما تنحسب (الراوتر ما انتقل / البرج ما دمج).
 * لو الراوتر ما يعطي التردد أصلاً (فاضي) ← ما نقدر نحكم، نقبلها زي قبل.
 */
export function verifyServing(req: { lte?: number[] | null; nr?: number[] | null }, s: Serving): { ok: boolean; why?: string } {
  const wantL = req.lte ?? [];
  const wantN = req.nr ?? [];
  if (wantL.length && s.lte.length) {
    const extra = s.lte.filter(b => !wantL.includes(b));
    if (extra.length) {
      return { ok: false, why: `الراوتر بقى على ${extra.map(L).join(' + ')} — ما انتقل لـ ${wantL.map(L).join(' + ')} (غالباً ما فيه برج عليه عندك)` };
    }
    const got = s.lte.filter(b => wantL.includes(b));
    if (wantL.length >= 2 && got.length < 2) {
      return { ok: false, why: `البرج ما دمجها — صار ${got.map(L).join(' + ') || 'بدون 4G'} بس` };
    }
  }
  if (wantN.length) {
    if (s.nr.length) {
      const extra = s.nr.filter(b => !wantN.includes(b));
      if (extra.length) return { ok: false, why: `الراوتر بقى على ${extra.map(N).join(' + ')} — ما انتقل لـ ${wantN.map(N).join(' + ')}` };
    } else if (s.lte.length && !wantL.length) {
      // طلبنا 5G بس وهو متصل 4G بدون 5G ← التردد مو موجود عند البرج
      return { ok: false, why: `ما اتصل على ${wantN.map(N).join(' + ')} — غالباً ما فيه برج 5G عليه عندك` };
    }
  }
  return { ok: true };
}

/** الترددات المعروفة لمنطقتك = اللي شفناها فعلاً (المتصل الحين + اللي تعلّمناها من شبكتك) — بدون القوائم الثابتة */
export function knownBands(current: Serving, seen: Serving | null | undefined): Serving {
  return { lte: uniq([...current.lte, ...(seen?.lte ?? [])]), nr: uniq([...current.nr, ...(seen?.nr ?? [])]) };
}
