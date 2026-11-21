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

/**
 * نفس الوضع بكل حقول net/net-mode (اللي رجّعها الراوتر) — للموديلات اللي ترفض طلب الحقلين بـ -1
 * (H155 موبايلي — ٢١ نوفمبر: «الراوتر رفض الطلب (-1)»). نغيّر بس حقول الوضع ونخلي الباقي (الترددات…) مثل ما هو.
 */
export function standardFullBody(s: NetStandard, fields: [string, string][]): string {
  const want = [...standardBody(s).matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
  const out = fields.map(([k, v]) => [k, v] as [string, string]);
  for (const [k, v] of want) {
    const x = out.find(f => f[0] === k);
    if (x) x[1] = v; else out.push([k, v]);
  }
  // 4G فقط/FDD/TDD: networkOption يبقى مثل ما هو (الصفحة ما تلمسه) · 5G: LTEBandOption يرجع «كل 4G»
  if (s === 'sa' || s === 'nsa' || s === 'sa_nsa') {
    const b = out.find(f => f[0] === 'LTEBandOption');
    if (b) b[1] = '0';
  }
  return out.map(([k, v]) => `<${k}>${v}</${k}>`).join('');
}
