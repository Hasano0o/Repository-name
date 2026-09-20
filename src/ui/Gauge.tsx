import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { C } from './theme';

export function Gauge({ score, color, label, sub, size = 220 }: {
  score: number; color: string; label: string; sub: string; size?: number;
}) {
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const val = Math.max(0, Math.min(1, score));
  const cx = size / 2;
  const rot = `rotate(135 ${cx} ${cx})`;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={cx} cy={cx} r={r} stroke={C.track} strokeWidth={stroke} fill="none"
          strokeDasharray={`${arc} ${c}`} strokeLinecap="round" transform={rot} />
        <Circle cx={cx} cy={cx} r={r} stroke={color} strokeOpacity={0.22} strokeWidth={stroke + 10} fill="none"
          strokeDasharray={`${arc * val} ${c}`} strokeLinecap="round" transform={rot} />
        <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${arc * val} ${c}`} strokeLinecap="round" transform={rot} />
      </Svg>
      <Text style={[s.label, { color }]}>{label}</Text>
      <Text style={s.sub}>{sub}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 32, fontWeight: '800' },
  sub: { color: C.sub, fontSize: 14, marginTop: 4, fontWeight: '600' },
});
