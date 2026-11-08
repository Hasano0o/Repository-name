/**
 * شارة الشركة: اسم نظيف بلون الشركة (بدل الشعار) + الفعالية لو الشركة حاطتها في اسم الشبكة
 * («Zain HAJJ EXPO» ← [زين] [🎉 HAJJ EXPO]) — حبة بيضاء بخط بلون الشركة عشان تنقرى على أي خلفية.
 * onHero = فوق خلفية ملوّنة ← حد أبيض خفيف حول شارة الشركة.
 */
import { View, Text } from '../i18n/rn';
import { sheet } from '../i18n';
import { brandOf, BRAND_COLOR, OTHER_COLOR } from '../utils/operatorBrand';

export function OperatorBadge({ name, onHero, small, noEvent }: { name?: string | null; onHero?: boolean; small?: boolean; noEvent?: boolean }) {
  const b = brandOf(name);
  if (!b.label) return null;
  const bg = b.key ? BRAND_COLOR[b.key] : OTHER_COLOR;
  return (
    <View style={s.row}>
      <View style={[s.pill, small && s.small, { backgroundColor: bg }, onHero && s.onHero]}>
        <Text style={[s.txt, small && s.txtSmall]} numberOfLines={1}>{b.label}</Text>
      </View>
      {!!b.event && !noEvent && (
        <View style={[s.pill, small && s.small, s.event, { borderColor: bg + '66' }]}>
          <Text style={[s.txt, small && s.txtSmall, { color: bg }]} numberOfLines={1}>🎉 {b.event}</Text>
        </View>
      )}
    </View>
  );
}

const s = sheet({
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, flexShrink: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, flexShrink: 1 },
  small: { paddingHorizontal: 7, paddingVertical: 1 },
  onHero: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
  event: { backgroundColor: '#ffffff', borderWidth: 1 },
  txt: { color: '#ffffff', fontSize: 12.5, fontWeight: '700', lineHeight: 18 },
  txtSmall: { fontSize: 11, lineHeight: 15 },
});
