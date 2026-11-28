/**
 * تخزين كلمات المرور: في الجوال SecureStore كالعادة،
 * وفي نسخة الويندوز عبر البرنامج (مشفّرة بتشفير الويندوز — safeStorage).
 *
 * آيفون (خطأ ٢٨ نوفمبر: «KeyChainException: User interaction is not allowed» وقت تغيير وضع الشبكة):
 * الافتراضي WHEN_UNLOCKED ← لو الجوال انقفل والتطبيق يكمّل بالخلفية (الحارس/المراقبة/أمر طويل) ما يقرأ الكلمة.
 * الحين: نحفظ بـ AFTER_FIRST_UNLOCK (تنقرى بعد أول فتح للجوال حتى لو مقفول)، والقديمة تنتقل لها أول ما تنقرى
 * والجوال مفتوح، ولو القراءة انرفضت والكلمة انقرت قبل بنفس التشغيل ← نستخدم اللي في الذاكرة.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { desktop } from './bridge';

/** متصفح عادي (بدون برنامج الويندوز): ما فيه تخزين آمن — نخليها في الذاكرة بس وما تنحفظ */
const mem = new Map<string, string>();
const webOnly = Platform.OS === 'web' && !desktop;

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
/** آخر قيمة انقرت/انحفظت بهالتشغيل (للجوال) — احتياط لو الكيتشين رفض وهو مقفول */
const cache = new Map<string, string>();
const migrated = new Set<string>();
/** expo-secure-store يحدّث القيمة بس لو العنصر موجود (ما يغيّر الإتاحة) ← نمسح ونحفظ من جديد، ولو فشل نرجّع بالافتراضي */
async function saveAfu(key: string, value: string): Promise<void> {
  if (Platform.OS !== 'ios') return SecureStore.setItemAsync(key, value, OPTS);
  try { await SecureStore.deleteItemAsync(key); } catch {}
  try { await SecureStore.setItemAsync(key, value, OPTS); }
  catch { await SecureStore.setItemAsync(key, value); }
}
const locked = (e: unknown) => /interaction is not allowed|KeyChain|-25308/i.test(String((e as any)?.message ?? e));

async function mobileGet(key: string): Promise<string | null> {
  try {
    const v = await SecureStore.getItemAsync(key, OPTS);
    if (v !== null) {
      cache.set(key, v);
      if (Platform.OS === 'ios' && !migrated.has(key)) {
        migrated.add(key);
        saveAfu(key, v).catch(() => migrated.delete(key));
      }
    }
    return v;
  } catch (e) {
    if (locked(e) && cache.has(key)) return cache.get(key)!;
    if (locked(e)) throw new Error('الجوال مقفول — افتح الجوال وجرّب مرة ثانية (الآيفون ما يعطي كلمة الراوتر والشاشة مقفولة)');
    throw e;
  }
}

export const secret = {
  get(key: string): Promise<string | null> {
    if (webOnly) return Promise.resolve(mem.get(key) ?? null);
    return desktop ? desktop.secretGet(key) : mobileGet(key);
  },
  set(key: string, value: string): Promise<void> {
    if (webOnly) { mem.set(key, value); return Promise.resolve(); }
    if (desktop) return desktop.secretSet(key, value);
    cache.set(key, value);
    migrated.add(key);
    return saveAfu(key, value);
  },
  del(key: string): Promise<void> {
    if (webOnly) { mem.delete(key); return Promise.resolve(); }
    if (desktop) return desktop.secretDel(key);
    cache.delete(key);
    return SecureStore.deleteItemAsync(key, OPTS);
  },
};
