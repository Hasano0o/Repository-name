/**
 * لوحة الشبكة — بطاقة 4G (تركواز غامق) وبطاقة 5G (كحلي/بنفسجي)،
 * كل وحدة فيها ٤ عدادات (RSRP · RSRQ · SINR · PING) وشبكة خانات مرتبة.
 * تظهر في مساعد التوجيه.
 */
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { Signal } from '../drivers/types';
import { Level, LEVEL_COLOR, rsrpLevel, sinrLevel, rsrqLevel, parseBands, parseNrBands } from '../utils/signal';
import { Icon, IconName } from './Icon';

export const pingLevel = (v?: number): Level =>
  v === undefined ? 'unknown' : v <= 40 ? 'excellent' : v <= 70 ? 'good' : v <= 120 ? 'fair' : 'poor';

const RANGES = {
  ping: [200, 10] as const,   // الأقل أفضل
  sinr: [-5, 25] as const,
  rsrq: [-20, -5] as const,
  rsrp: [-120, -70] as const,
};
const ratio = (v: number | undefined, [lo, hi]: readonly [number, number]) =>
  v === undefined ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

// ═══ ثيم كل شبكة — 4G تركواز غامق، 5G كحلي بنفسجي ═══
type Theme = {
  bg: [string, string, string];
  border: string;
  pill: [string, string];
  accent: string;       // لون الأرقام المميزة والأيقونات
  accentSoft: string;   // خلفية الأيقونات
  glow: string;         // الهالة في الزاوية
  panel: string;        // خلفية لوح العدادات
  tile: string;
  tileBorder: string;
  sub: string;
};
const THEMES: Record<'4G' | '5G', Theme> = {
  '4G': {
    bg: ['#13727d', '#1a8290', '#217796'],
    border: '#3a9aa6',
    pill: ['#0a5a66', '#0c4f6e'],
    accent: '#b8fff2',
    accentSoft: 'rgba(255,255,255,0.16)',
    glow: 'rgba(45,212,191,0.07)',
    panel: 'rgba(255,255,255,0.08)',
    tile: 'rgba(255,255,255,0.10)',
    tileBorder: 'rgba(255,255,255,0.16)',
    sub: 'rgba(230,255,251,0.8)',
  },
  '5G': {
    bg: ['#2d3a8f', '#3a3f9f', '#4a3aa6'],
    border: '#5a63c0',
    pill: ['#7c4dff', '#a24bd8'],
    accent: '#e2d9ff',
    accentSoft: 'rgba(255,255,255,0.15)',
    glow: 'rgba(139,92,246,0.09)',
    panel: 'rgba(255,255,255,0.08)',
    tile: 'rgba(255,255,255,0.10)',
    tileBorder: 'rgba(255,255,255,0.15)',
    sub: 'rgba(236,232,255,0.78)',
  },
};

// ═══ عدّاد قوس صغير ═══
function Gauge({ value, label, unit, level, r }: {
  value?: number; label: string; unit: string; level: Level; r: number;
}) {
  const size = 72, sw = 7, c = size / 2, rad = c - sw / 2 - 1;
  const START = 135, SWEEP = 270;
  const pol = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: c + rad * Math.cos(a), y: c + rad * Math.sin(a) };
  };
  const arc = (from: number, to: number) => {
    const p0 = pol(from), p1 = pol(to);
    return `M ${p0.x} ${p0.y} A ${rad} ${rad} 0 ${to - from > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`;
  };
  const empty = value === undefined;
  const col = empty ? 'rgba(255,255,255,0.35)' : LEVEL_COLOR[level];
  const end = START + Math.max(0.02, r) * SWEEP;
  const txt = empty ? '—' : Number.isInteger(value) ? String(value) : value!.toFixed(1);
  return (
    <View style={g.wrap}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Path d={arc(START, START + SWEEP)} stroke="rgba(255,255,255,0.2)" strokeWidth={sw} strokeLinecap="round" fill="none" />
          {!empty && <Path d={arc(START, end)} stroke={col} strokeWidth={sw} strokeLinecap="round" fill="none" />}
          {!empty && <Circle cx={pol(end).x} cy={pol(end).y} r={sw * 0.3} fill="#fff" />}
        </Svg>
        <Text style={[g.val, { color: empty ? 'rgba(255,255,255,0.4)' : '#fff', fontSize: txt.length > 4 ? 15 : 18 }]}
          numberOfLines={1} adjustsFontSizeToFit>{txt}</Text>
      </View>
      <Text style={g.lbl}>{label}</Text>
      <Text style={g.unit}>{unit}</Text>
    </View>
  );
}

