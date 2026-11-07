import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE_BASE } from './live';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';

/* ═══ مجتمع Bandly ═══
 * نتائج مجهولة الهوية لكل برج: رقم البرج + المشغّل + الإعداد + الدرجة.
 * ما نرسل موقع ولا رقم ولا اسم. المشاركة اختيارية ومقفلة افتراضياً. */

const CONSENT_KEY = 'bandly.community.consent';
const DEVICE_KEY = 'bandly.deviceId';
const AREA_KEY = 'bandly.area';

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

export async function deviceId(): Promise<string> {
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

/* ═══ الحي — يكتبه المستخدم بنفسه (ما نستخدم GPS) ═══ */
export async function getArea(): Promise<string> {
  try { return (await AsyncStorage.getItem(AREA_KEY)) ?? ''; } catch { return ''; }
}
export async function setArea(v: string): Promise<void> {
  try { await AsyncStorage.setItem(AREA_KEY, v.trim()); } catch {}
}

/** المشغّل ورقم البرج (لو متوفر) — للمقارنة بين الشرائح */
export async function currentNet(r: SavedRouter): Promise<{ tower?: string; operator: string } | null> {
  try {
    const [sig, net] = await withSession(r, async d => Promise.all([
      d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
      d.getNetworkInfo ? d.getNetworkInfo().catch(() => null) : Promise.resolve(null),
    ]));
    const tower = sig?.enodebId || sig?.cellId;
    return { tower: tower ? String(tower) : undefined, operator: net?.operator ?? '' };
  } catch {
    return null;
  }
}

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

export async function reportTest(t: { tower?: string; operator: string }, x: { setup: string; region: string; score: number; ping: number; jitter: number; loss: number }) {
  if ((await getConsent()) !== 'on') return;
  await post('report', { device: await deviceId(), tower: t.tower ?? '', operator: t.operator, area: await getArea(), ...x });
}

export interface AreaOp { operator: string; score: number | null; ping: number | null; jitter: number | null; tests: number; users: number; mine: boolean }

export async function fetchArea(area: string, region?: string): Promise<AreaOp[] | null> {
  if (!area.trim()) return null;
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 8000);
  try {
    const q = new URLSearchParams({ area, region: region ?? '', device: await deviceId() });
    const r = await fetch(`${LIVE_BASE}/live-api/community/area?${q.toString()}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return ((await r.json()) as { operators: AreaOp[] }).operators;
  } catch {
    return null;
  } finally {
    clearTimeout(tm);
  }
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

/* ═══ مستشار البرج (٧ نوفمبر) — بدون GPS: رقم البرج نفسه هو المكان ═══ */

/** «B3 + B1 + n78» ← «B1+B3+n78» (نفس شكل السيرفر) */
export function comboKey(carriers: { tech: 'LTE' | 'NR'; band: number }[]): string {
  const lte = [...new Set(carriers.filter(c => c.tech === 'LTE' && c.band > 0).map(c => c.band))].sort((a, b) => a - b);
  const nr = [...new Set(carriers.filter(c => c.tech === 'NR' && c.band > 0).map(c => c.band))].sort((a, b) => a - b);
  return [...lte.map(b => `B${b}`), ...nr.map(b => `n${b}`)].join('+');
}

export interface ObsReading {
  combo: string; carriers: number; model?: string;
  rsrp?: number; sinr?: number; nrRsrp?: number;
  ping?: number; jitter?: number; score?: number;
  /** scan = الفحص الصامت · after = بعد «اضبط لي كل شي» · kept = إعداد ثبّتناه لأنه أفضل */
  src: 'scan' | 'after' | 'kept';
}

/** يرسل قراءة لبرجك — بس لو العضو وافق على المشاركة */
export async function reportObs(t: TowerRef, x: ObsReading): Promise<void> {
  if ((await getConsent()) !== 'on' || !t.tower || !x.combo) return;
  await post('obs', { device: await deviceId(), tower: t.tower, operator: t.operator, ...x });
}

export interface ComboStat {
  combo: string; users: number; tests: number; mine: boolean; enough: boolean;
  rsrp: number | null; sinr: number | null; ping: number | null; jitter: number | null; score: number | null;
  night_ping: number | null; day_ping: number | null;
}
export interface TowerCombos { tower: string; operator: string; users: number; combos: ComboStat[]; min_users: number }

/** وش حصّل الأعضاء على نفس برجك (قراءة بس — ما يحتاج موافقة لأنه أرقام مجمّعة) */
export async function fetchCombos(t: TowerRef): Promise<TowerCombos | null> {
  if (!t.tower) return null;
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 6000);
  try {
    const q = new URLSearchParams({ tower: t.tower, operator: t.operator, device: await deviceId() });
    const r = await fetch(`${LIVE_BASE}/live-api/community/combos?${q.toString()}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return (await r.json()) as TowerCombos;
  } catch {
    return null;
  } finally {
    clearTimeout(tm);
  }
}

/* ═══ أفضل شركة في منطقتك (٧ نوفمبر) — زي OpenSignal، من فحوصات الأعضاء ═══ */

/** المدينة/الحي: من «الحي» المحفوظ، ولو ما فيه ← مدينة الإحصائيات */
export async function myPlace(): Promise<{ city: string; area: string }> {
  const area = await getArea();
  let city = area.split('/')[0]?.trim() ?? '';
  if (!city) {
    try {
      const { getCity } = await import('./stats');
      const c = await getCity();
      if (c && c !== '-') city = c;
    } catch {}
  }
  return { city, area };
}

/** نتيجة اختبار سرعة على خط الراوتر — بموافقة المشاركة، وبس لو نعرف المدينة والشركة */
export async function reportSpeed(x: { operator: string; down: number; up: number; ping: number; loaded?: number; nr?: boolean }): Promise<void> {
  if ((await getConsent()) !== 'on' || !x.operator) return;
  const { city, area } = await myPlace();
  if (!city) return;
  await post('speed', { device: await deviceId(), area: area || city, ...x });
}

export type CarrierCat = 'down' | 'up' | 'ping' | 'steady' | 'night_ping' | 'nr_pct';

export interface CarrierStat {
  operator: string; users: number; tests: number; mine: boolean; enough: boolean;
  score: number | null; ping: number | null; jitter: number | null;
  /** ٪ فحوصات «جاهز للعب؟» اللي طلعت ٧٠+ (وسيط الأعضاء) */
  steady: number | null;
  down: number | null; up: number | null;
  /** كم يزيد البنق وقت التحميل */
  bloat: number | null;
  /** ٪ اختبارات السرعة اللي كان فيها 5G */
  nr_pct: number | null;
  night_ping: number | null; day_ping: number | null;
  wins: CarrierCat[];
}
export interface CarrierBoard { operators: CarrierStat[]; winner: string | null; min_users: number; users: number }
export interface CarrierReport { city: string; area: string; city_stats: CarrierBoard; area_stats: CarrierBoard | null }

/** قراءة بس — أرقام مجمّعة، ما تحتاج موافقة */
export async function fetchCarriers(city: string, area: string): Promise<CarrierReport | null> {
  if (!city.trim()) return null;
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 8000);
  try {
    const q = new URLSearchParams({ city, area, device: await deviceId() });
    const r = await fetch(`${LIVE_BASE}/live-api/community/carriers?${q.toString()}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return (await r.json()) as CarrierReport;
  } catch {
    return null;
  } finally {
    clearTimeout(tm);
  }
}
