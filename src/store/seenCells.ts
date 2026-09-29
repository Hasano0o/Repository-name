import AsyncStorage from '@react-native-async-storage/async-storage';
import { CellTower } from '../drivers/types';

/** كل خلية شافها الراوتر — عشان تقدر تقفل على برج كان قوي قبل حتى لو مو ظاهر الحين */
export interface SeenCell {
  tech: 'LTE' | 'NR';
  pci: string;
  arfcn: string;
  band?: number;
  bestRsrp?: number;
  bestSinr?: number;
  lastSeen: number;
  times: number;
}

const KEY = (id: string) => `bandly.seencells.${id}`;
const MAX = 60;
export const seenKey = (c: { tech: string; pci: string; arfcn: string }) => `${c.tech}:${c.pci}:${c.arfcn}`;

export async function listSeen(routerId: string): Promise<SeenCell[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(routerId));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function rememberSeen(routerId: string, cells: CellTower[]): Promise<SeenCell[]> {
  const map = new Map((await listSeen(routerId)).map(c => [seenKey(c), c]));
  const now = Date.now();
  for (const c of cells) {
    if (!c.pci || !c.arfcn) continue;
    const k = seenKey({ tech: c.tech, pci: c.pci, arfcn: c.arfcn });
    const old = map.get(k);
    map.set(k, {
      tech: c.tech,
      pci: c.pci,
      arfcn: c.arfcn,
      band: c.band ?? old?.band,
      bestRsrp: c.rsrp !== undefined ? Math.max(c.rsrp, old?.bestRsrp ?? -999) : old?.bestRsrp,
      bestSinr: c.sinr !== undefined ? Math.max(c.sinr, old?.bestSinr ?? -999) : old?.bestSinr,
      lastSeen: now,
      times: (old?.times ?? 0) + 1,
    });
  }
  const list = [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MAX);
  try { await AsyncStorage.setItem(KEY(routerId), JSON.stringify(list)); } catch {}
  return list;
}
