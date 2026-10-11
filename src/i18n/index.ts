/**
 * اللغة (عربي / English)
 * ─────────────────────────────────────────────
 * • اللغة تنقرى بشكل متزامن وقت الإقلاع (مثل الثيم)، وتغييرها يعيد تشغيل التطبيق.
 * • الترجمة مركزية: النصوص العربية تبقى في الكود مثل ما هي، والقاموس (en.ts) يعطي مقابلها.
 *   مكوّنات Text/View في src/i18n/rn.tsx تترجم النص وتقلب الاتجاه تلقائياً بالإنجليزي.
 * • نص ما له ترجمة يطلع عربي — فالترجمة تمشي على مراحل بدون ما يخرب شي.
 */
import { Alert, Platform, StyleSheet } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Updates from 'expo-updates';
import { EN, EN_PATTERNS } from './en';

export type Lang = 'ar' | 'en';
const PREF_FILE = 'bandly-lang.txt';
const WEB_KEY = 'bandly.lang';

function readLang(): Lang | null {
  try {
    if (Platform.OS === 'web') {
      const v = globalThis.localStorage?.getItem(WEB_KEY);
      return v === 'en' || v === 'ar' ? v : null;
    }
    const f = new File(Paths.document, PREF_FILE);
    if (!f.exists) return null;
    const v = f.textSync().trim();
    return v === 'en' || v === 'ar' ? v : null;
  } catch {
    return null;
  }
}

/** اللي اختاره المستخدم (null = ما اختار للحين) */
export const LANG_PICKED: Lang | null = readLang();
export const LANG: Lang = LANG_PICKED ?? 'ar';
export const EN_MODE = LANG === 'en';

/** لغة الجوال عربية؟ (نستخدمها نسأل غير العرب مرة وحدة) */
export function deviceIsArabic(): boolean {
  try {
    const nav: any = (globalThis as any).navigator;
    const loc = (Platform.OS === 'web' && nav?.language) || Intl.DateTimeFormat().resolvedOptions().locale || '';
    return /^ar\b|^ar-/i.test(loc) || loc === 'ar';
  } catch {
    return true;
  }
}

/** يحفظ اللغة ويعيد تشغيل التطبيق */
export async function setLang(l: Lang, reload = true): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(WEB_KEY, l);
    else {
      const f = new File(Paths.document, PREF_FILE);
      if (!f.exists) f.create();
      f.write(l);
    }
  } catch {}
  if (!reload || l === LANG) return;
  if (Platform.OS === 'web') { try { (globalThis as any).location?.reload(); } catch {} return; }
  try { await Updates.reloadAsync(); } catch {}
}

// ═══ الترجمة ═══
const AR = /[؀-ۿ]/;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const toLatinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.').replace(/٪/g, '%').replace(/،/g, ',').replace(/؟/g, '?').replace(/؛/g, ';');

const DICT = new Map<string, string>();
for (const k of Object.keys(EN)) DICT.set(norm(k), EN[k]);

interface Pat { re: RegExp; out: string }
let PATS: Pat[] | null = null;
function pats(): Pat[] {
  if (PATS) return PATS;
  const list = Object.keys(EN_PATTERNS).sort((a, b) => b.length - a.length);
  PATS = list.map(k => {
    const src = norm(k)
      .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
      .replace(/\{(\d)\}/g, '\u0000$1\u0001')
      .replace(/[{}]/g, '\\$&')
      .replace(/\u0000(\d)\u0001/g, '(?<g$1>.+?)');
    return { re: new RegExp('^' + src + '$'), out: EN_PATTERNS[k] };
  });
  return PATS;
}

const CACHE = new Map<string, string>();

function lookup(s: string): string | null {
  const k = norm(s);
  if (!k) return s;
  const hit = DICT.get(k);
  if (hit !== undefined) return hit;
  for (const p of pats()) {
    const m = p.re.exec(k);
    if (m) {
      return p.out.replace(/\{(\d)\}/g, (_, i) => {
        const g = m.groups?.['g' + i] ?? '';
        return AR.test(g) ? tr(g) : g;
      });
    }
  }
  return null;
}

/** يترجم نص عربي للإنجليزي (لو اللغة إنجليزي). نص ما له ترجمة يرجع مثل ما هو. */
export function tr(s: string): string {
  if (!EN_MODE || typeof s !== 'string' || !AR.test(s)) return s;
  const c = CACHE.get(s);
  if (c !== undefined) return c;
  const lead = s.match(/^\s*/)?.[0] ?? '';
  const trail = s.match(/\s*$/)?.[0] ?? '';
  let out: string | null = null;
  // «STC · وضع تجريبي»: أجزاء مفصولة بنقطة — نترجم كل جزء لو كلها معروفة
  if (s.includes(' · ')) {
    const parts = s.split(' · ').map(p => (AR.test(p) ? lookup(p) : p));
    if (parts.every(p => p !== null)) out = parts.join(' · ');
  }
  if (out === null) out = lookup(s);
  if (out === null && s.includes('\n')) {
    // نص طويل بأكثر من سطر: نترجم كل سطر لحاله
    out = s.split('\n').map(line => (AR.test(line) ? lookup(line) ?? line : line)).join('\n');
  }
  if (out === null) {
    // جمل مفصولة بـ « — » أو « · »: نترجم كل جزء
    for (const sep of [' — ', ' · ', ' • ']) {
      if (s.includes(sep)) {
        const parts = s.split(sep).map(p => (AR.test(p) ? lookup(p) : p));
        if (parts.some(p => p !== null)) {
          out = parts.map((p, i) => p ?? s.split(sep)[i]).join(sep);
          break;
        }
      }
    }
  }
  if (out === null) {
    if (__DEV__ && (globalThis as any).__I18N_MISS) (globalThis as any).__I18N_MISS.add(norm(s));
    out = s;
  } else out = lead + out.trim() + trail;
  out = toLatinDigits(out);
  CACHE.set(s, out);
  return out;
}

