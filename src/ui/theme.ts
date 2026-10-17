import { Appearance } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Updates from 'expo-updates';

/* ═══════════════════════════════════════════════════════════════
 * الثيم (فاتح / داكن)
 * الأنماط في كل الشاشات تنبني مرة وحدة وقت تحميل التطبيق (StyleSheet.create)،
 * فالثيم يتحدد هنا بشكل متزامن قبل أي شاشة، وتغييره يعيد تشغيل التطبيق.
 * ═══════════════════════════════════════════════════════════════ */

export type ThemePref = 'light' | 'dark' | 'system';
const PREF_FILE = 'bandly-theme.txt';

function readPref(): ThemePref {
  try {
    const f = new File(Paths.document, PREF_FILE);
    if (!f.exists) return 'light';
    const v = f.textSync().trim();
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

export const THEME_PREF: ThemePref = readPref();
export const isDark: boolean =
  THEME_PREF === 'dark' || (THEME_PREF === 'system' && Appearance.getColorScheme() === 'dark');

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
  bg: '#edf0f5',
  bgTop: '#f0f3f7',
  bgBottom: '#e2e8f0',
  card: '#f8fafc',
  cardBorder: '#b7c3d3',
  rowBg: '#eff2f7',
  track: '#bdd9fd',

  // تدرّج بطاقة الترويسة
  heroFrom: '#f4fbfe',
  heroMid: '#e6f4ff',
  heroTo: '#c4e5f9',
  dangerTop: '#fff3f6',
  dangerBottom: '#ffecf2',

  // النص
  text: '#1e2d4d',
  sub: '#70799b',
  muted: '#70799b',

  // الهوية: الأزرق للإجراء فقط
  blue: '#2f6bff',
  blueIcon: '#2a73ff',
  blueLight: '#628dfe',
  blueSoft: '#bdd9fd',
  blueDeep: '#1b47c7',

  // ألوان المواضيع
  violet: '#7a51e0',
  violetBright: '#8448f5',
  violetSoft: '#d6c6ff',
  cyan: '#86d9ef',
  cyanSoft: '#c5f3ff',
  mint: '#57d3b2',
  mintSoft: '#a9e6dd',
  pink: '#e94079',
  pinkSoft: '#ffc5d9',
  crimson: '#cc275c',

  // الحالة
  green: '#34ce83',
  greenBright: '#47eb6b',
  greenSoft: '#dafcee',
  gold: '#ffc27a',
  goldSoft: '#fff9f2',
  amber: '#ffc27a',
  amberSoft: '#fde4b8',
  red: '#d73722',
  redSoft: '#ffecf2',

  line: '#d8e0eb',
  lineSoft: '#e1e7f0',
  onAccent: '#ffffff',
  onAccentSoft: '#cfe0ff',
  shadow: '#0d2350',
};

// داكن كحلي خافت (مو أسود) — نفس هوية التطبيق: الأزرق يبقى أزرق، مريح للعين
const DARK: typeof LIGHT = {
  bg: '#1a2130',
  bgTop: '#1d2535',
  bgBottom: '#171d2a',
  card: '#232c3e',
  cardBorder: '#3a4760',
  rowBg: '#2a3448',
  track: '#34507e',

  heroFrom: '#22304a',
  heroMid: '#263656',
  heroTo: '#2b3d62',
  dangerTop: '#3a2633',
  dangerBottom: '#42293a',

  text: '#e8edf5',
  sub: '#a9b4c8',
  muted: '#97a3b8',

  blue: '#4f80ff',
  blueIcon: '#6a96ff',
  blueLight: '#89aaff',
  blueSoft: '#2c3f66',
  blueDeep: '#c9d8ff',

  violet: '#b099f7',
  violetBright: '#a67cff',
  violetSoft: '#3b3566',
  cyan: '#6fd2ec',
  cyanSoft: '#21404d',
  mint: '#6adcbd',
  mintSoft: '#22463f',
  pink: '#f478a8',
  pinkSoft: '#4a2a3d',
  crimson: '#f07099',

  green: '#4fdc9a',
  greenBright: '#5cef7e',
  greenSoft: '#1f4335',
  gold: '#ffcb8c',
  goldSoft: '#3a3528',
  amber: '#ffcb8c',
  amberSoft: '#4a3d25',
  red: '#ff7d6b',
  redSoft: '#4a2b33',

  line: '#334055',
  lineSoft: '#2c3749',
  onAccent: '#ffffff',
  onAccentSoft: '#d6e2ff',
  shadow: '#000000',
};

export const C = isDark ? DARK : LIGHT;

/* ═══ تكييف الألوان المكتوبة مباشرة في الشاشات ═══
 * في الفاتح ترجع اللون نفسه. في الداكن:
 *  bg/bd: الخلفيات الفاتحة (أبيض وباستيل) تصير داكنة بنفس الدرجة اللونية
 *  fg:    النصوص الغامقة تصير فاتحة — والألوان الزاهية (أزرق، أخضر...) تبقى
 */
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
    // الرمادي والأبيض ياخذون الكحلي حق الثيم بدل الرمادي الباهت
    if (s < 0.12) { h = 32; s = 0.22; }
    if (role === 'fg') {
      if (l < 0.3 || (l <= 0.42 && s < 0.5)) out = fromHsl(h, Math.min(s, 0.45), Math.min(0.95, 1 - l * 0.45), p.a);
    } else if (l >= 0.8 && p.a >= 0.5) {
      // الشفاف الخفيف (زجاج فوق تدرّج ملوّن) نخليه زي ما هو
      const nl = 0.23 + (1 - l) * 0.45 + (role === 'bd' ? 0.1 : 0);
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

/** أنصاف الأقطار */
export const R = { sm: 18, md: 22, lg: 28, pill: 999 };

/** المسافات على شبكة ٤ */
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22 };

/** مقاسات الخط */
export const T = { score: 44, h1: 23, h2: 17, body: 14, label: 12, tiny: 11 };
