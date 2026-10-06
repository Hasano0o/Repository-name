import React, { useEffect, useRef, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon, IconName } from '../src/ui/Icon';
import { C, R, S, T, tBd, tBg, tFg } from '../src/ui/theme';
import { isLanHost } from '../src/utils/host';
import { detectDriver } from '../src/drivers/registry';
import { addDemoRouter } from '../src/drivers/demo';
import { DesktopNetCard, explainDetectFailure, useDesktopNet } from '../src/ui/DesktopNet';
import { getRouter, saveRouter, updateRouter, deleteRouter, SavedRouter, setWifi, SavedWifi } from '../src/store/routers';
import { LabelScannerHost, ensureScanner } from '../src/ui/scanner';
import type { LabelData } from '../src/utils/routerLabel';
import { dropSession } from '../src/store/sessions';
import {
  DEVICE_DRIVER_ID, DEVICE_HOST, ensureCellPermission,
} from '../src/drivers/device';
import { cellModuleAvailable, cellNative } from '../modules/bandly-cell/src';

/** عناوين الراوترات الشائعة — اختصار بضغطة */
const COMMON_HOSTS: { host: string; hint: string }[] = [
  { host: '192.168.8.1', hint: 'هواوي' },
  { host: '192.168.0.1', hint: 'ZTE' },
  { host: '192.168.1.1', hint: 'عام' },
  { host: '192.168.31.1', hint: 'شاومي' },
];

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
  const [step, setStep] = useState('');
  const [loading, setLoading] = useState<boolean>(Boolean(editId));
  const [focus, setFocus] = useState<string | null>(null);
  /** تعديل «هذا الجهاز» — ما له عنوان ولا كلمة مرور */
  const [isDevice, setIsDevice] = useState(false);
  /** ماسح ملصق الراوتر + بيانات الواي فاي اللي انقرأت منه (تنحفظ مع الراوتر) */
  const [scanning, setScanning] = useState(false);
  const [wifi, setWifiState] = useState<SavedWifi | null>(null);
  const [scanMsg, setScanMsg] = useState('');
  // يظهر حتى بالنسخ القديمة (يطلب التحديث) — بس مو بالويندوز
  const canScan = Platform.OS !== 'web';
  // نسخة الويندوز: حالة الشبكة + تعبئة عنوان الراوتر تلقائياً (ما لم يغيّره المستخدم)
  const net = useDesktopNet();
  const hostTouched = useRef(false);
  const pickHost = (h: string) => { hostTouched.current = true; setHost(h); };
  useEffect(() => {
    const gw = net.diag?.gateway;
    if (gw && !editId && !hostTouched.current && !net.diag?.noAddress) setHost(gw);
  }, [net.diag, editId]);

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
        setIsDevice(r.driverId === DEVICE_DRIVER_ID);
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

  /** يضيف «هذا الجهاز»: يقرأ الإشارة من شريحة الجهاز نفسه بدون راوتر */
  async function onAddDevice() {
    if (Platform.OS !== 'android') {
      Alert.alert('غير متاح', 'قراءة إشارة الجهاز متاحة على أندرويد فقط');
      return;
    }
    if (!cellModuleAvailable()) {
      Alert.alert('تحتاج تحديث', 'هذي الميزة تحتاج آخر نسخة من Bandly — حمّلها من البوت وثبّتها فوق النسخة الحالية');
      return;
    }
    setBusy(true);
    try {
      setStep('نطلب الصلاحية...');
      const ok = await ensureCellPermission();
      if (!ok) {
        Alert.alert('الصلاحية مطلوبة', 'أندرويد ما يعطي قراءات الأبراج إلا بصلاحية الموقع. اسمح بها وجرّب مرة ثانية.');
        return;
      }
      setStep('نقرأ الإشارة...');
      let found = 0;
      try {
        found = (await cellNative().getCells()).length;
      } catch { /* نحفظ ونخلّي شاشة الراوتر توضح الخطأ */ }
      if (found === 0) {
        const go = await new Promise<boolean>(res => Alert.alert(
          'ما طلعت أبراج',
          'ما قدرنا نقرأ أي برج الحين. تأكد إن فيه شريحة، وشغّل الموقع (GPS) من القائمة اللي فوق، وبعدها جرّب.',
          [
            { text: 'رجوع', style: 'cancel', onPress: () => res(false) },
            { text: 'أضفه على كل حال', onPress: () => res(true) },
          ],
        ));
        if (!go) return;
      }
      setStep('نحفظ...');
      const saved = await saveRouter({
        name: name.trim() || 'هذا الجهاز',
        host: DEVICE_HOST,
        username: '',
        driverId: DEVICE_DRIVER_ID,
        driverName: 'هذا الجهاز',
      }, '');
      nav.replace({ pathname: '/router/[id]', params: { id: saved.id } });
    } catch (e: unknown) {
      Alert.alert('خطأ', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStep('');
    }
  }

  function onScanned(d: LabelData) {
    const got: string[] = [];
    if (d.host) { pickHost(d.host); got.push('العنوان'); }
    if (d.username) { setUsername(d.username); got.push('اسم المستخدم'); }
    if (d.adminPassword) { setPassword(d.adminPassword); got.push('كلمة المرور'); }
    if (d.wifi?.ssid) {
      setWifiState({ ssid: d.wifi.ssid, password: d.wifi.password ?? '' });
      got.push('الواي فاي');
      if (!name.trim()) setName(d.wifi.ssid);
    }
    setScanMsg(got.length ? `✓ عبّينا: ${got.join('، ')}` : '');
    if (!d.adminPassword && d.wifi?.password) {
      Alert.alert('كلمة مرور الإدارة', 'ما لقينا كلمة مرور الإدارة على الملصق. بعض الرواترات تستخدم نفس كلمة سر الواي فاي أو «admin» — جرّبها.');
    }
  }

  async function onSave() {
    if (isDevice && editId) {
      setBusy(true);
      try {
        const saved = await updateRouter(editId, {
          name: name.trim() || 'هذا الجهاز',
          host: DEVICE_HOST,
          username: '',
          driverId: DEVICE_DRIVER_ID,
          driverName: 'هذا الجهاز',
        });
        if (saved) nav.replace({ pathname: '/router/[id]', params: { id: saved.id } });
      } finally {
        setBusy(false);
      }
      return;
    }
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
      setStep('نتعرّف على نوع الراوتر...');
      const driver = await detectDriver(h);
      if (!driver) {
        if (await explainDetectFailure(h, net, pickHost)) return;
        Alert.alert('تعذّر التعرف', 'ما تعرفنا على نوع الراوتر على هذا العنوان. تأكد إنك متصل بشبكة الراوتر.');
        return;
      }

      setStep('نسجّل الدخول...');
      try {
        await driver.login(h, u, password);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert('فشل الدخول', msg || 'تحقق من اسم المستخدم وكلمة المرور');
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

      setStep('نحفظ...');
      let saved: SavedRouter | null;
      if (editId) {
        dropSession(editId);
        saved = await updateRouter(editId, payload, password);
        if (!saved) {
          Alert.alert('خطأ', 'ما لقينا الراوتر المحفوظ');
          return;
        }
      } else {
        saved = await saveRouter(payload, password);
      }
      if (wifi?.ssid) { try { await setWifi(saved.id, wifi); } catch {} }
      nav.replace({ pathname: '/router/[id]', params: { id: saved.id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('خطأ', msg);
    } finally {
      setBusy(false);
      setStep('');
    }
  }

  function onDelete() {
    if (!editId) return;
    Alert.alert('حذف الراوتر', `تبي تحذف "${name || 'الراوتر'}" من التطبيق؟ بتنحذف كلمة المرور المحفوظة معه.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: async () => {
          dropSession(editId);
          await deleteRouter(editId);
          nav.replace('/');
        },
      },
    ]);
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
    <LinearGradient colors={[tBg('#eaf2ff'), tBg('#f3efff'), tBg('#eaf9f3')]} style={styles.flex}>
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
          {/* الترويسة */}
          <LinearGradient
            colors={[tBg('#2f6bff'), tBg('#6a4cff')]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroIcon}>
              <Text style={{ fontSize: 30 }}>{isEdit ? '✏️' : '📡'}</Text>
            </View>
            <Text style={styles.heroTitle}>{isEdit ? 'تعديل الراوتر' : 'أضف راوترك'}</Text>
            <Text style={styles.heroSub}>
              {isEdit
                ? 'عدّل البيانات وأدخل كلمة المرور عشان نتأكد من الدخول'
                : 'اتصل بشبكة الراوتر أول، وبعدها أدخل بيانات الدخول'}
            </Text>
            <View style={styles.safe}>
              <Icon name="lock" size={13} color={tFg('#fff')} />
              <Text style={styles.safeText}>{Platform.OS === 'web' ? 'كلمة المرور تنحفظ مشفّرة على جهازك فقط' : 'كلمة المرور تنحفظ مشفّرة على جوالك فقط'}</Text>
            </View>
          </LinearGradient>

          {/* «هذا الجهاز» — للأجهزة اللي تشتغل بنظام أندرويد وفيها شريحة */}
          {!isEdit && Platform.OS === 'android' && (
            <Pressable
              onPress={onAddDevice}
              disabled={busy}
              style={({ pressed }) => [styles.deviceCard, pressed && { opacity: 0.8 }]}
            >
              <View style={styles.deviceIcon}><Text style={{ fontSize: 24 }}>📱</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceTitle}>اقرأ إشارة هذا الجهاز</Text>
                <Text style={styles.deviceSub}>
                  لو Bandly مثبّت على جهاز فيه الشريحة نفسها (جهاز إنترنت منزلي بنظام أندرويد، أو جوالك) — بدون عنوان ولا كلمة مرور
                </Text>
              </View>
              <Icon name="chevron" size={18} color={C.blue} />
            </Pressable>
          )}

          {/* راوتر تجريبي — يشوف التطبيق كامل بدون راوتر */}
          {!isEdit && (
            <Pressable
              onPress={async () => { const id = await addDemoRouter(); nav.replace({ pathname: '/router/[id]', params: { id } }); }}
              disabled={busy}
              style={({ pressed }) => [styles.deviceCard, styles.demoCard, pressed && { opacity: 0.8 }]}
            >
              <View style={[styles.deviceIcon, { backgroundColor: tBg('#f3edff') }]}><Text style={{ fontSize: 24 }}>🧪</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceTitle}>جرّب بدون راوتر</Text>
                <Text style={styles.deviceSub}>راوتر تجريبي بقراءات وأبراج وترددات — تشوف فيه كل المزايا قبل ما تربط راوترك</Text>
              </View>
              <Icon name="chevron" size={18} color={tFg('#7c3aed')} />
            </Pressable>
          )}

          {/* امسح ملصق الراوتر — يعبّي البيانات لحاله */}
          {!isDevice && canScan && (
            <Pressable
              onPress={() => ensureScanner() && setScanning(true)}
              disabled={busy}
              style={({ pressed }) => [styles.deviceCard, styles.scanCard, pressed && { opacity: 0.8 }]}
            >
              <View style={[styles.deviceIcon, { backgroundColor: tBg('#e9fbf2') }]}><Text style={{ fontSize: 24 }}>📷</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceTitle}>امسح ملصق الراوتر</Text>
                <Text style={styles.deviceSub}>
                  {scanMsg || 'صوّر الملصق اللي تحت الراوتر ونعبّي العنوان وكلمة المرور والواي فاي لحالها'}
                </Text>
              </View>
              <Icon name="chevron" size={18} color={tFg('#12b76a')} />
            </Pressable>
          )}
          <LabelScannerHost visible={scanning} onClose={() => setScanning(false)} onResult={onScanned} />

          {/* النموذج */}
          <View style={styles.card}>
            <Field label="اسم الراوتر" hint="اختياري" icon="home" color={tFg('#8b5cf6')} focused={focus === 'name'}>
              <TextInput
                value={name}
                onChangeText={setName}
                onFocus={() => setFocus('name')}
                onBlur={() => setFocus(null)}
                placeholder="مثال: راوتر الصالة"
                placeholderTextColor={tFg('#9aa3bd')}
                style={styles.input}
                returnKeyType="next"
              />
            </Field>

            {!isDevice && (<>
            <DesktopNetCard net={net} />
            <Field label="عنوان الراوتر (IP)" icon="tower" color={tFg('#2f6bff')} focused={focus === 'host'}>
              <TextInput
                value={host}
                onChangeText={pickHost}
                onFocus={() => setFocus('host')}
                onBlur={() => setFocus(null)}
                placeholder="192.168.8.1"
                placeholderTextColor={tFg('#9aa3bd')}
                style={[styles.input, styles.ltr]}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                keyboardType="numbers-and-punctuation"
                returnKeyType="next"
              />
            </Field>
            <View style={styles.hosts}>
              {COMMON_HOSTS.map(h => {
                const on = host.trim() === h.host;
                return (
                  <Pressable
                    key={h.host}
                    onPress={() => pickHost(h.host)}
                    style={({ pressed }) => [styles.hostChip, on && styles.hostChipOn, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={[styles.hostIp, on && { color: tFg('#fff') }]}>{h.host}</Text>
                    <Text style={[styles.hostHint, on && { color: tFg('rgba(255,255,255,0.85)') }]}>{h.hint}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Field label="اسم المستخدم" icon="user" color={tFg('#12b76a')} focused={focus === 'user'}>
              <TextInput
                value={username}
                onChangeText={setUsername}
                onFocus={() => setFocus('user')}
                onBlur={() => setFocus(null)}
                placeholder="admin"
                placeholderTextColor={tFg('#9aa3bd')}
                style={[styles.input, styles.ltr]}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                returnKeyType="next"
              />
            </Field>

            <Field label="كلمة المرور" icon="lock" color={tFg('#f97316')} focused={focus === 'pass'}>
              <View style={styles.passwordRow}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocus('pass')}
                  onBlur={() => setFocus(null)}
                  placeholder="••••••••"
                  placeholderTextColor={tFg('#9aa3bd')}
                  style={[styles.input, styles.ltr, styles.passwordInput]}
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
                  accessibilityLabel={showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  <Icon name={showPass ? 'eye-off' : 'eye'} size={20} color={C.sub} />
                </Pressable>
              </View>
            </Field>
            <Text style={styles.passHint}>غالباً مكتوبة على ملصق تحت الراوتر (Password / كلمة مرور الإدارة)</Text>
            </>)}

            <Pressable
              onPress={onSave}
              disabled={busy}
              style={({ pressed }) => [styles.primaryWrap, (busy || pressed) && { opacity: 0.85 }]}
            >
              <LinearGradient
                colors={[tBg('#2f6bff'), tBg('#6a4cff')]}
                start={{ x: 1, y: 0 }}
                end={{ x: 0, y: 0 }}
                style={styles.primaryBtn}
              >
                {busy ? (
                  <View style={styles.busyRow}>
                    <ActivityIndicator color={tFg('#fff')} />
                    {!!step && <Text style={styles.primaryBtnText}>{step}</Text>}
                  </View>
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {isEdit ? '💾 حفظ التعديلات' : '🔗 اتصل وأضف الراوتر'}
                  </Text>
                )}
              </LinearGradient>
            </Pressable>

            <Pressable onPress={() => nav.back()} disabled={busy} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>إلغاء</Text>
            </Pressable>
          </View>

          {isEdit && (
            <Pressable
              onPress={onDelete}
              disabled={busy}
              style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
            >
              <Icon name="trash" size={17} color={C.red} />
              <Text style={styles.deleteText}>حذف الراوتر من التطبيق</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function Field({
  label, hint, icon, color, focused, children,
}: {
  label: string; hint?: string; icon: IconName; color: string; focused?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <View style={[styles.labelIcon, { backgroundColor: color }]}>
          <Icon name={icon} size={13} color={tFg('#fff')} />
        </View>
        <Text style={styles.label}>{label}</Text>
        {!!hint && <Text style={styles.labelHint}>{hint}</Text>}
      </View>
      <View style={[styles.inputWrap, focused && { borderColor: color, backgroundColor: tBg('#f3f6fa') }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  content: { padding: S.lg, paddingBottom: 200, gap: 14 },

  hero: {
    borderRadius: 26, paddingVertical: 22, paddingHorizontal: 18, alignItems: 'center', gap: 6,
    shadowColor: '#2f6bff', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  heroIcon: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: tBg('rgba(255,255,255,0.2)'), borderWidth: 1, borderColor: tBd('rgba(255,255,255,0.4)'), marginBottom: 4,
  },
  heroTitle: { color: tFg('#fff'), fontSize: 22, fontWeight: '900' },
  heroSub: { color: tFg('rgba(255,255,255,0.88)'), fontSize: 13, textAlign: 'center', lineHeight: 20 },
  safe: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 6,
    backgroundColor: tBg('rgba(255,255,255,0.18)'), borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  safeText: { color: tFg('#fff'), fontSize: 11.5, fontWeight: '700' },

  card: {
    backgroundColor: tBg('rgba(255,255,255,0.92)'), borderRadius: 24, padding: S.lg,
    borderWidth: 1, borderColor: tBd('#ffffff'),
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2,
  },
  field: { marginBottom: S.md },
  labelRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 7 },
  labelIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13.5, color: C.text, fontWeight: '800', textAlign: 'right' },
  labelHint: { fontSize: 11, color: C.muted, fontWeight: '600' },
  inputWrap: { borderRadius: 16, borderWidth: 1.5, borderColor: tBd('#d8e0eb'), backgroundColor: tBg('#e9eef5') },
  input: {
    paddingHorizontal: S.md, paddingVertical: S.sm, color: C.text, fontSize: 15, minHeight: 50,
    textAlign: 'right',
  },
  ltr: { textAlign: 'left', writingDirection: 'ltr', fontWeight: '700', letterSpacing: 0.3 },
  hosts: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: -4, marginBottom: S.md },
  hostChip: {
    borderRadius: 12, borderWidth: 1, borderColor: tBd('#d6e2ff'), backgroundColor: tBg('#eef3ff'),
    paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center',
  },
  hostChipOn: { backgroundColor: C.blue, borderColor: C.blue },
  hostIp: { color: C.blue, fontSize: 12, fontWeight: '800' },
  hostHint: { color: C.sub, fontSize: 9.5, fontWeight: '700' },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 46 },
  eye: {
    position: 'absolute', right: S.sm, top: 0, bottom: 0, width: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  passHint: { color: C.muted, fontSize: 11.5, textAlign: 'right', marginTop: -6, lineHeight: 17 },

  primaryWrap: {
    marginTop: S.lg, borderRadius: 16,
    shadowColor: '#2f6bff', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  primaryBtn: { borderRadius: 16, paddingVertical: S.md, alignItems: 'center', justifyContent: 'center', minHeight: 54 },
  primaryBtnText: { fontSize: 16, color: tFg('#ffffff'), fontWeight: '800' },
  busyRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  ghostBtn: { marginTop: S.sm, paddingVertical: S.sm, alignItems: 'center' },
  ghostBtnText: { fontSize: T.body, color: C.sub, fontWeight: '700' },

  deviceCard: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
    backgroundColor: tBg('rgba(255,255,255,0.92)'), borderRadius: 20, padding: S.md,
    borderWidth: 1.5, borderColor: tBd('#cfdcff'),
  },
  scanCard: { borderColor: tBd('#bfeed6') },
  demoCard: { borderColor: tBd('#ddd0ff') },
  deviceIcon: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    backgroundColor: tBg('#eef3ff'),
  },
  deviceTitle: { color: C.text, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  deviceSub: { color: C.sub, fontSize: 11.5, lineHeight: 17, textAlign: 'right', marginTop: 2 },

  deleteBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: tBg('#fff1f2'), borderColor: tBd('#fecdd3'), borderWidth: 1, borderRadius: 16, paddingVertical: 14,
  },
  deleteText: { color: C.red, fontWeight: '800', fontSize: 14 },
});
