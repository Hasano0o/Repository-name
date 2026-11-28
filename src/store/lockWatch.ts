/** «حارس التثبيت» — التخزين على الجوال لكل راوتر + الإعداد (تلقائي / اسألني / طافي). المنطق في utils/lockWatchCore. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WatchState } from '../utils/lockWatchCore';

const KEY = (id: string) => `bandly.lockWatch.${id}`;
const MODE = 'bandly.lockWatch.mode';
export type WatchMode = 'auto' | 'ask' | 'off';

export async function getWatch(id: string): Promise<WatchState | null> {
  try { const s = await AsyncStorage.getItem(KEY(id)); return s ? (JSON.parse(s) as WatchState) : null; } catch { return null; }
}
export async function saveWatch(id: string, w: WatchState): Promise<void> {
  try { await AsyncStorage.setItem(KEY(id), JSON.stringify(w)); } catch {}
}
export async function clearWatch(id: string): Promise<void> {
  try { await AsyncStorage.removeItem(KEY(id)); } catch {}
}
export async function getWatchMode(): Promise<WatchMode> {
  try { const m = await AsyncStorage.getItem(MODE); return m === 'ask' || m === 'off' ? m : 'auto'; } catch { return 'auto'; }
}
export async function setWatchMode(m: WatchMode): Promise<void> {
  try { await AsyncStorage.setItem(MODE, m); } catch {}
}

/**
 * التثبيت انقبل (safeApply kept): نحفظ القراءة الحين. لو فيه حارس قبله نخلي «prev» الأول —
 * عشان الإرجاع يرجّع العضو لإعداده قبل كل التثبيتات، مو للتثبيت اللي قبل.
 */
export async function startWatch(id: string, label: string, base: WatchState['base'], prev: unknown | null): Promise<void> {
  const old = await getWatch(id);
  await saveWatch(id, { at: Date.now(), label, base, prev: old ? old.prev : prev });
}