/** يختار نص حسب اللغة مباشرة (للنصوص اللي تتركّب بالكود) */
export const L = (ar: string, en: string) => (EN_MODE ? en : ar);

// ═══ قلب الاتجاه ═══
const SWAP_KEYS: Record<string, string> = {
  marginLeft: 'marginRight', marginRight: 'marginLeft',
  paddingLeft: 'paddingRight', paddingRight: 'paddingLeft',
  marginStart: 'marginEnd', marginEnd: 'marginStart',
  paddingStart: 'paddingEnd', paddingEnd: 'paddingStart',
  left: 'right', right: 'left', start: 'end', end: 'start',
  borderLeftWidth: 'borderRightWidth', borderRightWidth: 'borderLeftWidth',
  borderLeftColor: 'borderRightColor', borderRightColor: 'borderLeftColor',
  borderTopLeftRadius: 'borderTopRightRadius', borderTopRightRadius: 'borderTopLeftRadius',
  borderBottomLeftRadius: 'borderBottomRightRadius', borderBottomRightRadius: 'borderBottomLeftRadius',
  borderTopStartRadius: 'borderTopEndRadius', borderTopEndRadius: 'borderTopStartRadius',
  borderBottomStartRadius: 'borderBottomEndRadius', borderBottomEndRadius: 'borderBottomStartRadius',
};
const FLEX_SWAP: Record<string, string> = { 'flex-start': 'flex-end', 'flex-end': 'flex-start' };

/** أنماط انقلبت خلاص (ما نقلبها مرة ثانية) */
const DONE = new WeakSet<object>();
const FLIPPED = new WeakMap<object, object>();

function flipObj(o: any): any {
  if (!o || typeof o !== 'object' || DONE.has(o)) return o;
  const cached = FLIPPED.get(o);
  if (cached) return cached;
  const out: any = {};
  let changed = false;
  const dir = o.flexDirection;
  const isRow = dir === 'row' || dir === 'row-reverse';
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (k === 'flexDirection') {
      out[k] = v === 'row-reverse' ? 'row' : v === 'row' ? 'row-reverse' : v;
      changed = changed || out[k] !== v;
    } else if (k === 'textAlign') {
      // «left» بالعربي كان للأرقام والعناوين (LTR) — يبقى يسار
      out[k] = v === 'right' ? 'left' : v;
      changed = changed || out[k] !== v;
    } else if ((k === 'alignItems' && !isRow) || k === 'alignSelf') {
      // المحور الأفقي في الأعمدة: يمين ↔ يسار
      out[k] = FLEX_SWAP[v] ?? v;
      changed = changed || out[k] !== v;
    } else if (k === 'writingDirection') {
      out[k] = v === 'rtl' ? 'ltr' : v;
      changed = changed || out[k] !== v;
    } else if (k === 'transform' && Array.isArray(v)) {
      const t = v.map((x: any) => (x && typeof x.scaleX === 'number' && x.scaleX < 0 ? { scaleX: -x.scaleX } : x));
      out[k] = t;
      changed = changed || t.some((x: any, i: number) => x !== v[i]);
    } else if (SWAP_KEYS[k]) {
      out[SWAP_KEYS[k]] = v;
      changed = changed || o[SWAP_KEYS[k]] !== v;
    } else {
      out[k] = v;
    }
  }
  const res = changed ? out : o;
  DONE.add(res);
  FLIPPED.set(o, res);
  return res;
}

/** يقلب ستايل (كائن أو مصفوفة) — بالعربي يرجعه مثل ما هو */
export function fx<T>(style: T): T {
  if (!EN_MODE || !style) return style;
  if (Array.isArray(style)) return style.map(x => fx(x)) as any;
  if (typeof style === 'object') return flipObj(style);
  return style; // رقم (StyleSheet قديم) أو false
}

/** بديل StyleSheet.create: بالإنجليزي يقلب الاتجاه مرة وحدة وقت الإنشاء */
export function sheet<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(o: T & StyleSheet.NamedStyles<any>): T {
  if (!EN_MODE) return o;
  const out: any = {};
  for (const k of Object.keys(o)) out[k] = flipObj((o as any)[k]);
  return out;
}

// ═══ نوافذ التنبيه ═══
let alertPatched = false;
/** يترجم Alert.alert (العنوان والرسالة والأزرار). ينادى بعد تركيب نسخة الويندوز */
export function patchAlert() {
  if (alertPatched || !EN_MODE) return;
  alertPatched = true;
  const orig = Alert.alert.bind(Alert);
  (Alert as any).alert = (title: string, message?: string, buttons?: any[], opts?: any) =>
    orig(tr(title ?? ''), message ? tr(message) : message, buttons?.map(b => (b?.text ? { ...b, text: tr(b.text) } : b)), opts);
}
