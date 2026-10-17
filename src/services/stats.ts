import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { LIVE_BASE } from './live';
import { deviceId } from './community';
import { listRouters } from '../store/routers';

/* ═══ إحصائيات الاستخدام ═══
 * مرة باليوم: معرّف عشوائي + المدينة اللي اختارها المستخدم + نوع الجوال ونوع النظام (آيفون/أندرويد) ونسخته
 * ونسخة التطبيق + أنواع الراوترات المضافة. ما نرسل اسم ولا رقم ولا موقع GPS. */

const CITY_KEY = 'bandly.city';
const LAST_KEY = 'bandly.stats.lastDay';
const LOGIN_KEY = 'bandly.stats.logins';
const SCREENS_KEY = 'bandly.stats.screens';

/** فتح شاشة — نزيد عدّادها بس (رقم، بدون أي بيانات شخصية). ينرسل مع الإحصائية اليومية */
export async function markScreen(name: string) {
  if (!name) return;
  try {
    const m: Record<string, number> = JSON.parse((await AsyncStorage.getItem(SCREENS_KEY)) || '{}');
    m[name] = (m[name] ?? 0) + 1;
    await AsyncStorage.setItem(SCREENS_KEY, JSON.stringify(m));
  } catch {}
}

/** دخول حقيقي ناجح لراوتر (مو التجريبي) — نسجّل النوع واليوم، وأول دخول باليوم يحدّث الإحصائية */
export async function markLogin(driverName: string) {
  try {
    const day = today();
    const m: Record<string, string> = JSON.parse((await AsyncStorage.getItem(LOGIN_KEY)) || '{}');
    if (m[driverName] === day) return;
    m[driverName] = day;
    await AsyncStorage.setItem(LOGIN_KEY, JSON.stringify(m));
    pingDaily(true);
  } catch {}
}

/** المدن الأكثر — والباقي يكتبه المستخدم */
export const CITIES = [
  'الرياض', 'جدة', 'مكة', 'المدينة', 'الدمام', 'الخبر', 'الأحساء', 'الطائف',
  'أبها', 'خميس مشيط', 'جازان', 'نجران', 'شرورة', 'تبوك', 'حائل', 'بريدة',
];

/** '' = ما اختار بعد · '-' = قال لاحقاً */
export async function getCity(): Promise<string> {
  try { return (await AsyncStorage.getItem(CITY_KEY)) ?? ''; } catch { return ''; }
}

export async function setCity(v: string): Promise<void> {
  try { await AsyncStorage.setItem(CITY_KEY, v.trim().slice(0, 30)); } catch {}
  pingDaily(true);
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

let busy = false;

/** يرسل مرة باليوم (أو فوراً لو force). صامت تماماً لو فشل. */
export async function pingDaily(force = false): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const day = today();
    if (!force && (await AsyncStorage.getItem(LAST_KEY)) === day) return;
    const pc = (Platform.constants ?? {}) as Record<string, unknown>;
    const city = await getCity();
    const routers = (await listRouters().catch(() => [])).map(r => r.driverName).filter(Boolean);
    let logins: string[] = [];
    let loginEver = false;
    try {
      const m: Record<string, string> = JSON.parse((await AsyncStorage.getItem(LOGIN_KEY)) || '{}');
      logins = Object.keys(m).filter(k => m[k] === day);
      loginEver = Object.keys(m).length > 0;
    } catch {}
    let blocker = '';
    let blockerNote = '';
    try {
      const b = JSON.parse((await AsyncStorage.getItem('bandly.blocker')) || 'null');
      if (b && typeof b.r === 'string') { blocker = b.r; blockerNote = typeof b.note === 'string' ? b.note : ''; }
    } catch {}
    let screens: Record<string, number> = {};
    try { screens = JSON.parse((await AsyncStorage.getItem(SCREENS_KEY)) || '{}'); } catch {}
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${LIVE_BASE}/live-api/stats/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        id: await deviceId(),
        city: city === '-' ? '' : city,
        os: Platform.OS,
        brand: Platform.OS === 'ios' ? 'Apple' : String(pc.Brand ?? pc.Manufacturer ?? ''),
        model: String(pc.Model ?? ''),
        android: String(pc.Release ?? Platform.Version ?? ''),
        app: Constants.expoConfig?.version ?? '',
        update: Updates.isEmbeddedLaunch ? 'apk' : (Updates.createdAt?.toISOString().slice(0, 16) ?? ''),
        routers: [...new Set(routers)],
        logins,
        loginEver,
        screens,
        blocker,
        blockerNote,
      }),
    }).finally(() => clearTimeout(t));
    if (r.ok) {
      await AsyncStorage.setItem(LAST_KEY, day);
      // نطرح اللي انرسل بس — أي فتحة صارت أثناء الإرسال تبقى للمرة الجاية
      try {
        const now: Record<string, number> = JSON.parse((await AsyncStorage.getItem(SCREENS_KEY)) || '{}');
        for (const k of Object.keys(screens)) {
          const left = (now[k] ?? 0) - screens[k];
          if (left > 0) now[k] = left; else delete now[k];
        }
        await AsyncStorage.setItem(SCREENS_KEY, JSON.stringify(now));
      } catch {}
    }
  } catch {
    // ما يهم — نجرب المرة الجاية
  } finally {
    busy = false;
  }
}
