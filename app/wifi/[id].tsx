/**
 * مشاركة الواي فاي: رمز QR يصوّره الضيف ويتصل مباشرة، أو نص يرسله واتساب.
 * نشارك كلمة سر الواي فاي بس — كلمة مرور الإدارة أبداً.
 */
import { useCallback, useState } from 'react';
import {
  Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { getWifi, setWifi, SavedWifi } from '../../src/store/routers';
import { wifiQrText } from '../../src/utils/routerLabel';
import { copyText } from '../../src/utils/clipboard';
import { LabelScannerHost, ensureScanner } from '../../src/ui/scanner';
import { Icon } from '../../src/ui/Icon';
import { C, tBd, tBg, tFg } from '../../src/ui/theme';

export default function WifiShare() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [wifi, setW] = useState<SavedWifi | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [scanning, setScanning] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    getWifi(String(id)).then(w => {
      if (!alive) return;
      setW(w);
      setSsid(w?.ssid ?? '');
      setPass(w?.password ?? '');
      setEditing(!w);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [id]));

  const save = async (next?: SavedWifi) => {
    const w = next ?? { ssid: ssid.trim(), password: pass.trim() };
    if (!w.ssid) { Alert.alert('اسم الشبكة مطلوب', 'اكتب اسم الواي فاي (SSID) أو امسح الملصق.'); return; }
    await setWifi(String(id), w);
    setW(w); setSsid(w.ssid); setPass(w.password); setEditing(false);
  };

  const shareText = () => {
    if (!wifi) return;
    Share.share({
      message: `📶 شبكة الواي فاي: ${wifi.ssid}\n🔑 كلمة السر: ${wifi.password || '(بدون كلمة سر)'}`,
    }).catch(() => {});
  };

  const remove = () => Alert.alert('حذف بيانات الواي فاي', 'بنحذف اسم الشبكة وكلمة السر المحفوظة من التطبيق (الراوتر نفسه ما يتغير).', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'حذف', style: 'destructive', onPress: async () => { await setWifi(String(id), null); setW(null); setSsid(''); setPass(''); setEditing(true); } },
  ]);

  if (!loaded) return <View style={s.root} />;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {wifi && !editing ? (
        <>
          <View style={s.qrCard}>
            <Text style={s.qrTitle}>خلّ الضيف يصوّر الرمز</Text>
            <Text style={s.qrSub}>بكاميرا جواله — ويتصل مباشرة بدون ما يكتب شي</Text>
            <View style={s.qrBox}>
              <QRCode value={wifiQrText(wifi)} size={220} color="#0b1020" backgroundColor="#ffffff" />
            </View>
            <Text style={s.ssid}>{wifi.ssid}</Text>
            <Pressable onPress={() => setShow(v => !v)} style={s.passRow} hitSlop={8}>
              <Text style={s.passTxt}>{show ? (wifi.password || 'بدون كلمة سر') : '••••••••'}</Text>
              <Icon name={show ? 'eye-off' : 'eye'} size={16} color={C.sub} />
            </Pressable>
          </View>

          <Pressable onPress={shareText} style={({ pressed }) => [s.primary, pressed && { opacity: 0.85 }]}>
            <Text style={s.primaryTxt}>أرسلها كنص (واتساب وغيره)</Text>
            <Icon name="share" size={17} color={tFg('#fff')} />
          </Pressable>

          <View style={s.row}>
            <Pressable onPress={async () => { if (wifi.password && await copyText(wifi.password)) Alert.alert('✓ تم النسخ', 'نسخنا كلمة سر الواي فاي'); }} style={s.ghost}>
              <Text style={s.ghostTxt}>نسخ كلمة السر</Text>
            </Pressable>
            <Pressable onPress={() => setEditing(true)} style={s.ghost}><Text style={s.ghostTxt}>تعديل</Text></Pressable>
            <Pressable onPress={remove} style={s.ghost}><Text style={[s.ghostTxt, { color: C.red }]}>حذف</Text></Pressable>
          </View>
        </>
      ) : (
        <View style={s.card}>
          <Text style={s.cardTitle}>بيانات الواي فاي</Text>
          <Text style={s.cardSub}>اكتبها أو امسح الملصق اللي تحت الراوتر. تنحفظ مشفّرة على جوالك.</Text>
          {Platform.OS !== 'web' && (
            <Pressable onPress={() => ensureScanner() && setScanning(true)} style={s.scanBtn}>
              <Text style={s.scanTxt}>📷 امسح الملصق</Text>
            </Pressable>
          )}
          <Text style={s.label}>اسم الشبكة (SSID)</Text>
          <TextInput value={ssid} onChangeText={setSsid} style={s.input} autoCapitalize="none" autoCorrect={false} placeholder="مثال: ZTE_5G_A1B2" placeholderTextColor={C.muted} />
          <Text style={s.label}>كلمة السر</Text>
          <TextInput value={pass} onChangeText={setPass} style={s.input} autoCapitalize="none" autoCorrect={false} placeholder="كلمة سر الواي فاي" placeholderTextColor={C.muted} />
          <Pressable onPress={() => save()} style={({ pressed }) => [s.primary, pressed && { opacity: 0.85 }]}>
            <Text style={s.primaryTxt}>حفظ وإنشاء الرمز</Text>
          </Pressable>
          {wifi && (
            <Pressable onPress={() => { setSsid(wifi.ssid); setPass(wifi.password); setEditing(false); }} style={s.ghostCenter}>
              <Text style={s.ghostTxt}>إلغاء</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={s.warn}>
        <Text style={s.warnTxt}>🔒 نشارك كلمة سر الواي فاي بس. كلمة مرور الإدارة لا تعطيها لأحد — اللي معه يتحكم بالراوتر كامل.</Text>
      </View>

      <LabelScannerHost
        visible={scanning}
        mode="wifi"
        onClose={() => setScanning(false)}
        onResult={d => { if (d.wifi?.ssid) save({ ssid: d.wifi.ssid, password: d.wifi.password ?? '' }); }}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 14, paddingBottom: 60 },
  qrCard: {
    backgroundColor: C.card, borderRadius: 24, padding: 18, alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: C.cardBorder,
  },
  qrTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  qrSub: { color: C.sub, fontSize: 12.5, textAlign: 'center' },
  qrBox: { backgroundColor: '#ffffff', padding: 14, borderRadius: 18, marginVertical: 10 },
  ssid: { color: C.text, fontSize: 16, fontWeight: '800' },
  passRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  passTxt: { color: C.sub, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  primary: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: tBg('#2f6bff'), borderRadius: 16, paddingVertical: 14, marginTop: 4,
  },
  primaryTxt: { color: tFg('#fff'), fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row-reverse', gap: 10 },
  ghost: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14,
    backgroundColor: C.card, borderWidth: 1.5, borderColor: C.cardBorder,
  },
  ghostCenter: { alignItems: 'center', paddingVertical: 10 },
  ghostTxt: { color: C.sub, fontSize: 14, fontWeight: '700' },
  card: { backgroundColor: C.card, borderRadius: 22, padding: 16, gap: 8, borderWidth: 1.5, borderColor: C.cardBorder },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  cardSub: { color: C.sub, fontSize: 12.5, textAlign: 'right', lineHeight: 19 },
  scanBtn: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: tBg('#e9fbf2'), borderWidth: 1, borderColor: tBd('#bfeed6'), marginVertical: 4 },
  scanTxt: { color: tFg('#0f9f61'), fontSize: 14, fontWeight: '800' },
  label: { color: C.text, fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 6 },
  input: {
    backgroundColor: C.rowBg, borderRadius: 14, paddingHorizontal: 12, minHeight: 48,
    color: C.text, fontSize: 15, fontWeight: '700', textAlign: 'left', writingDirection: 'ltr',
  },
  warn: { backgroundColor: tBg('#fff7ed'), borderRadius: 14, padding: 12, borderWidth: 1, borderColor: tBd('#fed7aa') },
  warnTxt: { color: tFg('#9a3412'), fontSize: 12.5, lineHeight: 20, textAlign: 'right' },
});
