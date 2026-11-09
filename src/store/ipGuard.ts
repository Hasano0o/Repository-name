/**
 * «حماية الآي بي» بعد «آي بي ممتاز»: ٣ ساعات ما يسوي التطبيق شي تلقائي يقطع الاتصال
 * (الحارس · حارس 5G · الإصلاح الذاتي · الصيانة/الوضع الذكي · إرجاع تثبيت اللعب) — لأن أي انقطاع = آي بي جديد.
 * لو النت طايح أصلاً، الحماية ما لها معنى ← الأتمتة تشتغل عادي.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface IpGuard { until: number; ip?: string; ms?: number }
const k = (id: string) => `bandly.ipGuard.${id}`;
export const IP_GUARD_HOURS = 3;

export async function getIpGuard(routerId: string): Promise<IpGuard | null> {
  try {
    const g = JSON.parse((await AsyncStorage.getItem(k(routerId))) || 'null') as IpGuard | null;
    return g && g.until > Date.now() ? g : null;
  } catch {
    return null;
  }
}
export async function setIpGuard(routerId: string, g: IpGuard): Promise<void> {
  try { await AsyncStorage.setItem(k(routerId), JSON.stringify(g)); } catch {}
}
export async function clearIpGuard(routerId: string): Promise<void> {
  try { await AsyncStorage.removeItem(k(routerId)); } catch {}
}
/** نوقف الأتمتة؟ الحماية شغالة والنت شغال */
export async function ipHeld(routerId: string, online?: boolean): Promise<boolean> {
  return online !== false && !!(await getIpGuard(routerId));
}
