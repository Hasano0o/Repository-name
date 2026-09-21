// توحيد الحقول الخام القادمة من أي راوتر إلى قيم/بنية موحّدة.
// دوال نقية (بدون شبكة) — قابلة للاختبار والاستخدام من أي درايفر أو من شاشة الاستكشاف.
import { Carrier } from '../drivers/types';

/* ============================ أرقام / hex ============================ */

/** يحوّل نص قد يكون hex (بادئة 0x أو حروف a–f) أو عشري إلى رقم. */
export function hexToDec(v?: string | number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = String(v).trim();
  if (/^0x[0-9a-f]+$/i.test(s)) {
    const n = parseInt(s.slice(2), 16);
    return Number.isFinite(n) ? n : undefined;
  }
  if (/^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s)) {
    const n = parseInt(s, 16);
    return Number.isFinite(n) ? n : undefined;
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * PCI قد يجي hex أو عشري بدون تمييز واضح.
 * القاعدة: لو فيه حروف hex → hex. لو رقمي صرف وضمن المدى الصحيح (LTE ≤503، NR ≤1007) → عشري،
 * وإلا فسّره hex. maxPci حسب التقنية.
 */
export function parsePci(raw?: string | number, maxPci = 503): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  const s = String(raw).trim();
  if (/^0x/i.test(s) || /[a-f]/i.test(s)) return hexToDec(s);
  const dec = parseInt(s, 10);
  if (Number.isFinite(dec) && dec <= maxPci) return dec;
  return hexToDec(s);
}

/* ============================ Band mask ============================ */

/**
 * يفكّ band mask (نص hex، ببادئة 0x أو بدونها) إلى قائمة أرقام باندات.
 * البت رقم i (من 0) يمثّل الباند i+1. مثال: 0x180080800c5 → [1,3,7,8,20,28,40,41].
 */
export function decodeBandMask(mask?: string | number, maxBits = 64): number[] {
  if (mask === undefined || mask === null || mask === '') return [];
  let hex = String(mask).trim().replace(/^0x/i, '');
  if (!hex || /^0+$/.test(hex)) return [];
  if (!/^[0-9a-f]+$/i.test(hex)) return [];
  try {
    const big = BigInt('0x' + hex);
    const out: number[] = [];
    for (let i = 0; i < maxBits; i++) {
      if ((big >> BigInt(i)) & 1n) out.push(i + 1);
    }
    return out;
  } catch {
    return [];
  }
}

/** يحوّل قائمة باندات إلى mask (نص hex ببادئة 0x). عكس decodeBandMask. */
export function encodeBandMask(bands: number[]): string {
  let m = 0n;
  for (const b of bands) if (b > 0) m |= 1n << BigInt(b - 1);
  return '0x' + m.toString(16);
}

/**
 * FF..FF (أو كل البتات ضمن maxBits مضبوطة) تعني «كل الباندات مدعومة» — مو «كل الباندات مقفولة».
 * تُستخدم للتفريق قبل عرض القفل للمستخدم.
 */
export function isAllBandsMask(mask?: string | number, maxBits = 64): boolean {
  if (mask === undefined || mask === null || mask === '') return false;
  const hex = String(mask).trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(hex)) return false;
  try {
    const big = BigInt('0x' + hex);
    const all = (1n << BigInt(maxBits)) - 1n;
    return big === all || (big !== 0n && (big & all) === all);
  } catch {
    return false;
  }
}

/* ============================ Carrier Aggregation ============================ */

/** يحلّل صيغة ZTE النصية: "20MHz@500(B1) + 10MHz@6300(B20) + 100MHz@627264(n78)". */
export function parseZteCa(s?: string): Carrier[] {
  if (!s) return [];
  const out: Carrier[] = [];
  const re = /(\d+(?:\.\d+)?)\s*MHz\s*@\s*(\d+)\s*\(\s*([BbNn])\s*(\d+)\s*\)/g;
  let first = true;
  for (const m of s.matchAll(re)) {
    out.push({
      tech: m[3].toLowerCase() === 'n' ? 'NR' : 'LTE',
      band: parseInt(m[4], 10),
      role: first ? 'PCC' : 'SCC',
      arfcn: m[2],
      bandwidth: parseFloat(m[1]),
    });
    first = false;
  }
  return out;
}

/**
 * يحلّل قائمة Huawei الثانوية: "ARFCN,Bn,BW,PCI,RSRP,RSRQ,RSSI,SINR;..." (تفصلها ;).
 * بعض الطُرز ترسل بدون حقل BW، فنكتشف حسب طول السطر.
 */
export function parseHuaweiSecList(raw?: string, tech: 'LTE' | 'NR' = 'LTE'): Carrier[] {
  if (!raw) return [];
  const out: Carrier[] = [];
  for (const rec of raw.split(';')) {
    const f = rec.split(',').map(x => x.trim());
    if (f.length < 5) continue;
    const band = parseInt(f[1].replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(band)) continue;
    const hasBw = f.length >= 8;
    const num = (v?: string) => {
      if (v === undefined || v === '') return undefined;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    };
    out.push({
      tech,
      band,
      role: 'SCC',
      arfcn: f[0] || undefined,
      bandwidth: hasBw ? num(f[2]) : undefined,
      pci: f[hasBw ? 3 : 2] || undefined,
      rsrp: num(f[hasBw ? 4 : 3]),
      rsrq: num(f[hasBw ? 5 : 4]),
      sinr: hasBw ? num(f[7]) : undefined,
    });
  }
  return out;
}

/* ============================ اختيار قيمة / تحويل باند ============================ */

/** أول قيمة معرّفة وغير فارغة من عدة مفاتيح محتملة في خريطة خام. */
export function pick(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== '' && v !== 'null' && v !== '--') return String(v);
  }
  return undefined;
}

/** رقم من خريطة خام (يقبل 0 كقيمة صحيحة). */
export function pickNum(raw: Record<string, unknown>, ...keys: string[]): number | undefined {
  const v = pick(raw, ...keys);
  if (v === undefined) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/** يوحّد اسم الباند: 3 → "B3"، "LTE_BAND3" → "B3"، 78 مع nr → "n78". */
export function bandLabel(raw?: string | number, tech: 'LTE' | 'NR' = 'LTE'): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const prefix = tech === 'NR' ? 'n' : 'B';
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  return prefix + digits;
}
