import { View, Text, StyleSheet } from 'react-native';
import { C } from './theme';
import { Level, LEVEL_COLOR, LEVEL_SOFT, LEVEL_LABEL } from '../utils/signal';

export interface TileSpec {
  label: string; code: string; value?: number; unit: string;
  level: Level; min: number; max: number; note: string;
}

const pct = (v: number, min: number, max: number) =>
  Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

export function MetricTile({ t }: { t: TileSpec }) {
  const has = t.value !== undefined && Number.isFinite(t.value);
  const color = has ? LEVEL_COLOR[t.level] : C.muted;
  const p = has ? pct(t.value as number, t.min, t.max) : 0;
  return (
    <View style={s.tile}>
      <View style={s.head}>
        <View style={[s.badge, { backgroundColor: has ? LEVEL_SOFT[t.level] : C.rowBg }]}>
          <Text style={[s.badgeTxt, { color }]}>{has ? LEVEL_LABEL[t.level] : '—'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{t.label}</Text>
          <Text style={s.code}>{t.code}</Text>
        </View>
      </View>
      <View style={s.valueRow}>
        <Text style={s.unit}>{t.unit}</Text>
        <Text style={[s.value, { color }]}>{has ? Math.round(t.value as number) : '—'}</Text>
      </View>
      <View style={s.barBg}>
        <View style={[s.bar, { width: `${p}%` as const, backgroundColor: color }]} />
      </View>
      <View style={s.scale}>
        <Text style={s.scaleTxt}>{t.max}</Text>
        <Text style={s.note}>{t.note}</Text>
        <Text style={s.scaleTxt}>{t.min}</Text>
      </View>
    </View>
  );
}

export function MetricTiles({ items }: { items: TileSpec[] }) {
  return <View style={s.grid}>{items.map((t, i) => <MetricTile key={i} t={t} />)}</View>;
}

const s = StyleSheet.create({
  grid: { gap: 10 },
  tile: { backgroundColor: C.rowBg, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, padding: 12, gap: 8 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  label: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  code: { color: C.muted, fontSize: 10.5, textAlign: 'right', marginTop: 1 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt: { fontWeight: '800', fontSize: 11.5 },
  valueRow: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 6 },
  value: { fontSize: 34, fontWeight: '900', lineHeight: 38 },
  unit: { color: C.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  barBg: { height: 8, borderRadius: 999, backgroundColor: C.track, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 999 },
  scale: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  scaleTxt: { color: C.muted, fontSize: 10 },
  note: { color: C.sub, fontSize: 10.5, flex: 1, textAlign: 'center' },
});
