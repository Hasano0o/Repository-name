/**
 * لوحة الشبكة — بطاقة 4G وبطاقة 5G، كل وحدة فيها ٤ عدادات (PING · SINR · RSRQ · RSRP)
 * وخانات المعلومات (Cell ID · PCI · الباند · RSSI/ARFCN · EARFCN · BW).
 * تظهر في مساعد التوجيه تحت العدادين الأصليين.
 */
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Signal } from '../drivers/types';
import { Level, LEVEL_COLOR, rsrpLevel, sinrLevel, rsrqLevel, parseBands, parseNrBands } from '../utils/signal';
import { Icon, IconName } from './Icon';
import { P, shadow } from './Pro';

export const pingLevel = (v?: number): Level =>
  v === undefined ? 'unknown' : v <= 40 ? 'excellent' : v <= 70 ? 'good' : v <= 120 ? 'fair' : 'poor';

const cqiLevel = (v?: number): Level =>
  v === undefined ? 'fair' : v >= 12 ? 'excellent' : v >= 9 ? 'good' : v >= 6 ? 'fair' : 'poor';

const RANGES = {
  cqi: [0, 15] as const,
  ping: [200, 10] as const,   // الأقل أفضل
  sinr: [-5, 25] as const,
  rsrq: [-20, -5] as const,
  rsrp: [-120, -70] as const,
};
const ratio = (v: number | undefined, [lo, hi]: readonly [number, number]) =>
  v === undefined ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

// ═══ عدّاد قوس صغير ═══
function Gauge({ value, label, unit, level, r, dark, icon }: {
  value?: number; label: string; unit: string; level: Level; r: number; dark?: boolean; icon: IconName;
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
  const col = empty ? P.faint : LEVEL_COLOR[level];
  const end = START + Math.max(0.02, r) * SWEEP;
  const txt = empty ? '—' : Number.isInteger(value) ? String(value) : value!.toFixed(1);
  return (
    <View style={g.wrap}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Path d={arc(START, START + SWEEP)} stroke={dark ? 'rgba(255,255,255,0.12)' : '#e9eef8'} strokeWidth={sw} strokeLinecap="round" fill="none" />
          {!empty && <Path d={arc(START, end)} stroke={col} strokeWidth={sw} strokeLinecap="round" fill="none" />}
          {!empty && <Circle cx={pol(end).x} cy={pol(end).y} r={sw * 0.3} fill="#fff" />}
        </Svg>
        <Text style={[g.val, { color: empty ? P.faint : dark ? '#fff' : P.text, fontSize: txt.length > 4 ? 15 : 18 }]}
          numberOfLines={1} adjustsFontSizeToFit>{txt}</Text>
      </View>
      <View style={g.lblRow}>
        <Text style={[g.lbl, { color: col }]}>{label}</Text>
        <Icon name={icon} size={11} color={col} stroke={2.4} />
      </View>
      <Text style={[g.unit, dark && { color: 'rgba(255,255,255,0.55)' }]}>{unit}</Text>
    </View>
  );
}

// ═══ خانة معلومة ═══
function Tile({ icon, label, value, dark, accent }: {
  icon: IconName; label: string; value?: string; dark?: boolean; accent?: string;
}) {
  return (
    <View style={[t.tile, dark && t.tileDark]}>
      <View style={[t.icon, { backgroundColor: dark ? 'rgba(255,255,255,0.1)' : P.blueSoft }]}>
        <Icon name={icon} size={14} color={dark ? '#b8c6ff' : P.blue} stroke={2.1} />
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Text style={[t.lbl, dark && { color: 'rgba(255,255,255,0.6)' }]} numberOfLines={1}>{label}</Text>
        <Text style={[t.val, dark && { color: '#fff' }, !value && { color: P.faint }, !!accent && !!value && { color: accent }]}
          numberOfLines={1} adjustsFontSizeToFit>{value || '—'}</Text>
      </View>
    </View>
  );
}

function Card({ tech, dark, active, children, badge }: {
  tech: '4G' | '5G'; dark?: boolean; active?: boolean; children: React.ReactNode; badge?: string;
}) {
  return (
    <View style={[c.card, dark && c.cardDark, { borderColor: tech === '5G' ? 'rgba(160,120,255,0.55)' : 'rgba(47,107,255,0.35)' }]}>
      <View style={c.head}>
        <View style={[c.techPill, { backgroundColor: tech === '5G' ? P.violet : P.blue }]}>
          <Text style={c.techTxt}>{tech}</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <View style={[c.hIcon, { backgroundColor: dark ? 'rgba(160,120,255,0.18)' : P.blueSoft }]}>
              <Icon name={tech === '5G' ? 'spark' : 'tower'} size={14} color={dark ? '#c7b8ff' : P.blue} stroke={2.2} />
            </View>
            <Text style={[c.title, dark && { color: '#fff' }]}>{tech === '5G' ? 'شبكة 5G' : 'شبكة 4G LTE'}</Text>
          </View>
          {!!badge && (
            <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 1 }}>
              {badge.split(' · ').map((b, i) => (
                <Text key={i} style={[c.sub, dark && { color: 'rgba(255,255,255,0.65)' }]}>{i ? `· ${b}` : b}</Text>
              ))}
            </View>
          )}
        </View>
        <View style={[c.state, { backgroundColor: active ? '#16c78422' : dark ? 'rgba(255,255,255,0.08)' : P.soft }]}>
          <View style={[c.dot, { backgroundColor: active ? '#16c784' : P.faint }]} />
          <Text style={[c.stateTxt, { color: active ? '#0d9e66' : dark ? 'rgba(255,255,255,0.6)' : P.sub }]}>
            {active ? 'متصل' : 'غير نشط'}
          </Text>
        </View>
      </View>
      {children}
    </View>
  );
}

