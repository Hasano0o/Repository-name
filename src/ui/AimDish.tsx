import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { G, Path, Circle, Rect } from 'react-native-svg';
import { C } from './theme';

interface Props {
  score: number;
  label: string;
  sub?: string;
  size?: number;
  active?: boolean;
}

function colorFor(v: number): string {
  if (v >= 0.72) return '#fbbf24';
  if (v >= 0.45) return '#22c55e';
  if (v >= 0.25) return '#f59e0b';
  return '#dc2626';
}

export function AimDish({ score, label, sub, size = 220, active = true }: Props) {
  const val = Math.max(0, Math.min(1, score));
  const [angle, setAngle] = useState(0);
  const dirRef = useRef(1);

  const range = 3 + (1 - val) * 19;
  const step = 1.1;

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      setAngle(a => {
        const next = a + dirRef.current * step;
        if (next > range) { dirRef.current = -1; return range; }
        if (next < -range) { dirRef.current = 1; return -range; }
        return next;
      });
    }, 40);
    return () => clearInterval(iv);
  }, [range, active]);

  const col = colorFor(val);
  const glowSize = size * (0.72 + val * 0.26);
  const glowOpacity = 0.10 + val * 0.28;
  const showWaves = val > 0.35;

  return (
    <View style={[s.wrap, { width: size }]}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.08,
          width: glowSize,
          height: glowSize,
          borderRadius: glowSize / 2,
          backgroundColor: col,
          opacity: glowOpacity,
          alignSelf: 'center',
        }}
      />
      <View style={{ width: size, height: size }}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100">
          <G rotation={angle} origin="50, 55">
            <Rect x={47} y={82} width={6} height={10} fill={col} opacity={0.75} />
            <Rect x={40} y={90} width={20} height={3} rx={1.5} fill={col} opacity={0.75} />
            <Rect x={48} y={72} width={4} height={20} fill={col} opacity={0.75} />
            <Path d="M 22 55 Q 50 92 78 55 Z" fill={col} opacity={0.9} />
            <Path d="M 32 55 Q 50 82 68 55 Z" fill="#ffffff" opacity={0.2} />
            <Path d="M 50 43 L 22 55" stroke={col} strokeWidth={1.3} opacity={0.7} />
            <Path d="M 50 43 L 78 55" stroke={col} strokeWidth={1.3} opacity={0.7} />
            <Circle cx={50} cy={38} r={5} fill={col} />
            <Circle cx={50} cy={38} r={2.2} fill="#0d2350" opacity={0.5} />
            {showWaves && (
              <>
                <Path d="M 44 30 A 8 8 0 0 0 56 30" stroke={col} strokeWidth={2} fill="none" strokeLinecap="round" opacity={val > 0.72 ? 1 : 0.7} />
                <Path d="M 40 26 A 14 14 0 0 0 60 26" stroke={col} strokeWidth={2} fill="none" strokeLinecap="round" opacity={val > 0.72 ? 1 : 0.5} />
                {val > 0.6 && (
                  <Path d="M 36 22 A 20 20 0 0 0 64 22" stroke={col} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.75} />
                )}
              </>
            )}
          </G>
        </Svg>
      </View>
      <View style={s.textBox}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start' }}>
          <Text style={[s.pct, { color: col, fontSize: size * 0.22 }]}>{Math.round(val * 100)}</Text>
          <Text style={[s.pctSign, { fontSize: size * 0.10, marginTop: size * 0.03 }]}>٪</Text>
        </View>
        <Text style={[s.label, { color: col, fontSize: size * 0.11 }]}>{label}</Text>
        {!!sub && <Text style={[s.sub, { fontSize: size * 0.065 }]}>{sub}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center' },
  textBox: { alignItems: 'center', marginTop: -8 },
  pct: { fontWeight: '900', letterSpacing: -1 },
  pctSign: { color: C.muted, fontWeight: '800' },
  label: { fontWeight: '900', marginTop: -6 },
  sub: { color: C.muted, fontWeight: '700', marginTop: 4 },
});
