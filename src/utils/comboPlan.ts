/**
 * «غيّر الأساسي والثانوي» — وش نكتب للراوتر. بدون react-native (tests/comboPlan.test.ts).
 * auto = «أي ثانوي»: الأساسي ثابت وكل باقي ترددات 4G «ثانوي بس» (الدمج مفتوح) — بدل ما يثبّت الأساسي لحاله.
 * nrPrimary = أساسي 5G لما فيه أكثر من تردد 5G (الباقي «ثانوي بس»). الأدوار بس لراوترات bandRoles (هواوي lock-freq).
 */
export interface ComboPlan {
  lte: number[];
  roles?: { lteScell: number[]; nrScell?: number[] };
  nrPrimary: number | null;
}

export function comboPlan(o: {
  primary: number; extra: number[]; auto: boolean; supported: number[]; bandRoles: boolean;
  nr: number[]; nrPrimary: number | null;
}): ComboPlan {
  const auto = o.auto && o.bandRoles;
  const others = (auto ? o.supported : o.extra).filter(b => b !== o.primary);
  const lte = [o.primary, ...new Set(others)];
  const np = o.bandRoles && o.nr.length > 1 && o.nrPrimary !== null && o.nr.includes(o.nrPrimary) ? o.nrPrimary : null;
  const roles = o.bandRoles
    ? { lteScell: lte.filter(b => b !== o.primary), ...(np !== null ? { nrScell: o.nr.filter(b => b !== np) } : {}) }
    : undefined;
  return { lte, roles, nrPrimary: np };
}
