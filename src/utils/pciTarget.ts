/**
 * «تنبيه برج معيّن» في توجيه الأنتنا (اقتراح عضو ١٥ نوفمبر): العضو يشوف في NetMonster برج عاجبه (مثلاً PCI 38)،
 * يكتب رقمه، ويوجّه الأنتنا بدون ما يطالع — أول ما الراوتر يشبك على هالبرج (4G أو 5G) يجيه صوت.
 * بدون react-native — ينختبر في node.
 */
import type { Signal } from '../drivers/types';

/** رقم PCI صالح (0–1007 — أكبر مدى في 5G) أو null */
export function normPci(v: string | number | undefined | null): string | null {
  const s = String(v ?? '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  if (!s) return null;
  const n = Number(s);
  return n >= 0 && n <= 1007 ? String(n) : null;
}

/** الراوتر الحين على البرج المطلوب؟ (الأساسي 4G أو 5G) — يرجّع التقنية اللي طابقت */
export function pciHit(target: string | null, s: Signal | null | undefined): 'LTE' | 'NR' | null {
  const t = normPci(target);
  if (!t || !s) return null;
  if (normPci(s.pci) === t) return 'LTE';
  if (normPci(s.nrPci) === t) return 'NR';
  return null;
}

import type { CellTower } from '../drivers/types';

/** البرج المطلوب وين هو الحين: شابك عليه · يوصل للراوتر (جار/ثانوي) · ما يوصل */
export interface PciFind { state: 'serving' | 'seen' | 'none'; tech?: 'LTE' | 'NR'; band?: number; arfcn?: string; rsrp?: number; sinr?: number }

const bandNo = (b: unknown) => { const n = Number(String(b ?? '').replace(/\D/g, '')); return n > 0 ? n : undefined; };

export function pciFind(target: string | null, s: Signal | null | undefined, cells: CellTower[] | null | undefined): PciFind {
  const t = normPci(target);
  if (!t) return { state: 'none' };
  const hit = pciHit(t, s);
  if (hit && s) {
    return hit === 'LTE'
      ? { state: 'serving', tech: 'LTE', band: bandNo(s.band), arfcn: s.earfcn, rsrp: s.rsrp, sinr: s.sinr }
      : { state: 'serving', tech: 'NR', band: bandNo(s.nrBand), arfcn: s.nrArfcn, rsrp: s.nrRsrp, sinr: s.nrSinr };
  }
  const m = (cells ?? []).filter(c => normPci(c.pci) === t).sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))[0];
  if (m) return { state: m.kind === 'serving' ? 'serving' : 'seen', tech: m.tech, band: m.band, arfcn: m.arfcn, rsrp: m.rsrp, sinr: m.sinr };
  return { state: 'none' };
}

/** الأبراج اللي يشوفها الراوتر (للاختيار بضغطة) — رقم واحد لكل برج، الأقوى أول */
export function pciChoices(s: Signal | null | undefined, cells: CellTower[] | null | undefined, max = 8): { pci: string; tech: 'LTE' | 'NR'; band?: number; rsrp?: number; serving: boolean }[] {
  const all: { pci: string; tech: 'LTE' | 'NR'; band?: number; rsrp?: number; serving: boolean }[] = [];
  const sp = normPci(s?.pci), snp = normPci(s?.nrPci);
  if (sp) all.push({ pci: sp, tech: 'LTE', band: bandNo(s?.band), rsrp: s?.rsrp, serving: true });
  if (snp) all.push({ pci: snp, tech: 'NR', band: bandNo(s?.nrBand), rsrp: s?.nrRsrp, serving: true });
  for (const c of cells ?? []) {
    const p = normPci(c.pci);
    if (p) all.push({ pci: p, tech: c.tech, band: c.band, rsrp: c.rsrp, serving: c.kind === 'serving' });
  }
  const by = new Map<string, typeof all[number]>();
  for (const x of all) {
    const o = by.get(x.pci);
    if (!o || (x.serving && !o.serving) || (x.serving === o.serving && (x.rsrp ?? -999) > (o.rsrp ?? -999))) by.set(x.pci, { ...x, serving: x.serving || !!o?.serving });
  }
  return [...by.values()].sort((a, b) => Number(b.serving) - Number(a.serving) || (b.rsrp ?? -999) - (a.rsrp ?? -999)).slice(0, max);
}

/** قرب البرج المطلوب للصوت والاهتزاز (٠–١): مقارنة بأفضل قراءة له في الجلسة، وإلا بقوته المطلقة */
export function pciRel(rsrp: number | undefined, best: number | undefined): number {
  if (rsrp === undefined) return 0;
  if (best !== undefined && best > rsrp) return Math.max(0, Math.min(1, 1 - (best - rsrp) / 12));
  return Math.max(0.35, Math.min(1, (rsrp + 125) / 45));
}
