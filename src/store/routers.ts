import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export interface SavedRouter {
  id: string;
  name: string;
  host: string;
  username: string;
  driverId: string;
  driverName: string;
  createdAt: number;
}

const KEY = 'routers:v1';
const pwKey = (id: string) => `router_pw_${id}`;

export async function listRouters(): Promise<SavedRouter[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function getRouter(id: string): Promise<SavedRouter | null> {
  return (await listRouters()).find(r => r.id === id) ?? null;
}

export async function saveRouter(
  data: Omit<SavedRouter, 'id' | 'createdAt'>,
  password: string,
): Promise<SavedRouter> {
  const r: SavedRouter = {
    ...data,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: Date.now(),
  };
  await SecureStore.setItemAsync(pwKey(r.id), password);
  const all = await listRouters();
  await AsyncStorage.setItem(KEY, JSON.stringify([...all, r]));
  return r;
}

/**
 * تحديث راوتر محفوظ بنفس الـ id (يحافظ على createdAt).
 * كلمة المرور تُحدَّث فقط لو أُرسلت قيمة غير فارغة.
 */
export async function updateRouter(
  id: string,
  data: Omit<SavedRouter, 'id' | 'createdAt'>,
  password?: string,
): Promise<SavedRouter | null> {
  const all = await listRouters();
  const idx = all.findIndex(r => r.id === id);
  if (idx === -1) return null;
  const prev = all[idx];
  const updated: SavedRouter = {
    ...prev,
    ...data,
    id: prev.id,
    createdAt: prev.createdAt,
  };
  const next = [...all];
  next[idx] = updated;
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  if (password && password.length > 0) {
    await SecureStore.setItemAsync(pwKey(id), password);
  }
  return updated;
}

export async function deleteRouter(id: string) {
  const all = await listRouters();
  await AsyncStorage.setItem(KEY, JSON.stringify(all.filter(r => r.id !== id)));
  try { await SecureStore.deleteItemAsync(pwKey(id)); } catch {}
}

export function getPassword(id: string) {
  return SecureStore.getItemAsync(pwKey(id));
}
