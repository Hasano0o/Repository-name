/**
 * «تجربة ما خلصت» — إعداد الراوتر قبل أول أمر كتابة في أي تجربة (المحسّن، اضبط لي كل شي، الأبراج، تثبيت).
 *
 * قبل (٦ نوفمبر — تعليق عضو + ٦٣ فشل إرجاع بأسبوع): اللقطة كانت في الذاكرة بس. لو انقطعت التجربة في النص
 * (الآيفون وقّف التطبيق بالخلفية، الجوال تحوّل لبيانات الجوال لما الراوتر قطع، العضو سكّر التطبيق)
 * الراوتر يبقى على آخر تردد/برج جرّبناه — بدون دمج — والتطبيق ما يدري ← «ضبط مصنع».
 * الحين تنحفظ على الجوال وتنمسح بس لما الراوتر يرجع على إعداد نهائي (رجع أو العضو اختار الجديد).
 * لو لقيناها والتطبيق ما يسوي شي على الراوتر ← نرجّعها (recoverPending في safeLock).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LockSnapshot } from '../drivers/lockSnapshot';

export interface PendingRestore {
  routerId: string;
  snap: LockSnapshot;
  key: string;
  label: string;
  at: number;
}

const k = (routerId: string) => `bandly.pendingRestore.${routerId}`;
/** أقدم من كذا ما نرجّعها لحالنا (العضو غالباً غيّر إعداده بنفسه من بعدها) */
export const PENDING_MAX_AGE = 3 * 24 * 3600_000;

export async function savePending(routerId: string, snap: LockSnapshot, key: string, label: string): Promise<void> {
  try {
    const p: PendingRestore = { routerId, snap, key, label, at: Date.now() };
    await AsyncStorage.setItem(k(routerId), JSON.stringify(p));
  } catch {}
}

export async function getPending(routerId: string): Promise<PendingRestore | null> {
  try {
    const raw = await AsyncStorage.getItem(k(routerId));
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingRestore;
    if (!p?.snap?.data || typeof p.snap.driver !== 'string' || typeof p.at !== 'number') return null;
    return p;
  } catch {
    return null;
  }
}

export async function clearPending(routerId: string): Promise<void> {
  try { await AsyncStorage.removeItem(k(routerId)); } catch {}
}
