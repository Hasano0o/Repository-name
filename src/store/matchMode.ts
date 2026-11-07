/**
 * «وضع المباراة» — الأجهزة اللي وقّفناها مؤقتاً لكل راوتر. تنحفظ قبل أول حظر،
 * عشان لو التطبيق انقفل أو الجوال طفى، نرجّعها أول ما يفتح التطبيق بعد الوقت (matchRecovery).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MatchState } from '../utils/gameNet';

const k = (routerId: string) => `bandly.matchMode.${routerId}`;

export interface StoredMatch extends MatchState { notifId?: string }

export async function getMatch(routerId: string): Promise<StoredMatch | null> {
  try {
    const raw = await AsyncStorage.getItem(k(routerId));
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredMatch;
    return s && Array.isArray(s.devices) && typeof s.until === 'number' ? s : null;
  } catch {
    return null;
  }
}

export async function saveMatch(s: StoredMatch): Promise<void> {
  try { await AsyncStorage.setItem(k(s.routerId), JSON.stringify(s)); } catch {}
}

export async function clearMatch(routerId: string): Promise<void> {
  try { await AsyncStorage.removeItem(k(routerId)); } catch {}
}
