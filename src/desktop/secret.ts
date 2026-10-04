/**
 * تخزين كلمات المرور: في الجوال SecureStore كالعادة،
 * وفي نسخة الويندوز عبر البرنامج (مشفّرة بتشفير الويندوز — safeStorage).
 */
import * as SecureStore from 'expo-secure-store';
import { desktop } from './bridge';

export const secret = {
  get(key: string): Promise<string | null> {
    return desktop ? desktop.secretGet(key) : SecureStore.getItemAsync(key);
  },
  set(key: string, value: string): Promise<void> {
    return desktop ? desktop.secretSet(key, value) : SecureStore.setItemAsync(key, value);
  },
  del(key: string): Promise<void> {
    return desktop ? desktop.secretDel(key) : SecureStore.deleteItemAsync(key);
  },
};
