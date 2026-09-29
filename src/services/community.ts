import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE_BASE } from './live';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';

/* ═══ مجتمع Bandly ═══
 * نتائج مجهولة الهوية لكل برج: رقم البرج + المشغّل + الإعداد + الدرجة.
 * ما نرسل موقع ولا رقم ولا اسم. المشاركة اختيارية ومقفلة افتراضياً. */

const CONSENT_KEY = 'bandly.community.consent';
const DEVICE_KEY = 'bandly.deviceId';

export type Consent = 'on' | 'off' | null;

export async function getConsent(): Promise<Consent> {
  try {
    const v = await AsyncStorage.getItem(CONSENT_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export async function setConsent(v: 'on' | 'off'): Promise<void> {
  try { await AsyncStorage.setItem(CONSENT_KEY, v); } catch {}
}

async function deviceId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
      await AsyncStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous-device';
  }
}

export interface TowerRef { tower: string; operator: string }

/** رقم البرج الفعلي (eNodeB) أو رقم الخلية، مع اسم المشغّل */
export async function currentTower(r: SavedRouter): Promise<TowerRef | null> {
  try {
    const [sig, net] = await withSession(r, async d => Promise.all([
      d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
      d.getNetworkInfo ? d.getNetworkInfo().catch(() => null) : Promise.resolve(null),
    ]));
    const tower = sig?.enodebId || sig?.cellId;
    if (!tower) return null;
    return { tower: String(tower), operator: net?.operator ?? '' };
  } catch {
    return null;
  }
}

async function post(path: string, body: object): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    await fetch(`${LIVE_BASE}/live-api/community/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {} finally { clearTimeout(t); }
}

export async function reportTest(t: TowerRef, x: { setup: string; region: string; score: number; ping: number; jitter: number; loss: number }) {
  if ((await getConsent()) !== 'on') return;
  await post('report', { device: await deviceId(), tower: t.tower, operator: t.operator, ...x });
}

export async function reportOutage(t: TowerRef, from: number, to: number) {
  if ((await getConsent()) !== 'on') return;
  await post('outage', { device: await deviceId(), tower: t.tower, operator: t.operator, from, to });
}

export interface TowerInfo {
  tower: string;
  users: number;
  best: { setup: string; score: number; ping: number; jitter: number; tests: number; users: number }[];
  outages: { from: number; to: number; users: number; mine: boolean }[];
}

export async function fetchTower(t: TowerRef, region?: string): Promise<TowerInfo | null> {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 8000);
  try {
    const q = new URLSearchParams({ tower: t.tower, operator: t.operator, region: region ?? '', device: await deviceId() });
    const r = await fetch(`${LIVE_BASE}/live-api/community/tower?${q.toString()}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return (await r.json()) as TowerInfo;
  } catch {
    return null;
  } finally {
    clearTimeout(tm);
  }
}
