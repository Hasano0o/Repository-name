import { useState } from 'react';
import {
  ScrollView, View, Text, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { router, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { detectDriver } from '../src/drivers/registry';
import { saveRouter } from '../src/store/routers';
import { C, R, S, T } from '../src/ui/theme';
import { Icon } from '../src/ui/Icon';
import { isLanHost } from '../src/utils/host';

export default function AddRouter() {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [host, setHost] = useState('192.168.8.1');
  const [user, setUser] = useState('admin');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const onAdd = async () => {
    const h = host.trim();
    const u = user.trim();
    if (!h || !pass) { setError('اكتب عنوان الراوتر وكلمة المرور'); return; }
    if (!isLanHost(h)) {
      setError('عنوان الراوتر لازم يكون داخل شبكتك المحلية (مثل 192.168.8.1)');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setStatus('نتعرف على نوع الراوتر...');
      const driver = await detectDriver(h);
      if (!driver) {
        throw new Error('ما قدرنا نتعرف على الراوتر — تأكد إنك متصل بشبكته، أو إن ماركته غير مدعومة حالياً');
      }
      setStatus(`تم التعرف: ${driver.name} — نتحقق من الدخول...`);
      await driver.login(h, u, pass);
      const saved = await saveRouter(
        { name: name.trim() || driver.name, host: h, username: u, driverId: driver.id, driverName: driver.name },
        pass,
      );
      router.replace(`/router/${saved.id}` as Href);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStatus('');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={s.note}>تأكد إن جوالك متصل بواي فاي الراوتر قبل الإضافة</Text>

        <View style={s.card}>
          <Text style={s.label}>اسم الراوتر (اختياري)</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="مثلاً: راوتر البيت"
            placeholderTextColor={C.muted}
            returnKeyType="next"
          />

          <Text style={s.label}>عنوان الراوتر</Text>
          <TextInput
            style={s.input}
            value={host}
            onChangeText={setHost}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
          />

          <Text style={s.label}>اسم المستخدم</Text>
          <TextInput
            style={s.input}
            value={user}
            onChangeText={setUser}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
          />

          <Text style={s.label}>كلمة مرور لوحة الراوتر</Text>
          <View style={s.passWrap}>
            <TextInput
              style={[s.input, s.passInput]}
              value={pass}
              onChangeText={setPass}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={onAdd}
            />
            <Pressable
              style={s.eye}
              onPress={() => setShow(v => !v)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            >
              <Icon name={show ? 'up' : 'lock'} size={17} color={show ? C.blue : C.muted} />
            </Pressable>
          </View>
          <Text style={s.hint}>
            تُحفظ كلمة المرور على جوالك فقط، ونستخدمها للدخول على الراوتر مباشرة — ما ترسل لأي خادم.
          </Text>
        </View>

        {!!status && (
          <View style={s.statusRow}>
            <Text style={s.status}>{status}</Text>
            <ActivityIndicator color={C.blue} />
          </View>
        )}
        {!!error && <Text style={s.error}>{error}</Text>}

        <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={onAdd} disabled={busy}>
          <Text style={s.btnText}>{busy ? 'جاري الإضافة...' : 'إضافة'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.md },
  note: { color: C.sub, textAlign: 'right' },
  card: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
    borderRadius: R.lg, padding: S.lg, gap: 6,
  },
  label: { color: C.sub, fontWeight: '700', textAlign: 'right', marginTop: S.sm },
  input: {
    backgroundColor: C.rowBg, borderRadius: R.md, padding: 12,
    borderWidth: 1, borderColor: C.line, color: C.text, textAlign: 'right',
  },
  passWrap: { position: 'relative', justifyContent: 'center' },
  passInput: { paddingLeft: 44 },
  eye: {
    position: 'absolute', left: 8, height: 34, width: 34,
    alignItems: 'center', justifyContent: 'center',
  },
  hint: { color: C.muted, fontSize: T.label, textAlign: 'right', lineHeight: 18, marginTop: 6 },
  statusRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: S.sm },
  status: { color: C.blue, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  error: { color: C.red, fontWeight: '700', textAlign: 'right' },
  btn: { backgroundColor: C.blue, borderRadius: R.lg, padding: 15, alignItems: 'center' },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 16 },
});
