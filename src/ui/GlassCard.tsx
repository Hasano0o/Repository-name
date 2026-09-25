import { ReactNode, useState } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { C } from './theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try { UIManager.setLayoutAnimationEnabledExperimental(true); } catch {}
}

export function GlassCard({
  title, subtitle, icon, tint, children, collapsible = true, defaultOpen = true, accessory,
}: {
  title?: string;
  subtitle?: string;
  icon?: string;
  tint?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  accessory?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(o => !o);
  };

  return (
    <View style={s.card}>
      {!!title && (
        <View style={s.head}>
          <View style={s.headLeft}>
            {accessory}
            {collapsible && (
              <Pressable style={s.chevBtn} onPress={toggle} hitSlop={8}>
                <Text style={s.chev}>{open ? '▲' : '▼'}</Text>
              </Pressable>
            )}
          </View>
          <Pressable style={s.headRight} onPress={collapsible ? toggle : undefined} disabled={!collapsible}>
            <View style={{ flexShrink: 1 }}>
              <Text style={s.title}>{title}</Text>
              {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
            </View>
            {!!icon && (
              <View style={[s.iconBox, !!tint && { backgroundColor: tint }]}>
                <Text style={s.icon}>{icon}</Text>
              </View>
            )}
          </Pressable>
        </View>
      )}
      {open && <View style={[s.body, !!title && s.bodyDivided]}>{children}</View>}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderColor: C.cardBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
    shadowColor: C.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  chevBtn: {
    width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: C.cardBorder,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.rowBg,
  },
  chev: { color: C.sub, fontSize: 12 },
  title: { color: C.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  subtitle: { color: C.muted, fontSize: 11.5, fontWeight: '600', textAlign: 'right', marginTop: 2 },
  iconBox: {
    width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.blueSoft, borderWidth: 1, borderColor: C.cardBorder,
  },
  icon: { fontSize: 16 },
  body: { marginTop: 12, gap: 10 },
  bodyDivided: { borderTopWidth: 1, borderTopColor: C.cardBorder, paddingTop: 14 },
});
