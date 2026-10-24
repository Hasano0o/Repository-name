/**
 * «راوترك مو مدعوم؟ نضيفه لك» — طلب بسيط يوصل للمبرمج (بوت التطبيق) عشان يتواصل مع المستخدم ويدعم جهازه.
 * • الموديل + الشركة + المدينة + يوزر تليجرام (اختياري) — بموافقة صريحة. ما نطلب رقم جوال (ما نحتاج إفصاح جديد في أبل).
 * • فحص تلقائي للراوتر (اختياري) ينرفق مع الطلب — نفس «استكشاف جهاز» بدون كلمات مرور ولا MAC.
 * • ما فيه أيقونة جديدة: يفتح من «جهاز جديد · غير مدعوم؟» و«راوتري مو موجود» و«راوتري مو مدعوم؟».
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, Switch } from 'react-native';
import { View, Text, TextInput, Pressable } from '../src/i18n/rn';
import { router, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runProbe, reportText } from '../src/utils/probe';
import { sendSupportReport } from '../src/services/errors';
import { Icon } from '../src/ui/Icon';
import { C, R, S, tBg, tBd, tFg } from '../src/ui/theme';
import { sheet } from '../src/i18n';

const TELEGRAM = 'https://t.me/hasa_n20';
const OPS = ['stc', 'زين', 'موبايلي', 'سلام', 'غيرها'];
const HOSTS = ['192.168.8.1', '192.168.0.1', '192.168.1.1', '192.168.100.1', '192.168.31.1', '192.168.3.1'];

async function answers(host: string, ms = 2000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { await fetch(`http://${host}/`, { signal: ctrl.signal }); return true; } catch { return false; } finally { clearTimeout(t); }
}

export default function NewDeviceScreen() {
  const insets = useSafeAreaInsets();
  const [model, setModel] = useState('');
  const [op, setOp] = useState('');
  const [city, setCity] = useState('');
  const [tg, setTg] = useState('');
  const [scan, setScan] = useState(true);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState(false);

  const canSend = !!model.trim() && agree && !busy;

  const send = async () => {
    if (!canSend) return;
    let probe = '';
    if (scan) {
      setBusy('أدوّر على راوترك…');
      const found = (await Promise.all(HOSTS.map(async h => ((await answers(h)) ? h : null)))).find(Boolean) as string | undefined;
      if (found) {
        setBusy('أفحص الراوتر (دقيقة تقريباً)…');
        try {
          const rep = await runProbe(found, (d, t) => setBusy(`أفحص الراوتر… ${d}/${t}`));
          probe = reportText(rep, model.trim(), `الشركة: ${op || '—'} · المدينة: ${city || '—'}`);
        } catch { probe = `(الفحص ما كمل على ${found})`; }
      } else probe = '(ما لقينا راوتر على الشبكة — المستخدم مو متصل بواي فاي الراوتر)';
    }
    setBusy('أرسل الطلب…');
    const contact = `💬 تليجرام: ${tg.trim() ? '@' + tg.trim().replace(/^@/, '') : 'بيتواصل بنفسه على @hasa_n20'}`;
    const text = [
      '🆕 طلب إضافة جهاز جديد',
      `• الموديل: ${model.trim()}`,
      `• الشركة: ${op || '—'}`,
      `• المدينة: ${city.trim() || '—'}`,
      `• ${contact}`,
      '',
      probe || '(بدون فحص)',
    ].join('\n');
    const ok = await sendSupportReport('newdevice', text, { driverName: model.trim() });
    setBusy('');
    if (ok) setSent(true);
    else Alert.alert('ما وصل', 'تأكد إن النت شغّال وجرّب مرة ثانية — أو كلّمنا على تليجرام مباشرة.', [
      { text: 'رجوع', style: 'cancel' },
      { text: 'افتح تليجرام', onPress: () => Linking.openURL(TELEGRAM).catch(() => {}) },
    ]);
  };

  if (sent) {
    return (
      <View style={[s.page, s.center, { flex: 1, backgroundColor: C.bg }]}>
        <View style={[s.doneIcon]}><Icon name="check" size={34} color={tFg('#12b76a')} stroke={3} /></View>
        <Text style={s.title}>وصل طلبك ✓</Text>
        <Text style={s.sub}>{tg.trim() ? 'المبرمج بيتواصل معك على تليجرام.' : 'كلّمنا على تليجرام عشان نكمّل معك أسرع.'}{'\n'}وأول ما ندعم راوترك يوصلك تحديث للتطبيق.</Text>
        <Pressable style={[s.btn, { backgroundColor: '#2a9fd8' }]} onPress={() => Linking.openURL(TELEGRAM).catch(() => {})}>
          <Icon name="send" size={17} color={C.onAccent} /><Text style={s.btnTxt}>كلّمنا على تليجرام</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} style={s.link}><Text style={s.linkTxt}>رجوع</Text></Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <View style={s.heroIcon}><Icon name="compass" size={30} color={tFg('#6a45ec')} /></View>
          <Text style={s.title}>راوترك مو مدعوم؟ نضيفه لك</Text>
          <Text style={s.sub}>عبّي هالبيانات والمبرمج يتواصل معك ويضيف جهازك للتطبيق</Text>
        </View>

        <View style={s.card}>
          <Text style={s.lbl}>نوع الراوتر أو الموديل</Text>
          <TextInput style={s.input} value={model} onChangeText={setModel} placeholder="مكتوب على الملصق، مثل: TP-Link MR600" placeholderTextColor={C.muted} />

          <Text style={s.lbl}>الشركة</Text>
          <View style={s.chips}>
            {OPS.map(o => (
              <Pressable key={o} onPress={() => setOp(o)} style={[s.chip, op === o && s.chipOn]}>
                <Text style={[s.chipTxt, op === o && { color: C.onAccent }]}>{o}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.lbl}>مدينتك (اختياري)</Text>
          <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="مثل: شرورة" placeholderTextColor={C.muted} maxLength={30} />
        </View>

        <View style={s.card}>
          <Text style={s.lbl}>يوزرك في تليجرام (اختياري)</Text>
          <TextInput style={[s.input, { textAlign: 'left' }]} value={tg} onChangeText={setTg} placeholder="@username" placeholderTextColor={C.muted} autoCapitalize="none" maxLength={40} />
          <Text style={s.rowSub}>عشان المبرمج يكلّمك — أو تكلّمه أنت بعد الإرسال.</Text>
        </View>

        <View style={s.card}>
          <View style={s.row}>
            <Switch value={scan} onValueChange={setScan} trackColor={{ true: C.violet, false: C.track }} thumbColor={C.onAccent} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>أرفق فحص الراوتر</Text>
              <Text style={s.rowSub}>يساعد المبرمج يضيفه أسرع — لازم تكون على واي فاي الراوتر. ما نرفع كلمات المرور ولا أجهزتك.</Text>
            </View>
          </View>
          <View style={[s.row, s.rowLine]}>
            <Switch value={agree} onValueChange={setAgree} trackColor={{ true: C.violet, false: C.track }} thumbColor={C.onAccent} />
            <Text style={[s.rowSub, { flex: 1 }]}>موافق أرسل هالبيانات للمبرمج عشان يتواصل معي — وما تنحفظ في التطبيق.</Text>
          </View>
        </View>

        <Pressable style={[s.btn, !canSend && { opacity: 0.45 }]} disabled={!canSend} onPress={send} accessibilityRole="button">
          {busy ? <ActivityIndicator color={C.onAccent} /> : <Icon name="send" size={17} color={C.onAccent} />}
          <Text style={s.btnTxt}>{busy || 'أرسل الطلب'}</Text>
        </Pressable>

        <Pressable onPress={() => Linking.openURL(TELEGRAM).catch(() => {})} style={s.link}>
          <Text style={s.linkTxt}>أو كلّمنا على تليجرام مباشرة</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/probe' as Href)} style={s.link}>
          <Text style={[s.linkTxt, { color: C.muted, fontSize: 12.5 }]}>أدوات الاستكشاف المتقدمة (للخبراء)</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: S.md },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 6 },
  heroIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: tBg('#6a45ec1a'), alignItems: 'center', justifyContent: 'center' },
  doneIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: tBg('#12b76a1a'), alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  sub: { color: C.sub, fontSize: 13.5, textAlign: 'center', lineHeight: 21 },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: 14, gap: 8 },
  lbl: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right', marginTop: 2 },
  input: { backgroundColor: C.rowBg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: '#6a45ec', borderColor: '#6a45ec' },
  chipTxt: { color: C.text, fontWeight: '700', fontSize: 13.5 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  rowLine: { borderTopWidth: 1, borderColor: C.lineSoft, paddingTop: 10 },
  rowTitle: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  rowSub: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  btn: { alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#6a45ec', borderRadius: 16, paddingVertical: 15 },
  btnTxt: { color: C.onAccent, fontWeight: '900', fontSize: 16 },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkTxt: { color: tFg('#2a9fd8'), fontWeight: '800', fontSize: 14 },
});
