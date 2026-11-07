/* ═══ تكييف الألوان المكتوبة مباشرة في الشاشات (بدون react-native — يتختبر) ═══
 * في الفاتح ترجع اللون نفسه. في الداكن:
 *  bg/bd: الخلفيات الفاتحة (أبيض وباستيل) تصير داكنة بنفس الدرجة اللونية
 *  fg:    النصوص الغامقة تصير فاتحة — والألوان الزاهية (أزرق، أخضر...) تبقى
 *         ٧ نوفمبر: الألوان المشبعة الغامقة (كحلي #1d3f9e، برتقالي محروق #9a3412، عنبري #b45309…)
 *         كانت تبقى زي ما هي ← نص غامق على كرت كحلي ما ينقرى (صورة حسن: نافذة التقدّم).
 *         الحين لو تباينها مع الكرت الداكن أقل من 4.5 نفتّحها بنفس لونها لين تنقرى.
 */
type Rgba = { r: number; g: number; b: number; a: number };

/** خلفية الكرت في الداكن (C.card) — التباين يتحسب عليها */
export const DARK_CARD = '#111f35';
/** أقل تباين للنص (WCAG AA) */
export const MIN_CONTRAST = 4.5;

export function parseColor(c: string): Rgba | null {
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

function lum({ r, g, b }: Rgba): number {
  const ch = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** نسبة التباين بين لونين (1–21) — الشفافية ما تنحسب */
export function contrast(a: string, b: string): number {
  const pa = parseColor(a), pb = parseColor(b);
  if (!pa || !pb) return 21;
  const la = lum(pa), lb = lum(pb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function adaptColor(c: string, role: 'bg' | 'bd' | 'fg', dark: boolean): string {
  if (!dark) return c;
  const p = parseColor(c);
  if (!p) return c;
  let [h, s, l] = toHsl(p);
  // الرمادي والأبيض ياخذون الكحلي حق الثيم بدل الرمادي الباهت
  if (s < 0.12) { h = 218; s = 0.4; }
  if (role === 'fg') {
    if (l < 0.3 || (l <= 0.42 && s < 0.5)) return fromHsl(h, Math.min(s, 0.45), Math.min(0.95, 1 - l * 0.45), p.a);
    // مشبع وغامق: نفتّحه بنفس لونه لين يوصل تباين 4.5 على الكرت الداكن
    // (الزاهية l>0.42 مثل أزرق التطبيق #2f6bff تبقى زي ما هي — هويتها)
    if (l <= 0.42 && contrast(c, DARK_CARD) < MIN_CONTRAST) {
      const ss = Math.min(s, 0.9);
      for (let nl = l + 0.02; nl <= 0.92; nl += 0.02) {
        const out = fromHsl(h, ss, nl, p.a);
        if (contrast(out, DARK_CARD) >= MIN_CONTRAST) return out;
      }
      return fromHsl(h, ss, 0.92, p.a);
    }
    return c;
  }
  if (l >= 0.8 && p.a >= 0.5) {
    // أبيض ← #111f35 تقريباً (بطاقات الموقع)، والباستيل أفتح شوي بنفس لونه
    const nl = 0.14 + (1 - l) * 0.4 + (role === 'bd' ? 0.1 : 0);
    return fromHsl(h, Math.min(s, 0.42), nl, p.a);
  }
  return c;
}

/**
 * نص يخلط عربي ولاتيني ويبدأ بلاتيني («B3 + B1 + B20 + أي 5G»): النظام يحسبه سطر إنجليزي
 * ويقلب الجزء العربي («5 أيG»). علامة RLM في أوله تخليه سطر عربي — بدون ما يتغيّر النص.
 */
export function rtlLine(t: string): string {
  if (!t || t.charCodeAt(0) === 0x200f || !/[؀-ۿ]/.test(t)) return t;
  return '‏' + t;
}
