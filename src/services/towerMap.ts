/**
 * «بعد البرج عنك» — قاعدة أبراج Bandly من الأعضاء (السيرفر: live-server/towers.py).
 *
 * OpenCelliD ما يعرف أبراج 4G/5G في شرورة، فكل عضو **وافق** يرسل: رقم البرج + موقعه التقريبي (١١٠ م) + قوة
 * الإشارة. السيرفر يقدّر موقع البرج من ٣ أعضاء أو أكثر، ويرجّع الموقع بس (مو نقاط الأعضاء).
 *
 * الموقع: نستخدمه بس والتطبيق مفتوح (بدون خلفية)، ونطلب الصلاحية بس لما العضو يضغط «اعرف بعد البرج».
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE_BASE } from './live';
import { deviceId } from './community';
import { Signal } from '../drivers/types';
import { cellOf, cellKey, distanceM, bearingDeg, dirAr, distLabel, roundLoc, TowerCell } from './towerGeo';

const CONSENT_KEY = 'bandly.towerShare';
const SENT_KEY = 'bandly.towerSent';
const RESEND_MS = 12 * 3600_000;

export type TowerConsent = 'yes' | 'no' | null;

export async function getTowerConsent(): Promise<TowerConsent> {
  try { const v = await AsyncStorage.getItem(CONSENT_KEY); return v === 'yes' || v === 'no' ? v : null; } catch { return null; }
}
export async function setTowerConsent(v: 'yes' | 'no') {
  try { await AsyncStorage.setItem(CONSENT_KEY, v); } catch {}
}

type Loc = typeof import('expo-location');
let locMod: Loc | null | undefined;
async function loc(): Promise<Loc | null> {
  if (locMod !== undefined) return locMod;
  // ينحمّل وقت الحاجة — النسخ القديمة (بدون المكتبة الأصلية) ترجع null بدل ما تطيح
  try { locMod = await import('expo-location'); } catch { locMod = null; }
  return locMod;
}

/** الجهاز فيه مكتبة الموقع؟ (النسخ قبل بناء نوفمبر ما فيها) */
export async function locationAvailable(): Promise<boolean> {
  const L = await loc();
  if (!L) return false;
  try { await L.getForegroundPermissionsAsync(); return true; } catch { return false; }
}

/** يطلب الصلاحية (بس لما العضو يضغط) */
export async function requestLocation(): Promise<boolean> {
  const L = await loc();
  if (!L) return false;
  try { return (await L.requestForegroundPermissionsAsync()).granted; } catch { return false; }
}

async function position(): Promise<{ lat: number; lon: number; acc?: number } | null> {
  const L = await loc();
  if (!L) return null;
  try {
    if (!(await L.getForegroundPermissionsAsync()).granted) return null;
    const last = await L.getLastKnownPositionAsync({ maxAge: 15 * 60_000, requiredAccuracy: 1000 });
    const p = last ?? await Promise.race([
      L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced }),
      new Promise<null>(r => setTimeout(() => r(null), 10_000)),
    ]);
    if (!p) return null;
    return { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy ?? undefined };
  } catch { return null; }
}

/** يساهم بقراءة البرج الحالي (لو العضو وافق) — مرة كل ١٢ ساعة لكل برج. ما يرمي أبداً */
export async function contributeTower(sig?: Signal | null): Promise<void> {
  try {
    const cell = cellOf(sig);
    if (!cell || (await getTowerConsent()) !== 'yes') return;
    const k = cellKey(cell);
    let sent: Record<string, number> = {};
    try { sent = JSON.parse((await AsyncStorage.getItem(SENT_KEY)) ?? '{}'); } catch {}
    if (Date.now() - (sent[k] ?? 0) < RESEND_MS) return;
    const p = await position();
    if (!p) return;
    const r = await fetch(`${LIVE_BASE}/live-api/app/cellobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cell, lat: roundLoc(p.lat), lon: roundLoc(p.lon), acc: p.acc, device: await deviceId() }),
    });
    if (r.ok) {
      sent[k] = Date.now();
      // ما نخلي القائمة تكبر للأبد
      const keep = Object.entries(sent).sort((a, b) => b[1] - a[1]).slice(0, 50);
      await AsyncStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(keep)));
    }
  } catch {}
}

export type TowerInfo =
  | { state: 'nocell' }                                   // الراوتر ما يعطي هوية البرج
  | { state: 'collecting'; members: number; need: number } // لسا ما فيه أعضاء كفاية
  | { state: 'found'; label: string; dir?: string; deg?: number; members: number; accuracy: number; noLoc?: boolean };

/** موقع البرج من السيرفر + بعده واتجاهه عنك */
export async function towerInfo(sig?: Signal | null): Promise<TowerInfo> {
  const cell = cellOf(sig);
  if (!cell) return { state: 'nocell' };
  const q = new URLSearchParams({ mcc: cell.mcc, mnc: cell.mnc, tac: cell.tac, eci: cell.eci });
  const r = await fetch(`${LIVE_BASE}/live-api/app/cellpos?${q}`);
  const j = await r.json();
  if (!j?.found) return { state: 'collecting', members: Number(j?.members) || 0, need: Number(j?.need) || 3 };
  const p = await position();
  if (!p) return { state: 'found', label: 'موقع البرج معروف', members: j.members, accuracy: j.accuracy_m, noLoc: true };
  const m = distanceM(p.lat, p.lon, j.lat, j.lon);
  const deg = bearingDeg(p.lat, p.lon, j.lat, j.lon);
  const near = m < Math.max(300, j.accuracy_m);
  return { state: 'found', label: distLabel(m, j.accuracy_m), dir: near ? undefined : dirAr(deg), deg: near ? undefined : Math.round(deg), members: j.members, accuracy: j.accuracy_m };
}

export type { TowerCell };
