/**
 * اختيار سيرفر اللعبة — بلاطات بأعلام (٣ في الصف)، والمختار بتدرّج أزرق وتوهّج وعلامة ✓ بيضاء.
 * «أقرب سيرفر» ما له دولة فيطلع بأيقونة الموقع. تحت: وصف المنطقة المختارة.
 * نفس المكوّن في مُحسّن الألعاب وكاشف اللاق. (تصميم ١٧ نوفمبر — من صورة حسن)
 */
import { useState } from 'react';
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

/** «السعودية (جدة)» ← الاسم «السعودية» + المدينة «جدة» في سطر ثاني (كانت الأسماء الطويلة تصغر لين ما تنقرى) */
export function splitName(name: string): [string, string] {
  const m = name.match(/^(.*?)\s*\((.+)\)\s*$/);
  return m ? [m[1], m[2]] : [name, ''];
}

const DEFAULT_TOP = ['sa-jed', 'sa-ruh', 'ae'];

/** أول ٣ بلاطات: المختار دايماً + الأقرب من آخر قياس (لو فيه) وإلا السعودية والإمارات */
export function topThree(value: string, ranked?: string[]): string[] {
  const pool = [...(ranked ?? []), ...DEFAULT_TOP, ...REGIONS.map(r => r.id)];
  const out = [value];
  for (const id of pool) {
    if (out.length >= 3) break;
    if (!out.includes(id) && REGIONS.some(r => r.id === id)) out.push(id);
  }
  return out;
}

export function RegionGrid({ value, onPick, disabled, title = 'سيرفر لعبتك', ranked }: {
  value: string;
  onPick: (id: string) => void;
  disabled?: boolean;
  title?: string;
  /** المناطق من الأقرب للأبعد (من «أي سيرفر أقرب لك؟») — تحدد أول ٣ بلاطات */
  ranked?: string[];
}) {
  const reg = regionById(value);
  const [all, setAll] = useState(false);
  const top = topThree(value, ranked);
  const list = all ? REGIONS : top.map(id => regionById(id));
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
        {list.map(r => {
          const on = r.id === value;
          const [nm, city] = splitName(r.name);
          const body = (
            <>
              <View style={s.tileTop}>
                <Text style={s.flag}>{flagOf(r.id)}</Text>
                {on ? (
                  <View style={s.check}><Icon name="check" size={12} color={BLUE} stroke={3.2} /></View>
                ) : (
                  <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="chevron" size={14} color={C.muted} stroke={2.4} /></View>
                )}
              </View>
              <Text style={[s.name, on && s.nameOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>{nm}</Text>
              {!!city && <Text style={[s.city, on && s.cityOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{city}</Text>}
            </>
          );
          return (
            <View key={r.id} style={s.cell}>
              <Pressable
                onPress={() => { onPick(r.id); setAll(false); }}
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
      <Pressable style={({ pressed }) => [s.allBtn, pressed && { opacity: 0.75 }]} onPress={() => setAll(a => !a)}>
        <Text style={s.allTxt}>{all ? 'اعرض أقل ▲' : `اعرض كل الدول (${REGIONS.length}) ▼`}</Text>
      </Pressable>
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
    minHeight: 72, gap: 4,
    paddingVertical: 9, paddingHorizontal: 10, borderRadius: 16,
    backgroundColor: C.rowBg, borderWidth: 1.2, borderColor: C.cardBorder,
  },
  tileTop: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  tileOn: { borderColor: 'rgba(255,255,255,0.35)' },
  glow: {
    borderRadius: 16, shadowColor: BLUE, shadowOpacity: 0.55, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  flag: { fontSize: 23 },
  name: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  nameOn: { color: '#fff', fontSize: 14 },
  city: { color: C.sub, fontWeight: '700', fontSize: 12, textAlign: 'right', marginTop: 1 },
  cityOn: { color: '#dbe6ff' },
  allBtn: {
    alignItems: 'center', paddingVertical: 10, marginHorizontal: 4, borderRadius: 14,
    borderWidth: 1, borderColor: isDark ? '#2f6bff66' : C.cardBorder, backgroundColor: C.rowBg,
  },
  allTxt: { color: C.blue, fontWeight: '800', fontSize: 13.5 },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  info: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 9, marginHorizontal: 4,
    backgroundColor: C.rowBg, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 11, borderWidth: 1, borderColor: C.cardBorder,
  },
  infoIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' },
  infoI: { color: C.blue, fontSize: 13, fontWeight: '900', fontStyle: 'italic' },
  infoTxt: { flex: 1, color: C.sub, fontSize: 12.5, fontWeight: '600', textAlign: 'right' },
});
