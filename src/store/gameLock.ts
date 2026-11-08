/** تثبيت «ثبّت للعب» المؤقت لكل راوتر — ينحفظ عشان نرجّعه حتى لو التطبيق انقفل (services/gameLockGuard). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GameLock } from '../utils/gameLockCore';

const k = (routerId: string) => `bandly.gameLock.${routerId}`;

export async function getGameLock(routerId: string): Promise<GameLock | null> {
  try {
    const raw = await AsyncStorage.getItem(k(routerId));
    if (!raw) return null;
    const g = JSON.parse(raw) as GameLock;
    return g && g.prev && g.applied ? g : null;
  } catch {
    return null;
  }
}
export async function saveGameLock(g: GameLock): Promise<void> {
  try { await AsyncStorage.setItem(k(g.routerId), JSON.stringify(g)); } catch {}
}
export async function clearGameLock(routerId: string): Promise<void> {
  try { await AsyncStorage.removeItem(k(routerId)); } catch {}
}
