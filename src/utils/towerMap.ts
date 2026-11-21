/**
 * «وين برجي؟» — رابط خريطة CellMapper (صافي، اختبارات في tests/towerMap.test.ts).
 * CellMapper ما يسمح برابط لبرج محدد — نفتح خريطة الشركة على مدينة العضو، ونعطيه رقم موقع البرج (eNB)
 * يبحث فيه (Tower Search). الخريطة يعبّيها المستخدمين، فممكن البرج ما يكون مسجّل.
 */
import type { Signal } from '../drivers/types';

export type SaCarrier = 'stc' | 'mobily' | 'zain';
export const MNC: Record<SaCarrier, number> = { stc: 1, mobily: 3, zain: 4 };
export const CARRIER_NAME: Record<SaCarrier, string> = { stc: 'STC', mobily: 'موبايلي', zain: 'زين' };

/** مراكز المدن (نفس قائمة CITIES في الإحصائيات) — الخريطة تنفتح عليها */
const CITY_POS: Record<string, [number, number]> = {
  'الرياض': [24.7136, 46.6753], 'جدة': [21.4858, 39.1925], 'مكة': [21.3891, 39.8579], 'المدينة': [24.5247, 39.5692],
  'الدمام': [26.4207, 50.0888], 'الخبر': [26.2172, 50.1971], 'الأحساء': [25.3833, 49.5864], 'الطائف': [21.2703, 40.4158],
  'أبها': [18.2164, 42.5053], 'خميس مشيط': [18.3, 42.7333], 'جازان': [16.8892, 42.5511], 'نجران': [17.4917, 44.1322],
  'شرورة': [17.4667, 47.1167], 'تبوك': [28.3838, 36.555], 'حائل': [27.5114, 41.7208], 'بريدة': [26.326, 43.975],
};
const norm = (s: string) => (s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').trim();
export function cityPos(city?: string): [number, number] | undefined {
  if (!city) return undefined;
  const c = norm(city);
  for (const [k, v] of Object.entries(CITY_POS)) if (c.includes(norm(k)) || norm(k).includes(c)) return v;
  return undefined;
}

/** رقم موقع البرج (eNB): من الراوتر لو يعطيه، وإلا من Cell ID (ECI ٢٨ بت = eNB × ٢٥٦ + القطاع) */
export function enbOf(sig: Pick<Signal, 'enodebId' | 'cellId'> | null | undefined): number | undefined {
  if (!sig) return undefined;
  const e = Number(String(sig.enodebId ?? '').trim());
  if (Number.isFinite(e) && e > 0) return Math.floor(e);
  const raw = String(sig.cellId ?? '').trim();
  if (!raw) return undefined;
  const hex = /^0x/i.test(raw) || /[a-f]/i.test(raw);
  const eci = hex ? parseInt(raw.replace(/^0x/i, ''), 16) : Number(raw);
  if (!Number.isFinite(eci) || eci < 256 || eci > 0xfffffff) return undefined;
  return Math.floor(eci / 256);
}

export function cellMapperUrl(carrier: SaCarrier, city?: string): string {
  const pos = cityPos(city);
  const [lat, lon, zoom] = pos ? [pos[0], pos[1], 13] : [23.8859, 45.0792, 6];
  return `https://www.cellmapper.net/map?MCC=420&MNC=${MNC[carrier]}&type=LTE&latitude=${lat}&longitude=${lon}&zoom=${zoom}&showTowers=true&clusterEnabled=true&tilesEnabled=true`;
}
