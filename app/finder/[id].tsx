import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { Icon, IconName } from '../../src/ui/Icon';
import { C, R, S } from '../../src/ui/theme';

/**
 * "أفضل تردد": مدخل واحد لكل أدوات تجربة الترددات — بدل ثلاث مربعات متشابهة.
 */
const GOALS: { key: string; icon: IconName; color: string; title: string; sub: string; points: string[]; path: string }[] = [
  {
    key: 'speed', icon: 'spark', color: '#7c5cff',
    title: 'أسرع إنترنت', sub: 'تلقائي — تضغط وتنتظر',
    points: ['يجرب الترددات المتاحة واحد واحد', 'يقيس القوة والجودة والاستجابة', 'يثبّت الأفضل ويحفظه كملف تعريف'],
    path: 'optimize',
  },
  {
    key: 'game', icon: 'game', color: '#ec4899',
    title: 'أقل بنق للألعاب', sub: 'يقيس الاستجابة والتذبذب',
    points: ['يقيس البنق والتذبذب على كل تردد', 'مناسب للبلايستيشن والجوال', 'تختار أنت وش تثبّت'],
    path: 'ping',
  },
  {
    key: 'ca', icon: 'layers', color: '#0ea5a4',
    title: 'أفضل دمج', sub: 'أي تركيبة ترددات أسرع',
    points: ['يجرب تركيبات مثل B1+B3 و B3+B20', 'يقارنها بالإعداد التلقائي', 'ما يستهلك باقة'],
    path: 'calab',
  },
  {
    key: 'anchor', icon: 'antenna', color: '#9333ea',
    title: 'مرساة 5G', sub: 'أي تردد 4G يفتح لك 5G',
    points: ['يجرب كل تردد 4G مع تحميل قصير', 'يكشف أي تردد يخلي 5G يشتغل', 'يستهلك تقريباً ٢٥ ميقا لكل تردد'],
    path: 'anchor',
  },
  {
    key: 'nsacombo', icon: 'layers', color: '#f59e0b',
    title: 'دمج 4G + 5G (NSA)', sub: 'أي تركيبة أسرع لك',
    points: ['يجرب تركيبات مثل B20+n78 و B1+n41', 'يقيس السرعة الفعلية لكل تركيبة', 'يثبّت الأسرع بأمان (rollback تلقائي)'],
    path: 'nsacombo',
  },
  {
    key: 'manual', icon: 'bands', color: '#2f6bff',
    title: 'فحص كامل وتحكم يدوي', sub: 'للي يبي يشوف كل شي',
    points: ['فحص سريع وفحص دقيق مع 5G', 'قفل الترددات يدوياً ووضع الشبكة', 'كل تثبيت يرجع لحاله لو صار أسوأ'],
    path: 'bands',
  },
];

export default function Finder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={s.lead}>وش يهمك أكثر؟</Text>
        {GOALS.map(g => (
          <Pressable
            key={g.key}
            style={({ pressed }) => [s.card, { borderColor: g.color + '55' }, pressed && { opacity: 0.7, transform: [{ scale: 0.99 }] }]}
            onPress={() => router.push(`/${g.path}/${id}` as Href)}
          >
            <View style={s.head}>
              <View style={[s.icon, { backgroundColor: g.color + '1F' }]}>
                <Icon name={g.icon} size={22} color={g.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{g.title}</Text>
                <Text style={[s.sub, { color: g.color }]}>{g.sub}</Text>
              </View>
              <Text style={[s.arrow, { color: g.color }]}>‹</Text>
            </View>
            {g.points.map(p => <Text key={p} style={s.point}>• {p}</Text>)}
          </Pressable>
        ))}
        <Text style={s.note}>
          🛡️ أي تثبيت من هنا يمر على القفل الآمن: نقيس قبل وبعد، ولو صار الاتصال أسوأ نرجع إعدادك تلقائياً.
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.md },
  lead: { color: C.text, fontSize: 18, fontWeight: '800', textAlign: 'right', marginBottom: 2 },
  card: { backgroundColor: C.card, borderWidth: 1.5, borderRadius: R.lg, padding: S.lg, gap: 6 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: S.md, marginBottom: 4 },
  icon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  sub: { fontSize: 12.5, fontWeight: '700', textAlign: 'right', marginTop: 2 },
  arrow: { fontSize: 26, fontWeight: '300' },
  point: { color: C.sub, fontSize: 13, textAlign: 'right', lineHeight: 20 },
  note: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19, marginTop: 4 },
});
