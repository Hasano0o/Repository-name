import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, } from 'react-native';
import { Pressable, ScrollView, Text, TextInput, View } from '../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon, IconName } from '../src/ui/Icon';
import { C, R, S, T, tBd, tBg, tFg } from '../src/ui/theme';
import { isLanHost } from '../src/utils/host';
import { detectDriver } from '../src/drivers/registry';
import { addDemoRouter } from '../src/drivers/demo';
import { DesktopNetCard, explainDetectFailure, useDesktopNet } from '../src/ui/DesktopNet';
import { getRouter, saveRouter, updateRouter, deleteRouter, listRouters, SavedRouter, setWifi, SavedWifi, getLabel, setLabel, LabelCreds } from '../src/store/routers';
import { LabelScannerHost, ensureScanner } from '../src/ui/scanner';
import type { LabelData } from '../src/utils/routerLabel';
import { dropSession } from '../src/store/sessions';
import {
  DEVICE_DRIVER_ID, DEVICE_HOST, ensureCellPermission,
} from '../src/drivers/device';
import { cellModuleAvailable, cellNative } from '../modules/bandly-cell/src';

import { sheet } from '../src/i18n';
/** عناوين الراوترات الشائعة — اختصار بضغطة */
const COMMON_HOSTS: { host: string; hint: string; color: string }[] = [
  { host: '192.168.8.1', hint: 'هواوي', color: '#e5484d' },
  { host: '192.168.0.1', hint: 'ZTE', color: '#2f6bff' },
  { host: '192.168.31.1', hint: 'شاومي', color: '#ff7a1a' },
  { host: '192.168.1.1', hint: 'غيره', color: '#7c5cff' },
];

