/**
 * «كل المزايا» (١٦ نوفمبر — طلب حسن): صفحة الراوتر صارت للقراءات بس،
 * وكل الأدوات هنا بأيقونات مثل تطبيقات الشركات. نفس الأدوات ونفس الشروط اللي كانت في صفحة الراوتر.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { ScrollView, View, Text, Pressable, TextInput } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession, dropSession, routerWrite } from '../../src/store/sessions';
import { getFeatCache, setFeatCache, RouterFeatures } from '../../src/store/featCache';
import { Icon, IconName } from '../../src/ui/Icon';
import { shade } from '../../src/ui/Cards';
import { C, S, isDark } from '../../src/ui/theme';
import { FONT } from '../../src/ui/fonts';
import { sheet, tr } from '../../src/i18n';
import { LabelCard } from '../../src/ui/LabelCard';

interface Item { key: string; title: string; icon: IconName; color: string; onPress: () => void }
interface Group { title: string; color: string; icon: IconName; tag: string; tagIcon: IconName; hot?: boolean; items: Item[] }

/** كم بلاطة تطلع قبل «المزيد» (صف واحد) */
const FIRST = 4;

/** لون فاتح للنص فوق الخلفية الداكنة */
function lift(hex: string, amt = 0.45): string {
  const n = hex.replace('#', '');
  const f = (i: number) => { const v = parseInt(n.slice(i, i + 2), 16); return Math.round(v + (255 - v) * amt).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(2) + f(4);
}

const CONTROL_DRIVERS = ['huawei-lte', 'zte', 'fiberhome', 'oppo', 'greenpacket', 'zyxel', 'demo'];

export default function Features() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [feat, setFeat] = useState<RouterFeatures | undefined>(id ? getFeatCache(id) : undefined);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

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

  const groups = useMemo<Group[]>(() => {
    if (!info) return [];
    const f = feat;
    const cell = f?.cellular ?? true;
    const go = (p: string) => () => router.push(p as Href);
    const rid = info.id;
    const notDevice = info.driverId !== 'device';
    const pick = (xs: (Item | false | undefined)[]) => xs.filter((x): x is Item => !!x);
    return [
      {
        title: 'الأكثر طلباً', color: '#2f6bff', icon: 'star', tag: 'الأهم دائماً', tagIcon: 'star', hot: true, items: pick([
          notDevice && cell && { key: 'newip', title: 'آي بي جديد', icon: 'refresh', color: '#0e7d93', onPress: go(`/newip/${rid}`) },
          CONTROL_DRIVERS.includes(info.driverId) && { key: 'control', title: 'مركز التحكم', icon: 'settings', color: '#4338ca', onPress: go(`/control/${rid}`) },
          { key: 'speed', title: 'السرعة', icon: 'speed', color: '#12b76a', onPress: go(`/speed/${rid}`) },
          !!f?.reboot && { key: 'reboot', title: 'إعادة التشغيل', icon: 'power', color: '#e5484d', onPress: onReboot },
        ]),
      },
      {
        title: 'الإشارة والأبراج', color: '#2f6bff', icon: 'tower', tag: 'تحكّم أفضل بإشارتك', tagIcon: 'bands', items: pick([
          cell && { key: 'antenna', title: 'الأنتنا', icon: 'antenna', color: '#f97316', onPress: go(`/antenna/${rid}`) },
          cell && { key: 'places', title: 'الأماكن', icon: 'pin', color: '#0ea5a4', onPress: go(`/places/${rid}`) },
          { key: 'details', title: 'التفاصيل', icon: 'chart', color: '#0891b2', onPress: go(`/details/${rid}`) },
          cell && { key: 'carriers', title: 'أفضل شركة', icon: 'globe', color: '#e0a100', onPress: go('/carriers') },
          !cell && !!f?.optic && { key: 'fiber', title: 'مستشار الفايبر', icon: 'spark', color: '#f97316', onPress: go(`/fiber/${rid}`) },
          (info.driverId === 'huawei-lte' || (info.driverId === 'fiberhome' && !!f?.antenna)) &&
            { key: 'hwtools', title: info.driverId === 'fiberhome' ? 'الأنتنا' : 'الأنتنا والباقة', icon: 'layers', color: '#ea580c', onPress: go(`/hwtools/${rid}`) },
          !!f?.network && { key: 'network', title: 'الشبكة', icon: 'settings', color: '#0891b2', onPress: go(`/network/${rid}`) },
          { key: 'monitor', title: 'المراقبة', icon: 'bell', color: '#f43f5e', onPress: go('/monitor') },
        ]),
      },
      {
        title: 'الألعاب', color: '#8b5cf6', icon: 'game', tag: 'العب بدون لاق', tagIcon: 'spark', items: pick([
          { key: 'lag', title: 'كاشف اللاق', icon: 'target', color: '#db2777', onPress: go(`/lag/${rid}`) },
        ]),
      },
      {
        title: 'الأجهزة والباقة', color: '#8b5cf6', icon: 'wifi', tag: 'كل ما يخص راوترك', tagIcon: 'settings', items: pick([
          { key: 'devices', title: 'الأجهزة', icon: 'phone', color: '#8b5cf6', onPress: go(`/device/${rid}`) },
          { key: 'heavy', title: 'وش يثقّل نتك؟', icon: 'down', color: '#e5484d', onPress: go(`/heavy/${rid}`) },
          cell && (!!f?.ussd || !!f?.sms) && { key: 'recharge', title: 'اشحن رصيدك', icon: 'spark', color: '#16a34a', onPress: go(`/recharge/${rid}`) },
          notDevice && { key: 'wifi', title: 'شارك الواي فاي', icon: 'wifi', color: '#2f6bff', onPress: go(`/wifi/${rid}`) },
          !!f?.sms && { key: 'sms', title: 'الرسائل', icon: 'sms', color: '#16a34a', onPress: go(`/sms/${rid}`) },
        ]),
      },
      {
        title: 'ملفاتي', color: '#d97706', icon: 'folder', tag: 'ملفاتك بسهولة', tagIcon: 'folder', items: pick([
          { key: 'profiles', title: 'ملفاتي', icon: 'folder', color: '#a16207', onPress: go(`/profiles/${rid}`) },
        ]),
      },
    ];
  }, [info, feat, onReboot]);

  const needle = q.trim().toLowerCase();
  const shown = groups
    .map(g => ({ ...g, items: needle ? g.items.filter(it => it.title.includes(q.trim()) || tr(it.title).toLowerCase().includes(needle)) : g.items }))
    .filter(g => g.items.length);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'كل المزايا' }} />
      <View style={s.search}>
        <Icon name="search" size={18} color={C.sub} />
        <TextInput value={q} onChangeText={setQ} placeholder="دوّر على ميزة…" placeholderTextColor={C.sub} style={s.searchIn} />
      </View>
      {!info && <Text style={s.empty}>...</Text>}
      {!!info && !shown.length && <Text style={s.empty}>ما لقينا ميزة بهالاسم</Text>}
      {shown.map(g => {
        const more = !needle && g.items.length > FIRST;
        const isOpen = !!open[g.title];
        const items = more && !isOpen ? g.items.slice(0, FIRST) : g.items;
        const ink = isDark ? lift(g.color) : g.color;
        return (
          <View key={g.title} style={s.group}>
            <View style={s.gHead}>
              {g.hot ? (
                <LinearGradient colors={['#1e3a8a', '#2f6bff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.hot}>
                  <Icon name="spark" size={16} color="#ffb020" stroke={2.4} />
                  <Text style={s.hotTxt}>{g.title}</Text>
                </LinearGradient>
              ) : (
                <View style={s.gTitleRow}>
                  <View style={[s.gIcon, { backgroundColor: g.color + '22' }]}>
                    <Icon name={g.icon} size={17} color={ink} stroke={2.2} />
                  </View>
                  <Text style={s.gTitle}>{g.title}</Text>
                </View>
              )}
              <View style={[s.tag, { backgroundColor: g.color + (isDark ? '26' : '18') }]}>
                <Icon name={g.tagIcon} size={13} color={ink} stroke={2.3} />
                <Text style={[s.tagTxt, { color: ink }]} numberOfLines={1}>{g.tag}</Text>
              </View>
            </View>
            <View style={s.grid}>
              {items.map(it => (
                <View key={it.key} style={s.cell}>
                  <Pressable onPress={it.onPress} accessibilityRole="button" accessibilityLabel={it.title}
                    style={({ pressed }) => [s.tileWrap, { shadowColor: it.color }, pressed && { opacity: 0.85, transform: [{ scale: 0.95 }] }]}>
                    <LinearGradient colors={[it.color, shade(it.color, 0.3)]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={s.tile}>
                      <LinearGradient colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']} style={s.gloss} pointerEvents="none" />
                      <Icon name={it.icon} size={30} color="#fff" stroke={2.2} />
                      <Text style={s.tileTxt} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}>{it.title}</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              ))}
            </View>
            {more && (
              <Pressable onPress={() => setOpen(o => ({ ...o, [g.title]: !isOpen }))} accessibilityRole="button"
                style={({ pressed }) => [s.moreBtn, pressed && { opacity: 0.7 }]}>
                <Text style={s.moreTxt}>{isOpen ? 'أقل' : 'المزيد'}</Text>
                <Icon name={isOpen ? 'up' : 'down'} size={14} color={C.text} stroke={2.4} />
              </Pressable>
            )}
          </View>
        );
      })}
      {!!info && !needle && info.host !== 'demo' && info.host !== 'device' && <LabelCard routerId={info.id} />}
    </ScrollView>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: 14, paddingBottom: 40 },
  search: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.card, borderColor: C.cardBorder,
    borderWidth: 1.5, borderRadius: 26, paddingHorizontal: 16,
  },
  searchIn: { flex: 1, color: C.text, fontFamily: FONT.medium, fontSize: 14, paddingVertical: 12, textAlign: 'right' },
  empty: { color: C.sub, textAlign: 'center', fontFamily: FONT.medium, marginTop: 20 },
  group: {
    backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.2, borderRadius: 24, paddingTop: 12, paddingBottom: 14, paddingHorizontal: 8,
    shadowColor: '#0b1530', shadowOpacity: isDark ? 0.35 : 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  gHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginHorizontal: 6, marginBottom: 12 },
  gTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flexShrink: 1 },
  gIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  gTitle: { color: C.text, fontFamily: FONT.bold, fontSize: 16 },
  hot: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  hotTxt: { color: '#fff', fontFamily: FONT.bold, fontSize: 15.5 },
  tag: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, flexShrink: 1 },
  tagTxt: { fontFamily: FONT.bold, fontSize: 11.5 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', rowGap: 10 },
  cell: { width: '25%', paddingHorizontal: 4 },
  tileWrap: { borderRadius: 18, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  tile: {
    height: 92, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 4, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  gloss: { position: 'absolute', top: 0, left: 0, right: 0, height: '50%' },
  tileTxt: { color: '#fff', fontFamily: FONT.bold, fontSize: 12, textAlign: 'center', lineHeight: 16 },
  moreBtn: {
    alignSelf: 'flex-start', flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 12, marginHorizontal: 6,
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder,
  },
  moreTxt: { color: C.text, fontFamily: FONT.bold, fontSize: 13 },
});
