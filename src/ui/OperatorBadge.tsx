/** شارة الشركة: اسم نظيف بلون الشركة (بدل الشعار). onHero = فوق خلفية ملوّنة ← حد أبيض خفيف */
import { View, Text } from '../i18n/rn';
import { sheet } from '../i18n';
import { brandOf, BRAND_COLOR, OTHER_COLOR } from '../utils/operatorBrand';

export function OperatorBadge({ name, onHero, small }: { name?: string | null; onHero?: boolean; small?: boolean }) {
  const b = brandOf(name);
  if (!b.label) return null;
  const bg = b.key ? BRAND_COLOR[b.key] : OTHER_COLOR;
  return (
    <View style={[s.pill, small && s.small, { backgroundColor: bg }, onHero && s.onHero]}>
      <Text style={[s.txt, small && s.txtSmall]} numberOfLines={1}>{b.label}</Text>
    </View>
  );
}

const s = sheet({
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, alignSelf: 'center', flexShrink: 1 },
  small: { paddingHorizontal: 7, paddingVertical: 1 },
  onHero: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
  txt: { color: '#ffffff', fontSize: 12.5, fontWeight: '700', lineHeight: 18 },
  txtSmall: { fontSize: 11, lineHeight: 15 },
});
