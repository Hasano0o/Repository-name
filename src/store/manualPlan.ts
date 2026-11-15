/** «باقتي» — الباقة اليدوية لكل راوتر (على الجوال بس). المنطق في src/utils/manualPlan.ts */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ManualPlan } from '../utils/manualPlan';

const KEY = (id: string) => `bandly.manualPlan.${id}`;

export async function getManualPlan(id: string): Promise<ManualPlan | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY(id));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.sizeGB > 0 && p.days > 0 && p.start > 0 ? p as ManualPlan : null;
  } catch { return null; }
}
export async function setManualPlan(id: string, p: ManualPlan | null): Promise<void> {
  try { if (p) await AsyncStorage.setItem(KEY(id), JSON.stringify(p)); else await AsyncStorage.removeItem(KEY(id)); } catch {}
}
