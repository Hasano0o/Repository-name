/**
 * الإصلاح الذاتي للمزايا التجريبية (٢٨ نوفمبر):
 *  - fixesFor: الصيغ اللي نجحت عند الأعضاء لهالدرايفر/الموديل (live-server/labfix.py) — كاش ٦ ساعات
 *  - reportVariant: صيغة نجحت ← الرسيفر (الأعضاء الجايين ياخذونها أول)
 *  - markFail / markOk / noticesFor / ackNotice: سجل الفشل بالجوال ← «انصلحت، جرّبها» لما ينزل الإصلاح (labFixCore)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE_BASE } from './live';
import { pendingFixes, labKey, type FailLog, type FixedNotice } from '../utils/labFixCore';

const FAILS = 'bandly.labFails';
const SEEN = 'bandly.labFixSeen';
const CACHE = (d: string, m: string) => `bandly.labFix.${d}.${m}`;
const TTL = 6 * 3600_000;

async function readJson<T>(k: string, d: T): Promise<T> {
  try { return JSON.parse((await AsyncStorage.getItem(k)) || '') as T; } catch { return d; }
}

export async function fixesFor(driver: string, model = ''): Promise<Record<string, string>> {
  const key = CACHE(driver, model);
  const c = await readJson<{ at: number; fixes: Record<string, string> } | null>(key, null);
  if (c && Date.now() - c.at < TTL) return c.fixes;
  try {
    const r = await fetch(`${LIVE_BASE}/live-api/app/labfix?driver=${encodeURIComponent(driver)}&model=${encodeURIComponent(model)}`);
    const j = await r.json();
    const fixes = j?.fixes && typeof j.fixes === 'object' ? j.fixes : {};
    AsyncStorage.setItem(key, JSON.stringify({ at: Date.now(), fixes })).catch(() => {});
    return fixes;
  } catch { return c?.fixes ?? {}; }
}

export async function reportVariant(driver: string, model: string, lab: string, variant: string): Promise<void> {
  try {
    await fetch(`${LIVE_BASE}/live-api/app/labfix`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver, model, lab: labKey(lab), variant }),
    });
  } catch {}
}

const fk = (routerId: string, driver: string, lab: string) => `${routerId}|${driver}:${labKey(lab)}`;

export async function markFail(routerId: string, driver: string, lab: string): Promise<void> {
  const f = await readJson<FailLog>(FAILS, {});
  f[fk(routerId, driver, lab)] = Date.now();
  await AsyncStorage.setItem(FAILS, JSON.stringify(f)).catch(() => {});
}
export async function markOk(routerId: string, driver: string, lab: string): Promise<void> {
  const f = await readJson<FailLog>(FAILS, {});
  const k = fk(routerId, driver, lab);
  if (!(k in f)) return;
  delete f[k];
  await AsyncStorage.setItem(FAILS, JSON.stringify(f)).catch(() => {});
}
export async function noticesFor(routerId: string, driver: string): Promise<FixedNotice[]> {
  return pendingFixes(routerId, driver, await readJson<FailLog>(FAILS, {}), await readJson<Record<string, number>>(SEEN, {}));
}
export async function ackNotice(key: string): Promise<void> {
  const s = await readJson<Record<string, number>>(SEEN, {});
  s[key] = Date.now();
  await AsyncStorage.setItem(SEEN, JSON.stringify(s)).catch(() => {});
}
