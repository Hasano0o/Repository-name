/**
 * صيغة كلمة المرور اللي نجحت مع كل راوتر ZTE — محفوظة على الجهاز.
 * قبل: كانت في الذاكرة بس، فكل ما انفتح التطبيق (أو اشتغلت المراقبة بالخلفية) نرجع نجرّب
 * الصيغ وحدة وحدة، وكل صيغة غلط = محاولة دخول فاشلة ← الراوتر يقفل الدخول ٥ دقايق.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (host: string) => `zte-login-formula:${host}`;
const mem = new Map<string, string>();

export async function loadFormula(host: string): Promise<string | undefined> {
  const m = mem.get(host);
  if (m) return m;
  try {
    const v = await AsyncStorage.getItem(key(host));
    if (v) mem.set(host, v);
    return v ?? undefined;
  } catch { return undefined; }
}

export async function saveFormula(host: string, name: string): Promise<void> {
  mem.set(host, name);
  try { await AsyncStorage.setItem(key(host), name); } catch {}
}
