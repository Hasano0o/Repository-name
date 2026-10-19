/**
 * بطاقات الإشارة (بدل العدّاد في صفحة الراوتر): بطاقة لكل تقنية — 4G وتحتها 5G لو موجود.
 * كل بطاقة: شارة التردد (B3 · 1800 متوازن) + قوة الإشارة كبيرة + شريط + حالة الإشارة،
 * ومربعين SINR و RSRQ بأيقونات. الألوان من نفس جداول التقييم (signal.ts) عشان تطابق باقي الشاشات.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { View, Text } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import type { Signal } from '../drivers/types';
import { LEVEL_COLOR, LEVEL_SOFT, Level, rsrpLevel, rsrqLevel, sinrLevel, signalScore, parseBands, parseNrBands } from '../utils/signal';
import { friendlyBand } from '../utils/bands';
import { C, tBd, tBg } from './theme';
import { sheet } from '../i18n';

type Tech = 'LTE' | 'NR';
interface Row { tech: Tech; band?: string; rsrp?: number; sinr?: number; rsrq?: number; pci?: string }

const TECH_TINT: Record<Tech, [string, string]> = {
  LTE: ['#1f5eff', '#3b8bff'],
  NR: ['#5b3df5', '#9466ff'],
};
const TECH_ACCENT: Record<Tech, string> = { LTE: '#2f6bff', NR: '#6a4cff' };

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
function Bars({ color, size = 22, on = 4 }: { color: string; size?: number; on?: number }) {
  const h = [7, 11, 15, 19];
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      {h.map((v, i) => (
        <Rect key={i} x={1 + i * 5.4} y={21 - v} width={3.8} height={v} rx={1.6} fill={color} opacity={i < on ? 1 : 0.35} />
      ))}
    </Svg>
  );
}
function Waves({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={5} cy={12} r={2.2} fill={color} />
      <Path d="M10 7.5a6.5 6.5 0 0 1 0 9" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M14 4.5a10.5 10.5 0 0 1 0 15" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M18 2a14 14 0 0 1 0 20" stroke={color} strokeWidth={2.2} strokeLinecap="round" opacity={0.6} />
    </Svg>
  );
}
function Antenna({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={1.8} fill={color} />
      <Path d="M8.2 4.6a5 5 0 0 0 0 6.8M15.8 4.6a5 5 0 0 1 0 6.8M5.5 2.5a8.5 8.5 0 0 0 0 11M18.5 2.5a8.5 8.5 0 0 1 0 11" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M12 10l-4.5 12M12 10l4.5 12M9 18h6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
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
        <LinearGradient colors={['#2f6bff', '#14b8a6', '#34d399']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.fill} />
      </Animated.View>
    </View>
  );
}

function Stat({ icon, label, value, lv }: { icon: 'bars' | 'antenna'; label: string; value: string; lv: Level }) {
  const col = LEVEL_COLOR[lv];
  return (
    <View style={[s.stat, { backgroundColor: LEVEL_SOFT[lv] }]}>
      <View style={s.statTxt}>
        <Text style={s.statLbl} numberOfLines={1}>{label}</Text>
        <Text style={[s.statVal, { color: col }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      </View>
      {icon === 'bars' ? <Bars color={col} /> : <Antenna color={col} />}
    </View>
  );
}

function TechRow({ r }: { r: Row }) {
  const b = num(r.band);
  const code = r.band ? (r.tech === 'NR' ? `n${b ?? ''}` : `B${b ?? ''}`) : r.tech === 'NR' ? '5G' : '4G';
  const nice = b ? friendlyBand(r.tech, b) : '';
  const lv = rsrpLevel(r.rsrp);
  const score = signalScore({ rsrp: r.rsrp, sinr: r.sinr, rsrq: r.rsrq });
  const barsOn = lv === 'excellent' ? 4 : lv === 'good' ? 3 : lv === 'fair' ? 2 : 1;
  return (
    <View style={s.row}>
      <View style={s.top}>
      <LinearGradient colors={TECH_TINT[r.tech]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.chip}>
        <View style={s.chipTop}>
          <Bars color="#ffffff" size={20} on={barsOn} />
          <View style={s.techPill}><Text style={s.techPillTxt}>{r.tech === 'NR' ? '5G' : '4G'}</Text></View>
        </View>
        <Text style={s.chipBand} numberOfLines={1} adjustsFontSizeToFit>{code}</Text>
        {!!nice && <Text style={s.chipNice} numberOfLines={1} adjustsFontSizeToFit>{nice}</Text>}
      </LinearGradient>

      <View style={s.mid}>
        <View style={s.midHead}>
          <Text style={s.midLbl}>قوة الإشارة</Text>
          <Waves color={TECH_ACCENT[r.tech]} />
        </View>
        <View style={s.rsrpLine}>
          <Text style={[s.rsrp, { color: LEVEL_COLOR[lv] }]} numberOfLines={1} adjustsFontSizeToFit>{fmt(r.rsrp)}</Text>
          <Text style={s.unit}>dBm</Text>
        </View>
        <QualityBar score={score} />
        <View style={[s.status, { backgroundColor: LEVEL_SOFT[lv] }]}>
          <Text style={[s.statusTxt, { color: LEVEL_COLOR[lv] }]}>{STATUS[lv]}</Text>
          <View style={[s.dot, { backgroundColor: LEVEL_COLOR[lv] }]} />
        </View>
      </View>
      </View>

      <View style={s.stats}>
        <Stat icon="bars" label="النقاء SINR" value={fmt(r.sinr, 1)} lv={sinrLevel(r.sinr)} />
        <Stat icon="antenna" label="الجودة RSRQ" value={fmt(r.rsrq, 1)} lv={rsrqLevel(r.rsrq)} />
      </View>
    </View>
  );
}

export function TechCards({ signal }: { signal?: Signal | null }) {
  const rows = techRows(signal);
  if (!rows.length) return null;
  return (
    <View style={s.wrap}>
      {rows.map(r => <TechRow key={r.tech} r={r} />)}
    </View>
  );
}

const s = sheet({
  wrap: { alignSelf: 'stretch', gap: 10 },
  row: {
    gap: 10,
    backgroundColor: tBg('#ffffffd9'), borderRadius: 22, borderWidth: 1, borderColor: tBd('#ffffff'),
    padding: 10,
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },
  top: { flexDirection: 'row-reverse', alignItems: 'stretch', gap: 12 },
  chip: { width: 104, borderRadius: 18, padding: 10, justifyContent: 'space-between' },
  chipTop: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  techPill: { borderRadius: 999, borderWidth: 1, borderColor: '#ffffff80', backgroundColor: '#ffffff26', paddingHorizontal: 8, paddingVertical: 1 },
  techPillTxt: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  chipBand: { color: '#ffffff', fontSize: 28, fontWeight: '900', letterSpacing: -0.5, textAlign: 'right', marginTop: 6 },
  chipNice: { color: '#ffffffe6', fontSize: 10.5, fontWeight: '700', textAlign: 'right' },
  mid: { flex: 1, gap: 4, justifyContent: 'center' },
  midHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  midLbl: { color: C.text, fontSize: 13, fontWeight: '800' },
  rsrpLine: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 4 },
  rsrp: { fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  unit: { color: C.muted, fontSize: 12, fontWeight: '700' },
  track: { height: 8, borderRadius: 99, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row-reverse' },
  fillWrap: { height: '100%' },
  fill: { flex: 1, borderRadius: 99 },
  status: { flexDirection: 'row-reverse', alignItems: 'center', alignSelf: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 2 },
  statusTxt: { fontSize: 11.5, fontWeight: '800' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  stats: { flexDirection: 'row-reverse', gap: 8 },
  stat: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  statTxt: { flexShrink: 1, alignItems: 'flex-end' },
  statLbl: { color: C.sub, fontSize: 11, fontWeight: '800' },
  statVal: { fontSize: 20, fontWeight: '900' },
});
