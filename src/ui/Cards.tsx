import { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, R, S, T } from './theme';
import { Icon, IconName } from './Icon';

/** البطاقة البطل — الحالة الرئيسية، بخلفية متدرجة خفيفة وبدون حد */
export function HeroCard({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <LinearGradient
      colors={[C.bgTop, C.blueSoft]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[s.hero, style]}
    >
      {children}
    </LinearGradient>
  );
}

/** بطاقة قياس — سطح هادئ بحد رفيع */
export function MetricCard({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.metric, style]}>{children}</View>;
}

/** عنوان قسم — نص صغير فوق المحتوى، مع رابط اختياري */
export function Section({
  title, icon, actionLabel, onAction, accessory, children,
}: {
  title: string; icon?: IconName; actionLabel?: string;
  onAction?: () => void; accessory?: ReactNode; children: ReactNode;
}) {
  return (
    <View style={{ gap: S.sm }}>
      <View style={s.secHead}>
        {!!icon && <Icon name={icon} size={14} color={C.sub} />}
        <Text style={s.secTitle}>{title}</Text>
        <View style={{ flex: 1 }} />
        {accessory}
        {!!actionLabel && (
          <Pressable onPress={onAction} hitSlop={8}>
            <Text style={s.secAction}>{actionLabel} ‹</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

/** زر إجراء بارز — ممتلئ أو ناعم */
export function ActionCard({
  icon, title, hint, tone = 'solid', onPress,
}: {
  icon: IconName; title: string; hint?: string;
  tone?: 'solid' | 'soft' | 'smart'; onPress: () => void;
}) {
  const solid = tone === 'solid';
  const smart = tone === 'smart';
  const bg = solid ? C.blue : smart ? C.violetSoft : C.blueSoft;
  const fg = solid ? C.onAccent : smart ? C.violet : C.blue;
  return (
    <Pressable style={[s.action, { backgroundColor: bg }]} onPress={onPress}>
      <Icon name={icon} size={16} color={fg} />
      <Text style={[s.actionTitle, { color: solid ? C.onAccent : C.text }]}>{title}</Text>
      {!!hint && <Text style={[s.actionHint, { color: solid ? C.onAccentSoft : C.muted }]}>{hint}</Text>}
    </Pressable>
  );
}

/** مربع أداة داخل شبكة ٣ أعمدة */
export function ToolTile({
  icon, title, sub, color: custom, tone = 'tool', wide, onPress,
}: {
  icon: IconName; title: string; sub?: string; color?: string;
  tone?: 'tool' | 'smart' | 'watch'; wide?: boolean; onPress: () => void;
}) {
  const color = custom ?? (tone === 'smart' ? C.violet : tone === 'watch' ? C.sub : C.blue);
  const soft = custom ? custom + '1F' : (tone === 'smart' ? C.violetSoft : tone === 'watch' ? C.rowBg : C.blueSoft);
  return (
    <Pressable
      hitSlop={4}
      style={({ pressed }) => [
        wide ? s.tileWide : s.tile,
        pressed && { opacity: 0.6, transform: [{ scale: 0.98 }] },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title} — ${sub}` : title}
    >
      <View style={[wide ? s.tileIconWide : s.tileIcon, { backgroundColor: soft }]}>
        <Icon name={icon} size={wide ? 20 : 17} color={color} />
      </View>
      <View style={wide ? { flex: 1, alignItems: 'flex-end' } : undefined}>
        <Text style={wide ? s.tileTitleWide : s.tileTitle}>{title}</Text>
        {!!sub && <Text style={wide ? s.tileSubWide : s.tileSub}>{sub}</Text>}
      </View>
    </Pressable>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={s.grid}>{children}</View>;
}

const s = StyleSheet.create({
  hero: { borderRadius: R.lg, padding: S.lg, gap: S.md },
  metric: {
    backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line,
    padding: S.md, gap: S.sm,
  },
  secHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  secTitle: { color: C.text, fontSize: T.label + 1, fontWeight: '800', textAlign: 'right' },
  secAction: { color: C.blue, fontSize: T.label, fontWeight: '700' },
  action: {
    borderRadius: R.md, paddingVertical: 11, paddingHorizontal: S.md,
    flexDirection: 'row-reverse', alignItems: 'center', gap: S.sm,
  },
  actionTitle: { flex: 1, fontSize: T.body + 0.5, fontWeight: '800', textAlign: 'right' },
  actionHint: { fontSize: T.label, fontWeight: '700' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: S.sm },
  tile: {
    flexBasis: '30%', flexGrow: 1, backgroundColor: C.card, borderRadius: R.md,
    borderWidth: 1, borderColor: C.line, paddingVertical: 11, paddingHorizontal: 7,
    alignItems: 'center', gap: 3,
  },
  tileIcon: { width: 32, height: 32, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  tileTitle: { color: C.text, fontWeight: '700', fontSize: 12.5, textAlign: 'center' },
  tileSub: { color: C.muted, fontSize: 10.5, textAlign: 'center' },
  tileWide: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: C.card, borderRadius: R.lg,
    borderWidth: 1, borderColor: C.line, padding: 13, gap: 10,
    flexDirection: 'row-reverse', alignItems: 'center',
    shadowColor: C.shadow, shadowOpacity: 0.05, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },
  tileIconWide: { width: 40, height: 40, borderRadius: R.md, alignItems: 'center', justifyContent: 'center' },
  tileTitleWide: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  tileSubWide: { color: C.muted, fontSize: 11, textAlign: 'right', marginTop: 2 },
});
