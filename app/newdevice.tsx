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
import { detectDriver } from '../src/drivers/registry';
import { LabelScannerHost, ensureScanner } from '../src/ui/scanner';
import { ocrAvailable } from '../modules/bandly-cell/src';
import { sendSupportReport } from '../src/services/errors';
import { Icon } from '../src/ui/Icon';
import { C, R, S, tBg, tBd, tFg } from '../src/ui/theme';
import { sheet } from '../src/i18n';

const TELEGRAM = 'https://t.me/hasa_n20';
const OPS = ['stc', 'زين', 'موبايلي', 'سلام', 'غيرها'];
const WANTS = ['الإشارة', 'الترددات', 'تثبيت البرج', 'إعادة التشغيل', 'الأجهزة المتصلة', 'الواي فاي'];
/** سطور الملصق اللي فيها الموديل/النسخة — ونستبعد أي شي فيه كلمة مرور أو رقم تسلسلي/IMEI */
const SECRET = /pass|pwd|key|pin|wpa|كلم|رمز|imei|s\/?n\b|serial|mac\b|ssid/i;
const MODELISH = /model|موديل|type|p\/?n|h\/?w|hardware|version|ver\b|zyxel|tp-?link|huawei|zte|nokia|alcatel|netgear|d-?link|tenda|[a-z]{2,}[- ]?\d{3,}/i;
function modelLines(lines: string[]): string[] {
  return [...new Set(lines.map(l => l.trim()).filter(l => l.length >= 3 && l.length <= 60 && !SECRET.test(l) && MODELISH.test(l)))].slice(0, 8);
}
/** الموديل والفيرموير من صفحة الراوتر نفسها (بدون دخول) — من تقرير الفحص */
function pageInfo(probe: string): string[] {
  const out = new Set<string>();
  // العنوان من الصفحة الرئيسية بس — مو من صفحات الخطأ (404) اللي ترجع من الفحوصات الثانية
  const main = probe.split(/\n--- /).find(sec => sec.startsWith('الصفحة الرئيسية')) ?? '';
  const t = main.match(/<title>([^<]{3,60})<\/title>/i)?.[1]?.trim();
  if (t && !/error|not found|404|forbidden|unauthori/i.test(t)) out.add(`عنوان الصفحة: ${t}`);
  for (const m of probe.matchAll(/"?(wa_inner_version|web_version|hardware_version|SoftwareVersion|HardwareVersion|FirmwareVersion|DeviceName|ModelName|model_name|product_name|devcap_model)"?\s*[:=]\s*"([^"]{3,50})"/gi)) out.add(`${m[1]}: ${m[2]}`);
  return [...out].slice(0, 6);
}
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
  const [label, setLabel] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const canOcr = Platform.OS === 'android' && ocrAvailable();
  const [tester, setTester] = useState(false);
  const [laptop, setLaptop] = useState(false);
  const [wants, setWants] = useState<string[]>([]);
  const toggleWant = (w: string) => setWants(x => (x.includes(w) ? x.filter(y => y !== w) : [...x, w]));
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
        // الراوتر مدعوم أصلاً؟ (المستخدم ما عرف يضيفه) — نقوله بدل ما يرسل طلب على الفاضي
        setBusy('أتعرّف على راوترك…');
        const d = await detectDriver(found).catch(() => null);
        const known = d && (d as any).id !== 'unknown' ? (d as any).name as string : null;
        if (known) {
          setBusy('');
          const go = await new Promise<'setup' | 'send' | 'cancel'>(res => Alert.alert('راوترك مدعوم أصلاً ✓',
            `الراوتر اللي متصل فيه (${known}) يشتغل مع Bandly — ما يحتاج طلب.\n\nلو تقصد راوتر ثاني، اتصل بواي فايه أول وارجع هنا.`,
            [
              { text: 'رجوع', style: 'cancel', onPress: () => res('cancel') },
              { text: 'أرسل على كل حال', onPress: () => res('send') },
              { text: 'دخّلني الحين', onPress: () => res('setup') },
            ]));
          if (go === 'setup') { router.replace('/setup' as Href); return; }
          if (go === 'cancel') return;
        }
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
      `• يبي: ${wants.length ? wants.join('، ') : '—'}`,
      `• ${tester ? '✅ مستعد يجرّب التحديثات' : '— ما أكّد إنه يجرّب'} · ${laptop ? '💻 عنده لابتوب' : 'بدون لابتوب'}`,
      ...(label.length ? ['', '📷 من الملصق:', ...label.map(l => `  ${l}`)] : Platform.OS === 'ios' ? ['', '📷 الملصق: بيرسل صورته على تليجرام'] : []),
      ...(probe && pageInfo(probe).length ? ['', '🧾 من صفحة الراوتر:', ...pageInfo(probe).map(l => `  ${l}`)] : []),
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
          <View style={s.heroIcon}><Icon name="compass" size={30} color={tFg('#ea580c')} /></View>
          <Text style={s.title}>راوترك مو مدعوم؟ نضيفه لك</Text>
          <Text style={s.sub}>عبّي هالبيانات والمبرمج يتواصل معك ويضيف جهازك للتطبيق</Text>
        </View>

        <View style={s.card}>
          <Text style={s.lbl}>نوع الراوتر أو الموديل</Text>
          <TextInput style={s.input} value={model} onChangeText={setModel} placeholder="مكتوب على الملصق، مثل: TP-Link MR600" placeholderTextColor={C.muted} />
          {canOcr ? (
            <Pressable onPress={() => ensureScanner() && setScanning(true)} style={s.scanBtn} accessibilityRole="button">
              <Icon name="camera" size={16} color={tFg('#ea580c')} />
              <Text style={s.scanTxt}>{label.length ? 'صوّر الملصق مرة ثانية' : 'صوّر الملصق — نقرأ الموديل لحالنا'}</Text>
            </Pressable>
          ) : (
            <Text style={s.rowSub}>📷 بعد الإرسال، أرسل صورة الملصق اللي تحت الراوتر على تليجرام — تساعد كثير.</Text>
          )}
          {!!label.length && (
            <View style={s.labelBox}>
              <Text style={s.rowSub}>قرينا من الملصق (بدون كلمات المرور):</Text>
              {label.map(l => <Text key={l} style={s.labelLine}>{l}</Text>)}
            </View>
          )}
          <LabelScannerHost visible={scanning} mode="model" onClose={() => setScanning(false)}
            onResult={d => { const ls = modelLines(d.rawLines ?? []); setLabel(ls); if (!model.trim() && ls[0]) setModel(ls[0]); }} />

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
          <Text style={s.lbl}>وش تبي يشتغل في راوترك؟</Text>
          <View style={s.chips}>
            {WANTS.map(w => (
              <Pressable key={w} onPress={() => toggleWant(w)} style={[s.chip, wants.includes(w) && s.chipOn]}>
                <Text style={[s.chipTxt, wants.includes(w) && { color: C.onAccent }]}>{w}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[s.row, s.rowLine]}>
            <Switch value={tester} onValueChange={setTester} trackColor={{ true: '#ea580c', false: C.track }} thumbColor={C.onAccent} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>مستعد أجرّب معكم</Text>
              <Text style={s.rowSub}>نرسل لك تحديث تجريبي وتقول لنا وش اشتغل — بدونه صعب ندعم راوترك</Text>
            </View>
          </View>
          <View style={[s.row, s.rowLine]}>
            <Switch value={laptop} onValueChange={setLaptop} trackColor={{ true: '#ea580c', false: C.track }} thumbColor={C.onAccent} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>عندي لابتوب</Text>
              <Text style={s.rowSub}>ممكن نطلب منك تسجّل صفحة الراوتر من المتصفح (نشرح لك خطوة خطوة)</Text>
            </View>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.row}>
            <Switch value={scan} onValueChange={setScan} trackColor={{ true: '#ea580c', false: C.track }} thumbColor={C.onAccent} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>أرفق فحص الراوتر</Text>
              <Text style={s.rowSub}>يساعد المبرمج يضيفه أسرع — لازم تكون على واي فاي الراوتر. ما نرفع كلمات المرور ولا أجهزتك.</Text>
            </View>
          </View>
          <View style={[s.row, s.rowLine]}>
            <Switch value={agree} onValueChange={setAgree} trackColor={{ true: '#ea580c', false: C.track }} thumbColor={C.onAccent} />
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
  heroIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: tBg('#ea580c1a'), alignItems: 'center', justifyContent: 'center' },
  scanBtn: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: tBd('#ea580c88'), backgroundColor: tBg('#ea580c0f'), borderRadius: 14, paddingVertical: 11 },
  scanTxt: { color: tFg('#c2410c'), fontWeight: '800', fontSize: 13.5 },
  labelBox: { backgroundColor: C.rowBg, borderRadius: 12, padding: 10, gap: 2 },
  labelLine: { color: C.text, fontSize: 13, fontWeight: '700', textAlign: 'left' },
  doneIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: tBg('#12b76a1a'), alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  sub: { color: C.sub, fontSize: 13.5, textAlign: 'center', lineHeight: 21 },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: 14, gap: 8 },
  lbl: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right', marginTop: 2 },
  input: { backgroundColor: C.rowBg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: '#ea580c', borderColor: '#ea580c' },
  chipTxt: { color: C.text, fontWeight: '700', fontSize: 13.5 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  rowLine: { borderTopWidth: 1, borderColor: C.lineSoft, paddingTop: 10 },
  rowTitle: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  rowSub: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  btn: { alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ea580c', borderRadius: 16, paddingVertical: 15 },
  btnTxt: { color: C.onAccent, fontWeight: '900', fontSize: 16 },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkTxt: { color: tFg('#2a9fd8'), fontWeight: '800', fontSize: 14 },
});
