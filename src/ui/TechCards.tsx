/**
 * بطاقات الإشارة (بدل العدّاد في صفحة الراوتر) — حسب تصميم حسن:
 * بطاقة لكل تقنية (4G وتحتها 5G لو موجود)، ثلاث أعمدة من اليمين:
 *   شارة التردد (4G · أعمدة · B3 · 1800 متوازن) | قوة الإشارة + الشريط + الحالة | مربعا SINR و RSRQ
 * مربعات SINR/RSRQ تفتح «التفاصيل». ألوان التقييم من signal.ts عشان تطابق باقي الشاشات.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import type { Signal } from '../drivers/types';
import { LEVEL_COLOR, LEVEL_SOFT, Level, rsrpLevel, rsrqLevel, signalScore, parseBands, parseNrBands } from '../utils/signal';
import { friendlyBand } from '../utils/bands';
import { C, isDark, tBd, tBg } from './theme';
import { sheet } from '../i18n';

type Tech = 'LTE' | 'NR';
interface Row { tech: Tech; band?: string; rsrp?: number; sinr?: number; rsrq?: number; pci?: string }

const TECH_TINT: Record<Tech, [string, string]> = {
  LTE: ['#1f5eff', '#3b8bff'],
  NR: ['#5b3df5', '#9466ff'],
};
/** لون التقنية للنص والأيقونات، وخلفيته الفاتحة لمربع SINR */
const TECH_ACCENT: Record<Tech, string> = { LTE: '#1f5eff', NR: '#5b3df5' };
const TECH_SOFT: Record<Tech, string> = isDark
  ? { LTE: '#22314f', NR: '#2c2850' }
  : { LTE: '#eaf1ff', NR: '#f0ecff' };

const STATUS: Record<Level, string> = {
  excellent: 'إشارة ممتازة', good: 'إشارة جيدة', fair: 'إشارة متوسطة', poor: 'إشارة ضعيفة', unknown: 'ما فيه قراءة',
};

