import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { C } from './theme';
import { Level, LEVEL_COLOR, LEVEL_LABEL } from '../utils/signal';

export interface RingSpec {
  label: string;
  value?: number;
  unit: string;
  level: Level;
  min: number;
  max: number;
  color?: string;
  caption?: string;
  mode?: 'value' | 'percent';
  /** التغيّر عن القراءة السابقة — يظهر سهم ▲▼ */
  delta?: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function MetricRing({ spec, size = 62 }: { spec: RingSpec; size?: number }) {
  const has = spec.value !== undefined && Number.isFinite(spec.value);
  const color = spec.color ?? (has ? LEVEL_COLOR[spec.level] : C.muted);
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const frac = has ? clamp01(((spec.value as number) - spec.min) / (spec.max - spec.min)) : 0;

  return (
    <View style={{ alignItems: 'center', gap: 7, width: size + 16 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.track} strokeWidth={6} />
          <Circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
            strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={[s.center, { width: size, height: size }]}>
          {spec.mode === 'percent' ? (
            <>
              <Text style={[s.value, { fontSize: size * 0.27 }]}>{has ? Math.round(frac * 100) : '—'}</Text>
              <Text style={s.unit}>٪</Text>
            </>
          ) : (
            <>
              <Text style={[s.value, { fontSize: size * 0.26 }]}>{has ? Math.round(spec.value as number) : '—'}</Text>
              <Text style={s.unit}>{spec.unit}</Text>
            </>
          )}
        </View>
      </View>
      <View style={{ alignItems: 'center', gap: 1 }}>
        <Text style={s.label}>{spec.label}</Text>
        <Text style={[s.state, { color }]}>
          {spec.caption ?? (spec.mode === 'percent' && has
            ? `${Math.round(spec.value as number)} ${spec.unit}`
            : has ? LEVEL_LABEL[spec.level] : '—')}
        </Text>
        {spec.delta !== undefined && Math.round(spec.delta) !== 0 && (
          <Text style={[s.delta, { color: spec.delta > 0 ? '#12b76a' : '#e5484d' }]}>
            {spec.delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(spec.delta))}
          </Text>
        )}
      </View>
    </View>
  );
}

export function MetricRings({ items, size = 62 }: { items: RingSpec[]; size?: number }) {
  return (
    <View style={s.row}>
      {items.map((it, i) => <MetricRing key={i} spec={it} size={size} />)}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-start' },
  center: { position: 'absolute', top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  value: { color: C.text, fontWeight: '700', lineHeight: undefined },
  unit: { color: C.muted, fontSize: 8, marginTop: 1 },
  label: { color: C.text, fontSize: 11, fontWeight: '600' },
  state: { fontSize: 9.5, fontWeight: '700' },
  delta: { fontSize: 10, fontWeight: '800' },
});
