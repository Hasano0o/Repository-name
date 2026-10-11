/**
 * بدائل View/Text/TextInput/Pressable/ScrollView:
 * بالعربي تمرّر كل شي مثل ما هو، وبالإنجليزي تترجم النص وتقلب الاتجاه (row-reverse ← row، يمين ← يسار).
 * كل ملفات التطبيق تستوردها من هنا بدل react-native.
 */
import { Children } from 'react';
import {
  View as RNView, Text as RNText, TextInput as RNTextInput, Pressable as RNPressable, ScrollView as RNScrollView,
} from 'react-native';
import { EN_MODE, fx, tr } from './index';

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

function TextW(p: any) {
  return <RNText {...p} style={fx(p.style)}>{trChildren(p.children)}</RNText>;
}
function ViewW(p: any) {
  return <RNView {...p} style={fx(p.style)} />;
}
function TextInputW(p: any) {
  return <RNTextInput {...p} style={fx(p.style)} placeholder={typeof p.placeholder === 'string' ? tr(p.placeholder) : p.placeholder} />;
}
function PressableW(p: any) {
  const st = p.style;
  const style = typeof st === 'function' ? (s: any) => fx(st(s)) : fx(st);
  const a11y = typeof p.accessibilityLabel === 'string' ? tr(p.accessibilityLabel) : p.accessibilityLabel;
  return <RNPressable {...p} style={style} accessibilityLabel={a11y} />;
}
function ScrollViewW(p: any) {
  return <RNScrollView {...p} style={fx(p.style)} contentContainerStyle={fx(p.contentContainerStyle)} />;
}

export const Text = (EN_MODE ? TextW : RNText) as unknown as typeof RNText;
export const View = (EN_MODE ? ViewW : RNView) as unknown as typeof RNView;
export const TextInput = (EN_MODE ? TextInputW : RNTextInput) as unknown as typeof RNTextInput;
export const Pressable = (EN_MODE ? PressableW : RNPressable) as unknown as typeof RNPressable;
export const ScrollView = (EN_MODE ? ScrollViewW : RNScrollView) as unknown as typeof RNScrollView;
// أنواع (useRef<View> وغيره)
export type Text = RNText;
export type View = RNView;
export type TextInput = RNTextInput;
export type ScrollView = RNScrollView;
