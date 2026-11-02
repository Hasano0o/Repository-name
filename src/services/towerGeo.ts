/**
 * حسابات «بعد البرج واتجاهه» — صافية بدون react-native (عشان الاختبارات).
 * البرج يتعرّف بـ MCC-MNC-TAC-ECI (نفس اللي في قواعد الأبراج).
 */
import { Signal } from '../drivers/types';

export interface TowerCell { mcc: string; mnc: string; tac: string; eci: string; tech: 'LTE' | 'NR'; band?: number; rsrp?: number }

const digits = (x?: string) => String(x ?? '').replace(/\D/g, '');

/** من قراءة الإشارة ← هوية البرج (لازم PLMN + TAC + Cell ID). null لو ناقص */
export function cellOf(sig?: Signal | null): TowerCell | null {
  if (!sig) return null;
  const plmn = digits(sig.plmn);
  const tac = digits(sig.tac);
  const eci = digits(sig.cellId);
  if (plmn.length < 5 || plmn.length > 6 || !tac || !eci || eci === '0' || tac === '0') return null;
  const band = Number(String(sig.band ?? '').match(/B?(\d{1,3})\)?\s*$/i)?.[1] ?? NaN);
  return {
    mcc: plmn.slice(0, 3), mnc: String(Number(plmn.slice(3))), tac: String(Number(tac)), eci: String(Number(eci)),
    tech: 'LTE', band: Number.isFinite(band) ? band : undefined, rsrp: sig.rsrp,
  };
}

export const cellKey = (c: TowerCell) => `${c.mcc}-${c.mnc}-${c.tac}-${c.eci}`;

/** المسافة بالمتر (هافرساين) */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1, dl = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** الاتجاه من (1) إلى (2) بالدرجات من الشمال (0–360) */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const DIRS = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
export const dirAr = (deg: number) => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

/** «حوالي ٢٫٣ كم» / «حوالي ٧٠٠ م» — نقرّب حسب الدقة (ما نوهم بدقة ما عندنا) */
export function distLabel(m: number, accM: number): string {
  if (m < Math.max(300, accM)) return 'قريب جداً منك';
  if (m < 1000) return `حوالي ${Math.round(m / 100) * 100} م`;
  return `حوالي ${(Math.round(m / 100) / 10).toFixed(1)} كم`;
}

/** نقرّب الموقع قبل ما يطلع من الجوال (٣ خانات ≈ ١١٠ م) */
export const roundLoc = (x: number) => Math.round(x * 1000) / 1000;
