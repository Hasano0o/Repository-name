/**
 * اختيار سيرفر اللعبة — بلاطات بأعلام (٣ في الصف)، والمختار بتدرّج أزرق وتوهّج وعلامة ✓ بيضاء.
 * «أقرب سيرفر» ما له دولة فيطلع بأيقونة الموقع. تحت: وصف المنطقة المختارة.
 * نفس المكوّن في مُحسّن الألعاب وكاشف اللاق. (تصميم ١٧ نوفمبر — من صورة حسن)
 */
import { View, Text, Pressable } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { REGIONS, regionById } from '../utils/latency';
import { C, isDark } from './theme';
import { Icon } from './Icon';

import { sheet } from '../i18n';
const FLAG: Record<string, string> = {
  ae: '🇦🇪', sa: '🇸🇦', 'sa-ruh': '🇸🇦', 'sa-jed': '🇸🇦', qa: '🇶🇦', tr: '🇹🇷', eg: '🇪🇬',
  in: '🇮🇳', it: '🇮🇹', eu: '🇩🇪', fr: '🇫🇷', uk: '🇬🇧', se: '🇸🇪', sg: '🇸🇬', kr: '🇰🇷', us: '🇺🇸', br: '🇧🇷', cf: '📍',
};
export const flagOf = (id: string) => FLAG[id] ?? '🌐';

const BLUE = '#2f6bff';

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
        <View style={s.titleRow}>
          <LinearGradient colors={['#4f8bff', '#1d4ed8']} style={s.headIcon}>
            <Icon name="layers" size={17} color="#fff" stroke={2.3} />
          </LinearGradient>
          <Text style={s.title}>{title}</Text>
        </View>
        <View style={s.pill}>
          <Icon name="bands" size={14} color="#22c55e" stroke={2.8} />
          <Text style={s.pillTxt} numberOfLines={1}>أداء أفضل وأقل بنق</Text>
        </View>
      </View>
      <View style={s.grid}>
        {REGIONS.map(r => {
          const on = r.id === value;
          const body = (
            <>
              <Text style={s.flag}>{flagOf(r.id)}</Text>
              <Text style={[s.name, on && s.nameOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{r.name}</Text>
              {on ? (
                <View style={s.check}><Icon name="check" size={13} color={BLUE} stroke={3.2} /></View>
              ) : (
                <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="chevron" size={15} color={C.muted} stroke={2.4} /></View>
              )}
            </>
          );
          return (
            <View key={r.id} style={s.cell}>
              <Pressable
                onPress={() => onPick(r.id)}
                disabled={disabled && !on}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [on && s.glow, disabled && !on && s.dim, pressed && !on && s.pressed]}
              >
                {on ? (
                  <LinearGradient colors={['#4f8bff', '#1d4ed8']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={[s.tile, s.tileOn]}>
                    {body}
                  </LinearGradient>
                ) : (
                  <View style={s.tile}>{body}</View>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
      <View style={s.info}>
        <View style={s.infoIcon}><Text style={s.infoI}>i</Text></View>
        <Text style={s.infoTxt} numberOfLines={2}>{reg.hint}</Text>
      </View>
    </View>
  );
}

const s = sheet({
  card: {
    backgroundColor: C.card, borderColor: isDark ? '#2f6bff55' : C.cardBorder, borderWidth: 1.5, borderRadius: 24,
    paddingVertical: 14, paddingHorizontal: 9, gap: 12,
    shadowColor: BLUE, shadowOpacity: isDark ? 0.35 : 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 4 },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flexShrink: 1 },
  headIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontWeight: '900', fontSize: 16, textAlign: 'right' },
  pill: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16,
    backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder, flexShrink: 1,
  },
  pillTxt: { color: C.text, fontWeight: '700', fontSize: 11.5 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', rowGap: 9 },
  cell: { width: '33.333%', paddingHorizontal: 4 },
  tile: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6, minHeight: 50,
    paddingVertical: 10, paddingHorizontal: 9, borderRadius: 16,
    backgroundColor: C.rowBg, borderWidth: 1.2, borderColor: C.cardBorder,
  },
  tileOn: { borderColor: 'rgba(255,255,255,0.35)' },
  glow: {
    borderRadius: 16, shadowColor: BLUE, shadowOpacity: 0.55, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  flag: { fontSize: 24 },
  name: { flex: 1, color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right' },
  nameOn: { color: '#fff', fontSize: 14.5 },
  check: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  info: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 9, marginHorizontal: 4,
    backgroundColor: C.rowBg, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 11, borderWidth: 1, borderColor: C.cardBorder,
  },
  infoIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' },
  infoI: { color: C.blue, fontSize: 13, fontWeight: '900', fontStyle: 'italic' },
  infoTxt: { flex: 1, color: C.sub, fontSize: 12.5, fontWeight: '600', textAlign: 'right' },
});
