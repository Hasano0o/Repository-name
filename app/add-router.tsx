import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '../src/ui/Icon';
import { C, R, S, T } from '../src/ui/theme';
import { isLanHost } from '../src/utils/host';
import { detectDriver } from '../src/drivers/registry';
import { getRouter, saveRouter, updateRouter, SavedRouter } from '../src/store/routers';

export default function AddRouterScreen() {
  const nav = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId =
    typeof params.id === 'string' && params.id.length > 0 ? params.id : undefined;

  const [name, setName] = useState('');
  const [host, setHost] = useState('192.168.8.1');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState<boolean>(Boolean(editId));

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!editId) return;
      try {
        const r = await getRouter(editId);
        if (!alive || !r) return;
        setName(r.name ?? '');
        setHost(r.host ?? '192.168.8.1');
        setUsername(r.username ?? 'admin');
      } catch {
        // نتجاهل: النموذج يبقى فارغاً
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editId]);

  async function onSave() {
    const h = host.trim();
    const u = username.trim() || 'admin';
    if (!isLanHost(h)) {
      Alert.alert('عنوان غير صالح', 'أدخل عنواناً محلياً، مثال: 192.168.8.1');
      return;
    }
    if (!password) {
      Alert.alert('كلمة المرور مطلوبة', 'أدخل كلمة مرور الراوتر للمتابعة');
      return;
    }
    setBusy(true);
    try {
      const driver = await detectDriver(h);
      if (!driver) {
        Alert.alert('تعذّر التعرف', 'ما تعرفنا على نوع الراوتر على هذا العنوان');
        return;
      }

      try {
        await driver.login(h, u, password);
      } catch {
        Alert.alert('فشل الدخول', 'تحقق من اسم المستخدم وكلمة المرور');
        return;
      }

      const dAny = driver as unknown as { id?: string; name?: string };
      const dId = dAny.id ?? 'unknown';
      const dName = dAny.name ?? dId;

      const payload = {
        name: name.trim() || dName || 'راوتر',
        host: h,
        username: u,
        driverId: dId,
        driverName: dName,
      };

      let saved: SavedRouter | null;
      if (editId) {
        saved = await updateRouter(editId, payload, password);
        if (!saved) {
          Alert.alert('خطأ', 'ما لقينا الراوتر المحفوظ');
          return;
        }
      } else {
        saved = await saveRouter(payload, password);
      }
      nav.replace('/router/' + saved.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('خطأ', msg);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.blue} />
      </View>
    );
  }

  const isEdit = Boolean(editId);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.title}>
            {isEdit ? 'تعديل الراوتر' : 'إضافة راوتر'}
          </Text>
          <Text style={styles.subtitle}>
            أدخل بيانات الدخول — تُحفظ كلمة المرور في التخزين الآمن على جهازك فقط،
            ولا تُرسل لأي جهة خارجية.
          </Text>

          <Field label="الاسم (اختياري)">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="مثال: راوتر الصالة"
              placeholderTextColor={C.muted}
              style={styles.input}
              returnKeyType="next"
            />
          </Field>

          <Field label="عنوان الراوتر">
            <TextInput
              value={host}
              onChangeText={setHost}
              placeholder="192.168.8.1"
              placeholderTextColor={C.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              keyboardType="numbers-and-punctuation"
              returnKeyType="next"
            />
          </Field>

          <Field label="اسم المستخدم">
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="admin"
              placeholderTextColor={C.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
            />
          </Field>

          <Field label="كلمة المرور">
            <View style={styles.passwordRow}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={C.muted}
                style={[styles.input, styles.passwordInput]}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPass}
                autoComplete="password"
                textContentType="password"
                returnKeyType="done"
                onSubmitEditing={onSave}
              />
              <Pressable
                onPress={() => setShowPass((v) => !v)}
                hitSlop={10}
                style={styles.eye}
                accessibilityRole="button"
                accessibilityLabel={
                  showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
                }
              >
                <Icon
                  name={showPass ? 'eye-off' : 'eye'}
                  size={20}
                  color={C.sub}
                />
              </Pressable>
            </View>
          </Field>

          <Pressable
            onPress={onSave}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              (busy || pressed) && styles.primaryBtnPressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {isEdit ? 'حفظ التعديلات' : 'إضافة الراوتر'}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => nav.back()}
            disabled={busy}
            style={styles.ghostBtn}
          >
            <Text style={styles.ghostBtnText}>إلغاء</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.bg,
  },
  content: {
    padding: S.lg,
    paddingBottom: 200,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: R.lg,
    padding: S.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.cardBorder,
    shadowColor: C.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  title: {
    fontSize: T.h1,
    fontWeight: '700',
    color: C.text,
    marginBottom: S.xs,
  },
  subtitle: {
    fontSize: T.body,
    color: C.sub,
    marginBottom: S.lg,
    lineHeight: 20,
  },
  field: { marginBottom: S.md },
  label: { fontSize: T.label, color: C.sub, marginBottom: S.xs },
  input: {
    backgroundColor: C.rowBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.blueSoft,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    color: C.text,
    fontSize: T.body,
    minHeight: 48,
  },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 44 },
  eye: {
    position: 'absolute',
    right: S.sm,
    top: 0,
    bottom: 0,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: S.lg,
    backgroundColor: C.blue,
    borderRadius: R.md,
    paddingVertical: S.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryBtnPressed: { opacity: 0.85 },
  primaryBtnText: { fontSize: T.body, color: '#ffffff', fontWeight: '600' },
  ghostBtn: { marginTop: S.sm, paddingVertical: S.sm, alignItems: 'center' },
  ghostBtnText: { fontSize: T.body, color: C.sub },
});
