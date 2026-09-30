/**
 * مكوّنات الواجهة الموحّدة (تصميم ٢) — تُستخدم في الرئيسية والتفاصيل ومساعد التوجيه.
 * التخطيط: row-reverse للعربي، والأرقام دايماً LTR عشان الإشارة السالبة ما تنقلب.
 */
import { ReactNode, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { Icon, IconName } from './Icon';
import { Level, LEVEL_COLOR, LEVEL_LABEL, LEVEL_SOFT } from '../utils/signal';
import { C, isDark, tBd, tBg, tFg } from './theme';

// ═══ الألوان ═══
const P_LIGHT = {
  bg: '#e5eaf2',
  card: '#f3f6fa',
  border: '#d8e0eb',
  soft: '#e9eef5',
  text: '#0f1f45',
  sub: '#6b7796',
  faint: '#a3adc6',
  blue: '#2f6bff',
  blueSoft: '#e8efff',
  violet: '#7050f0',
  violetSoft: '#efeaff',
  green: '#12b76a',
  greenSoft: '#e7f8ef',
  amber: '#f59e0b',
  amberSoft: '#fff5e3',
  red: '#e5484d',
  redSoft: '#ffeef0',
  cyan: '#0ea5c6',
  cyanSoft: '#e3f7fc',
  heroA: '#2f6bff',
  heroB: '#6a45ec',
};

const P_DARK: typeof P_LIGHT = {
  bg: C.bg,
  card: C.card,
  border: C.cardBorder,
  soft: C.rowBg,
  text: C.text,
  sub: C.sub,
  faint: '#5f6b88',
  blue: '#4d82ff',
  blueSoft: '#1c2c4d',
  violet: '#9a7cf5',
  violetSoft: '#27204a',
  green: '#2fcf85',
  greenSoft: '#14322a',
  amber: '#f7b23b',
  amberSoft: '#352a15',
  red: '#ff6b6f',
  redSoft: '#3a1c22',
  cyan: '#3cc3e0',
  cyanSoft: '#12303a',
  heroA: '#2f5fe0',
  heroB: '#5b3cc9',
};

export const P = isDark ? P_DARK : P_LIGHT;

export const shadow: ViewStyle = {
  shadowColor: '#1b2b5c',
  shadowOpacity: 0.07,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
};

export const lvlColor = (l: Level) => LEVEL_COLOR[l];
export const lvlSoft = (l: Level) => LEVEL_SOFT[l];
export const lvlLabel = (l: Level) => LEVEL_LABEL[l];

// ═══ بطاقة الترويسة المتدرجة ═══
export function Hero({ children, colors = [P.heroA, P.heroB], style }: {
  children: ReactNode; colors?: [string, string]; style?: ViewStyle;
}) {
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 1, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[st.hero, style]}
    >
      {/* دوائر زخرفية خفيفة */}
      <View pointerEvents="none" style={[st.blob, { top: -60, left: -40, width: 170, height: 170 }]} />
      <View pointerEvents="none" style={[st.blob, { bottom: -70, right: -30, width: 150, height: 150, opacity: 0.07 }]} />
      {children}
    </LinearGradient>
  );
}

// ═══ زر أيقونة زجاجي (فوق التدرج) ═══
export function GlassBtn({ icon, onPress, busy, label }: {
  icon?: IconName; onPress?: () => void; busy?: boolean; label?: string;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8}
      style={({ pressed }) => [st.glass, !!label && { paddingHorizontal: 14, width: undefined }, pressed && { opacity: 0.7 }]}>
      {busy ? <ActivityIndicator size="small" color={tFg('#fff')} /> : (
        <>
          {!!label && <Text style={st.glassTxt}>{label}</Text>}
          {!!icon && <Icon name={icon} size={18} color={tFg('#fff')} stroke={2.1} />}
        </>
      )}
    </Pressable>
  );
}

