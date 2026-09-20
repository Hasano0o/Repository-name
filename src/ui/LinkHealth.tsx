import { View, Text, StyleSheet } from 'react-native';
import { HealthItem, HEALTH_COLOR } from '../utils/linkHealth';
import { C, R, S } from './theme';

/** بطاقة "صحة الوصلة": ثلاثة أسطر، كل سطر بشريط وجملة تشرح وش يعني */
export function LinkHealthCard({ items }: { items: HealthItem[] }) {
  if (!items.length) return null;
  return (
    <View style={s.card}>
      <Text style={s.title}>صحة الوصلة</Text>
      <Text style={s.sub}>اللي يقرر سرعتك فعلياً — مو بس قوة الإشارة</Text>
      {items.map(it => (
        <View key={it.key} style={s.row}>
          <View style={s.head}>
            <Text style={s.name}>{it.title}</Text>
            <Text style={[s.val, { color: HEALTH_COLOR[it.level] }]}>{it.value}</Text>
          </View>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.max(4, Math.round(it.bar * 100))}%`, backgroundColor: HEALTH_COLOR[it.level] }]} />
          </View>
          <Text style={s.note}>{it.note}</Text>
        </View>
      ))}
    </View>
  );
}

/** نسخة مختصرة لشاشة التوجيه */
export function LinkHealthChips({ items }: { items: HealthItem[] }) {
  if (!items.length) return null;
  const short: Record<HealthItem['key'], string> = { efficiency: 'كفاءة', uplink: 'إرسال', mimo: 'مسارات' };
  return (
    <View style={s.chips}>
      {items.map(it => (
        <View key={it.key} style={[s.chip, { borderColor: HEALTH_COLOR[it.level] }]}>
          <Text style={s.chipLabel}>{short[it.key]}</Text>
          <Text style={[s.chipVal, { color: HEALTH_COLOR[it.level] }]}>{it.value.split(' · ')[0].replace(' من 23', '')}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, padding: S.lg, gap: S.md },
  title: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  sub: { color: C.muted, fontSize: 11.5, textAlign: 'right', marginTop: -S.sm },
  row: { gap: 6 },
  head: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: C.text, fontWeight: '700', fontSize: 13 },
  val: { fontWeight: '800', fontSize: 12.5 },
  track: { height: 7, borderRadius: R.pill, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row-reverse' },
  fill: { height: '100%', borderRadius: R.pill },
  note: { color: C.sub, fontSize: 11.5, textAlign: 'right', lineHeight: 17 },
  chips: { flexDirection: 'row-reverse', justifyContent: 'center', gap: S.sm, marginTop: S.sm },
  chip: { borderWidth: 1, borderRadius: R.md, paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center', backgroundColor: C.rowBg },
  chipLabel: { color: C.muted, fontSize: 10.5 },
  chipVal: { fontWeight: '800', fontSize: 12.5 },
});
