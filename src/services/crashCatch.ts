/**
 * ماسك الانهيارات (٢١ نوفمبر ٢٠٢٦): App Store Connect يعطي عدد الانهيارات بس (٧ في 1.1.2)
 * وولا واحد منها وصل errors.jsonl — التطبيق يتقفل قبل ما يرسل.
 * الحين: أي خطأ قاتل في كود التطبيق ← نحفظه على الجوال لحظتها، وأول ما يفتح المرة الجاية
 * يوصل الرسيفر كـ feature «crash» (الرسالة + الشاشة + أول سطور مكان الخطأ). بدون أي بيانات شخصية.
 * يمشي بتحديث OTA (جافاسكربت بس). انهيارات نظام آيفون نفسه (native) ما يمسكها.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { crashText } from './crashText';

const KEY = 'bandly.pendingCrash';
let screen = '';
let installed = false;

/** آخر شاشة فتحها العضو (من _layout) — عشان نعرف وين طاح */
export function setCrashScreen(name: string) { screen = name; }

export function installCrashCatcher() {
  if (installed) return;
  installed = true;
  try {
    const EU: any = (globalThis as any).ErrorUtils;
    if (!EU?.setGlobalHandler) return; // نسخة الويندوز/الويب
    const prev = EU.getGlobalHandler?.();
    EU.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      if (!isFatal) { try { prev?.(error, isFatal); } catch {} return; }
      const text = crashText(error, screen);
      let done = false;
      const finish = () => { if (done) return; done = true; try { prev?.(error, isFatal); } catch {} };
      // نعطي الحفظ فرصة قبل ما يقفل التطبيق (الافتراضي يقفله فوراً) — بحد أقصى ثانية
      AsyncStorage.setItem(KEY, JSON.stringify({ text, at: new Date().toISOString() })).then(finish, finish);
      setTimeout(finish, 1000);
    });
  } catch {}
}

/** عند الإقلاع: لو فيه انهيار محفوظ من المرة اللي قبل ← نرسله ونمسحه */
export async function flushCrash() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    await AsyncStorage.removeItem(KEY);
    const { text, at } = JSON.parse(raw);
    const { reportError } = await import('./errors');
    await reportError('crash', `${text} · صار ${String(at).slice(5, 16).replace('T', ' ')}`);
  } catch {}
}
