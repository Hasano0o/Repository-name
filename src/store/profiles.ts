import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Profile {
  id: string;
  routerId: string;
  name: string;
  bands: number[];
  nrBands: number[];
  mode?: string;
  note?: string;
  createdAt: number;
}

const KEY = (routerId: string) => `profiles:${routerId}`;

export async function listProfiles(routerId: string): Promise<Profile[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(routerId));
    return raw ? (JSON.parse(raw) as Profile[]) : [];
  } catch {
    return [];
  }
}

export async function saveProfile(
  p: Omit<Profile, 'id' | 'createdAt'>,
): Promise<Profile> {
  const item: Profile = {
    ...p,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: Date.now(),
  };
  const all = await listProfiles(p.routerId);
  await AsyncStorage.setItem(KEY(p.routerId), JSON.stringify([...all, item]));
  return item;
}

export async function deleteProfile(routerId: string, id: string): Promise<void> {
  const all = await listProfiles(routerId);
  await AsyncStorage.setItem(KEY(routerId), JSON.stringify(all.filter(p => p.id !== id)));
}

export async function renameProfile(routerId: string, id: string, name: string): Promise<void> {
  const all = await listProfiles(routerId);
  await AsyncStorage.setItem(
    KEY(routerId),
    JSON.stringify(all.map(p => (p.id === id ? { ...p, name } : p))),
  );
}

export function profileSummary(p: Profile): string {
  const parts: string[] = [];
  if (p.bands.length) parts.push(p.bands.map(b => 'B' + b).join('+'));
  if (p.nrBands.length) parts.push(p.nrBands.map(b => 'n' + b).join('+'));
  if (!parts.length) parts.push('بدون قفل');
  return parts.join(' · ');
}
