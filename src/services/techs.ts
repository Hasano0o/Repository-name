/** دليل الفنيين المعتمدين — نفس اللي يطلع في البوت (live-server: /live-api/techs) */
import { LIVE_BASE } from './live';

export interface Tech {
  name: string; city: string; phone: string; note?: string; areas?: string; years?: string;
  rating: number | null; rating_n: number;
}

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
