/**
 * إشارة كل ناقل ثانوي 4G في ZTE (٢٨ نوفمبر) — من تقارير `ca-sig` لثلاث فيرمويرات (MC801A STC · U50 Pro · SAG5C):
 *   lte_multi_ca_scell_info     = «idx,pci,?,band,earfcn,bw;…»
 *   lte_multi_ca_scell_sig_info = «rsrp,rsrq,sinr,rssi,?,?;…»  — نفس ترتيب الصفوف
 * مثال: «-104.9,-11.2,13.5,-73.7,0,2;-104.2,-12.5,12.6,-73.0,0,2;» — صافي، عليه اختبارات.
 */
export interface SccSig { rsrp?: number; rsrq?: number; sinr?: number; rssi?: number }

const inRange = (v: string | undefined, lo: number, hi: number) => {
  const x = parseFloat(String(v ?? '').trim());
  return Number.isFinite(x) && x >= lo && x <= hi ? x : undefined;
};

export function sccSigRows(raw: string | undefined): SccSig[] {
  return String(raw ?? '').split(';').map(r => r.trim()).filter(Boolean).map(r => {
    const f = r.split(',');
    const rsrp = inRange(f[0], -156, -30);
    return {
      rsrp,
      rsrq: rsrp === undefined ? undefined : inRange(f[1], -43, 20),
      sinr: rsrp === undefined ? undefined : inRange(f[2], -30, 50),
      rssi: inRange(f[3], -130, -10),
    };
  });
}
