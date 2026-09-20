import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { C } from './theme';
import { fmtBytes } from '../utils/format';

export function UsageRing({ download, upload, size = 176 }: { download: number; upload: number; size?: number }) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const total = download + upload;
  const d = total ? download / total : 0;
  const u = total ? upload / total : 0;
  const gap = total ? c * 0.012 : 0;
  const rot = `rotate(-90 ${cx} ${cx})`;

  return (
    <View style={{ gap: 16 }}>
      <View style={{ alignSelf: 'center', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={cx} cy={cx} r={r} stroke={C.track} strokeWidth={stroke} fill="none" />
          <Circle cx={cx} cy={cx} r={r} stroke={C.blue} strokeWidth={stroke} fill="none"
            strokeDasharray={`${Math.max(c * d - gap, 0)} ${c}`} transform={rot} />
          <Circle cx={cx} cy={cx} r={r} stroke={C.violet} strokeWidth={stroke} fill="none"
            strokeDasharray={`${Math.max(c * u - gap, 0)} ${c}`} strokeDashoffset={-c * d} transform={rot} />
        </Svg>
        <Text style={s.total}>{fmtBytes(total)}</Text>
        <Text style={s.totalLabel}>الإجمالي</Text>
      </View>
      <View style={s.row}>
        <Stat arrow="↑" color={C.violet} label="رفع" value={fmtBytes(upload)} />
        <Stat arrow="↓" color={C.blue} label="تنزيل" value={fmtBytes(download)} />
      </View>
    </View>
  );
}

function Stat({ arrow, color, label, value }: { arrow: string; color: string; label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.arrow, { color }]}>{arrow}</Text>
      <View>
        <Text style={s.statVal}>{value}</Text>
        <Text style={s.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  total: { color: C.text, fontSize: 22, fontWeight: '800' },
  totalLabel: { color: C.sub, fontSize: 12, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  arrow: { fontSize: 24, fontWeight: '800' },
  statVal: { color: C.text, fontWeight: '700', fontSize: 15 },
  statLabel: { color: C.sub, fontSize: 12, textAlign: 'right' },
});
