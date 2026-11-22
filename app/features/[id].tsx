/**
 * «كل المزايا» (١٦ نوفمبر — طلب حسن؛ ٢٢ نوفمبر — تصميم حسن المعتمد):
 * كل الأدوات ظاهرة (بدون «المزيد») · أيقونات صغيرة ٤ بالصف · لون واحد لكل قسم ·
 * حبات أقسام فوق تنزل للقسم · «بيانات الملصق» فوق · الأقسام في src/ui/featureGroups.ts (نفس الشروط).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView as RNScrollView } from 'react-native';
import { ScrollView, View, Text, Pressable, TextInput } from '../../src/i18n/rn';
import { Stack, useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession, dropSession, routerWrite } from '../../src/store/sessions';
import { getFeatCache, setFeatCache, RouterFeatures } from '../../src/store/featCache';
import { Icon } from '../../src/ui/Icon';
import { C, S, isDark } from '../../src/ui/theme';
import { FONT } from '../../src/ui/fonts';
import { sheet, tr, EN_MODE } from '../../src/i18n';
import { LabelCard } from '../../src/ui/LabelCard';
import { buildFeatureGroups, FeatGroup } from '../../src/ui/featureGroups';

/** لون فاتح للأيقونة فوق الخلفية الداكنة */
function lift(hex: string, amt = 0.45): string {
  const n = hex.replace('#', '');
  const f = (i: number) => { const v = parseInt(n.slice(i, i + 2), 16); return Math.round(v + (255 - v) * amt).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(2) + f(4);
}
const ink = (c: string) => (isDark ? lift(c) : c);
/** حبات أقصر بالإنجليزي (العربي نفس اسم القسم المختصر) */
const EN_CHIP: Record<string, string> = { all: 'All', hot: 'Top', signal: 'Signal', devices: 'Devices' };

export default function Features() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [feat, setFeat] = useState<RouterFeatures | undefined>(id ? getFeatCache(id) : undefined);
  const [q, setQ] = useState('');
  const [active, setActive] = useState('all');
  const scroll = useRef<RNScrollView>(null);
  const ys = useRef<Record<string, number>>({});

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      if (!id) return;
      const r = await getRouter(id);
      if (!alive || !r) return;
      setInfo(r);
      if (getFeatCache(id)) return; // صفحة الراوتر عبّتها — ما نحتاج دخول جديد
      try {
        const f = await withSession(r, async d => ({
          bands: !!d.getBandConfig, sms: !!d.listSms, ussd: !!d.ussd, reboot: !!d.reboot, devices: !!d.getDevices,
          usage: !!d.getUsage, network: !!d.getApnProfiles || !!d.getDns, antenna: !!d.getAntenna,
          cellular: !!d.getSignal, optic: !!d.getOptic,
        }));
        setFeatCache(id, f);
        if (alive) setFeat(f);
      } catch {}
    })();
    return () => { alive = false; };
  }, [id]));

  const onReboot = useCallback(() => {
    if (!info) return;
    Alert.alert(
      'إعادة تشغيل الراوتر',
      'سيُقطع الاتصال مؤقتاً أثناء إعادة التشغيل — دقيقتين تقريباً حتى يرجع الإنترنت.\n\nكل الأجهزة المتصلة بالواي فاي بينقطع عنها النت خلال هالفترة.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'إعادة تشغيل', style: 'destructive', onPress: async () => {
            try {
              await routerWrite(info, d => (d.reboot ? d.reboot() : Promise.resolve()), { label: 'إعادة تشغيل' });
              dropSession(info.id);
              Alert.alert('تم', 'الراوتر يعيد التشغيل الحين');
              router.back();
            } catch (e: any) {
              Alert.alert('ما تم', e?.message ?? String(e));
            }
          },
        },
      ],
    );
  }, [info]);

  const groups = useMemo<FeatGroup[]>(() => {
    if (!info) return [];
    return buildFeatureGroups(info, feat, (p: string) => () => router.push(p as Href), onReboot);
  }, [info, feat, onReboot]);

  const needle = q.trim().toLowerCase();
  const shown = groups
    .map(g => ({ ...g, items: needle ? g.items.filter(it => it.title.includes(q.trim()) || tr(it.title).toLowerCase().includes(needle)) : g.items }))
    .filter(g => g.items.length);

  const jump = (key: string) => {
    setActive(key);
    const y = key === 'all' ? 0 : ys.current[key];
    if (y != null) scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  const insets = useSafeAreaInsets();
  const chips = [{ key: 'all', short: 'الكل', chipIcon: 'grid' as const }, ...groups];

  return (
    <LinearGradient colors={isDark ? [C.bg, C.bg] : ['#eef1ff', '#f6f3ff', '#eef6ff']} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'كل المزايا' }} />
      {/* الترويسة (تصميم حسن ٢٢ نوفمبر): رجوع · كل المزايا ✦ · الترس */}
      <View style={[s.head, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => info && router.push(`/add-router?id=${info.id}` as Href)} accessibilityRole="button" accessibilityLabel="تعديل الراوتر"
          style={({ pressed }) => [s.round, pressed && { opacity: 0.8 }]}>
          <Icon name="settings" size={24} color={ink('#2563eb')} stroke={2.4} />
        </Pressable>
        <View style={s.titleRow}>
          <Text style={s.title}>كل المزايا</Text>
          <Svg width={26} height={26} viewBox="0 0 24 24">
            <Path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8z" fill={ink('#2563eb')} />
            <Path d="M18.5 13l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="#60a5fa" />
          </Svg>
        </View>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="رجوع"
          style={({ pressed }) => [s.round, pressed && { opacity: 0.8 }]}>
          <Icon name="back" size={24} color={ink('#1e3a8a')} stroke={2.8} />
        </Pressable>
      </View>

      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 30 }]} keyboardShouldPersistTaps="handled">
        <View style={s.search}>
          <View style={s.searchIc}><Icon name="search" size={20} color={C.sub} stroke={2.4} /></View>
          <TextInput value={q} onChangeText={setQ} placeholder="دوّر على ميزة…" placeholderTextColor={C.sub} style={s.searchIn} />
        </View>

        {!needle && groups.length > 1 && (
          <View style={s.chips}>
            {chips.map(g => {
              const on = active === g.key;
              const ic = g.key === 'hot' ? '#f97316' : on ? '#ffffff' : ink('#2563eb');
              return (
                <Pressable key={g.key} onPress={() => jump(g.key)} accessibilityRole="button"
                  style={({ pressed }) => [s.chip, on && s.chipOn, pressed && { opacity: 0.8 }]}>
                  <Icon name={g.chipIcon} size={19} color={ic} stroke={2.3} />
                  <Text style={[s.chipTxt, on && s.chipTxtOn]} numberOfLines={1} adjustsFontSizeToFit>{EN_MODE ? (EN_CHIP[g.key] ?? g.short) : g.short}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {!!info && !needle && info.host !== 'demo' && info.host !== 'device' && <LabelCard routerId={info.id} />}

        {!info && <Text style={s.empty}>...</Text>}
        {!!info && !shown.length && <Text style={s.empty}>ما لقينا ميزة بهالاسم</Text>}

        {shown.map(g => (
          <View key={g.key} style={s.group} onLayout={e => { ys.current[g.key] = e.nativeEvent.layout.y; }}>
            <LinearGradient colors={isDark ? [g.color + '33', 'transparent'] : g.band} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.band}>
              <LinearGradient colors={[lift(g.color, 0.25), g.color]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.badge}>
                <Icon name={g.icon} size={22} color="#ffffff" stroke={2.4} />
              </LinearGradient>
              <Text style={s.gTitle}>{g.title}</Text>
              <View style={s.count}>
                <Text style={s.countTxt}>{`${g.items.length} ميزات`}</Text>
              </View>
            </LinearGradient>
            <View style={s.grid}>
              {g.items.map(it => (
                <Pressable key={it.key} onPress={it.onPress} accessibilityRole="button" accessibilityLabel={it.title}
                  style={({ pressed }) => [s.cell, pressed && { opacity: 0.75, transform: [{ scale: 0.95 }] }]}>
                  <View style={[s.icWrap, { shadowColor: it.color }]}>
                    <LinearGradient colors={isDark ? [it.color + '40', it.color + '22'] : [lift(it.color, 0.93), lift(it.color, 0.8)]}
                      start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.ic}>
                      <Icon name={it.icon} size={28} color={ink(it.color)} stroke={2.3} />
                    </LinearGradient>
                  </View>
                  <Text style={s.lb} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{it.title}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {!needle && !!info && (
          <View style={s.foot}>
            <View style={[s.footLine, { backgroundColor: '#a5b4fc' }]} />
            <Text style={s.footTxt}>كل ما تحتاجه في مكان واحد 🚀</Text>
            <View style={[s.footLine, { backgroundColor: '#c4b5fd' }]} />
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = sheet({
  head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingBottom: 8 },
  round: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#3b4b8a', shadowOpacity: isDark ? 0.3 : 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  title: { color: isDark ? '#f1f5f9' : '#1e2a5a', fontSize: 24, fontWeight: '900' },
  page: { paddingHorizontal: S.lg, paddingTop: 6, gap: 14 },
  search: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.card, borderColor: C.cardBorder,
    borderWidth: 1, borderRadius: 28, paddingHorizontal: 18,
    shadowColor: '#3b4b8a', shadowOpacity: isDark ? 0.3 : 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  searchIn: { flex: 1, color: C.text, fontFamily: FONT.medium, fontSize: 15, paddingVertical: 12, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', gap: 7, paddingVertical: 2 },
  searchIc: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.rowBg, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  chip: {
    flexGrow: 1, flexShrink: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 9, borderRadius: 22,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder,
    shadowColor: '#3b4b8a', shadowOpacity: isDark ? 0.25 : 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  chipOn: { backgroundColor: '#1e3a8a', borderColor: '#1e3a8a' },
  chipTxt: { color: C.text, fontWeight: '800', fontSize: 13.5, flexShrink: 1 },
  chipTxtOn: { color: '#fff' },
  empty: { color: C.sub, textAlign: 'center', fontFamily: FONT.medium, marginTop: 20 },
  group: {
    backgroundColor: C.card, borderColor: isDark ? C.cardBorder : '#ffffff', borderWidth: 1.5, borderRadius: 26, overflow: 'hidden', paddingBottom: 14,
    shadowColor: '#3b4b8a', shadowOpacity: isDark ? 0.3 : 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3,
  },
  band: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingRight: 0, paddingLeft: 12, height: 50, marginBottom: 12 },
  badge: { width: 50, height: 50, borderBottomLeftRadius: 18, alignItems: 'center', justifyContent: 'center' },
  gTitle: { color: isDark ? '#f1f5f9' : '#1e2a5a', fontSize: 18, fontWeight: '900', flex: 1, textAlign: 'right' },
  count: { backgroundColor: C.card, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: C.cardBorder },
  countTxt: { color: C.sub, fontSize: 12.5, fontWeight: '800' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', rowGap: 16, paddingHorizontal: 6 },
  cell: { width: '25%', alignItems: 'center', gap: 7, paddingHorizontal: 2 },
  icWrap: { borderRadius: 20, shadowOpacity: 0.28, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  ic: { width: 60, height: 54, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: isDark ? '#ffffff14' : '#ffffffcc' },
  lb: { color: C.text, fontWeight: '800', fontSize: 12.5, textAlign: 'center', lineHeight: 17 },
  foot: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 4 },
  footLine: { flex: 1, height: 2, borderRadius: 1, opacity: 0.6 },
  footTxt: { color: isDark ? '#e2e8f0' : '#1e2a5a', fontSize: 14, fontWeight: '900' },
});
