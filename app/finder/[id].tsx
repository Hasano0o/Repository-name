import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { Icon, IconName } from '../../src/ui/Icon';

const BLUE = '#3567F5';
const PURPLE = '#7655F5';
const TEXT = '#14264A';
const MUTED = '#71809A';
const BG = '#F4F8FF';
const SUCCESS = '#13B783';
const CARD = '#FFFFFF';
const BORDER = '#E6ECF5';

interface Item {
  key: string;
  icon: IconName;
  color: string;
  title: string;
  sub: string;
  tag?: string;
  path: string;
}
interface Section {
  key: string;
  icon: string;
  title: string;
  subtitle: string;
  items: Item[];
}

const SECTIONS: Section[] = [
  {
    key: 'auto',
    icon: '🚀',
    title: 'الأسرع تلقائياً',
    subtitle: 'يختار الأفضل لك بدون تعب',
    items: [
      {
        key: 'speed',
        icon: 'spark',
        color: '#7c5cff',
        title: 'أسرع إنترنت',
        sub: 'اختبار تلقائي شامل — يقفل ويقيس ويثبّت',
        tag: 'موصى به',
        path: 'optimize',
      },
      {
        key: 'anchor',
        icon: 'antenna',
        color: '#9333ea',
        title: 'مرساة 5G',
        sub: 'أي تردد 4G يفتح 5G في منطقتك',
        path: 'anchor',
      },
    ],
  },
  {
    key: 'manual',
    icon: '🎯',
    title: 'تحكم يدوي',
    subtitle: 'اختر الترددات وقفلها بنفسك',
    items: [
      {
        key: 'bands',
        icon: 'bands',
        color: '#2f6bff',
        title: 'قفل الترددات',
        sub: 'اختيار يدوي كامل + وضع الشبكة',
        path: 'bands',
      },
      {
        key: 'ca',
        icon: 'layers',
        color: '#0ea5a4',
        title: 'دمج 4G + 4G',
        sub: 'جرب تركيبات مثل B1+B3 و B3+B20',
        path: 'calab',
      },
      {
        key: 'nsa',
        icon: 'layers',
        color: '#f59e0b',
        title: 'دمج 4G + 5G (NSA)',
        sub: 'تركيبات مثل B20+n78 و B1+n41',
        tag: 'جديد',
        path: 'nsacombo',
      },
    ],
  },
  {
    key: 'diagnose',
    icon: '📊',
    title: 'تشخيص',
    subtitle: 'اعرف شبكتك وأبراجك',
    items: [
      {
        key: 'towers',
        icon: 'tower',
        color: '#12b76a',
        title: 'الأبراج والنواقل',
        sub: 'كل الأبراج + PCI + الدمج',
        path: 'towers',
      },
      {
        key: 'ping',
        icon: 'game',
        color: '#ec4899',
        title: 'قياس البنق',
        sub: 'مناسب للألعاب والاتصال',
        path: 'ping',
      },
    ],
  },
];

export default function Finder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}
      >
        <View style={s.header}>
          <Text style={s.lead}>وش تبي تسوي؟</Text>
          <Text style={s.sub}>3 أقسام — كل واحد فيه أدوات محددة</Text>
        </View>

        {SECTIONS.map((sec) => (
          <View key={sec.key} style={s.section}>
            <View style={s.secHead}>
              <Text style={s.secIcon}>{sec.icon}</Text>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={s.secTitle}>{sec.title}</Text>
                <Text style={s.secSub}>{sec.subtitle}</Text>
              </View>
            </View>
            <View style={{ gap: 8 }}>
              {sec.items.map((it) => (
                <Pressable
                  key={it.key}
                  style={({ pressed }) => [
                    s.card,
                    { borderColor: it.color + '40' },
                    pressed && { opacity: 0.75, transform: [{ scale: 0.99 }] },
                  ]}
                  onPress={() => router.push(`/${it.path}/${id}` as Href)}
                >
                  <View style={[s.iconWrap, { backgroundColor: it.color + '18' }]}>
                    <Icon name={it.icon} size={20} color={it.color} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      {!!it.tag && (
                        <View style={[s.tag, { backgroundColor: it.color }]}>
                          <Text style={s.tagTxt}>{it.tag}</Text>
                        </View>
                      )}
                      <Text style={s.title}>{it.title}</Text>
                    </View>
                    <Text style={[s.itemSub, { color: it.color }]}>{it.sub}</Text>
                  </View>
                  <Icon name="chevron" size={18} color={it.color} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Text style={s.note}>
          🛡️ كل أداة تمر على «القفل الآمن»: نقيس قبل وبعد، ولو صار الاتصال أسوأ نرجع إعدادك تلقائياً.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  header: { gap: 3 },
  lead: { color: TEXT, fontSize: 22, fontWeight: '900', textAlign: 'right' },
  sub: { color: MUTED, fontSize: 12.5, textAlign: 'right' },
  section: {
    backgroundColor: CARD, borderRadius: 22, padding: 14, gap: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  secHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  secIcon: { fontSize: 24 },
  secTitle: { color: TEXT, fontSize: 16.5, fontWeight: '900', textAlign: 'right' },
  secSub: { color: MUTED, fontSize: 11, textAlign: 'right', marginTop: 1 },
  card: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: '#FAFCFF',
    borderRadius: 14, borderWidth: 1.5,
  },
  iconWrap: {
    width: 42, height: 42, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: TEXT, fontSize: 14, fontWeight: '900', textAlign: 'right' },
  itemSub: { fontSize: 11, fontWeight: '700', textAlign: 'right', marginTop: 2 },
  tag: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  tagTxt: { color: '#FFF', fontSize: 9, fontWeight: '900' },
  note: {
    color: MUTED, fontSize: 11.5, textAlign: 'right',
    lineHeight: 18, paddingHorizontal: 4, marginTop: 4,
  },
});
