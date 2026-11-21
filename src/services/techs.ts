/** دليل الفنيين المعتمدين — نفس اللي يطلع في البوت (live-server: /live-api/techs) */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIVE_BASE } from './live';

/** التخصصات — الفنيين القدامى (من البوت) = فني أنتنا */
export type TechKind = 'antenna' | 'repair';
export const KIND_LABEL: Record<TechKind, string> = { antenna: 'فني أنتنا', repair: 'صيانة أجهزة' };
export const KIND_ICON: Record<TechKind, string> = { antenna: '📡', repair: '🔧' };

export interface Tech {
  name: string; city: string; phone: string; note?: string; areas?: string; years?: string;
  rating: number | null; rating_n: number; kinds?: TechKind[];
}

export const kindsOf = (t: Tech): TechKind[] => (t.kinds && t.kinds.length ? t.kinds : ['antenna']);

export const BOT_TECH_SIGNUP = 'https://t.me/NetGuide1_bot?start=tech';

export async function fetchTechs(): Promise<Tech[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`${LIVE_BASE}/live-api/techs`, { signal: ctrl.signal });
    const j = await r.json();
    return Array.isArray(j?.techs) ? j.techs : [];
  } finally {
    clearTimeout(t);
  }
}

/** ٠٥xxxxxxxx أو ٥xxxxxxxx أو +٩٦٦… → 9665xxxxxxxx للواتساب */
export function waNumber(phone: string): string | null {
  const d = (phone || '').replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  if (/^9665\d{8}$/.test(d)) return d;
  if (/^05\d{8}$/.test(d)) return '966' + d.slice(1);
  if (/^5\d{8}$/.test(d)) return '966' + d;
  return d.length >= 9 ? d : null;
}

/** «الرياض» يطابق «الرياض - حي النرجس» ويتجاهل «ال» والهمزات */
const norm = (s: string) => (s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/^ال/, '').trim();
export const sameCity = (a: string, b: string) => !!a && !!b && (norm(a).includes(norm(b)) || norm(b).includes(norm(a)));

/** طلب فني: يوصل لفنيين المدينة في البوت. يرجّع كم فني وصله */
export async function requestTech(r: { city: string; phone: string; note: string; name?: string }): Promise<number> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${LIVE_BASE}/live-api/techreq`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify(r),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.detail || 'ما قدرنا نرسل الطلب');
    return Number(j?.sent) || 0;
  } finally {
    clearTimeout(t);
  }
}

// ═══ تسجيل فني من التطبيق — الموافقة توصل المالك في البوت، والنتيجة ترجع هنا ═══
export interface TechSignup { id: string; token: string; status: 'new' | 'ok' | 'no'; key?: string; name: string; at: number }
const SIGNUP_KEY = 'bandly.techSignup';

export async function loadSignup(): Promise<TechSignup | null> {
  try { const v = await AsyncStorage.getItem(SIGNUP_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
async function saveSignup(v: TechSignup | null) {
  try { v ? await AsyncStorage.setItem(SIGNUP_KEY, JSON.stringify(v)) : await AsyncStorage.removeItem(SIGNUP_KEY); } catch {}
}
export const clearSignup = () => saveSignup(null);

export async function signupTech(f: { name: string; phone: string; city: string; areas: string; services: string; years: string; kinds: TechKind[] }): Promise<TechSignup> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${LIVE_BASE}/live-api/app/techsignup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify(f),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.id) throw new Error(j?.detail || 'ما قدرنا نرسل التسجيل');
    const v: TechSignup = { id: j.id, token: j.token, status: 'new', name: f.name, at: Date.now() };
    await saveSignup(v);
    return v;
  } finally {
    clearTimeout(t);
  }
}

/** يشيك على نتيجة الموافقة ويحفظها */
export async function refreshSignup(v: TechSignup): Promise<TechSignup> {
  if (v.status !== 'new') return v;
  try {
    const r = await fetch(`${LIVE_BASE}/live-api/app/techsignup/${encodeURIComponent(v.id)}?token=${encodeURIComponent(v.token)}`);
    if (!r.ok) return v;
    const j = await r.json();
    if (j?.status === 'ok' || j?.status === 'no') {
      const next: TechSignup = { ...v, status: j.status, key: j.key };
      await saveSignup(next);
      return next;
    }
  } catch {}
  return v;
}
