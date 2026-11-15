/**
 * زيكسل NR5103EV2 (فيديو عضو ١٥ نوفمبر): INTF_Current_Band و INTF_RFCN (وأحياناً PCI) تجي **قائمة** للدمج كله
 * — مثلاً RFCN "1850,40590,40392,647424" = B3 + B41 + B41 + n78. كنا ناخذ آخر رقم في النص ← «B78» بدل B3،
 * والقناة تطلع القائمة كاملة. هنا: أول عنصر = الأساسي، والباقي نواقل ثانوية (التردد من الاسم، وإلا من رقم القناة).
 * بدون react-native — ينختبر في node.
 */
import { bandOfArfcn } from '../../utils/arfcn';

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
export const zxList = (v: unknown) => str(v).split(/[,;]/).map(x => x.trim()).filter(Boolean);
const isNr = (tok: string) => /NR|^n\d/i.test(tok);
const bandNum = (tok: string) => { const m = tok.match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : undefined; };

export interface ZxCell { tech: 'LTE' | 'NR'; band?: number; arfcn?: string; pci?: string }

/** كل النواقل من القوائم (أول واحد = الأساسي) */
export function zxCells(c: Record<string, any>): ZxCell[] {
  const bands = zxList(c.INTF_Current_Band), rfcns = zxList(c.INTF_RFCN), pcis = zxList(c.INTF_PhyCell_ID);
  const n = Math.max(bands.length, rfcns.length);
  const out: ZxCell[] = [];
  for (let i = 0; i < n; i++) {
    const tok = bands[i] ?? '';
    const ar = rfcns[i];
    const arN = ar !== undefined ? Number(ar) : NaN;
    // بدون اسم تردد: القناة الكبيرة (أكبر من 100000) = 5G
    const tech: 'LTE' | 'NR' = tok ? (isNr(tok) ? 'NR' : 'LTE') : arN > 100000 ? 'NR' : 'LTE';
    const band = (tok ? bandNum(tok) : undefined) ?? (Number.isFinite(arN) ? bandOfArfcn(tech, arN) : undefined);
    out.push({ tech, band, arfcn: ar, pci: pcis.length > 1 ? pcis[i] : i === 0 ? pcis[0] : undefined });
  }
  return out;
}

/** الأساسي: أول خلية 4G (لو الأول 5G وما فيه 4G = SA) */
export function zxPcc(c: Record<string, any>): ZxCell | null {
  const cells = zxCells(c);
  return cells[0] ?? null;
}
