/**
 * إحصائيات الأنتنا لكل منفذ (MIMO) — حسن ٢٨ نوفمبر.
 * المودم يستقبل من ٢ أو ٤ منافذ (RX0…RX3). لو منفذ أضعف بوضوح من الباقي = كيبل مفصول/بقتيل خربان/منفذ مو مركّب.
 * صافي بدون react-native — عليه اختبارات (tests/antennaPorts.test.ts).
 */
export interface AntennaPort { idx: number; rsrp?: number; rsrq?: number; sinr?: number }
export interface AntennaSet {
  tech: 'LTE' | 'NR';
  /** التردد اللي انقاس عليه (للعرض) */
  band?: number;
  ports: AntennaPort[];
}

export type PortState = 'ok' | 'low' | 'weak' | 'dead';
export interface PortRow extends AntennaPort { state: PortState; behind?: number }
export interface AntennaVerdict {
  tech: 'LTE' | 'NR';
  band?: number;
  /** «2×2» أو «4×4» — عدد المنافذ اللي فيها استقبال فعلي */
  mimo: string;
  ports: PortRow[];
  /** أسوأ حالة بين المنافذ */
  worst: PortState;
  msg: string;
}

const okRsrp = (v?: number) => (typeof v === 'number' && v <= -44 && v >= -140 ? v : undefined);

/** فرق عن أقوى منفذ: ٦ = أضعف شوي · ١٢ = ضعيف (تأكد من الكيبل) */
export const LOW_DB = 6;
export const WEAK_DB = 12;

const RANK: PortState[] = ['ok', 'low', 'weak', 'dead'];

export function antennaVerdict(set: AntennaSet): AntennaVerdict | null {
  const ports = set.ports.slice().sort((a, b) => a.idx - b.idx);
  if (ports.length < 2) return null;
  const vals = ports.map(p => okRsrp(p.rsrp)).filter((v): v is number => v !== undefined);
  if (vals.length < 1) return null;
  const best = Math.max(...vals);
  const rows: PortRow[] = ports.map(p => {
    const v = okRsrp(p.rsrp);
    if (v === undefined) return { ...p, rsrp: undefined, state: 'dead' };
    const d = Math.round(best - v);
    const state: PortState = d >= WEAK_DB ? 'weak' : d >= LOW_DB ? 'low' : 'ok';
    return { ...p, rsrp: v, state, behind: d >= LOW_DB ? d : undefined };
  });
  const live = rows.filter(r => r.state !== 'dead').length;
  const mimo = `${live}×${live}`;
  const worst = rows.reduce<PortState>((a, r) => (RANK.indexOf(r.state) > RANK.indexOf(a) ? r.state : a), 'ok');
  const bad = rows.filter(r => r.state === 'weak' || r.state === 'dead').map(r => 'RX' + r.idx);
  const msg = worst === 'ok' ? 'كل المنافذ متقاربة — الأنتنا والكيابل سليمة'
    : worst === 'low' ? 'منفذ أضعف شوي من الباقي — طبيعي لو الأنتنا مو موجّهة تماماً'
    : bad.length > 1 ? `${bad.join(' · ')} ضعيفة — تأكد من كيابل الأنتنا أو البقتيل على هالمنافذ`
    : `${bad[0]} ضعيف — تأكد من كيبل الأنتنا أو البقتيل على هالمنفذ`;
  return { tech: set.tech, band: set.band, mimo, ports: rows, worst, msg };
}

/** القيم من الراوتر غالباً نص: «-85,-87,-99,-140» أو حقول منفصلة — يرجّع منافذ مرقّمة من ٠ */
export function portsFrom(values: (string | number | undefined | null)[]): AntennaPort[] {
  const out: AntennaPort[] = [];
  values.forEach((v, i) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').trim());
    if (Number.isFinite(n) && n !== 0) out.push({ idx: i, rsrp: n });
    else out.push({ idx: i });
  });
  // منافذ فاضية في الآخر (الراوتر 2×2 يرجّع ٤ خانات والأخيرتين فاضية) ← نشيلها
  while (out.length && out[out.length - 1].rsrp === undefined) out.pop();
  return out;
}
