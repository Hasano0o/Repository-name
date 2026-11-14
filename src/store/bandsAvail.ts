import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * هل الراوتر فيه تحكم بالترددات (الدرايفر بعد الدخول فيه getBandConfig)؟ — صفحة الراوتر تحفظه كل تحميل،
 * و«اختار الأفضل» يقراه عشان يخفي أدوات الترددات للراوترات اللي صفحتها ما تسمح (نوكيا 3.1 / 5G-24W-A…).
 * undefined = ما ندري للحين (نعرض كل شي).
 */
const key = (id: string) => `bandly.bandsAvail.${id}`;

export async function rememberBands(id: string, has: boolean): Promise<void> {
  try { await AsyncStorage.setItem(key(id), has ? '1' : '0'); } catch {}
}
export async function bandsAvailable(id: string): Promise<boolean | undefined> {
  try {
    const v = await AsyncStorage.getItem(key(id));
    return v === '1' ? true : v === '0' ? false : undefined;
  } catch { return undefined; }
}