/** البنق مرة وحدة فوق البطاقتين — النت يمشي على 4G و5G مع بعض فالبنق واحد */
function PingBar({ ping, to }: { ping?: number; to?: string }) {
  const lv = pingLevel(ping);
  const col = ping === undefined ? P.faint : LEVEL_COLOR[lv];
  return (
    <View style={pb.bar}>
      <View style={pb.valBox}>
        <Text style={[pb.val, { color: col }]}>{ping ?? '…'}</Text>
        <Text style={pb.unit}>ms</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={pb.title}>البنق{to ? ` لسيرفرات ${to}` : ''}</Text>
        <Text style={pb.sub}>واحد للشبكتين — النت يمشي على 4G و5G مع بعض</Text>
      </View>
      <View style={[pb.icon, { backgroundColor: col + '22' }]}>
        <Icon name="speed" size={18} color={col} />
      </View>
    </View>
  );
}

const pb = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#ffffff', borderRadius: 20, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: P.soft },
  valBox: { flexDirection: 'row', alignItems: 'baseline', gap: 3, minWidth: 74 },
  val: { fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  unit: { fontSize: 12, color: P.sub, fontWeight: '700' },
  title: { fontSize: 14, fontWeight: '800', color: P.text, textAlign: 'right' },
  sub: { fontSize: 11, color: P.sub, textAlign: 'right', marginTop: 2 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});

