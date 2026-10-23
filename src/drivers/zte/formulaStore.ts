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

/**
 * كلمة مرور الراوتر رفضها صراحة (بالصيغة المعروفة) — نحفظ بصمتها (sha256، مو الكلمة نفسها).
 * المهام الخلفية والشاشات ما تعيد تجربتها: كانت كل مراقبة بالخلفية تحرق محاولة لين يبقى ١،
 * والعدّاد ما يرجع إلا بدخول ناجح ← «ما ينحل إلا بضبط المصنع».
 * تنمسح أول ما ينجح الدخول. والمستخدم يقدر يجرّبها بنفسه (lastTry).
 */
const badKey = (host: string) => `zte-login-badpw:${host}`;
const badMem = new Map<string, string>();

export async function isBadPassword(host: string, fp: string): Promise<boolean> {
  // نقرأ التخزين كل مرة: المراقبة بالخلفية ممكن تشتغل في تشغيل ثاني للتطبيق وما تشوف ذاكرة الشاشة
  try {
    const v = (await AsyncStorage.getItem(badKey(host))) ?? '';
    badMem.set(host, v);
    return v === fp;
  } catch { return badMem.get(host) === fp; }
}

export async function markBadPassword(host: string, fp: string | null): Promise<void> {
  badMem.set(host, fp ?? '');
  try { fp ? await AsyncStorage.setItem(badKey(host), fp) : await AsyncStorage.removeItem(badKey(host)); } catch {}
}
