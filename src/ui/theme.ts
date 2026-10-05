import { Appearance } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Updates from 'expo-updates';

/* ═══════════════════════════════════════════════════════════════
 * الثيم (فاتح / داكن) - ثيم مريح للعين بدائل فخمة داكنة
 * ═══════════════════════════════════════════════════════════════ */

export type ThemePref = 'light' | 'dark' | 'system';
const PREF_FILE = 'bandly-theme.txt';

function readPref(): ThemePref {
  try {
    const f = new File(Paths.document, PREF_FILE);
    if (!f.exists) return 'dark';
    const v = f.textSync().trim();
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export const THEME_PREF: ThemePref = readPref();
export const isDark: boolean =
  THEME_PREF === 'dark' || (THEME_PREF === 'system' && Appearance.getColorScheme() === 'dark') || THEME_PREF !== 'light';

/** يحفظ الاختيار ويعيد تشغيل التطبيق عشان كل الشاشات تاخذ الألوان الجديدة */
export async function setThemePref(p: ThemePref): Promise<void> {
  try {
    const f = new File(Paths.document, PREF_FILE);
    if (!f.exists) f.create();
    f.write(p);
  } catch {}
  try { await Updates.reloadAsync(); } catch {}
}

const LIGHT = {
  // الأسطح
  bg: '#f8fafc',
  bgTop: '#f1f5f9',
  bgBottom: '#e2e8f0',
  card: '#ffffff',
  cardBorder: '#e2e8f0',
  rowBg: '#f1f5f9',
  track: '#cbd5e1',

  // تدرّج بطاقة الترويسة
  heroFrom: '#eff6ff',
  heroMid: '#e0f2fe',
  heroTo: '#dbeafe',
  dangerTop: '#fef2f2',
  dangerBottom: '#ffe4e6',

  // النص
  text: '#0f172a',
  sub: '#475569',
  muted: '#64748b',

  // الهوية: الأزرق للتمييز والإجراء
  blue: '#2563eb',
  blueIcon: '#3b82f6',
  blueLight: '#60a5fa',
  blueSoft: '#dbeafe',
  blueDeep: '#1d4ed8',

  // ألوان المواضيع
  violet: '#7c3aed',
  violetBright: '#8b5cf6',
  violetSoft: '#ede9fe',
  cyan: '#0891b2',
  cyanSoft: '#cff4fc',
  mint: '#059669',
  mintSoft: '#d1fae5',
  pink: '#db2777',
  pinkSoft: '#fce7f3',
  crimson: '#e11d48',

  // الحالة
  green: '#059669',
  greenBright: '#10b981',
  greenSoft: '#d1fae5',
  gold: '#d97706',
  goldSoft: '#fef3c7',
  amber: '#d97706',
  amberSoft: '#fef3c7',
  red: '#dc2626',
  redSoft: '#fee2e2',

  line: '#e2e8f0',
  lineSoft: '#f1f5f9',
  onAccent: '#ffffff',
  onAccentSoft: '#bfdbfe',
  shadow: '#0f172a',
};

// داكن فخم مريح للعين (Midnight Obsidian) - بدون أسود حاد ولا بياض فاقع
const DARK: typeof LIGHT = {
  bg: '#12151e',
  bgTop: '#1a1f2c',
  bgBottom: '#10131b',
  card: '#1e2433',
  cardBorder: '#2a3246',
  rowBg: '#171c28',
  track: '#263046',

  heroFrom: '#1c2333',
  heroMid: '#1a202e',
  heroTo: '#141824',
  dangerTop: '#331c24',
  dangerBottom: '#24141a',

  text: '#f3f4f6',
  sub: '#9ca3af',
  muted: '#6b7280',

  blue: '#3b82f6',
  blueIcon: '#60a5fa',
  blueLight: '#93c5fd',
  blueSoft: '#1e293b',
  blueDeep: '#2563eb',

  violet: '#8b5cf6',
  violetBright: '#a78bfa',
  violetSoft: '#2e1065',
  cyan: '#06b6d4',
  cyanSoft: '#164e63',
  mint: '#10b981',
  mintSoft: '#064e3b',
  pink: '#ec4899',
  pinkSoft: '#831843',
  crimson: '#f43f5e',

  green: '#10b981',
  greenBright: '#34d399',
  greenSoft: '#064e3b',
  gold: '#f59e0b',
  goldSoft: '#451a03',
  amber: '#f59e0b',
  amberSoft: '#78350f',
  red: '#ef4444',
  redSoft: '#7f1d1d',

  line: '#273043',
  lineSoft: '#1f2738',
  onAccent: '#ffffff',
  onAccentSoft: '#dbeafe',
  shadow: '#000000',
};

export const C = isDark ? DARK : LIGHT;

/* ═══ تكييف الألوان المكتوبة مباشرة في الشاشات ═══ */
type Rgba = { r: number; g: number; b: number; a: number };

function parse(c: string): Rgba | null {
  let m = c.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = c.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  return null;
}

function toHsl({ r, g, b }: Rgba): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number, a: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const q = s * Math.min(l, 1 - l);
  const f = (n: number) => l - q * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hx = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}${a < 1 ? hx(a) : ''}`;
}

const cache = new Map<string, string>();
function adapt(c: string, role: 'bg' | 'bd' | 'fg'): string {
  if (!isDark) return c;
  const key = role + c;
  const hit = cache.get(key);
  if (hit) return hit;
  let out = c;
  const p = parse(c);
  if (p) {
    let [h, s, l] = toHsl(p);
    if (s < 0.12) { h = 222; s = 0.22; }
    if (role === 'fg') {
      if (l < 0.3 || (l <= 0.42 && s < 0.5)) out = fromHsl(h, Math.min(s, 0.45), Math.min(0.95, 1 - l * 0.45), p.a);
    } else if (l >= 0.8 && p.a >= 0.5) {
      const nl = 0.20 + (1 - l) * 0.45 + (role === 'bd' ? 0.1 : 0);
      out = fromHsl(h, Math.min(s, 0.3), nl, p.a);
    }
  }
  cache.set(key, out);
  return out;
}

/** لون خلفية */
export const tBg = (c: string) => adapt(c, 'bg');
/** لون حدود */
export const tBd = (c: string) => adapt(c, 'bd');
/** لون نص أو أيقونة */
export const tFg = (c: string) => adapt(c, 'fg');

/** أنصاف الأقطار - زوايا متناسقة وعصرية */
export const R = { xs: 8, sm: 12, md: 16, lg: 20, xl: 24, pill: 999 };

/** المسافات على شبكة 4 */
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };

/** مقاسات الخطوط */
export const T = { score: 40, h1: 22, h2: 17, body: 14, label: 12, tiny: 11 };
