/**
 * «كيف تبدأ» — تطلع مرة وحدة بعد ما يضيف المستخدم أول راوتر (?welcome=1 في صفحة الراوتر).
 * أربع خطوات قصيرة + زر يفتح مساعد Bandly. ما تطلب شي ولا تغيّر شي في الراوتر.
 */
import { Modal, ScrollView } from 'react-native';
import { Pressable, Text, View } from '../i18n/rn';
import { router, Href } from 'expo-router';
import { Icon, IconName } from './Icon';
import { C, R, tBg, tFg } from './theme';
import { sheet } from '../i18n';

const STEPS: { icon: IconName; color: string; title: string; text: string }[] = [
  { icon: 'chart', color: '#2f6bff', title: 'فوق: قوة اتصالك', text: 'البطاقات فوق تقول لك إشارتك ممتازة ولا ضعيفة، و4G ولا 5G.' },
  { icon: 'spark', color: '#0e7d93', title: 'كلّم مساعد Bandly', text: 'تحت «حسّن اتصالك» — قل له «أفضل تردد» أو «أفضل برج» أو «افحص إشارتي» ويسويها لك.' },
  { icon: 'aim', color: '#12b76a', title: 'وجّه الأنتنا', text: 'حرّك الراوتر أو الأنتنا وهو يقول لك بالصوت متى صارت الإشارة أقوى.' },
  { icon: 'power', color: '#d97706', title: 'إعادة التشغيل', text: 'لو علّق النت، قل للمساعد «أعد تشغيل الراوتر» — يسأل قبل ويتأكد إنه رجع.' },
];

export function WelcomeTour({ visible, routerId, onClose }: { visible: boolean; routerId: string; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.back}>
        <View style={s.card}>
          <ScrollView contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false}>
            <Text style={s.title}>✓ دخلنا للراوتر!</Text>
            <Text style={s.lead}>كيف تبدأ — أربع أشياء بس:</Text>
            {STEPS.map((st, i) => (
              <View key={st.title} style={s.row}>
                <View style={[s.icon, { backgroundColor: tBg(st.color + '1f') }]}>
                  <Icon name={st.icon} size={19} color={tFg(st.color)} stroke={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{i + 1}) {st.title}</Text>
                  <Text style={s.rowText}>{st.text}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <Pressable
            style={s.primary}
            accessibilityRole="button"
            onPress={() => { onClose(); router.push(`/assistant/${routerId}` as Href); }}
          >
            <Icon name="mic" size={17} color={C.onAccent} />
            <Text style={s.primaryTxt}>كلّم المساعد</Text>
          </Pressable>
          <Pressable style={s.secondary} onPress={onClose} accessibilityRole="button">
            <Text style={s.secondaryTxt}>فهمت، خلني أتصفح</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = sheet({
  back: { flex: 1, backgroundColor: 'rgba(8,14,30,0.55)', justifyContent: 'center', padding: 18 },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 20, gap: 12, maxHeight: '88%' },
  title: { color: C.text, fontSize: 21, fontWeight: '900', textAlign: 'right' },
  lead: { color: C.sub, fontSize: 13.5, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', gap: 12, alignItems: 'flex-start' },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: C.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right' },
  rowText: { color: C.sub, fontSize: 13, lineHeight: 20, textAlign: 'right', marginTop: 2 },
  primary: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.blue, borderRadius: 16, paddingVertical: 14, marginTop: 4 },
  primaryTxt: { color: C.onAccent, fontWeight: '800', fontSize: 15 },
  secondary: { alignItems: 'center', paddingVertical: 8 },
  secondaryTxt: { color: C.sub, fontWeight: '700', fontSize: 13.5 },
});
