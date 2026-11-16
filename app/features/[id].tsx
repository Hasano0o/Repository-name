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
import { C, S } from '../../src/ui/theme';
import { FONT } from '../../src/ui/fonts';
import { sheet, tr } from '../../src/i18n';
import { LabelCard } from '../../src/ui/LabelCard';

interface Item { key: string; title: string; icon: IconName; color: string; onPress: () => void }
interface Group { title: string; color: string; items: Item[] }

const CONTROL_DRIVERS = ['huawei-lte', 'zte', 'fiberhome', 'oppo', 'greenpacket', 'zyxel', 'demo'];

export default function Features() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [feat, setFeat] = useState<RouterFeatures | undefined>(id ? getFeatCache(id) : undefined);
  const [q, setQ] = useState('');

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
        title: 'الأكثر طلباً', color: '#0e7d93', items: pick([
          notDevice && cell && { key: 'newip', title: 'آي بي جديد', icon: 'refresh', color: '#0e7d93', onPress: go(`/newip/${rid}`) },
          CONTROL_DRIVERS.includes(info.driverId) && { key: 'control', title: 'مركز التحكم', icon: 'settings', color: '#4338ca', onPress: go(`/control/${rid}`) },
          { key: 'speed', title: 'السرعة', icon: 'speed', color: '#12b76a', onPress: go(`/speed/${rid}`) },
          !!f?.reboot && { key: 'reboot', title: 'إعادة التشغيل', icon: 'power', color: '#e5484d', onPress: onReboot },
        ]),
      },
      {
        title: 'الإشارة والأبراج', color: '#2f6bff', items: pick([
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
        title: 'الألعاب', color: '#ec4899', items: pick([
          { key: 'lag', title: 'كاشف اللاق', icon: 'target', color: '#db2777', onPress: go(`/lag/${rid}`) },
        ]),
      },
      {
        title: 'الأجهزة والباقة', color: '#8b5cf6', items: pick([
          { key: 'devices', title: 'الأجهزة', icon: 'phone', color: '#8b5cf6', onPress: go(`/device/${rid}`) },
          { key: 'heavy', title: 'وش يثقّل نتك؟', icon: 'down', color: '#e5484d', onPress: go(`/heavy/${rid}`) },
          cell && (!!f?.ussd || !!f?.sms) && { key: 'recharge', title: 'اشحن رصيدك', icon: 'spark', color: '#16a34a', onPress: go(`/recharge/${rid}`) },
          notDevice && { key: 'wifi', title: 'شارك الواي فاي', icon: 'wifi', color: '#2f6bff', onPress: go(`/wifi/${rid}`) },
          !!f?.sms && { key: 'sms', title: 'الرسائل', icon: 'sms', color: '#16a34a', onPress: go(`/sms/${rid}`) },
        ]),
      },
      {
        title: 'ملفاتي', color: '#a16207', items: pick([
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
        <Icon name="target" size={16} color={C.sub} />
        <TextInput value={q} onChangeText={setQ} placeholder="دوّر على ميزة…" placeholderTextColor={C.sub} style={s.searchIn} />
      </View>
      {!info && <Text style={s.empty}>...</Text>}
      {!!info && !shown.length && <Text style={s.empty}>ما لقينا ميزة بهالاسم</Text>}
      {shown.map(g => (
        <View key={g.title} style={s.group}>
          <View style={s.gHead}>
            <View style={[s.gMark, { backgroundColor: g.color }]} />
            <Text style={s.gTitle}>{g.title}</Text>
          </View>
          <View style={s.grid}>
            {g.items.map(it => (
              <Pressable key={it.key} onPress={it.onPress} accessibilityRole="button" accessibilityLabel={it.title}
                style={({ pressed }) => [s.item, pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] }]}>
                <LinearGradient colors={[it.color, shade(it.color)]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.ic}>
                  <Icon name={it.icon} size={25} color="#fff" stroke={2.1} />
                </LinearGradient>
                <Text style={s.lbl} numberOfLines={2}>{it.title}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {!!info && !needle && info.host !== 'demo' && info.host !== 'device' && <LabelCard routerId={info.id} />}
    </ScrollView>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: S.md, paddingBottom: 40 },
  search: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: C.card, borderColor: C.cardBorder,
    borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 14,
  },
  searchIn: { flex: 1, color: C.text, fontFamily: FONT.medium, fontSize: 14, paddingVertical: 11, textAlign: 'right' },
  empty: { color: C.sub, textAlign: 'center', fontFamily: FONT.medium, marginTop: 20 },
  group: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: 22, paddingVertical: 14, paddingHorizontal: 8 },
  gHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginHorizontal: 6, marginBottom: 12 },
  gMark: { width: 5, height: 18, borderRadius: 3 },
  gTitle: { color: C.text, fontFamily: FONT.bold, fontSize: 15.5 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', rowGap: 14 },
  item: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  ic: { width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  lbl: { color: C.text, fontFamily: FONT.medium, fontSize: 11.5, textAlign: 'center', lineHeight: 16 },
});
