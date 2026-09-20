import { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { C } from './theme';

const SWEEP = 270;
const START = 135; // يبدأ من تحت يسار ويلف لتحت يمين

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const p0 = polar(cx, cy, r, from);
  const p1 = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

/**
 * عدّاد قوس بتدرج أخضر ← أزرق، الرقم في النص و"من 100" وشارة التقييم تحته.
 */
export function ArcGauge({ score, label, color, size = 150 }: {
  score: number; label: string; color: string; size?: number;
}) {
  const val = Math.max(0, Math.min(1, score));
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = anim.addListener(({ value }) => setShown(value));
    Animated.timing(anim, { toValue: val, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [val, anim]);

  const stroke = size * 0.085;
  const c = size / 2;
  const r = c - stroke / 2 - 2;
  const end = START + Math.max(0.01, shown) * SWEEP;
  const tip = polar(c, c, r, end);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="g" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#22c55e" />
            <Stop offset="0.55" stopColor="#14b8a6" />
            <Stop offset="1" stopColor="#2f6bff" />
          </LinearGradient>
        </Defs>
        <Circle cx={c} cy={c} r={r - stroke * 1.1} fill="#ffffff" opacity={0.85} />
        <Path d={arc(c, c, r, START, START + SWEEP)} stroke={C.track} strokeWidth={stroke} strokeLinecap="round" fill="none" />
        <Path d={arc(c, c, r, START, end)} stroke="url(#g)" strokeWidth={stroke} strokeLinecap="round" fill="none" />
        <Circle cx={tip.x} cy={tip.y} r={stroke * 0.32} fill="#ffffff" />
      </Svg>
      <Text style={[s.num, { fontSize: size * 0.27 }]}>{Math.round(shown * 100)}</Text>
      <Text style={[s.of, { fontSize: size * 0.075 }]}>من 100</Text>
      <View style={[s.pill, { backgroundColor: color }]}>
        <Text style={[s.pillText, { fontSize: size * 0.08 }]}>{label}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  num: { color: C.text, fontWeight: '800', letterSpacing: -1, marginTop: 6 },
  of: { color: C.muted, fontWeight: '600', marginTop: -4 },
  pill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 3, marginTop: 6 },
  pillText: { color: '#fff', fontWeight: '800' },
});
