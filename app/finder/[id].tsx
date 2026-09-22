import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { Icon, IconName } from '../../src/ui/Icon';
import { C, R, S } from '../../src/ui/theme';

interface Goal {
  key: string;
  icon: IconName;
  color: string;
  title: string;
  sub: string;
  tag: string;
  path: string;
}

const GOALS: Goal[] = [
  {
    key: 'speed', icon: 'spark', color: '#7c5cff',
    title: 'أسرع إنترنت',
    sub: 'تلقائي — تضغط وتنتظر',
    tag: 'يقيس القوة والاستجابة',
    path: 'optimize',
  },
  {
    key: 'game', icon: 'game', color: '#ec4899',
    title: 'أقل بنق',
    sub: 'للألعاب',
    tag: 'البنق والتذبذب',
    path: 'ping',
  },
  {
    key: 'ca', icon: 'layers', color: '#0ea5a4',
    title: 'أفضل دمج',
    sub: '4G + 4G',
    tag: 'مثل B1+B3',
    path: 'calab',
  },
  {
    key: 'anchor', icon: 'antenna', color: '#9333ea',
    title: 'مرساة 5G',
    sub: 'أي 4G يفتح 5G',
    tag: '~25 ميقا',
    path: 'anchor',
  },
  {
    key: 'nsacombo', icon: 'layers', color: '#f59e0b',
    title: 'دمج NSA',
    sub: '4G + 5G',
    tag: 'مثل B20+n78',
    path: 'nsacombo',
  },
  {
    key: 'manual', icon: 'bands', color: '#2f6bff',
    title: 'فحص وتحكم',
    sub: 'كل شي يدوياً',
    tag: 'قفل الترددات',
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
        <View style={s.grid}>
          {GOALS.map(g => (
            <Pressable
              key={g.key}
              style={({ pressed }) => [
                s.card,
                { borderColor: g.color + '40' },
                pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] },
              ]}
              onPress={() => router.push(`/${g.path}/${id}` as Href)}
            >
              {/* أيقونة كبيرة */}
              <View style={[s.iconWrap, { backgroundColor: g.color + '18' }]}>
                <Icon name={g.icon} size={30} color={g.color} />
              </View>

              {/* العنوان */}
              <Text style={s.title}>{g.title}</Text>

              {/* الوصف */}
              <Text style={[s.sub, { color: g.color }]} numberOfLines={1}>
                {g.sub}
              </Text>

              {/* شارة صغيرة */}
              <View style={[s.chip, { backgroundColor: g.color + '12' }]}>
                <Text style={[s.chipTxt, { color: g.color }]} numberOfLines={1}>
                  {g.tag}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        <Text style={s.note}>
          🛡️ أي تثبيت من هنا يمر على القفل الآمن: نقيس قبل وبعد، ولو صار الاتصال أسوأ نرجع إعدادك تلقائياً.
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.md },
  lead: { color: C.text, fontSize: 18, fontWeight: '800', textAlign: 'right', marginBottom: 4 },

  grid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderRadius: R.lg,
    paddingVertical: S.md,
    paddingHorizontal: S.sm,
    alignItems: 'center',
    gap: 6,
    minHeight: 150,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: {
    color: C.text,
    fontSize: 14.5,
    fontWeight: '800',
    textAlign: 'center',
  },
  sub: {
    fontSize: 11.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 2,
    maxWidth: '100%',
  },
  chipTxt: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  note: {
    color: C.muted,
    fontSize: 12,
    textAlign: 'right',
    lineHeight: 19,
    marginTop: 8,
  },
});
