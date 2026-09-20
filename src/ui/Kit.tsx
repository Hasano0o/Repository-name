import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { C, R, S, T } from './theme';
import { Icon, IconName } from './Icon';

export type Tone = 'violet' | 'cyan' | 'mint' | 'green' | 'blue' | 'amber' | 'pink';

export const TONE: Record<Tone, { fg: string; bg: string }> = {
  violet: { fg: C.violet, bg: C.violetSoft },
  cyan:   { fg: C.cyan,   bg: C.cyanSoft },
  mint:   { fg: C.mint,   bg: C.mintSoft },
  green:  { fg: C.green,  bg: C.greenSoft },
  blue:   { fg: C.blueIcon, bg: C.blueSoft },
  amber:  { fg: C.amber,  bg: C.amberSoft },
  pink:   { fg: C.pink,   bg: C.pinkSoft },
};

/** رقم + وحدته باتجاه LTR — يمنع انقلاب الإشارة السالبة */
export function Num({ value, unit, color = C.text, size = T.metric ?? 22 }:
  { value: string | number; unit?: string; color?: string; size?: number }) {
  return (
    <View style={st.num}>
      <Text style={{ color, fontSize: size, fontWeight: '700' }}>{String(value)}</Text>
      {!!unit && <Text style={{ color: C.sub, fontSize: T.label, marginLeft: S.xs }}>{unit}</Text>}
    </View>
  );
}

export function StatusPill({ tone, text }: { tone: 'ok' | 'warn' | 'err' | 'idle'; text: string }) {
  const map = {
    ok:   { bg: C.greenSoft, dot: C.green },
    warn: { bg: C.goldSoft,  dot: C.amber },
    err:  { bg: C.redSoft,   dot: C.red },
    idle: { bg: C.rowBg,     dot: C.sub },
  }[tone];
  return (
    <View style={[st.pill, { backgroundColor: map.bg }]}>
      <View style={[st.dot, { backgroundColor: map.dot }]} />
      <Text style={st.pillTxt}>{text}</Text>
    </View>
  );
}

export function Card({ title, icon, tone = 'blue', children, style }:
  { title?: string; icon?: IconName; tone?: Tone; children?: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[st.card, style]}>
      {!!title && (
        <View style={st.cardHead}>
          {!!icon && <Icon name={icon} size={18} color={TONE[tone].fg} />}
          <Text style={st.cardTitle}>{title}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

export function IconTile({ icon, tone, title, desc, onPress, style }:
  { icon: IconName; tone: Tone; title: string; desc?: string; onPress?: () => void; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.tile, style, pressed && { opacity: 0.7 }]}>
      <View style={[st.circle, { backgroundColor: TONE[tone].bg }]}>
        <Icon name={icon} size={22} color={TONE[tone].fg} />
      </View>
      <Text style={st.tileTitle} numberOfLines={1}>{title}</Text>
      {!!desc && <Text style={st.tileDesc} numberOfLines={2}>{desc}</Text>}
    </Pressable>
  );
}

export function MetricTile({ label, value, unit, icon, tone = 'blue', state }:
  { label: string; value: string | number; unit?: string; icon?: IconName; tone?: Tone;
    state?: 'warn' | 'err' }) {
  const color = state === 'err' ? C.red : state === 'warn' ? C.amber : C.text;
  return (
    <View style={st.metric}>
      <View style={st.metricHead}>
        <Text style={st.metricLabel} numberOfLines={1}>{label}</Text>
        {!!icon && <Icon name={icon} size={16} color={TONE[tone].fg} />}
      </View>
      <Num value={value} unit={unit} color={color} />
    </View>
  );
}

export function Banner({ tone = 'warn', title, text, cta, onPress }:
  { tone?: 'warn' | 'err'; title: string; text: string; cta?: string; onPress?: () => void }) {
  const bg = tone === 'err' ? C.redSoft : C.goldSoft;
  const fg = tone === 'err' ? C.red : C.amber;
  return (
    <View style={[st.banner, { backgroundColor: bg }]}>
      <View style={st.bannerHead}>
        <Icon name="bulb" size={16} color={fg} />
        <Text style={[st.bannerTitle, { color: fg }]}>{title}</Text>
      </View>
      <Text style={st.bannerTxt}>{text}</Text>
      {!!cta && (
        <Pressable onPress={onPress} style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]}>
          <Text style={st.ctaTxt}>{cta}</Text>
          <Icon name="chevron" size={16} color={C.onAccent} />
        </Pressable>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  num: { flexDirection: 'row', alignItems: 'baseline' },
  pill: { height: 34, paddingHorizontal: S.md, borderRadius: R.pill,
          flexDirection: 'row', alignItems: 'center', gap: S.xs, alignSelf: 'flex-start' },
  pillTxt: { color: C.text, fontSize: T.label, fontWeight: '600' },
  dot: { width: 9, height: 9, borderRadius: R.pill },

  card: { backgroundColor: C.rowBg, borderRadius: R.lg, padding: S.lg, marginBottom: S.md,
          shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 18,
          shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: S.xs, marginBottom: S.md },
  cardTitle: { color: C.text, fontSize: T.h2, fontWeight: '700' },

  tile: { flex: 1, backgroundColor: C.card, borderRadius: R.md, paddingVertical: S.md,
          paddingHorizontal: S.sm, alignItems: 'center', minWidth: 0,
          shadowColor: C.shadow, shadowOpacity: 0.05, shadowRadius: 12,
          shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  circle: { width: 48, height: 48, borderRadius: R.pill, alignItems: 'center',
            justifyContent: 'center', marginBottom: S.sm },
  tileTitle: { color: C.text, fontSize: T.label, fontWeight: '700', textAlign: 'center' },
  tileDesc: { color: C.sub, fontSize: T.tiny, textAlign: 'center', marginTop: 2 },

  metric: { backgroundColor: C.rowBg, borderRadius: R.sm, padding: S.md, minWidth: 0 },
  metricHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  metricLabel: { color: C.sub, fontSize: T.tiny, flexShrink: 1 },

  banner: { borderRadius: R.lg, padding: S.lg, marginBottom: S.md },
  bannerHead: { flexDirection: 'row', alignItems: 'center', gap: S.xs },
  bannerTitle: { fontSize: T.label, fontWeight: '700' },
  bannerTxt: { color: C.text, fontSize: T.body, marginTop: S.sm, marginBottom: S.md, lineHeight: 20 },
  cta: { height: 40, paddingHorizontal: S.lg, borderRadius: R.pill, backgroundColor: C.blue,
         flexDirection: 'row', alignItems: 'center', gap: S.sm, alignSelf: 'flex-start' },
  ctaTxt: { color: C.onAccent, fontSize: T.label, fontWeight: '700' },
});
