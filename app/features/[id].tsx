/**
 * «كل المزايا» (١٦ نوفمبر — طلب حسن؛ ٢٢ نوفمبر — تصميم حسن المعتمد):
 * كل الأدوات ظاهرة (بدون «المزيد») · أيقونات صغيرة ٤ بالصف · لون واحد لكل قسم ·
 * حبات أقسام فوق تنزل للقسم · «بيانات الملصق» فوق · الأقسام في src/ui/featureGroups.ts (نفس الشروط).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView as RNScrollView } from 'react-native';
import { ScrollView, View, Text, Pressable, TextInput } from '../../src/i18n/rn';
import { Stack, useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession, dropSession, routerWrite } from '../../src/store/sessions';
import { getFeatCache, setFeatCache, RouterFeatures } from '../../src/store/featCache';
import { Icon } from '../../src/ui/Icon';
import { C, S, isDark } from '../../src/ui/theme';
import { FONT } from '../../src/ui/fonts';
import { sheet, tr } from '../../src/i18n';
import { LabelCard } from '../../src/ui/LabelCard';
import { buildFeatureGroups, FeatGroup } from '../../src/ui/featureGroups';

/** لون فاتح للأيقونة فوق الخلفية الداكنة */
function lift(hex: string, amt = 0.45): string {
  const n = hex.replace('#', '');
  const f = (i: number) => { const v = parseInt(n.slice(i, i + 2), 16); return Math.round(v + (255 - v) * amt).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(2) + f(4);
}
const ink = (c: string) => (isDark ? lift(c) : c);
const soft = (c: string) => c + (isDark ? '33' : '1c');

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

  return (
    <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'كل المزايا' }} />
      <View style={s.search}>
        <Icon name="search" size={18} color={C.sub} />
        <TextInput value={q} onChangeText={setQ} placeholder="دوّر على ميزة…" placeholderTextColor={C.sub} style={s.searchIn} />
      </View>

      {!needle && groups.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {[{ key: 'all', short: 'الكل' }, ...groups].map(g => {
            const on = active === g.key;
            return (
              <Pressable key={g.key} onPress={() => jump(g.key)} accessibilityRole="button"
                style={({ pressed }) => [s.chip, on && s.chipOn, pressed && { opacity: 0.75 }]}>
                <Text style={[s.chipTxt, on && s.chipTxtOn]}>{g.short}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {!!info && !needle && info.host !== 'demo' && info.host !== 'device' && <LabelCard routerId={info.id} />}

      {!info && <Text style={s.empty}>...</Text>}
      {!!info && !shown.length && <Text style={s.empty}>ما لقينا ميزة بهالاسم</Text>}

      {shown.map(g => (
        <View key={g.key} style={s.group} onLayout={e => { ys.current[g.key] = e.nativeEvent.layout.y; }}>
          <View style={s.gHead}>
            <View style={[s.gIcon, { backgroundColor: soft(g.color) }]}>
              <Icon name={g.icon} size={16} color={ink(g.color)} stroke={2.3} />
            </View>
            <Text style={s.gTitle}>{g.title}</Text>
            <Text style={s.gCount}>{String(g.items.length)}</Text>
          </View>
          <View style={s.grid}>
            {g.items.map(it => (
              <Pressable key={it.key} onPress={it.onPress} accessibilityRole="button" accessibilityLabel={it.title}
                style={({ pressed }) => [s.cell, pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }]}>
                <View style={[s.ic, { backgroundColor: soft(g.color) }]}>
                  <Icon name={it.icon} size={24} color={ink(g.color)} stroke={2.1} />
                </View>
                <Text style={s.lb} numberOfLines={2}>{it.title}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: 12, paddingBottom: 40 },
  search: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.card, borderColor: C.cardBorder,
    borderWidth: 1.5, borderRadius: 26, paddingHorizontal: 16,
  },
  searchIn: { flex: 1, color: C.text, fontFamily: FONT.medium, fontSize: 14, paddingVertical: 12, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', gap: 8, paddingVertical: 2 },
  chip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder },
  chipOn: { backgroundColor: isDark ? '#3b5bdb' : '#1e2a4a', borderColor: isDark ? '#3b5bdb' : '#1e2a4a' },
  chipTxt: { color: C.text, fontFamily: FONT.bold, fontSize: 13 },
  chipTxtOn: { color: '#fff' },
  empty: { color: C.sub, textAlign: 'center', fontFamily: FONT.medium, marginTop: 20 },
  group: {
    backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 20, paddingTop: 12, paddingBottom: 12, paddingHorizontal: 6,
    shadowColor: '#0b1530', shadowOpacity: isDark ? 0.3 : 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  gHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginHorizontal: 8, marginBottom: 12 },
  gIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  gTitle: { color: C.text, fontFamily: FONT.bold, fontSize: 15, flex: 1, textAlign: 'right' },
  gCount: { color: C.sub, fontFamily: FONT.medium, fontSize: 12 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', rowGap: 14 },
  cell: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  ic: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  lb: { color: C.text, fontFamily: FONT.medium, fontSize: 11.5, textAlign: 'center', lineHeight: 15 },
});
