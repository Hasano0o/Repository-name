/**
 * «عدّة الألياف» — مزايا بدون دخول الراوتر (حسن ٢٣ نوفمبر).
 * المدخل: «إضافة راوتر» ← «ما أبي أدخل الراوتر». تشتغل على أي راوتر (ألياف أو غيره) لأنها تقيس من الجوال.
 */
import { ScrollView, View, Text, Pressable } from '../src/i18n/rn';
import { router, Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, IconName } from '../src/ui/Icon';
import { C, R, S, tBg, tBd } from '../src/ui/theme';
import { sheet } from '../src/i18n';

const TOOLS: { path: string; title: string; sub: string; icon: IconName; grad: [string, string] }[] = [
  { path: '/planspeed/none', title: 'سرعتك مقابل باقتك', sub: 'توصلك سرعة باقتك؟ ولو لا: من الواي فاي ولا من الشركة', icon: 'speed', grad: ['#0d9488', '#14b8a6'] },
  { path: '/rooms/none', title: 'الواي فاي بالغرف', sub: 'قِس كل غرفة وشوف وين يضعف الواي فاي ووين تحط المقوّي', icon: 'wifi', grad: ['#2f6bff', '#6a4cff'] },
];

export default function FiberKit() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, paddingBottom: 40, gap: 12 }}>
      <View style={[s.intro, { backgroundColor: tBg('#e3f6f1'), borderColor: tBd('#9fdccd') }]}>
        <Text style={s.introTitle}>بدون كلمة مرور الراوتر</Text>
        <Text style={s.introTxt}>
          هذي الأدوات تقيس من جوالك نفسه وهو متصل بواي فاي البيت — تنفع للألياف وأي راوتر.
          لو بغيت الإشارة الضوئية والأجهزة وإعدادات الواي فاي، أضف الراوتر بكلمة الملصق.
        </Text>
      </View>
      {TOOLS.map(t => (
        <Pressable key={t.path} onPress={() => router.push(t.path as Href)} style={({ pressed }) => [pressed && { opacity: 0.88 }]}>
          <View style={s.card}>
            <LinearGradient colors={t.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>
              <Icon name={t.icon} size={22} color="#ffffff" />
            </LinearGradient>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.title}>{t.title}</Text>
              <Text style={s.sub}>{t.sub}</Text>
            </View>
            <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="chevron" size={18} color={C.muted} /></View>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = sheet({
  intro: { borderRadius: R.lg, borderWidth: 1, padding: 14, gap: 6 },
  introTitle: { color: '#0d9488', fontSize: 15, fontWeight: '900', textAlign: 'right' },
  introTxt: { color: C.text, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  card: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, padding: 14,
    borderWidth: 1, borderColor: tBd('#ffffff'),
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  icon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 11.5, lineHeight: 17, textAlign: 'right' },
});
