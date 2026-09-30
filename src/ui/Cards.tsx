import { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, R, S, T, tBd, tBg, tFg } from './theme';
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
/** يغمّق اللون شوي للتدرّج */
export function shade(hex: string, amt = 0.22): string {
  const n = hex.replace('#', '');
  const f = (i: number) => Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - amt)).toString(16).padStart(2, '0');
  return '#' + f(0) + f(2) + f(4);
}

/**
 * بلاطة أداة ملوّنة:
 * wide = تدرّج بلون الأداة ونص أبيض (أدوات التحسين الرئيسية)
 * عادي = خلفية فاتحة من لون الأداة وأيقونة بدائرة ملوّنة
 */
export function ToolTile({
  icon, title, sub, color: custom, tone = 'tool', wide, onPress,
}: {
  icon: IconName; title: string; sub?: string; color?: string;
  tone?: 'tool' | 'smart' | 'watch'; wide?: boolean; onPress: () => void;
}) {
  const color = custom ?? (tone === 'smart' ? C.violet : tone === 'watch' ? '#64748b' : C.blue);
  return (
    <Pressable
      hitSlop={4}
      style={({ pressed }) => [
        wide ? s.tileWide : s.tile,
        { shadowColor: color },
        pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title} — ${sub}` : title}
    >
      {wide ? (
        <LinearGradient colors={[color, shade(color)]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.tileWideIn}>
          <View style={s.tileIconWide}>
            <Icon name={icon} size={21} color={tFg('#fff')} />
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={s.tileTitleWide}>{title}</Text>
            {!!sub && <Text style={s.tileSubWide} numberOfLines={1}>{sub}</Text>}
          </View>
        </LinearGradient>
      ) : (
        <LinearGradient
          colors={[color + '24', color + '0A']}
          start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
          style={[s.tileIn, { borderColor: color + '33' }]}
        >
          <View style={[s.tileIcon, { backgroundColor: color }]}>
            <Icon name={icon} size={17} color={tFg('#fff')} />
          </View>
          <Text style={s.tileTitle}>{title}</Text>
          {!!sub && <Text style={[s.tileSub, { color: shade(color, 0.1) }]} numberOfLines={1}>{sub}</Text>}
        </LinearGradient>
      )}
    </Pressable>
  );
}

/** عنوان قسم بشريط لون صغير */
export function GroupTitle({ title, color = C.blue }: { title: string; color?: string }) {
  return (
    <View style={s.gHead}>
      <View style={[s.gBar, { backgroundColor: color }]} />
      <Text style={s.gTitle}>{title}</Text>
    </View>
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
    flexBasis: '30%', flexGrow: 1, borderRadius: R.md, backgroundColor: C.card,
    shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  tileIn: {
    borderRadius: R.md, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 6,
    alignItems: 'center', gap: 3, flex: 1,
  },
  tileIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  tileTitle: { color: C.text, fontWeight: '800', fontSize: 12.5, textAlign: 'center' },
  tileSub: { fontSize: 10.5, fontWeight: '600', textAlign: 'center' },
  tileWide: {
    flexBasis: '47%', flexGrow: 1, borderRadius: R.lg,
    shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  tileWideIn: { borderRadius: R.lg, padding: 13, gap: 10, flexDirection: 'row-reverse', alignItems: 'center', flex: 1 },
  tileIconWide: {
    width: 40, height: 40, borderRadius: R.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: tBg('rgba(255,255,255,0.22)'), borderWidth: 1, borderColor: tBd('rgba(255,255,255,0.35)'),
  },
  tileTitleWide: { color: tFg('#fff'), fontWeight: '800', fontSize: 14.5, textAlign: 'right' },
  tileSubWide: { color: tFg('rgba(255,255,255,0.85)'), fontSize: 11, fontWeight: '600', textAlign: 'right', marginTop: 2 },
  gHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: -2, paddingHorizontal: 4 },
  gBar: { width: 4, height: 16, borderRadius: 2 },
  gTitle: { color: C.text, fontSize: 14.5, fontWeight: '800', textAlign: 'right' },
});