// ═══ بطاقة قسم ═══
export function Section({ title, sub, icon, tone = P.blue, toneSoft = P.blueSoft, right, children, style }: {
  title: string; sub?: string; icon: IconName; tone?: string; toneSoft?: string;
  right?: ReactNode; children?: ReactNode; style?: ViewStyle;
}) {
  return (
    <View style={[st.section, style]}>
      <View style={st.secHead}>
        <View style={[st.secIcon, { backgroundColor: toneSoft }]}>
          <Icon name={icon} size={17} color={tone} stroke={2.1} />
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={st.secTitle}>{title}</Text>
          {!!sub && <Text style={st.secSub}>{sub}</Text>}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

// ═══ رقم + وحدة (LTR) ═══
export function Val({ v, unit, size = 20, color = P.text, unitColor = P.sub }: {
  v?: string | number; unit?: string; size?: number; color?: string; unitColor?: string;
}) {
  const empty = v === undefined || v === null || v === '';
  return (
    <View style={st.val}>
      <Text style={{ color: empty ? P.faint : color, fontSize: size, fontWeight: '800', letterSpacing: -0.5 }}>
        {empty ? '—' : String(v)}
      </Text>
      {!empty && !!unit && (
        <Text style={{ color: unitColor, fontSize: Math.max(10, size * 0.48), fontWeight: '700', marginLeft: 3 }}>{unit}</Text>
      )}
    </View>
  );
}

// ═══ شريط جودة (٠–١) ═══
export function QBar({ ratio, color, track = '#e9eef8', h = 6 }: {
  ratio: number; color: string; track?: string; h?: number;
}) {
  const r = Math.max(0, Math.min(1, ratio));
  return (
    <View style={{ height: h, borderRadius: h, backgroundColor: track, overflow: 'hidden', flexDirection: 'row' }}>
      <View style={{ width: `${Math.max(4, r * 100)}%`, backgroundColor: color, borderRadius: h }} />
    </View>
  );
}

/** نطاقات القياس للشريط */
export const RANGE = {
  rsrp: [-120, -70] as const,
  sinr: [-5, 25] as const,
  rsrq: [-20, -5] as const,
  rssi: [-100, -50] as const,
};
export const ratioOf = (v: number | undefined, [lo, hi]: readonly [number, number]) =>
  v === undefined ? 0 : (v - lo) / (hi - lo);

// ═══ مربع قياس بشريط جودة ═══
export function MeterTile({ label, value, unit, level, ratio }: {
  label: string; value?: number; unit: string; level: Level; ratio: number;
}) {
  const col = lvlColor(level);
  return (
    <View style={st.meter}>
      <View style={st.meterHead}>
        <View style={[st.lvlPill, { backgroundColor: lvlSoft(level) }]}>
          <Text style={[st.lvlPillTxt, { color: col }]}>{lvlLabel(level)}</Text>
        </View>
        <Text style={st.meterLbl} numberOfLines={1}>{label}</Text>
      </View>
      <Val v={value} unit={unit} size={22} />
      <QBar ratio={ratio} color={col} />
    </View>
  );
}

// ═══ خانة معلومة صغيرة ═══
export function InfoCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={st.info}>
      <Text style={st.infoLbl} numberOfLines={1}>{label}</Text>
      <Text style={[st.infoVal, !!accent && { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

// ═══ شبكة عمودين ═══
export function Grid({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  return <View style={[st.grid, { gap }]}>{children}</View>;
}
export function Cell({ children, full }: { children: ReactNode; full?: boolean }) {
  return <View style={full ? { width: '100%' } : st.half}>{children}</View>;
}

// ═══ شارة ═══
export function Chip({ text, color = P.blue, bg = P.blueSoft, icon }: {
  text: string; color?: string; bg?: string; icon?: IconName;
}) {
  return (
    <View style={[st.chip, { backgroundColor: bg }]}>
      <Text style={[st.chipTxt, { color }]} numberOfLines={1}>{text}</Text>
      {!!icon && <Icon name={icon} size={12} color={color} stroke={2.2} />}
    </View>
  );
}

// ═══ عدّاد دائري (نسبة ٠–١) ═══
export function Ring({ ratio, size = 148, stroke = 12, color = '#ffffff', track = 'rgba(255,255,255,0.22)', children }: {
  ratio: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const SWEEP = 270;
  const START = 135;
  const pol = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  };
  const arc = (from: number, to: number) => {
    const p0 = pol(from); const p1 = pol(to);
    return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`;
  };
  const v = Math.max(0.005, Math.min(1, ratio));
  const end = START + v * SWEEP;
  const tip = pol(end);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGrad id="ringg" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={0.55} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </SvgGrad>
        </Defs>
        <Path d={arc(START, START + SWEEP)} stroke={track} strokeWidth={stroke} strokeLinecap="round" fill="none" />
        <Path d={arc(START, end)} stroke="url(#ringg)" strokeWidth={stroke} strokeLinecap="round" fill="none" />
        <Circle cx={tip.x} cy={tip.y} r={stroke * 0.62} fill={color} />
        <Circle cx={tip.x} cy={tip.y} r={stroke * 0.28} fill={P.heroA} />
      </Svg>
      {children}
    </View>
  );
}

// ═══ مفتاح تبديل على شكل بطاقة ═══
export function ToggleCard({ on, label, onLabel, icon, color, onPress }: {
  on: boolean; label: string; onLabel: string; icon: IconName; color: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.toggle, on && { borderColor: color + '55', backgroundColor: color + '10' }, pressed && { opacity: 0.8 }]}>
      <View style={[st.switch, on && { backgroundColor: color }]}>
        <View style={[st.knob, on ? { right: 2 } : { left: 2 }]} />
      </View>
      <Text style={[st.toggleTxt, on && { color }]} numberOfLines={1}>{on ? onLabel : label}</Text>
      <View style={[st.toggleIcon, { backgroundColor: on ? color : P.soft }]}>
        <Icon name={icon} size={15} color={on ? tFg('#fff') : P.sub} stroke={2.1} />
      </View>
    </Pressable>
  );
}

// ═══ زر رئيسي متدرّج ═══
export function PrimaryBtn({ text, icon, onPress, busy, disabled, colors = [P.heroA, P.heroB], style, small }: {
  text: string; icon?: IconName; onPress?: () => void; busy?: boolean; disabled?: boolean;
  colors?: [string, string]; style?: ViewStyle; small?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [{ borderRadius: 16, overflow: 'hidden' }, style, pressed && { opacity: 0.88 }, disabled && { opacity: 0.5 }]}>
      <LinearGradient colors={colors} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }}
        style={[st.primary, small && { paddingVertical: 11 }]}>
        {busy ? <ActivityIndicator size="small" color={tFg('#fff')} /> : !!icon && <Icon name={icon} size={small ? 16 : 19} color={tFg('#fff')} stroke={2.2} />}
        <Text style={[st.primaryTxt, small && { fontSize: 13.5 }]}>{text}</Text>
      </LinearGradient>
    </Pressable>
  );
}

// ═══ قسم قابل للطي ═══
export function Collapse({ title, icon, tone, toneSoft, children, defaultOpen = false }: {
  title: string; icon: IconName; tone: string; toneSoft: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={st.section}>
      <Pressable onPress={() => setOpen(o => !o)} style={st.secHead}>
        <View style={[st.secIcon, { backgroundColor: toneSoft }]}>
          <Icon name={icon} size={17} color={tone} stroke={2.1} />
        </View>
        <Text style={[st.secTitle, { flex: 1, textAlign: 'right' }]}>{title}</Text>
        <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
          <Icon name="chevron" size={16} color={P.sub} />
        </View>
      </Pressable>
      {open && <View style={{ marginTop: 12 }}>{children}</View>}
    </View>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 28, padding: 18, overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: tBg('#ffffff'), opacity: 0.1 },
  glass: {
    height: 40, width: 40, borderRadius: 14, backgroundColor: tBg('rgba(255,255,255,0.18)'),
    borderWidth: 1, borderColor: tBd('rgba(255,255,255,0.25)'),
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row-reverse', gap: 6,
  },
  glassTxt: { color: tFg('#fff'), fontSize: 13.5, fontWeight: '800' },

  section: { backgroundColor: P.card, borderRadius: 22, padding: 16, borderWidth: 1, borderColor: P.border, ...shadow },
  secHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  secIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secTitle: { color: P.text, fontSize: 15.5, fontWeight: '800', textAlign: 'right' },
  secSub: { color: P.sub, fontSize: 11.5, textAlign: 'right', marginTop: 1 },

  val: { flexDirection: 'row', alignItems: 'baseline', alignSelf: 'flex-end' },

  meter: { backgroundColor: P.soft, borderRadius: 16, padding: 12, gap: 8, borderWidth: 1, borderColor: P.border },
  meterHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  meterLbl: { color: P.sub, fontSize: 12, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  lvlPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  lvlPillTxt: { fontSize: 10.5, fontWeight: '800' },

  info: { backgroundColor: P.soft, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, gap: 2, borderWidth: 1, borderColor: P.border },
  infoLbl: { color: P.sub, fontSize: 11, fontWeight: '600', textAlign: 'right' },
  infoVal: { color: P.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },

  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap' },
  half: { width: '48.4%' },

  chip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipTxt: { fontSize: 11.5, fontWeight: '800' },

  toggle: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    backgroundColor: P.card, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1.5, borderColor: P.border,
  },
  toggleIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toggleTxt: { flex: 1, color: P.text, fontSize: 12.5, fontWeight: '800', textAlign: 'right' },
  switch: { width: 34, height: 20, borderRadius: 10, backgroundColor: tBg('#d6ddec'), justifyContent: 'center' },
  knob: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: tBg('#fff') },

  primary: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, paddingHorizontal: 16 },
  primaryTxt: { color: tFg('#fff'), fontSize: 15.5, fontWeight: '800' },
});
