/**
 * بطارية ZTE الجيل الجديد (MU5252 TopFlow · U60 Pro) — منطق صافي عشان ينختبر.
 * من صفحة MU5252 (FULL ٩ نوفمبر): getBatteryInfo ← get_device_info (bat_*)، والرئيسية تعرض
 * bat_percent% + bat_temperature°C (transTemperature) · bat_charger_status "0" = ما يشحن (convertBatteryPers).
 */
import type { BatteryInfo } from '../types';

const n = (v: unknown): number | undefined => {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const x = Number(String(v).trim());
  return Number.isFinite(x) ? x : undefined;
};

export function zteBattery(b: Record<string, unknown> | null | undefined): BatteryInfo | null {
  if (!b) return null;
  if (String(b.bat_online ?? '').trim() === '0') return null;
  const p = n(b.bat_percent);
  if (p === undefined || p < 0 || p > 100) return null;
  const plugged = String(b.bat_charger_connect ?? '').trim() === '1';
  const st = String(b.bat_charger_status ?? '').trim();
  const t = n(b.bat_temperature);
  return {
    percent: Math.round(p),
    plugged,
    charging: st !== '' && st !== '0' && p < 100,
    tempC: t !== undefined && t > -30 && t < 100 ? Math.round(t) : undefined,
  };
}
