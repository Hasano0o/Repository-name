import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { C } from './theme';
import { desktop } from '../desktop/bridge';

const when = (d: Date | null) => {
  if (!d) return '—';
  return d.toLocaleString('ar-SA', { weekday: 'long', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/**
 * حالة التحديث عن بُعد + زر «تحقق الحين».
 * يوضح وش النسخة الشغالة، ولو التطبيق رجع للنسخة الأصلية بسبب خطأ (emergency launch).
 */
export function UpdateStatus() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ready, setReady] = useState(false);

  // نسخة الويندوز: التحديث من البرنامج نفسه (يحمّل المثبّت الجديد ويثبّته)
  if (desktop) {
    return (
      <View style={s.box}>
        <View style={s.row}>
          {desktop.checkUpdate && (
            <Pressable style={s.btn} onPress={() => desktop?.checkUpdate?.()}>
              <Text style={s.btnTxt}>تحقق من التحديث</Text>
            </Pressable>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Bandly للويندوز</Text>
            <Text style={s.sub}>النسخة {desktop.version}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!Updates.isEnabled) return null;

  const embedded = Updates.isEmbeddedLaunch;
  const version = embedded ? 'النسخة الأصلية من الـ APK' : `تحديث ${when(Updates.createdAt)}`;

  const check = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) {
        setMsg('✓ عندك آخر نسخة');
      } else {
        setMsg('نحمّل التحديث...');
        await Updates.fetchUpdateAsync();
        setReady(true);
        setMsg('✓ التحديث جاهز');
      }
    } catch (e: any) {
      setMsg(`ما قدرنا نتحقق: ${String(e?.message ?? e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.box}>
      <View style={s.row}>
        {ready ? (
          <Pressable style={s.btnOn} onPress={() => Updates.reloadAsync().catch(() => {})}>
            <Text style={s.btnOnTxt}>أعد التشغيل الحين</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.btn, busy && { opacity: 0.5 }]} onPress={check} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color={C.blue} /> : <Text style={s.btnTxt}>تحقق من التحديث</Text>}
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.title}>نسخة التطبيق</Text>
          <Text style={s.sub}>{version}</Text>
        </View>
      </View>
      {Updates.isEmergencyLaunch && (
        <Text style={s.warn}>⚠️ آخر تحديث ما اشتغل، فرجعنا للنسخة الأصلية. اضغط «تحقق من التحديث»، ولو تكرر بلّغ المطوّر.</Text>
      )}
      {!!msg && <Text style={s.msg}>{msg}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 12, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right' },
  sub: { color: C.sub, fontSize: 11.5, textAlign: 'right', marginTop: 2 },
  btn: { borderWidth: 1, borderColor: C.blue, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, minWidth: 110, alignItems: 'center' },
  btnTxt: { color: C.blue, fontWeight: '800', fontSize: 12.5 },
  btnOn: { backgroundColor: C.blue, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  btnOnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 12.5 },
  warn: { color: C.red, fontSize: 12, textAlign: 'right', lineHeight: 18 },
  msg: { color: C.sub, fontSize: 12, fontWeight: '700', textAlign: 'right' },
});
