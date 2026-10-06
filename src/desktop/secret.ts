/**
 * تخزين كلمات المرور: في الجوال SecureStore كالعادة،
 * وفي نسخة الويندوز عبر البرنامج (مشفّرة بتشفير الويندوز — safeStorage).
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { desktop } from './bridge';

/** متصفح عادي (بدون برنامج الويندوز): ما فيه تخزين آمن — نخليها في الذاكرة بس وما تنحفظ */
const mem = new Map<string, string>();
const webOnly = Platform.OS === 'web' && !desktop;

export const secret = {
  get(key: string): Promise<string | null> {
    if (webOnly) return Promise.resolve(mem.get(key) ?? null);
    return desktop ? desktop.secretGet(key) : SecureStore.getItemAsync(key);
  },
  set(key: string, value: string): Promise<void> {
    if (webOnly) { mem.set(key, value); return Promise.resolve(); }
    return desktop ? desktop.secretSet(key, value) : SecureStore.setItemAsync(key, value);
  },
  del(key: string): Promise<void> {
    if (webOnly) { mem.delete(key); return Promise.resolve(); }
    return desktop ? desktop.secretDel(key) : SecureStore.deleteItemAsync(key);
  },
};
