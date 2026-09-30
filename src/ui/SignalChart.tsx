import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { tBd } from './theme';

/** رسم قوة الإشارة (RSRP) — يسار = قديم، يمين = الآن */
export function SignalChart({ values, color, height = 120, min = -125, max = -60 }: {
  values: number[]; color: string; height?: number; min?: number; max?: number;
}) {
  const [w, setW] = useState(0);
  const pad = { t: 10, b: 10, l: 6, r: 10 };
  const H = height;
  let body = null;
  if (w > 0 && values.length >= 2) {
    const iw = w - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const y = (v: number) => pad.t + ih - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * ih;
    const pts = values.map((v, i) => ({ x: pad.l + (i * iw) / (values.length - 1), y: y(v) }));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], mx = (a.x + b.x) / 2;
      d += ` C ${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
    }
    const last = pts[pts.length - 1];
    body = (
      <Svg width={w} height={H}>
        <Defs>
          <LinearGradient id="sc" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.28" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {[-70, -90, -110].map(g => (
          <Line key={g} x1={0} x2={w} y1={y(g)} y2={y(g)} stroke={tBd('#edf1f8')} strokeWidth={1} strokeDasharray="4 5" />
        ))}
        <Path d={`${d} L ${last.x} ${pad.t + ih} L ${pts[0].x} ${pad.t + ih} Z`} fill="url(#sc)" />
        <Path d={d} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={last.x} cy={last.y} r={9} fill={color} opacity={0.18} />
        <Circle cx={last.x} cy={last.y} r={5} fill="#fff" stroke={color} strokeWidth={3} />
      </Svg>
    );
  }
  return <View style={{ height: H }} onLayout={e => setW(e.nativeEvent.layout.width)}>{body}</View>;
}
