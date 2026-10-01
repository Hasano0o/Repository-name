import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { LIVE_BASE } from './live';
import { deviceId } from './community';
import { listRouters } from '../store/routers';

/* ═══ إحصائيات الاستخدام ═══
 * مرة باليوم: معرّف عشوائي + المدينة اللي اختارها المستخدم + نوع الجوال ونسخة أندرويد
 * ونسخة التطبيق + أنواع الراوترات المضافة. ما نرسل اسم ولا رقم ولا موقع GPS. */

const CITY_KEY = 'bandly.city';
const LAST_KEY = 'bandly.stats.lastDay';

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
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${LIVE_BASE}/live-api/stats/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        id: await deviceId(),
        city: city === '-' ? '' : city,
        brand: String(pc.Brand ?? pc.Manufacturer ?? ''),
        model: String(pc.Model ?? ''),
        android: String(pc.Release ?? Platform.Version ?? ''),
        app: Constants.expoConfig?.version ?? '',
        update: Updates.isEmbeddedLaunch ? 'apk' : (Updates.createdAt?.toISOString().slice(0, 16) ?? ''),
        routers: [...new Set(routers)],
      }),
    }).finally(() => clearTimeout(t));
    if (r.ok) await AsyncStorage.setItem(LAST_KEY, day);
  } catch {
    // ما يهم — نجرب المرة الجاية
  } finally {
    busy = false;
  }
}
