/**
 * Pro7 (LuCI bigtmt) — صفحات المودم من ملف FULL (٢ نوفمبر ٢٠٢٦، 5G CPE Pro 7 موبايلي):
 *
 *  admin/modem/band (Band Lock) — نموذج واحد فيه ٤ أقسام، كل قسم «Enable» + قائمة مربعات:
 *    gwenable/set_gwband (WCDMA 1/5/8) · lteenable/set_lteband (B1…B71) ·
 *    nsanr5genable/set_nsanr5gband (NSA: n1…n78) · nr5genable/set_nr5gband (SA: n1…n78)
 *    عند العضو: LTE مطفي (= كل الترددات) والسيارة شغالة على 4G ← «Enable» = التثبيت شغال، والقائمة = المسموح.
 *    NSA مشغّل على n78 بس (إعداد الشركة).
 *  admin/modem/network — select «Network Mode»: 0 Auto · 1 5G Only · 2 4G Only · 3 3G Only · 4 5G NSA Only ·
 *    5 5G SA Only · 6 5G SA+NSA/4G (القسم مجهول الاسم cfgXXXX — ناخذه من الصفحة)
 *  admin/modem/cell — ltecelllock {enable, freq, pci} · sacelllock {enable, freq, scs(15/30/60/120), pci, band}
 *    تثبيت برج 5G قسمه «sacelllock» ← للـ SA بس.
 *
 * أسماء الخانات نلقاها في الصفحة الحية بنهايتها (ما نفترض اسم القسم)، وقيم المربعات من الصفحة نفسها.
 * ملف صافي بدون react-native.
 */
import { CbiForm, cbiChoices, cbiState } from './cbi';
import { NetworkModeOption } from '../types';

export type Pro7List = 'gw' | 'lte' | 'nsa' | 'sa';
const KEY: Record<Pro7List, string> = { gw: 'gw', lte: 'lte', nsa: 'nsanr5g', sa: 'nr5g' };

export interface Pro7BandList {
  flag: string;
  list: string;
  enabled: boolean;
  /** رقم التردد ← قيمة المربع في الصفحة */
  opts: { band: number; value: string; checked: boolean }[];
}

export function pro7BandLists(form: CbiForm): Partial<Record<Pro7List, Pro7BandList>> {
  const st = cbiState(form);
  const out: Partial<Record<Pro7List, Pro7BandList>> = {};
  for (const k of Object.keys(KEY) as Pro7List[]) {
    const flag = Object.keys(st.flags).find(n => n.endsWith(`.${KEY[k]}enable`) && !n.endsWith(`.nsa${KEY[k]}enable`));
    if (!flag) continue;
    const list = flag.replace(new RegExp(`\\.${KEY[k]}enable$`), `.set_${KEY[k]}band`);
    const opts = cbiChoices(form, list)
      .map(c => ({ band: Number((c.label.match(/\d{1,3}/) ?? [])[0]), value: c.value, checked: c.checked }))
      .filter(o => Number.isFinite(o.band) && o.band > 0);
    if (!opts.length) continue;
    out[k] = { flag, list, enabled: st.flags[flag], opts };
  }
  return out;
}

/** الترددات المثبّتة في قائمة (فاضي = تلقائي) */
export const lockedBands = (l?: Pro7BandList) => (l && l.enabled ? l.opts.filter(o => o.checked).map(o => o.band) : []);

export function pro7NetField(form: CbiForm) {
  return form.fields.find(f => f.type === 'select' && /^cbid\.[^.]+\.[^.]+\.network$/.test(f.name));
}

const MODE_AR: Record<string, string> = {
  'auto': 'تلقائي', '5g only': '5G بس', '4g only': '4G بس', '3g only': '3G بس',
  '5g nsa only': '5G NSA بس', '5g sa only': '5G SA بس', '5g sa+nsa/4g': '5G SA + NSA + 4G',
};
export function pro7Modes(form: CbiForm): NetworkModeOption[] {
  return (pro7NetField(form)?.options ?? []).map(o => ({ value: o.value, label: MODE_AR[o.label.toLowerCase().trim()] ?? o.label }));
}
/** قيمة خيار بالاسم الإنجليزي اللي في الصفحة (Auto …) */
export function pro7ModeByLabel(form: CbiForm, label: string): string | undefined {
  return pro7NetField(form)?.options?.find(o => o.label.toLowerCase().trim() === label.toLowerCase())?.value;
}

export interface Pro7CellSec { enable: string; freq: string; pci: string; scs?: string; band?: string }
/** أسماء خانات تثبيت البرج (ltecelllock / sacelllock) */
export function pro7CellFields(form: CbiForm): { lte?: Pro7CellSec; sa?: Pro7CellSec } {
  const st = cbiState(form);
  const sec = (s: string): Pro7CellSec | undefined => {
    const enable = Object.keys(st.flags).find(n => n.endsWith(`.${s}.enable`));
    if (!enable) return undefined;
    const p = enable.slice(0, -'.enable'.length);
    if (!(`${p}.freq` in st.vals) || !(`${p}.pci` in st.vals)) return undefined;
    return {
      enable, freq: `${p}.freq`, pci: `${p}.pci`,
      scs: `${p}.scs` in st.vals ? `${p}.scs` : undefined,
      band: `${p}.band` in st.vals ? `${p}.band` : undefined,
    };
  };
  return { lte: sec('ltecelllock'), sa: sec('sacelllock') };
}

/**
 * SCS لبرج 5G — بس الترددات اللي لها قيمة وحدة في 3GPP (38.104 جدول SSB):
 * n77/n78/n79 = 30 · n1/n3/n7/n8/n20/n28/n71 = 15. غيرها (n41 ممكن 15 أو 30) ما نخمّن.
 */
export function nrScs(band?: number): string | undefined {
  if (band === 77 || band === 78 || band === 79) return '30';
  if (band !== undefined && [1, 3, 7, 8, 20, 28, 71].includes(band)) return '15';
  return undefined;
}
