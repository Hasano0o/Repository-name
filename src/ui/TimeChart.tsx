import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { G, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { C } from './theme';

export interface Series {
  label: string;
  color: string;
  values: (number | undefined)[];
  min: number;
  max: number;
  unit: string;
}

export function TimeChart({ times, series, height = 170 }: {
  times: number[]; series: Series[]; height?: number;
}) {
  const [w, setW] = useState(0);
  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 22;

  const fmt = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const pts = (s: Series) => {
    const inner = w - padL - padR;
    const ih = height - padT - padB;
    const out: string[] = [];
    s.values.forEach((v, i) => {
      if (v === undefined) return;
      const x = padL + (times.length > 1 ? (i / (times.length - 1)) * inner : inner / 2);
      const norm = Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min)));
      const y = padT + (1 - norm) * ih;
      out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return out.join(' ');
  };

  return (
    <View>
      <View style={{ height }} onLayout={e => setW(e.nativeEvent.layout.width)}>
        {w > 0 && times.length > 1 && (
          <Svg width={w} height={height}>
            {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
              const y = padT + f * (height - padT - padB);
              return (
                <G key={i}>
                  <Line x1={padL} y1={y} x2={w - padR} y2={y} stroke={C.cardBorder} strokeWidth={1} />
                </G>
              );
            })}
            {series.map(s => (
              <Polyline key={s.label} points={pts(s)} fill="none" stroke={s.color} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {series[0] && (
              <>
                <SvgText x={4} y={padT + 8} fill={C.muted} fontSize={9}>{series[0].max}</SvgText>
                <SvgText x={4} y={height - padB} fill={C.muted} fontSize={9}>{series[0].min}</SvgText>
              </>
            )}
            <SvgText x={padL} y={height - 6} fill={C.muted} fontSize={9} textAnchor="start">{fmt(times[0])}</SvgText>
            <SvgText x={w - padR} y={height - 6} fill={C.muted} fontSize={9} textAnchor="end">
              {fmt(times[times.length - 1])}
            </SvgText>
          </Svg>
        )}
        {(w === 0 || times.length < 2) && (
          <View style={s2.empty}><Text style={s2.emptyText}>نحتاج قراءتين على الأقل لرسم المنحنى</Text></View>
        )}
      </View>
      <View style={s2.legend}>
        {series.map(s => (
          <View key={s.label} style={s2.legendItem}>
            <Text style={s2.legendText}>{s.label}</Text>
            <View style={[s2.dot, { backgroundColor: s.color }]} />
          </View>
        ))}
      </View>
    </View>
  );
}

const s2 = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: C.muted, fontSize: 12 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: C.sub, fontSize: 11, fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
