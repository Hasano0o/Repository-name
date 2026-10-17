import AsyncStorage from '@react-native-async-storage/async-storage';
import { secret } from '../desktop/secret';

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
const wifiKey = (id: string) => `router_wifi_${id}`;
const labelKey = (id: string) => `router_label_${id}`;

/**
 * «بيانات الملصق»: بيانات المصنع اللي تحت الراوتر — تنحفظ مرة وحدة ومنفصلة عن الكلمة الحالية،
 * عشان بعد ضبط المصنع يرجع التطبيق يدخل لحاله، والمستخدم يشوفها وقت الحاجة. مشفّرة على الجهاز بس.
 */
export interface LabelCreds { username?: string; adminPassword?: string; ssid?: string; wifiPassword?: string }

export async function getLabel(id: string): Promise<LabelCreds | null> {
  try {
    const raw = await secret.get(labelKey(id));
    return raw ? (JSON.parse(raw) as LabelCreds) : null;
  } catch {
    return null;
  }
}

export async function setLabel(id: string, l: LabelCreds | null): Promise<void> {
  const clean = l && Object.fromEntries(Object.entries(l).map(([k, v]) => [k, (v ?? '').trim()]).filter(([, v]) => v)) as LabelCreds;
  if (!clean || !Object.keys(clean).length) { try { await secret.del(labelKey(id)); } catch {} return; }
  await secret.set(labelKey(id), JSON.stringify(clean));
}

/** نغيّر كلمة الدخول المحفوظة بس (مثلاً بعد ما نجحت كلمة الملصق) */
export async function setPassword(id: string, password: string): Promise<void> {
  if (password) await secret.set(pwKey(id), password);
}

/** بيانات الواي فاي (للمشاركة مع الضيوف) — محفوظة مشفّرة مثل كلمة مرور الإدارة */
export interface SavedWifi { ssid: string; password: string; security?: string }

export async function getWifi(id: string): Promise<SavedWifi | null> {
  try {
    const raw = await secret.get(wifiKey(id));
    return raw ? (JSON.parse(raw) as SavedWifi) : null;
  } catch {
    return null;
  }
}

export async function setWifi(id: string, w: SavedWifi | null): Promise<void> {
  if (!w || !w.ssid) { try { await secret.del(wifiKey(id)); } catch {} return; }
  await secret.set(wifiKey(id), JSON.stringify(w));
}

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
  await secret.set(pwKey(r.id), password);
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
    await secret.set(pwKey(id), password);
  }
  return updated;
}

export async function deleteRouter(id: string) {
  const all = await listRouters();
  await AsyncStorage.setItem(KEY, JSON.stringify(all.filter(r => r.id !== id)));
  try { await secret.del(pwKey(id)); } catch {}
  try { await secret.del(wifiKey(id)); } catch {}
  try { await secret.del(labelKey(id)); } catch {}
}

export function getPassword(id: string) {
  return secret.get(pwKey(id));
}