export function NetPanel({ signal, ping, pingTo }: { signal: Signal | null; ping?: number; pingTo?: string }) {
  if (!signal) return null;
  const s = signal;
  const lteBand = parseBands(s.band).filter(b => b.startsWith('B')).join('+') || s.band;
  const nrBand = parseNrBands(s.nrBand).join('+') || s.nrBand;
  const hasNr = s.nrRsrp !== undefined || !!s.nrBand;
  const bw = [s.dlBandwidth, s.ulBandwidth].filter(Boolean).join(' / ');
  const hasLte = s.rsrp !== undefined || !!s.band;
  const mode = hasNr ? 'مزدوج مع 5G' : '4G فقط';
  // في 5G NSA: الـ 4G هو الأساسي (ماسك الاتصال) والـ 5G ثانوي للسرعة
  const lteRole = hasNr ? '⭐ أساسي' : '';
  const nrRole = hasLte ? 'ثانوي للسرعة' : '⭐ أساسي (5G SA)';

  return (
    <View style={{ gap: 12 }}>
      <PingBar ping={ping} to={pingTo} />
      <Card tech="4G" active={s.rsrp !== undefined} badge={`${lteBand || '—'}${lteRole ? ` · ${lteRole}` : ''} · ${mode}`}>
        <View style={c.gauges}>
          <Gauge icon="antenna" label="RSRP" unit="dBm" value={s.rsrp} level={rsrpLevel(s.rsrp)} r={ratio(s.rsrp, RANGES.rsrp)} />
          <Gauge icon="chart" label="RSRQ" unit="dB" value={s.rsrq} level={rsrqLevel(s.rsrq)} r={ratio(s.rsrq, RANGES.rsrq)} />
          <Gauge icon="spark" label="SINR" unit="dB" value={s.sinr} level={sinrLevel(s.sinr)} r={ratio(s.sinr, RANGES.sinr)} />
          {s.cqi !== undefined && <Gauge icon="speed" label="CQI" unit="0–15" value={s.cqi} level={cqiLevel(s.cqi)} r={ratio(s.cqi, RANGES.cqi)} />}
        </View>
        <View style={c.tiles}>
          <Tile icon="bands" label="الباند" value={lteBand} accent={P.blue} />
          <Tile icon="tower" label="PCI" value={s.pci} />
          <Tile icon="antenna" label="Cell ID" value={s.cellId} />
          <Tile icon="chart" label="RSSI" value={s.rssi !== undefined ? `${s.rssi} dBm` : undefined} />
          <Tile icon="layers" label="EARFCN" value={s.earfcn} />
          <Tile icon="speed" label="عرض النطاق" value={bw || undefined} />
        </View>
      </Card>

      {hasNr && (
        <Card tech="5G" dark active={s.nrRsrp !== undefined} badge={`${nrBand || '—'} · ${nrRole}`}>
          <View style={c.gauges}>
            <Gauge dark icon="antenna" label="RSRP" unit="dBm" value={s.nrRsrp} level={rsrpLevel(s.nrRsrp)} r={ratio(s.nrRsrp, RANGES.rsrp)} />
            <Gauge dark icon="chart" label="RSRQ" unit="dB" value={s.nrRsrq} level={rsrqLevel(s.nrRsrq)} r={ratio(s.nrRsrq, RANGES.rsrq)} />
            <Gauge dark icon="spark" label="SINR" unit="dB" value={s.nrSinr} level={sinrLevel(s.nrSinr)} r={ratio(s.nrSinr, RANGES.sinr)} />
            {s.nrCqi !== undefined && <Gauge dark icon="speed" label="CQI" unit="0–15" value={s.nrCqi} level={cqiLevel(s.nrCqi)} r={ratio(s.nrCqi, RANGES.cqi)} />}
          </View>
          <View style={c.tiles}>
            <Tile dark icon="bands" label="الباند" value={nrBand} accent="#c7b8ff" />
            <Tile dark icon="tower" label="PCI" value={s.nrPci} />
            <Tile dark icon="layers" label="NR-ARFCN" value={s.nrArfcn} />
            <Tile dark icon="speed" label="عرض النطاق" value={s.nrDlBandwidth} />
          </View>
        </Card>
      )}
    </View>
  );
}

const g = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center' },
  val: { fontWeight: '800', letterSpacing: -0.5, maxWidth: 50, textAlign: 'center' },
  lblRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3, marginTop: -4 },
  lbl: { fontSize: 11.5, fontWeight: '800' },
  unit: { fontSize: 9.5, color: P.sub, fontWeight: '600' },
});
const t = StyleSheet.create({
  tile: {
    width: '48.5%', flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    backgroundColor: P.soft, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: P.border,
  },
  tileDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)' },
  icon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  lbl: { color: P.sub, fontSize: 10.5, fontWeight: '700' },
  val: { color: P.text, fontSize: 14.5, fontWeight: '800' },
});
const c = StyleSheet.create({
  card: { backgroundColor: P.card, borderRadius: 22, padding: 14, gap: 12, borderWidth: 1.5, borderColor: P.border, ...shadow },
  hIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cardDark: { backgroundColor: '#14224a', borderColor: '#24366b' },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  techPill: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  techTxt: { color: '#fff', fontSize: 17, fontWeight: '800' },
  title: { color: P.text, fontSize: 15, fontWeight: '800' },
  sub: { color: P.sub, fontSize: 11.5 },
  state: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  stateTxt: { fontSize: 11, fontWeight: '800' },
  gauges: { flexDirection: 'row-reverse' },
  tiles: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
});
