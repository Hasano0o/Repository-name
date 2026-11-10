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
import { AR, norm, makeTranslator } from './lookup';
import { C, isDark } from '../ui/theme';

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
/** لغة التواريخ والأوقات (toLocaleString): بالإنجليزي ميلادي بأرقام لاتينية */
export const LOCALE = EN_MODE ? 'en-US' : 'ar-SA';

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
// المنطق كله في lookup.ts (صافي، عليه اختبارات، والفاحص يستخدمه). هنا: اللغة + الذاكرة المؤقتة.
const T = makeTranslator(EN, EN_PATTERNS);
const CACHE = new Map<string, string>();

/** يترجم نص عربي للإنجليزي (لو اللغة إنجليزي). نص ما له ترجمة يرجع مثل ما هو. */
export function tr(s: string): string {
  if (!EN_MODE || typeof s !== 'string' || !AR.test(s)) return s;
  const c = CACHE.get(s);
  if (c !== undefined) return c;
  if (__DEV__ && (globalThis as any).__I18N_MISS && T.core(s) === null) (globalThis as any).__I18N_MISS.add(norm(s));
  const out = T.full(s);
  // النصوص المتغيّرة (أرقام تتحدث كل ثانية) ما تخلّي الذاكرة تكبر بلا حد
  if (CACHE.size > 4000) CACHE.clear();
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
  if (!EN_MODE && !isDark) return o;
  const out: any = {};
  for (const k of Object.keys(o)) {
    const v = EN_MODE ? flipObj((o as any)[k]) : (o as any)[k];
    out[k] = isDark ? darkEdge(v) : v;
  }
  return out;
}

/**
 * الوضع الداكن (٧ نوفمبر): البطاقات تاخذ حد خفيف + حافة علوية أفتح (لمعة بسيطة، بدون توهج —
 * ظل الأندرويد الملوّن ما ينرسم زين). من مكان واحد عشان كل الشاشات تتوحد.
 * البطاقة = زوايا ١٦ وأكثر (مو حبة/زر دائري) و:
 *  • حدها cardBorder ← نضيف الحافة العلوية
 *  • أو خلفيتها card (أو rowBg مع ظل) بدون أي حد ← نضيف الحد والحافة
 * أي شي فيه حد علوي خاص به ما نلمسه.
 */
export function darkEdge(st: any): any {
  if (!st || typeof st !== 'object' || Array.isArray(st)) return st;
  const r = st.borderRadius;
  if (typeof r !== 'number' || r < 16 || r >= 100) return st;
  if (st.borderTopColor !== undefined || st.borderTopWidth !== undefined) return st;
  if (st.fontSize !== undefined) return st; // نص (شارة/وسم) — مو بطاقة
  if (st.borderColor === C.cardBorder && (st.borderWidth ?? 0) >= 1) return { ...st, borderTopColor: C.cardEdge };
  const shadowed = !!st.elevation || !!st.shadowOpacity;
  if (st.borderWidth === undefined && st.borderColor === undefined
    && (st.backgroundColor === C.card || (st.backgroundColor === C.rowBg && shadowed))) {
    return { ...st, borderWidth: 1, borderColor: C.cardBorder, borderTopColor: C.cardEdge };
  }
  return st;
}

/**
 * لو الشاشة غيّرت لون حد البطاقة (أخضر/أحمر حسب الحالة) الحافة العلوية تاخذ نفس اللون —
 * عشان ما يطلع خط كحلي فوق إطار ملوّن. للمصفوفات بس (التغيير يجي دايماً [s.card, {...}]).
 */
export function edgeFix(style: any): any {
  if (!isDark || !Array.isArray(style)) return style;
  const f = StyleSheet.flatten(style) as any;
  if (!f || f.borderTopColor !== C.cardEdge || !f.borderColor || f.borderColor === C.cardBorder) return style;
  return [style, { borderTopColor: f.borderColor }];
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
