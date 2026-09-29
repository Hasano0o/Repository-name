import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Profile {
  id: string;
  routerId: string;
  name: string;
  bands: number[];
  nrBands: number[];
  mode?: string;
  note?: string;
  /** وضع بضغطة — ألعاب / مشاهدة / اجتماعات */
  role?: Role;
  createdAt: number;
}

export type Role = 'game' | 'watch' | 'meet';

export const ROLES: { id: Role; icon: string; name: string; hint: string }[] = [
  { id: 'game', icon: '🎮', name: 'ألعاب', hint: 'أقل بنق وتذبذب' },
  { id: 'watch', icon: '🎬', name: 'مشاهدة', hint: 'أعلى سرعة' },
  { id: 'meet', icon: '💼', name: 'اجتماعات', hint: 'أثبت اتصال' },
];

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
  // كل وضع له ملف واحد — الجديد ياخذ مكان القديم
  const all = (await listProfiles(p.routerId)).map(x => (p.role && x.role === p.role ? { ...x, role: undefined } : x));
  await AsyncStorage.setItem(KEY(p.routerId), JSON.stringify([...all, item]));
  return item;
}

/** يعيّن ملف موجود لوضع (أو يشيله لو role فاضي) */
export async function setProfileRole(routerId: string, id: string, role?: Role): Promise<void> {
  const all = await listProfiles(routerId);
  await AsyncStorage.setItem(
    KEY(routerId),
    JSON.stringify(all.map(p => (p.id === id ? { ...p, role } : role && p.role === role ? { ...p, role: undefined } : p))),
  );
}

export async function roleProfiles(routerId: string): Promise<Partial<Record<Role, Profile>>> {
  const out: Partial<Record<Role, Profile>> = {};
  for (const p of await listProfiles(routerId)) if (p.role) out[p.role] = p;
  return out;
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
