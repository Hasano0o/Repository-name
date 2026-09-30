import AsyncStorage from '@react-native-async-storage/async-storage';

/** آخر بنق مقاس على كل برج (نقفل عليه ونقيس) — عشان يظهر جنب البرج حتى بعد ما نرجع */
export interface TowerPing {
  ping: number;
  jitter: number;
  loss: number;
  score: number;
  region: string;
  at: number;
}

const KEY = (id: string) => `bandly.towerping.${id}`;
export const towerPingKey = (tech: string, pci: string) => `${tech}:${pci}`;

export async function loadTowerPings(routerId: string): Promise<Record<string, TowerPing>> {
  try {
    const raw = await AsyncStorage.getItem(KEY(routerId));
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export async function saveTowerPing(routerId: string, key: string, p: TowerPing): Promise<Record<string, TowerPing>> {
  const all = await loadTowerPings(routerId);
  all[key] = p;
  // نخلي آخر ٤٠ برج بس
  const trimmed = Object.fromEntries(Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 40));
  try { await AsyncStorage.setItem(KEY(routerId), JSON.stringify(trimmed)); } catch {}
  return trimmed;
}

export const pingAgo = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'الحين';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} س`;
  return `قبل ${Math.round(h / 24)} يوم`;
};
