/**
 * إعداد الراوتر **قبل** ما نفك كل التثبيتات (رجّع الإشارة) — نحفظه عشان المستخدم يرجّعه
 * بضغطة من صفحة الراوتر، بدل ما يضيع.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LockSnapshot } from '../drivers/lockSnapshot';

const key = (routerId: string) => `release-snap:${routerId}`;

export async function saveReleaseSnap(routerId: string, s: LockSnapshot): Promise<void> {
  try { await AsyncStorage.setItem(key(routerId), JSON.stringify(s)); } catch {}
}

export async function getReleaseSnap(routerId: string): Promise<LockSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(key(routerId));
    if (!raw) return null;
    const s = JSON.parse(raw) as LockSnapshot;
    return s && typeof s.driver === 'string' && s.data ? s : null;
  } catch {
    return null;
  }
}

export async function clearReleaseSnap(routerId: string): Promise<void> {
  try { await AsyncStorage.removeItem(key(routerId)); } catch {}
}

/**
 * هل «رجّع الإشارة» على هذا الراوتر احتاج إعادة تشغيل آخر مرة؟
 * بعض الموديلات (ZTE MU5001) ما تطلع من «بدون خدمة» بعد فك التثبيت إلا بإعادة تشغيل —
 * لو تعلّمنا هذا، المرة الجاية ما نضيّع دقيقة ونص ننتظر على الفاضي.
 */
const bootKey = (routerId: string) => `release-needs-reboot:${routerId}`;

export async function releaseNeedsReboot(routerId: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(bootKey(routerId))) === '1'; } catch { return false; }
}

export async function setReleaseNeedsReboot(routerId: string, v: boolean): Promise<void> {
  try {
    if (v) await AsyncStorage.setItem(bootKey(routerId), '1');
    else await AsyncStorage.removeItem(bootKey(routerId));
  } catch {}
}
