/**
 * بطاقات الإشارة (بدل العدّاد في صفحة الراوتر): صف لكل تقنية — 4G وتحته 5G لو موجود.
 * كل صف: شارة التردد (B3 · 1800 متوازن) + قوة الإشارة كبيرة + شريط الجودة + SINR و RSRQ.
 * الألوان من نفس جداول التقييم (signal.ts) عشان تطابق باقي الشاشات.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { View, Text } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import type { Signal } from '../drivers/types';
import { LEVEL_COLOR, rsrpLevel, rsrqLevel, sinrLevel, signalScore, parseBands, parseNrBands } from '../utils/signal';
import { friendlyBand } from '../utils/bands';
import { C, tBd, tBg } from './theme';
import { sheet } from '../i18n';

type Tech = 'LTE' | 'NR';
interface Row { tech: Tech; band?: string; rsrp?: number; sinr?: number; rsrq?: number; pci?: string }

const TECH_TINT: Record<Tech, [string, string]> = {
  LTE: ['#2f6bff', '#4f8bff'],
  NR: ['#6a4cff', '#9b6bff'],
};

const num = (b?: string) => {
  const m = (b ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
};
// \u200E: علامة «يسار لليمين» عشان السالب يطلع -93 مو 93- داخل النص العربي
const fmt = (v?: number, d = 0) => (v === undefined ? '—' : '\u200E' + (Math.round(v * 10 ** d) / 10 ** d).toString());

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

function QualityBar({ score }: { score: number }) {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: Math.max(0.04, Math.min(1, score)), duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [score, w]);
  return (
    <View style={s.track}>
      <Animated.View style={[s.fillWrap, { width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}>
        <LinearGradient colors={['#22c55e', '#14b8a6', '#2f6bff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.fill} />
      </Animated.View>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLbl}>{label}</Text>
      <Text style={[s.statVal, { color }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function TechRow({ r }: { r: Row }) {
  const b = num(r.band);
  const code = r.band ? (r.tech === 'NR' ? `n${b ?? ''}` : `B${b ?? ''}`) : r.tech === 'NR' ? '5G' : '4G';
  const nice = b ? friendlyBand(r.tech, b) : '';
  const lv = rsrpLevel(r.rsrp);
  const score = signalScore({ rsrp: r.rsrp, sinr: r.sinr, rsrq: r.rsrq });
  return (
    <View style={s.row}>
      <LinearGradient colors={TECH_TINT[r.tech]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.chip}>
        <Text style={s.chipTech}>{r.tech === 'NR' ? '5G' : '4G'}</Text>
        <Text style={s.chipBand} numberOfLines={1} adjustsFontSizeToFit>{code}</Text>
        {!!nice && <Text style={s.chipNice} numberOfLines={1} adjustsFontSizeToFit>{nice}</Text>}
      </LinearGradient>

      <View style={s.mid}>
        <Text style={s.midLbl}>قوة الإشارة</Text>
        <View style={s.rsrpLine}>
          <Text style={[s.rsrp, { color: LEVEL_COLOR[lv] }]}>{fmt(r.rsrp)}</Text>
          <Text style={s.unit}>dBm</Text>
        </View>
        <QualityBar score={score} />
      </View>

      <View style={s.stats}>
        <Stat label="النقاء SINR" value={fmt(r.sinr, 1)} color={LEVEL_COLOR[sinrLevel(r.sinr)]} />
        <Stat label="الجودة RSRQ" value={fmt(r.rsrq, 1)} color={LEVEL_COLOR[rsrqLevel(r.rsrq)]} />
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
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
    backgroundColor: tBg('#ffffffcc'), borderRadius: 20, borderWidth: 1, borderColor: tBd('#ffffff'),
    padding: 12,
  },
  chip: { width: 76, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center' },
  chipTech: { color: '#ffffffcc', fontSize: 11, fontWeight: '800' },
  chipBand: { color: '#ffffff', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  chipNice: { color: '#ffffffdd', fontSize: 10, fontWeight: '700', marginTop: 1 },
  mid: { flex: 1, gap: 2 },
  midLbl: { color: C.sub, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  rsrpLine: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 4 },
  rsrp: { fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  unit: { color: C.muted, fontSize: 11, fontWeight: '700' },
  track: { height: 7, borderRadius: 99, backgroundColor: C.track, overflow: 'hidden', marginTop: 4, flexDirection: 'row-reverse' },
  fillWrap: { height: '100%' },
  fill: { flex: 1, borderRadius: 99 },
  stats: { gap: 6, minWidth: 74 },
  stat: { backgroundColor: tBg('#f4f6fb'), borderRadius: 12, paddingVertical: 4, paddingHorizontal: 8, alignItems: 'center' },
  statLbl: { color: C.muted, fontSize: 9.5, fontWeight: '700' },
  statVal: { fontSize: 15, fontWeight: '900' },
});

