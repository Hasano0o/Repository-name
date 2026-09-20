import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import Svg, { G, Circle, Rect } from 'react-native-svg';
import { C } from './theme';

const SEGMENTS = 16;
const AC = Animated.createAnimatedComponent(Rect);

function Segment({ index, active, color, cx, r, w, h }: {
  index: number; active: boolean; color: string; cx: number; r: number; w: number; h: number;
}) {
  const a = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(a, {
      toValue: active ? 1 : 0,
      duration: 260,
      delay: active ? index * 18 : 0,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [active, a, index]);

  const angle = -90 + (index * 360) / SEGMENTS;
  const grow = a.interpolate({ inputRange: [0, 1], outputRange: [h * 0.45, h] });
  const y = a.interpolate({ inputRange: [0, 1], outputRange: [cx - r - h * 0.45, cx - r - h] });
  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.22, 1] });

  return (
    <G rotation={angle} origin={`${cx}, ${cx}`}>
      <AC x={cx - w / 2} y={y} width={w} height={grow} rx={w / 2} fill={color} opacity={opacity} />
    </G>
  );
}

export function SignalRing({ score, color, label, sub, note, size = 150 }: {
  score: number; color: string; label: string; sub: string; note?: string; size?: number;
}) {
  const val = Math.max(0, Math.min(1, score));
  const lit = Math.round(val * SEGMENTS);
  const cx = size / 2;
  const r = size * 0.34;
  const segW = size * 0.035;
  const segH = size * 0.1;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={cx} cy={cx} r={r - segW} stroke={C.track} strokeWidth={1.5} fill="none" />
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <Segment key={i} index={i} active={i < lit} color={i < lit ? color : C.track}
            cx={cx} r={r} w={segW} h={segH} />
        ))}
      </Svg>
      <Svg width={size * 0.16} height={size * 0.16} viewBox="0 0 24 24" style={{ marginBottom: size * 0.015 }}>
        <Rect x={3} y={14} width={3.4} height={7} rx={1.7} fill={color} opacity={val > 0.05 ? 1 : 0.25} />
        <Rect x={8.4} y={10} width={3.4} height={11} rx={1.7} fill={color} opacity={val > 0.3 ? 1 : 0.25} />
        <Rect x={13.8} y={6} width={3.4} height={15} rx={1.7} fill={color} opacity={val > 0.55 ? 1 : 0.25} />
        <Rect x={19.2} y={2} width={3.4} height={19} rx={1.7} fill={color} opacity={val > 0.78 ? 1 : 0.25} />
      </Svg>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start' }}>
        <Text style={[s.ringPct, { fontSize: size * 0.24, color: C.text }]}>{Math.round(val * 100)}</Text>
        <Text style={[s.ringPctSign, { fontSize: size * 0.11, marginTop: size * 0.045 }]}>٪</Text>
      </View>
      <Text style={[s.ringLabel, { color, fontSize: size * 0.105 }]}>{label}</Text>
      {!!sub && <Text style={[s.sub, { fontSize: size * 0.082 }]}>{sub}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  ringPct: { fontWeight: '800', letterSpacing: -0.5 },
  ringPctSign: { color: C.muted, fontWeight: '700' },
  ringLabel: { fontWeight: '800', marginTop: -2 },
  label: { fontSize: 26, fontWeight: '800' },
  sub: { color: C.muted, marginTop: 1, fontWeight: '600' },
  note: { color: C.muted, fontSize: 11, marginTop: 2 },
});
