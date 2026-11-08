/**
 * بدائل View/Text/TextInput/Pressable/ScrollView:
 * بالعربي تمرّر كل شي مثل ما هو، وبالإنجليزي تترجم النص وتقلب الاتجاه (row-reverse ← row، يمين ← يسار).
 * كل ملفات التطبيق تستوردها من هنا بدل react-native.
 */
import { Children, createContext, useContext } from 'react';
import {
  View as RNView, Text as RNText, TextInput as RNTextInput, Pressable as RNPressable, ScrollView as RNScrollView, StyleSheet,
} from 'react-native';
import { familyFor, OUR_FONTS } from '../ui/fonts';
import { EN_MODE, fx, tr, edgeFix } from './index';
import { isDark } from '../ui/theme';

const AR = /[؀-ۿ]/;

function trChildren(children: any): any {
  if (typeof children === 'string') return tr(children);
  if (!Array.isArray(children)) return children;
  // كل الأجزاء نصوص/أرقام ← نترجمها كجملة وحدة (عشان «{n} قنوات» تنترجم صح)
  if (children.every(c => typeof c === 'string' || typeof c === 'number' || c == null || c === false)) {
    const joined = children.filter(c => c != null && c !== false).join('');
    if (!AR.test(joined)) return children;
    const t = tr(joined);
    if (t !== joined) return t;
  }
  return Children.map(children, c => (typeof c === 'string' ? tr(c) : c)) ?? children;
}

/**
 * الخط (٩ نوفمبر — «الآيفون خطه غير»): applyGlobalFont كان يرقّع Text.render، وText في RN 0.86 دالة بدون render
 * ← ما كان يشتغل، وكل نص بدون fontFamily يطلع بخط النظام (SF بالآيفون، غيره بالأندرويد).
 * الحين: الوزن ← وجه IBM Plex المناسب، وfontWeight = normal مع خطوطنا (الآيفون مع وزن ثقيل يرجع لخط النظام).
 * النص المتداخل بدون وزن ولا خط يورث من أبوه (ما نحط له regular فوق bold الأب).
 */
const InText = createContext(false);
export function fontStyle(style: any, nested: boolean): any {
  const f: any = StyleSheet.flatten(style) || {};
  if (f.fontFamily) return OUR_FONTS.has(f.fontFamily) && f.fontWeight != null && f.fontWeight !== 'normal' ? [style, { fontWeight: 'normal' }] : style;
  if (nested && f.fontWeight == null) return style;
  return [style, { fontFamily: familyFor(f.fontWeight), fontWeight: 'normal' }];
}

function TextW(p: any) {
  const nested = useContext(InText);
  const el = (
    <RNText {...p} style={fontStyle(EN_MODE ? fx(p.style) : p.style, nested)}>
      {EN_MODE ? trChildren(p.children) : p.children}
    </RNText>
  );
  return nested ? el : <InText.Provider value>{el}</InText.Provider>;
}
function ViewW(p: any) {
  return <RNView {...p} style={edgeFix(EN_MODE ? fx(p.style) : p.style)} />;
}
function TextInputW(p: any) {
  return <RNTextInput {...p} style={fontStyle(EN_MODE ? fx(p.style) : p.style, false)}
    placeholder={EN_MODE && typeof p.placeholder === 'string' ? tr(p.placeholder) : p.placeholder} />;
}
function PressableW(p: any) {
  const st = p.style;
  const f = (x: any) => edgeFix(EN_MODE ? fx(x) : x);
  const style = typeof st === 'function' ? (s: any) => f(st(s)) : f(st);
  const a11y = EN_MODE && typeof p.accessibilityLabel === 'string' ? tr(p.accessibilityLabel) : p.accessibilityLabel;
  return <RNPressable {...p} style={style} accessibilityLabel={a11y} />;
}
function ScrollViewW(p: any) {
  return <RNScrollView {...p} style={fx(p.style)} contentContainerStyle={fx(p.contentContainerStyle)} />;
}

export const Text = TextW as unknown as typeof RNText;
export const View = (EN_MODE || isDark ? ViewW : RNView) as unknown as typeof RNView;
export const TextInput = TextInputW as unknown as typeof RNTextInput;
export const Pressable = (EN_MODE || isDark ? PressableW : RNPressable) as unknown as typeof RNPressable;
export const ScrollView = (EN_MODE ? ScrollViewW : RNScrollView) as unknown as typeof RNScrollView;
// أنواع (useRef<View> وغيره)
export type Text = RNText;
export type View = RNView;
export type TextInput = RNTextInput;
export type ScrollView = RNScrollView;
