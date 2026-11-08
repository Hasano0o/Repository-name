/**
 * مربعات الترددات الصغيرة بنفس ألوان «الأساسي والثانوي»:
 * الأساسي أزرق · الثانوي 4G برتقالي · 5G بنفسجي. تلتف لسطر ثاني لو الشاشة ضيقة.
 * onHero: داخل الترويسة الزرقاء — حد أبيض خفيف عشان الأساسي الأزرق يبان على الأزرق.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { View, Text } from '../i18n/rn';
import { sheet } from '../i18n';
import { FONT } from './fonts';
import type { BandChip, BandChipKind } from '../utils/bandChips';

const GRAD: Record<BandChipKind, [string, string]> = {
  pcc: ['#1f5eff', '#3b8bff'],
  lte: ['#ea580c', '#fb923c'],
  nr: ['#7c3aed', '#a78bfa'],
};

export function BandChips({ chips, onHero, center, max = 6 }: { chips: BandChip[]; onHero?: boolean; center?: boolean; max?: number }) {
  if (!chips.length) return null;
  const shown = chips.slice(0, max);
  const more = chips.length - shown.length;
  return (
    <View style={[s.row, center && { justifyContent: 'center' }]}>
      {shown.map((c, i) => (
        <LinearGradient key={i + c.label} colors={GRAD[c.kind]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[s.chip, onHero && s.onHero]}>
          <Text style={s.txt} numberOfLines={1}>{c.label}</Text>
        </LinearGradient>
      ))}
      {more > 0 && (
        <View style={[s.chip, s.more]}><Text style={s.txt}>+{more}</Text></View>
      )}
    </View>
  );
}

const s = sheet({
  row: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  chip: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1.5, minWidth: 30, alignItems: 'center' },
  onHero: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' },
  more: { backgroundColor: 'rgba(127,127,127,0.35)' },
  txt: { color: '#ffffff', fontSize: 11.5, fontWeight: '800', fontFamily: FONT.bold, lineHeight: 15 },
});
