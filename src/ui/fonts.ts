import React from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';

export const FONT = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
};

const familyFor = (weight?: string | number): string => {
  const w = typeof weight === 'string' ? parseInt(weight, 10) : weight;
  if (weight === 'bold' || (w && w >= 700)) return FONT.bold;
  if (w && w >= 600) return FONT.semibold;
  if (w && w >= 500) return FONT.medium;
  return FONT.regular;
};

let applied = false;

/** يفرض الخط العربي على كل نص في التطبيق بدون تعديل كل شاشة */
export function applyGlobalFont() {
  if (applied) return;
  applied = true;
  for (const Comp of [Text, TextInput] as any[]) {
    const orig = Comp.render;
    if (typeof orig !== 'function') continue;
    Comp.render = function (...args: any[]) {
      const el = orig.apply(this, args);
      const flat = StyleSheet.flatten(el.props.style) || {};
      const family = familyFor((flat as any).fontWeight);
      return React.cloneElement(el, {
        style: [{ fontFamily: family }, el.props.style],
      });
    };
  }
}
