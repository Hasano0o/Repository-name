import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * إعدادات الراوتر الأصلية (ترددات + وضع الشبكة) — تنحفظ من أول اتصال والراوتر نظيف.
 * «فك التثبيت» و«الإنقاذ» يرجعون لها بدل قائمة تخمينية.
 */
const key = (id: string) => `router-baseline:${id}`;

export async function getBaseline(id: string): Promise<Record<string, string> | null> {
  try {
    const raw = await AsyncStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

export async function saveBaseline(id: string, b: Record<string, string>): Promise<void> {
  try { await AsyncStorage.setItem(key(id), JSON.stringify({ ...b, _at: String(Date.now()) })); } catch {}
}

export async function clearBaseline(id: string): Promise<void> {
  try { await AsyncStorage.removeItem(key(id)); } catch {}
}
