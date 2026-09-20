import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { G, Rect, Line, Circle, Text as SvgText } from 'react-native-svg';
import { C } from './theme';
import { LEVEL_COLOR, overallLevel } from '../utils/signal';

export interface RadarPoint { rsrp?: number; sinr?: number; }

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const SINR_MIN = -5, SINR_MAX = 30, RSRP_MIN = -130, RSRP_MAX = -60;

export function SignalRadar({ history }: { history: RadarPoint[] }) {
  const [w, setW] = useState(0);
  const h = 210;
  const pad = 26;
  const px = (v: number) => pad + clamp((v - SINR_MIN) / (SINR_MAX - SINR_MIN)) * (w - pad * 2);
  const py = (v: number) => pad + (1 - clamp((v - RSRP_MIN) / (RSRP_MAX - RSRP_MIN))) * (h - pad * 2);

  const pts = history.filter((p): p is Required<RadarPoint> => p.rsrp !== undefined && p.sinr !== undefined);
  const last = pts[pts.length - 1];
  const color = LEVEL_COLOR[overallLevel(last ?? null)];
  const grid = [0, 1, 2, 3, 4];

  return (
    <View>
      <View style={{ height: h }} onLayout={e => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Svg width={w} height={h}>
            <Rect x={pad} y={pad} width={Math.max(w - pad * 2, 0)} height={h - pad * 2} fill={C.rowBg} rx={12} />
            <Rect x={px(13)} y={pad} width={Math.max(w - pad - px(13), 0)} height={Math.max(py(-90) - pad, 0)} fill={C.green} opacity={0.12} rx={8} />
            <Rect x={pad} y={py(-100)} width={Math.max(px(0) - pad, 0)} height={Math.max(h - pad - py(-100), 0)} fill={C.red} opacity={0.1} rx={8} />
            {grid.map(i => {
              const gx = pad + (i * (w - pad * 2)) / 4;
              const gy = pad + (i * (h - pad * 2)) / 4;
              return (
                <G key={i}>
                  <Line x1={gx} y1={pad} x2={gx} y2={h - pad} stroke={C.cardBorder} strokeWidth={1} />
                  <Line x1={pad} y1={gy} x2={w - pad} y2={gy} stroke={C.cardBorder} strokeWidth={1} />
                </G>
              );
            })}
            {pts.slice(0, -1).map((p, i) => (
              <Circle key={i} cx={px(p.sinr)} cy={py(p.rsrp)} r={3} fill={color} opacity={((i + 1) / pts.length) * 0.5} />
            ))}
            {last && <Circle cx={px(last.sinr)} cy={py(last.rsrp)} r={15} fill={color} opacity={0.18} />}
            {last && <Circle cx={px(last.sinr)} cy={py(last.rsrp)} r={7} fill={color} />}
            <SvgText x={w - pad} y={h - 8} fill={C.muted} fontSize={10} textAnchor="end">SINR →</SvgText>
            <SvgText x={pad} y={16} fill={C.muted} fontSize={10} textAnchor="start">RSRP ↑</SvgText>
          </Svg>
        )}
      </View>
      <Text style={s.caption}>
        {last ? 'كل ما كانت النقطة أعلى ويمين، كان الاتصال أفضل' : 'ننتظر قراءات الإشارة...'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  caption: { color: C.sub, textAlign: 'center', fontSize: 12, marginTop: 4 },
});