// ═══ خانة معلومة ═══
function Tile({ icon, label, value, th, accent, cols }: {
  icon: IconName; label: string; value?: string; th: Theme; accent?: boolean; cols: 2 | 3;
}) {
  return (
    <View style={[t.tile, { width: cols === 3 ? '31.8%' : '48.6%', backgroundColor: th.tile, borderColor: th.tileBorder }]}>
      <View style={t.top}>
        <Text style={[t.lbl, { color: th.sub }]} numberOfLines={1}>{label}</Text>
        <View style={[t.icon, { backgroundColor: th.accentSoft }]}>
          <Icon name={icon} size={13} color={th.accent} stroke={2.2} />
        </View>
      </View>
      <Text style={[t.val, { color: !value ? 'rgba(255,255,255,0.35)' : accent ? th.accent : '#fff' }]}
        numberOfLines={1} adjustsFontSizeToFit>{value || '—'}</Text>
    </View>
  );
}

function Card({ tech, active, children, badges }: {
  tech: '4G' | '5G'; active?: boolean; children: React.ReactNode; badges: string[];
}) {
  const th = THEMES[tech];
  return (
    <View style={[c.shadow, { shadowColor: th.bg[1] }]}>
      <LinearGradient colors={th.bg} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }}
        style={[c.card, { borderColor: th.border }]}>
        <View style={[c.glow, { backgroundColor: th.glow }]} pointerEvents="none" />
        <View style={c.head}>
          <LinearGradient colors={th.pill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={c.techPill}>
            <Text style={c.techTxt}>{tech}</Text>
          </LinearGradient>
          <View style={{ flex: 1, alignItems: 'flex-end', gap: 5 }}>
            <Text style={c.title}>{tech === '5G' ? 'شبكة 5G' : 'شبكة 4G LTE'}</Text>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 5 }}>
              {badges.filter(Boolean).map((b, i) => (
                <View key={i} style={[c.badge, { backgroundColor: th.accentSoft }]}>
                  <Text style={[c.badgeTxt, { color: th.accent }]}>{b}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={[c.state, { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
            <View style={[c.dot, { backgroundColor: active ? '#3dff9e' : 'rgba(255,255,255,0.4)' }]} />
            <Text style={[c.stateTxt, { color: active ? '#fff' : 'rgba(255,255,255,0.7)' }]}>
              {active ? 'متصل' : 'غير نشط'}
            </Text>
          </View>
        </View>
        {children}
      </LinearGradient>
    </View>
  );
}

export function NetPanel({ signal, ping }: { signal: Signal | null; ping?: number }) {
  if (!signal) return null;
  const s = signal;
  const L = THEMES['4G'], N = THEMES['5G'];
  const lteBand = parseBands(s.band).filter(b => b.startsWith('B')).join('+') || s.band;
  const nrBand = parseNrBands(s.nrBand).join('+') || s.nrBand;
  const hasNr = s.nrRsrp !== undefined || !!s.nrBand;
  const bw = [s.dlBandwidth, s.ulBandwidth].filter(Boolean).join(' / ');

  return (
    <View style={{ gap: 12 }}>
      <Card tech="4G" active={s.rsrp !== undefined} badges={[lteBand || '—', hasNr ? 'مزدوج مع 5G' : '4G فقط']}>
        <View style={[c.gauges, { backgroundColor: L.panel }]}>
          <Gauge label="RSRP" unit="dBm" value={s.rsrp} level={rsrpLevel(s.rsrp)} r={ratio(s.rsrp, RANGES.rsrp)} />
          <Gauge label="RSRQ" unit="dB" value={s.rsrq} level={rsrqLevel(s.rsrq)} r={ratio(s.rsrq, RANGES.rsrq)} />
          <Gauge label="SINR" unit="dB" value={s.sinr} level={sinrLevel(s.sinr)} r={ratio(s.sinr, RANGES.sinr)} />
          <Gauge label="PING" unit="ms" value={ping} level={pingLevel(ping)} r={ratio(ping, RANGES.ping)} />
        </View>
        <View style={c.tiles}>
          <Tile cols={3} th={L} icon="bands" label="الباند" value={lteBand} accent />
          <Tile cols={3} th={L} icon="tower" label="PCI" value={s.pci} />
          <Tile cols={3} th={L} icon="antenna" label="Cell ID" value={s.cellId} />
          <Tile cols={3} th={L} icon="chart" label="RSSI" value={s.rssi !== undefined ? `${s.rssi} dBm` : undefined} />
          <Tile cols={3} th={L} icon="layers" label="EARFCN" value={s.earfcn} />
          <Tile cols={3} th={L} icon="speed" label="النطاق" value={s.dlBandwidth || bw || undefined} />
        </View>
      </Card>

      {hasNr && (
        <Card tech="5G" active={s.nrRsrp !== undefined} badges={[nrBand || '—']}>
          <View style={[c.gauges, { backgroundColor: N.panel }]}>
            <Gauge label="RSRP" unit="dBm" value={s.nrRsrp} level={rsrpLevel(s.nrRsrp)} r={ratio(s.nrRsrp, RANGES.rsrp)} />
            <Gauge label="RSRQ" unit="dB" value={s.nrRsrq} level={rsrqLevel(s.nrRsrq)} r={ratio(s.nrRsrq, RANGES.rsrq)} />
            <Gauge label="SINR" unit="dB" value={s.nrSinr} level={sinrLevel(s.nrSinr)} r={ratio(s.nrSinr, RANGES.sinr)} />
            <Gauge label="PING" unit="ms" value={ping} level={pingLevel(ping)} r={ratio(ping, RANGES.ping)} />
          </View>
          <View style={c.tiles}>
            <Tile cols={2} th={N} icon="bands" label="الباند" value={nrBand} accent />
            <Tile cols={2} th={N} icon="tower" label="PCI" value={s.nrPci} />
            <Tile cols={2} th={N} icon="layers" label="NR-ARFCN" value={s.nrArfcn} />
            <Tile cols={2} th={N} icon="speed" label="عرض النطاق" value={s.nrDlBandwidth} />
          </View>
        </Card>
      )}
    </View>
  );
}

const g = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center' },
  val: { fontWeight: '800', letterSpacing: -0.5, maxWidth: 50, textAlign: 'center' },
  lbl: { fontSize: 11.5, fontWeight: '800', marginTop: -4, color: '#fff' },
  unit: { fontSize: 9.5, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
});
const t = StyleSheet.create({
  tile: { borderRadius: 14, paddingVertical: 9, paddingHorizontal: 10, borderWidth: 1, gap: 4 },
  top: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  icon: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  lbl: { fontSize: 10.5, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  val: { fontSize: 15, fontWeight: '800', textAlign: 'right' },
});
const c = StyleSheet.create({
  shadow: {
    borderRadius: 24, shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  card: { borderRadius: 24, padding: 14, gap: 12, borderWidth: 1, overflow: 'hidden' },
  glow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, top: -110, left: -70 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  techPill: { borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 13, paddingVertical: 7 },
  techTxt: { color: '#fff', fontSize: 18, fontWeight: '900' },
  title: { color: '#fff', fontSize: 16, fontWeight: '800' },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontWeight: '800' },
  state: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  stateTxt: { fontSize: 11.5, fontWeight: '800' },
  gauges: { flexDirection: 'row-reverse', borderRadius: 18, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  tiles: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 7 },
});