export default function AddRouterScreen() {
  const nav = useRouter();
  const params = useLocalSearchParams<{ id?: string; scan?: string }>();
  /** جاي من ترحيب المستخدم الجديد: نفتح الكاميرا على طول، ونسجّل الدخول لحالنا بعد التصوير */
  const welcomeScan = params.scan === '1' && !params.id;
  const editId =
    typeof params.id === 'string' && params.id.length > 0 ? params.id : undefined;

  const [name, setName] = useState('');
  const [host, setHost] = useState('192.168.8.1');
  const [username, setUsername] = useState('admin');
  const [passwordState, setPassword] = useState('');
  const [passHelp, setPassHelp] = useState(false);
  // الشرح مفتوح من البداية للجدد
  const [guide, setGuide] = useState(true);
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
  const scannedLabel = useRef<LabelCreds | null>(null);
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

  // الترحيب ← الكاميرا تنفتح على طول (مرة وحدة)
  const autoScanned = useRef(false);
  useEffect(() => {
    if (!welcomeScan || autoScanned.current) return;
    autoScanned.current = true;
    const t = setTimeout(() => { if (ensureScanner()) setScanning(true); }, 400);
    return () => clearTimeout(t);
  }, [welcomeScan]);

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
    scannedLabel.current = {
      username: d.username, adminPassword: d.adminPassword,
      ssid: d.wifi?.ssid, wifiPassword: d.wifi?.password,
    };
    if (d.username) { setUsername(d.username); got.push('اسم المستخدم'); }
    if (d.adminPassword) { setPassword(d.adminPassword); got.push('كلمة المرور'); }
    if (d.wifi?.ssid) {
      setWifiState({ ssid: d.wifi.ssid, password: d.wifi.password ?? '' });
      got.push('الواي فاي');
      if (!name.trim()) setName(d.wifi.ssid);
    }
    setScanMsg(got.length ? `✓ عبّينا: ${got.join('، ')}` : '');
    // لقينا كلمة الإدارة ← ندخل عنه على طول (المستخدم شاف البيانات وأكدها في الماسح)
    if (d.adminPassword && !editId) {
      setScanMsg(`✓ عبّينا: ${got.join('، ')} — ندخل للراوتر عنك...`);
      setTimeout(() => {
        onSave({
          host: d.host, username: d.username, password: d.adminPassword, findHost: !d.host,
          wifi: d.wifi?.ssid ? { ssid: d.wifi.ssid, password: d.wifi.password ?? '' } : undefined,
          name: d.wifi?.ssid,
        });
      }, 300);
      return;
    }
    if (!d.adminPassword) {
      // رمز QR فيه الواي فاي بس — نوضح الخطوة الجاية بدل ما يحتار (أغلب الآيفون هنا: يقرأ QR بس)
      Alert.alert('باقي كلمة مرور الإدارة',
        `${d.wifi?.ssid ? 'تمام، قرينا الواي فاي ✓\n\n' : ''}اكتب «كلمة مرور الإدارة» المكتوبة على الملصق (غالباً جنب كلمة Password أو كلمة الدخول) في خانة كلمة المرور، واضغط «اتصل وأضف الراوتر».\n\nبعض الراوترات تستخدم نفس كلمة سر الواي فاي أو «admin».`);
    }
  }

  /**
   * over: قيم من الماسح (حالة React ما تتحدّث فوراً) — findHost: العنوان مو على الملصق،
   * فلو ما رد العنوان الحالي نجرّب العناوين المشهورة (هواوي/ZTE/غيرها) قبل ما نستسلم.
   */
  async function onSave(over?: { host?: string; username?: string; password?: string; findHost?: boolean; wifi?: SavedWifi; name?: string }) {
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
    let h = (over?.host ?? host).trim();
    const u = (over?.username ?? username).trim() || 'admin';
    const password = over?.password ?? passwordState;
    const wifiNow = over?.wifi ?? wifi;
    const nameNow = (name.trim() || over?.name || '').trim();
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
      let driver = await detectDriver(h);
      if (!driver && over?.findHost) {
        for (const alt of ['192.168.8.1', '192.168.0.1', '192.168.1.1', '192.168.100.1', '192.168.192.1', '192.168.254.1'].filter(x => x !== h)) {
          setStep(`ندوّر على الراوتر (${alt})...`);
          driver = await detectDriver(alt);
          if (driver) { h = alt; setHost(alt); break; }
        }
      }
      if (!driver) {
        if (await explainDetectFailure(h, net, pickHost)) return;
        // نفرّق: فيه جهاز يرد بس نوعه مو مدعوم ← «نضيفه لك» / ما فيه شي يرد ← مو على شبكة الراوتر
        setStep('نتأكد…');
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 2500);
        const answered = await fetch(`http://${h}/`, { signal: ctrl.signal }).then(() => true, () => false).finally(() => clearTimeout(tm));
        if (answered) {
          Alert.alert('راوترك مو مدعوم للحين',
            `لقينا راوتر على ${h}، بس نوعه للحين ما يشتغل مع Bandly.\n\nأرسل لنا تفاصيله (دقيقة وحدة) والمبرمج يتواصل معك ويضيفه.`,
            [{ text: 'رجوع', style: 'cancel' }, { text: 'نضيفه لك', onPress: () => nav.push('/newdevice') }]);
        } else {
          Alert.alert('ما لقينا راوتر',
            `ما فيه جهاز يرد على ${h}.\n\nتأكد إن جوالك متصل بواي فاي الراوتر (مو بيانات الجوال)، أو خلّ التطبيق يدوّر عليه.`,
            [{ text: 'تمام', style: 'cancel' }, { text: 'دوّر عليه', onPress: () => nav.push('/setup') }]);
        }
        return;
      }

      // الموديل بالضبط (بدون كلمة مرور) — التطبيق يضبط نفسه عليه
      const prof = driver.identify ? await driver.identify().catch(() => null) : null;
      if (prof) {
        setStep(`تعرّفنا على راوترك: ${prof.label} ✓`);
        await new Promise(r => setTimeout(r, 900));
      }

      setStep('نسجّل الدخول...');
      try {
        await driver.login(h, u, password, { fresh: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // ZTE: باقي محاولة/محاولتين — قبل كنا نوقف للأبد (والحل الوحيد ضبط المصنع). الحين نخيّر المستخدم.
        if ((e as any)?.code === 'LAST_TRY') {
          const left = (e as any)?.left as number | undefined;
          const go = await new Promise<boolean>(res => Alert.alert(
            left === 1 ? 'باقي محاولة أخيرة' : 'نجرّب الدخول؟',
            `${left === 1 ? 'الراوتر يسمح بمحاولة دخول وحدة قبل ما يقفل.' : msg}\n\nتأكد إن كلمة المرور صحيحة (الملصق تحت الراوتر، أو اللي غيّرتها أنت).\n\nلو طلعت غلط: الراوتر ممكن يقفل الدخول دقايق وبعدها يرجع طبيعي — ما يحتاج ضبط مصنع.`,
            [
              { text: 'أراجع الكلمة', style: 'cancel', onPress: () => res(false) },
              { text: 'جرّب الحين', onPress: () => res(true) },
            ],
          ));
          if (!go) return;
          setStep('المحاولة الأخيرة...');
          try {
            await driver.login(h, u, password, { lastTry: true, fresh: true });
          } catch (e2) {
            Alert.alert('فشل الدخول', e2 instanceof Error ? e2.message : String(e2));
            return;
          }
        } else {
          Alert.alert('فشل الدخول', msg || 'تحقق من اسم المستخدم وكلمة المرور');
          return;
        }
      }

      const dAny = driver as unknown as { id?: string; name?: string };
      const dId = dAny.id ?? 'unknown';
      const dName = prof?.label ?? dAny.name ?? dId;

      const payload = {
        name: nameNow || dName || 'راوتر',
        host: h,
        username: u,
        driverId: dId,
        driverName: dName,
      };

      setStep('نحفظ...');
      // أول راوتر؟ ← بعد الحفظ نعرض «كيف تبدأ»
      const first = !editId && (await listRouters().catch(() => [] as SavedRouter[])).length === 0;
      let saved: SavedRouter | null;
      if (editId) {
        dropSession(editId);
        saved = await updateRouter(editId, payload, password);
        if (!saved) {
          Alert.alert('خطأ', 'ما لقينا الراوتر المحفوظ');
          return;
        }
      } else {
        // نفس الراوتر مضاف من قبل؟ نحدّثه بدل ما نسوي نسخة ثانية —
        // النسختين كانوا يسجّلون دخول بنفس الوقت ويطردون بعض
        const norm = (x: string) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const dup = (await listRouters().catch(() => [] as SavedRouter[])).find(x => x.driverId === dId && norm(x.host) === norm(h));
        if (dup) {
          dropSession(dup.id);
          saved = (await updateRouter(dup.id, payload, password)) ?? (await saveRouter(payload, password));
        } else {
          saved = await saveRouter(payload, password);
        }
      }
      if (wifiNow?.ssid) { try { await setWifi(saved.id, wifiNow); } catch {} }
      // بيانات الملصق: لو صوّر الملصق نحفظها لحالها (منفصلة عن الكلمة الحالية) — تنفع بعد ضبط المصنع
      if (scannedLabel.current) {
        try { await setLabel(saved.id, { ...(await getLabel(saved.id)), ...scannedLabel.current }); } catch {}
      }
      nav.replace({ pathname: '/router/[id]', params: first ? { id: saved.id, welcome: '1' } : { id: saved.id } });
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

          {/* كيف أضيف راوتري؟ — أكبر عقبة عند الجدد (الإحصائيات: «ما عرف كيف يضيفه») */}
          {!isEdit && (
            <View style={styles.guide}>
              <Pressable onPress={() => setGuide(v => !v)} style={styles.guideHead} hitSlop={6}>
                <View style={styles.guideIcon}><Text style={{ fontSize: 17 }}>🧭</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.guideTitle}>كيف أضيف راوتري؟</Text>
                  <Text style={styles.guideSub}>٤ خطوات — أقل من دقيقة</Text>
                </View>
                <Text style={styles.guideArrow}>{guide ? '▲' : '▼'}</Text>
              </Pressable>
              {guide && (
                <View style={{ gap: 10 }}>
                  {[
                    ['📶', 'اتصل بواي فاي الراوتر', 'جوالك لازم يكون على شبكة الراوتر نفسه. لو ما زبط، اطفِ بيانات الجوال مؤقتاً.'],
                    ['🏷️', 'اقلب الراوتر وشوف الملصق', 'تحته أو خلفه: العنوان (غالباً 192.168.8.1 أو 192.168.0.1) وكلمة المرور (Password).'],
                    ['📷', 'صوّر الملصق أو اكتب البيانات', 'زر «صوّره» يعبّي العنوان وكلمة المرور لحاله — أو اكتبها تحت.'],
                    ['✅', 'اضغط «اتصل وأضف الراوتر»', 'التطبيق يتعرّف على نوع الراوتر ويدخل لحاله. كلمة المرور تبقى على جوالك بس.'],
                  ].map(([ic, t, d], i) => (
                    <View key={i} style={styles.guideRow}>
                      <View style={styles.guideNum}><Text style={styles.guideNumTxt}>{i + 1}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.guideRowTitle}>{ic} {t}</Text>
                        <Text style={styles.guideRowDesc}>{d}</Text>
                      </View>
                    </View>
                  ))}
                  <Pressable onPress={() => Linking.openURL('https://t.me/hasa_n20').catch(() => {})}
                    style={({ pressed }) => [styles.tgBtn, pressed && { opacity: 0.85 }]}>
                    <Icon name="send" size={17} color="#ffffff" />
                    <Text style={styles.tgTxt}>ما زبط؟ كلّم المبرمج في تيليجرام يشرح لك</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {/* النموذج */}
          <View style={styles.card}>
            {!isDevice && (<>
            <LinearGradient
              colors={[tBg('#eef3ff'), tBg('#f4efff')]}
              start={{ x: 1, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.credBox}
            >
              <View style={styles.credHead}>
                <View style={styles.credIcon}><Text style={{ fontSize: 17 }}>🔑</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.credTitle}>بيانات دخول الراوتر</Text>
                  <Text style={styles.credSub}>مكتوبة على الملصق تحت الراوتر (Password)</Text>
                </View>
                {canScan && (
                  <Pressable
                    onPress={() => ensureScanner() && setScanning(true)}
                    disabled={busy}
                    hitSlop={6}
                    style={({ pressed }) => [styles.credScan, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={styles.credScanTxt}>📷 صوّره</Text>
                  </Pressable>
                )}
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
                    value={passwordState}
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
                    onSubmitEditing={() => onSave()}
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

              <Pressable onPress={() => setPassHelp(v => !v)} hitSlop={6} style={styles.helpToggle}>
                <Text style={styles.helpToggleTxt}>{passHelp ? '▲' : '▼'}  وين ألقى كلمة المرور؟</Text>
              </Pressable>
              {passHelp && (
                <View style={styles.helpBox}>
                  {[
                    ['1', 'اقلب الراوتر', 'فيه ملصق تحته أو خلفه، عليه بيانات الراوتر.'],
                    ['2', 'دوّر على كلمة المرور', 'مكتوبة جنب: Password أو Admin Password أو Login Password. واسم المستخدم غالباً admin.'],
                    ['3', 'لا تخلطها بالواي فاي', 'WiFi Key / WLAN Key هي كلمة الواي فاي. لو ما فيه غيرها على الملصق جرّبها، بعض الرواترات تستخدمها للدخول بعد.'],
                    ['4', 'غيّرتها قبل؟', 'لو أنت أو الفني غيّرتها من إعدادات الراوتر، اكتب الجديدة — اللي على الملصق ما تشتغل بعد التغيير.'],
                  ].map(([n, t, d]) => (
                    <View key={n} style={styles.helpRow}>
                      <View style={styles.helpNum}><Text style={styles.helpNumTxt}>{n}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.helpTitle}>{t}</Text>
                        <Text style={styles.helpDesc}>{d}</Text>
                      </View>
                    </View>
                  ))}
                  <Text style={styles.helpNote}>نسيتها؟ زر Reset (اضغطه ١٠ ثواني بقلم) يرجّع كلمة الملصق — بس يمسح إعداداتك كلها، فخلّه آخر حل.</Text>
                </View>
              )}
            </LinearGradient>
            {!!scanMsg && <Text style={styles.passHint}>{scanMsg}</Text>}

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
            <Text style={styles.hostsCap}>وش نوع راوترك؟ اختره والعنوان يتعبى لحاله 👇</Text>
            <View style={styles.hosts}>
              {COMMON_HOSTS.map(h => {
                const on = host.trim() === h.host;
                const col = tFg(h.color);
                return (
                  <Pressable
                    key={h.host}
                    onPress={() => pickHost(h.host)}
                    style={({ pressed }) => [
                      styles.hostChip,
                      { borderColor: on ? col : tBd(h.color + '40'), backgroundColor: on ? col : tBg(h.color + '12') },
                      on && { shadowColor: h.color, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
                      pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] },
                    ]}
                  >
                    {on && <View style={styles.hostCheck}><Text style={{ color: col, fontSize: 10, fontWeight: '900' }}>✓</Text></View>}
                    <Text style={[styles.hostBrand, { color: on ? tFg('#fff') : col }]}>{h.hint}</Text>
                    <Text style={[styles.hostIp, { color: on ? tFg('rgba(255,255,255,0.9)') : C.sub }]}>{h.host}</Text>
                  </Pressable>
                );
              })}
            </View>

            </>)}

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


            <Pressable
              onPress={() => onSave()}
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
                <Text style={styles.deviceTitle}>جرّب بدون راوتر · Demo</Text>
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

const styles = sheet({
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
  hostsCap: { color: C.sub, fontSize: 12, fontWeight: '700', textAlign: 'right', marginTop: -4, marginBottom: 8 },
  hosts: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: S.md },
  hostChip: {
    flexBasis: '47%', flexGrow: 1, borderRadius: 16, borderWidth: 1.5,
    paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', gap: 2,
  },
  hostCheck: {
    position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 9,
    backgroundColor: tBg('#ffffff'), alignItems: 'center', justifyContent: 'center',
  },
  hostBrand: { fontSize: 15, fontWeight: '900' },
  hostIp: { fontSize: 11.5, fontWeight: '700', writingDirection: 'ltr' },
  guide: { backgroundColor: C.card, borderRadius: R.lg, padding: 14, gap: 12, borderWidth: 1.5, borderColor: tBd('#c7d7ff') },
  guideHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  guideIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: tBg('#eef3ff'), alignItems: 'center', justifyContent: 'center' },
  guideTitle: { color: C.text, fontSize: 15.5, fontWeight: '900', textAlign: 'right' },
  guideSub: { color: C.sub, fontSize: 11.5, textAlign: 'right' },
  guideArrow: { color: C.blue, fontSize: 13, fontWeight: '800' },
  guideRow: { flexDirection: 'row-reverse', gap: 10, alignItems: 'flex-start' },
  guideNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  guideNumTxt: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  guideRowTitle: { color: C.text, fontSize: 13.5, fontWeight: '800', textAlign: 'right' },
  guideRowDesc: { color: C.sub, fontSize: 12, lineHeight: 18, textAlign: 'right', marginTop: 1 },
  tgBtn: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#229ED9', borderRadius: 14, paddingVertical: 11, marginTop: 2 },
  tgTxt: { color: '#ffffff', fontSize: 13.5, fontWeight: '900' },
  helpToggle: { alignSelf: 'flex-end', paddingVertical: 4, marginTop: -4, marginBottom: S.sm },
  helpToggleTxt: { color: C.blue, fontSize: 13, fontWeight: '800' },
  helpBox: { backgroundColor: tBg('#ffffff'), borderRadius: 14, padding: S.md, gap: 10, marginBottom: S.md },
  helpRow: { flexDirection: 'row-reverse', gap: 10, alignItems: 'flex-start' },
  helpNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  helpNumTxt: { color: tFg('#fff'), fontSize: 12, fontWeight: '900' },
  helpTitle: { color: C.text, fontSize: 13.5, fontWeight: '800', textAlign: 'right' },
  helpDesc: { color: C.sub, fontSize: 12, lineHeight: 18, textAlign: 'right', marginTop: 1 },
  helpNote: { color: tFg('#b45309'), fontSize: 11.5, lineHeight: 17, textAlign: 'right', backgroundColor: tBg('#fff7e6'), borderRadius: 10, padding: 8 },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 46 },
  eye: {
    position: 'absolute', right: S.sm, top: 0, bottom: 0, width: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  credBox: {
    borderRadius: 20, padding: S.md, paddingBottom: 2, marginBottom: S.md,
    borderWidth: 1.5, borderColor: tBd('#c9d8ff'),
    shadowColor: '#2f6bff', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  credHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: S.md },
  credIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: tBg('#ffffff'), alignItems: 'center', justifyContent: 'center' },
  credTitle: { color: C.text, fontSize: 15.5, fontWeight: '900', textAlign: 'right' },
  credSub: { color: C.sub, fontSize: 11.5, textAlign: 'right', marginTop: 1 },
  credScan: { backgroundColor: tBg('#12b76a'), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  credScanTxt: { color: tFg('#fff'), fontSize: 12, fontWeight: '800' },
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
