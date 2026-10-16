/**
 * «وضع الشبكة» الدقيق من صفحة المطورين في هواوي (WebUI 4.0 — H158 وغيره):
 * ستة خيارات، كل واحد = NetworkMode + حقل إضافي. أخذناها من كود الصفحة نفسها (networkmode.js)
 * وتأكدنا من شكل طلب الحفظ الفعلي (NSA = NetworkMode 00 + networkOption 0).
 * دوال صافية بدون شبكة — عشان نختبرها في Node.
 */
export type NetStandard = 'sa' | 'nsa' | 'sa_nsa' | 'lte' | 'lte_fdd' | 'lte_tdd';

export const NET_STANDARDS: NetStandard[] = ['nsa', 'sa_nsa', 'sa', 'lte', 'lte_fdd', 'lte_tdd'];

const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim();

/** الوضع الحالي من رد net/net-mode — null لو الراوتر ما يدعم هالخيارات أو الوضع غير معروف */
export function standardOf(xml: string): NetStandard | null {
  const opt = tag(xml, 'networkOption');
  if (opt === undefined) return null; // فيرموير قديم ما فيه الخيارات الدقيقة
  const mode = tag(xml, 'NetworkMode');
  if (mode === '00') return opt === '1' ? 'sa' : opt === '2' ? 'sa_nsa' : opt === '0' ? 'nsa' : null;
  if (mode === '03') {
    const b = tag(xml, 'LTEBandOption') ?? '0';
    return b === '1' ? 'lte_fdd' : b === '2' ? 'lte_tdd' : 'lte';
  }
  return null;
}

/** جسم طلب الحفظ — نفس اللي ترسله صفحة الراوتر بالضبط (حقلين بس) */
export function standardBody(s: NetStandard): string {
  switch (s) {
    case 'sa': return '<NetworkMode>00</NetworkMode><networkOption>1</networkOption>';
    case 'nsa': return '<NetworkMode>00</NetworkMode><networkOption>0</networkOption>';
    case 'sa_nsa': return '<NetworkMode>00</NetworkMode><networkOption>2</networkOption>';
    case 'lte': return '<NetworkMode>03</NetworkMode><LTEBandOption>0</LTEBandOption>';
    case 'lte_fdd': return '<NetworkMode>03</NetworkMode><LTEBandOption>1</LTEBandOption>';
    case 'lte_tdd': return '<NetworkMode>03</NetworkMode><LTEBandOption>2</LTEBandOption>';
  }
}

export const STANDARD_LABEL: Record<NetStandard, { title: string; sub: string }> = {
  nsa: { title: '4G + 5G', sub: 'NSA — الأشهر عندنا' },
  sa_nsa: { title: 'SA + NSA', sub: 'الراوتر يختار' },
  sa: { title: '5G فقط', sub: 'SA — الـ 5G أساسي' },
  lte: { title: '4G فقط', sub: 'بدون 5G' },
  lte_fdd: { title: '4G FDD فقط', sub: 'B1 · B3 · B20 · B28…' },
  lte_tdd: { title: '4G TDD فقط', sub: 'B38 · B40 · B41…' },
};
