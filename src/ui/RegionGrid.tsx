/**
 * اختيار سيرفر اللعبة — مربعات بأعلام كبيرة (٣ في الصف)، والمختار أزرق بعلامة ✓.
 * «أقرب سيرفر» ما له دولة فيطلع بأيقونة الموقع. تحت: وصف المنطقة المختارة.
 * نفس المكوّن في مُحسّن الألعاب وكاشف اللاق.
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { REGIONS, regionById } from '../utils/latency';
import { C, isDark } from './theme';

const FLAG: Record<string, string> = {
  ae: '🇦🇪', in: '🇮🇳', it: '🇮🇹', eu: '🇩🇪', fr: '🇫🇷', uk: '🇬🇧', se: '🇸🇪', sg: '🇸🇬', us: '🇺🇸', cf: '📍',
};
export const flagOf = (id: string) => FLAG[id] ?? '🌐';

export function RegionGrid({ value, onPick, disabled, title = 'سيرفر لعبتك' }: {
  value: string;
  onPick: (id: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  const reg = regionById(value);
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.headIcon}>🖥️</Text>
        <Text style={s.title}>{title}</Text>
      </View>
      <View style={s.grid}>
        {REGIONS.map(r => {
          const on = r.id === value;
          return (
            <Pressable
              key={r.id}
              onPress={() => onPick(r.id)}
              disabled={disabled && !on}
              style={({ pressed }) => [s.tile, on && s.tileOn, disabled && !on && s.dim, pressed && !on && s.pressed]}
            >
              <Text style={s.flag}>{flagOf(r.id)}</Text>
              <Text style={[s.name, on && { color: C.onAccent }]} numberOfLines={1} adjustsFontSizeToFit>{r.name}</Text>
              {on ? (
                <View style={s.check}><Text style={s.checkTxt}>✓</Text></View>
              ) : (
                <Text style={s.chev}>‹</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={s.info}>
        <Text style={s.infoIcon}>ℹ️</Text>
        <Text style={s.infoTxt} numberOfLines={2}>{reg.hint}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: 20, padding: 12, gap: 10 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  headIcon: { fontSize: 16 },
  title: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '31%', flexGrow: 1, minWidth: 96,
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
    paddingVertical: 11, paddingHorizontal: 10, borderRadius: 16,
    backgroundColor: C.rowBg, borderWidth: 1.5, borderColor: C.cardBorder,
  },
  tileOn: {
    backgroundColor: C.blue, borderColor: C.blue,
    shadowColor: C.blue, shadowOpacity: isDark ? 0 : 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  flag: { fontSize: 24 },
  name: { flex: 1, color: C.text, fontWeight: '800', fontSize: 13.5, textAlign: 'right' },
  chev: { color: C.muted, fontSize: 18, fontWeight: '700', marginTop: -2 },
  check: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  checkTxt: { color: C.blue, fontSize: 12, fontWeight: '900' },
  info: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    backgroundColor: C.blueSoft, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10,
  },
  infoIcon: { fontSize: 14 },
  infoTxt: { flex: 1, color: C.sub, fontSize: 12, fontWeight: '600', textAlign: 'right' },
});