const num = (b?: string) => {
  const m = (b ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
};
// ‎: علامة «يسار لليمين» عشان السالب يطلع -93 مو 93- داخل النص العربي
const fmt = (v?: number, d = 0) => (v === undefined ? '—' : '‎' + (Math.round(v * 10 ** d) / 10 ** d).toString());

/** الصفوف اللي نعرضها من قراءة الراوتر */
export function techRows(sig?: Signal | null): Row[] {
  if (!sig) return [];
  const out: Row[] = [];
  const lteBand = parseBands(sig.band).find(b => !b.startsWith('n'));
  if (sig.rsrp !== undefined || lteBand) {
    out.push({ tech: 'LTE', band: lteBand, rsrp: sig.rsrp, sinr: sig.sinr, rsrq: sig.rsrq, pci: sig.pci });
  }
  const nrBand = parseNrBands(sig.nrBand)[0];
  if (sig.nrRsrp !== undefined || nrBand) {
    out.push({ tech: 'NR', band: nrBand, rsrp: sig.nrRsrp, sinr: sig.nrSinr, rsrq: sig.nrRsrq, pci: sig.nrPci });
  }
  return out;
}

// ─── أيقونات ───
export function Bars({ color, size = 22, on = 4 }: { color: string; size?: number; on?: number }) {
  const h = [7, 11, 15, 19];
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      {h.map((v, i) => (
        <Rect key={i} x={1 + i * 5.4} y={21 - v} width={3.8} height={v} rx={1.6} fill={color} opacity={i < on ? 1 : 0.4} />
      ))}
    </Svg>
  );
}
function Waves({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Circle cx={5} cy={12} r={2.4} fill={color} />
      <Path d="M10 7.5a6.5 6.5 0 0 1 0 9" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M14 4.5a10.5 10.5 0 0 1 0 15" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M18 2a14 14 0 0 1 0 20" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}
function Antenna({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={1.9} fill={color} />
      <Path d="M8.2 4.6a5 5 0 0 0 0 6.8M15.8 4.6a5 5 0 0 1 0 6.8M5.5 2.5a8.5 8.5 0 0 0 0 11M18.5 2.5a8.5 8.5 0 0 1 0 11" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path d="M12 10l-4.5 12M12 10l4.5 12M9 18h6" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}
function Chevron({ color }: { color: string }) {
  return (
    <Svg width={10} height={10} viewBox="0 0 10 10" fill="none">
      <Path d="M3.5 1.5L7 5l-3.5 3.5" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
/** لمعة خفيفة داخل الشارة (موجات قطرية) */
function Sheen() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute' }}>
      <Path d="M0 70 Q40 40 100 55 L100 100 L0 100 Z" fill="#ffffff" opacity={0.08} />
      <Path d="M30 0 Q60 30 100 20 L100 0 Z" fill="#ffffff" opacity={0.1} />
    </Svg>
  );
}

function QualityBar({ score }: { score: number }) {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: Math.max(0.04, Math.min(1, score)), duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [score, w]);
  return (
    <View style={s.track}>
      <Animated.View style={[s.fillWrap, { width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}>
        <LinearGradient colors={['#2f6bff', '#14b8a6', '#34d399']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.fill} />
      </Animated.View>
    </View>
  );
}

function Stat({ icon, label, value, color, bg, onPress }: {
  icon: React.ReactNode; label: string; value: string; color: string; bg: string; onPress?: () => void;
}) {
  return (
    <Pressable style={[s.stat, { backgroundColor: bg }]} onPress={onPress} disabled={!onPress}>
      {!!onPress && <Chevron color={C.muted} />}
      <View style={s.statTxt}>
        <Text style={s.statLbl} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
        <Text style={[s.statVal, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      </View>
      {icon}
    </Pressable>
  );
}

function TechRow({ r, onDetails }: { r: Row; onDetails?: () => void }) {
  const b = num(r.band);
  const code = r.band ? (r.tech === 'NR' ? `n${b ?? ''}` : `B${b ?? ''}`) : r.tech === 'NR' ? '5G' : '4G';
  const nice = b ? friendlyBand(r.tech, b) : '';
  const lv = rsrpLevel(r.rsrp);
  const qlv = rsrqLevel(r.rsrq);
  const score = signalScore({ rsrp: r.rsrp, sinr: r.sinr, rsrq: r.rsrq });
  const barsOn = lv === 'excellent' ? 4 : lv === 'good' ? 3 : lv === 'fair' ? 2 : 1;
  const accent = TECH_ACCENT[r.tech];
  return (
    <View style={s.row}>
      {/* ١. شارة التردد */}
      <LinearGradient colors={TECH_TINT[r.tech]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.chip}>
        <Sheen />
        <View style={s.chipTop}>
          <Bars color="#ffffff" size={18} on={barsOn} />
          <View style={s.techPill}><Text style={s.techPillTxt}>{r.tech === 'NR' ? '5G' : '4G'}</Text></View>
        </View>
        <Text style={s.chipBand} numberOfLines={1} adjustsFontSizeToFit>{code}</Text>
        {!!nice && <Text style={s.chipNice} numberOfLines={1} adjustsFontSizeToFit>{nice}</Text>}
      </LinearGradient>

      {/* ٢. قوة الإشارة */}
      <View style={s.mid}>
        <View style={s.midHead}>
          <Text style={s.midLbl} numberOfLines={1} adjustsFontSizeToFit>قوة الإشارة</Text>
          <Waves color={accent} />
        </View>
        <View style={s.rsrpLine}>
          <Text style={[s.rsrp, { color: LEVEL_COLOR[lv] }]} numberOfLines={1} adjustsFontSizeToFit>{fmt(r.rsrp)}</Text>
          <Text style={s.unit}>dBm</Text>
        </View>
        <QualityBar score={score} />
        <View style={[s.status, { backgroundColor: LEVEL_SOFT[lv] }]}>
          <Text style={[s.statusTxt, { color: LEVEL_COLOR[lv] }]} numberOfLines={1} adjustsFontSizeToFit>{STATUS[lv]}</Text>
          <View style={[s.dot, { backgroundColor: LEVEL_COLOR[lv] }]} />
        </View>
      </View>

      <View style={s.sep} />

      {/* ٣. النقاء والجودة */}
      <View style={s.stats}>
        <Stat icon={<Bars color={accent} size={20} />} label="النقاء SINR" value={fmt(r.sinr, 1)}
          color={accent} bg={TECH_SOFT[r.tech]} onPress={onDetails} />
        <Stat icon={<Antenna color={LEVEL_COLOR[qlv]} />} label="الجودة RSRQ" value={fmt(r.rsrq, 1)}
          color={LEVEL_COLOR[qlv]} bg={LEVEL_SOFT[qlv]} onPress={onDetails} />
      </View>
    </View>
  );
}

export function TechCards({ signal, onDetails }: { signal?: Signal | null; onDetails?: () => void }) {
  const rows = techRows(signal);
  if (!rows.length) return null;
  return (
    <View style={s.wrap}>
      {rows.map(r => <TechRow key={r.tech} r={r} onDetails={onDetails} />)}
    </View>
  );
}

const s = sheet({
  wrap: { alignSelf: 'stretch', gap: 8 },
  row: {
    flexDirection: 'row-reverse', alignItems: 'stretch', gap: 8,
    backgroundColor: tBg('#ffffffe6'), borderRadius: 22, borderWidth: 1, borderColor: tBd('#ffffff'),
    padding: 7,
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  // ١. الشارة
  chip: { width: 78, borderRadius: 16, padding: 8, justifyContent: 'space-between', alignItems: 'center', overflow: 'hidden' },
  chipTop: { alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  techPill: { borderRadius: 999, borderWidth: 1, borderColor: '#ffffff99', backgroundColor: '#ffffff26', paddingHorizontal: 7, paddingVertical: 1 },
  techPillTxt: { color: '#ffffff', fontSize: 10.5, fontWeight: '900' },
  chipBand: { color: '#ffffff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center', marginTop: 2 },
  chipNice: { color: '#ffffffeb', fontSize: 9, fontWeight: '700', textAlign: 'center' },
  // ٢. الوسط
  mid: { flex: 1, gap: 3, justifyContent: 'center', alignItems: 'center', paddingVertical: 2 },
  midHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3 },
  midLbl: { color: C.text, fontSize: 11.5, fontWeight: '800', flexShrink: 1 },
  rsrpLine: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 3 },
  rsrp: { fontSize: 26, fontWeight: '900', letterSpacing: -1, flexShrink: 1 },
  unit: { color: C.sub, fontSize: 10, fontWeight: '700' },
  track: { alignSelf: 'stretch', height: 6, borderRadius: 99, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row' },
  fillWrap: { height: '100%' },
  fill: { flex: 1, borderRadius: 99 },
  status: { flexDirection: 'row-reverse', alignItems: 'center', alignSelf: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2, maxWidth: '100%' },
  statusTxt: { fontSize: 10, fontWeight: '800', flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  sep: { width: 1, backgroundColor: C.cardBorder, marginVertical: 6 },
  // ٣. المربعات
  stats: { width: 80, gap: 5 },
  stat: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingHorizontal: 5, paddingVertical: 4, gap: 3 },
  statTxt: { alignItems: 'center' },
  statLbl: { color: C.text, fontSize: 8.5, fontWeight: '800' },
  statVal: { fontSize: 15, fontWeight: '900' },
});
