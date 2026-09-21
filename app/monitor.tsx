import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Switch, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  MonitorSettings, MonitorAlerts, getMonitorSettings, saveMonitorSettings, DEFAULT_SETTINGS,
} from '../src/store/monitor';
import { startMonitor, stopMonitor, isMonitorRegistered, runMonitorCheck } from '../src/tasks/monitor';
import { requestNotifyPermission, notify } from '../src/utils/notify';
import { listRouters } from '../src/store/routers';
import { Icon, IconName } from '../src/ui/Icon';
import { C, R, S, T } from '../src/ui/theme';

interface AlertRow { key: keyof MonitorAlerts; title: string; sub: string; icon: IconName; color: string; }

const ALERT_ROWS: AlertRow[] = [
  { key: 'signalDrop', title: 'ضعف الإشارة', sub: 'ينبّهك لما تطيح إشارتك', icon: 'down', color: '#e5484d' },
  { key: 'signalRecover', title: 'تحسّن الإشارة', sub: 'لما ترجع الإشارة قوية', icon: 'up', color: '#12b76a' },
  { key: 'nr5g', title: 'رجوع 5G', sub: 'لما يتصل بشبكة 5G', icon: 'spark', color: '#7a51e0' },
  { key: 'disconnect', title: 'انقطاع الاتصال', sub: 'لما يفقد الراوتر الشبكة', icon: 'power', color: '#d73722' },
  { key: 'dataPlan', title: 'استهلاك الباقة', sub: 'تنبيه عند 70٪ و90٪ و100٪', icon: 'chart', color: '#f59e0b' },
];

export default function MonitorScreen() {
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<MonitorSettings>(DEFAULT_SETTINGS);
  const [registered, setRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [routerCount, setRouterCount] = useState(0);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const s = await getMonitorSettings();
      const reg = await isMonitorRegistered();
      const rs = await listRouters();
      if (!alive) return;
      setSettings(s); setRegistered(reg); setRouterCount(rs.length); setLoading(false);
    })();
    return () => { alive = false; };
  }, []));

  const persist = async (s: MonitorSettings) => {
    setSettings(s);
    await saveMonitorSettings(s);
  };

  const toggleMaster = async (on: boolean) => {
    setMsg('');
    if (on) {
      setBusy(true);
      const ok = await requestNotifyPermission();
      if (!ok) {
        setBusy(false);
        setMsg('لازم تسمح بالإشعارات من إعدادات جوالك عشان تشتغل المراقبة.');
        return;
      }
      try {
        await startMonitor(settings.intervalMin);
        setRegistered(await isMonitorRegistered());
        await persist({ ...settings, enabled: true });
        setMsg('تم التفعيل ✅ بيراقب اتصالك ويرسل لك تنبيه لو صار شي — حتى والتطبيق مقفل.');
      } catch {
        setMsg('ما قدرنا نشغّل المراقبة على هذا الجهاز.');
      }
      setBusy(false);
    } else {
      setBusy(true);
      await stopMonitor();
      setRegistered(await isMonitorRegistered());
      await persist({ ...settings, enabled: false });
      setBusy(false);
      setMsg('تم إيقاف المراقبة.');
    }
  };

  const toggleAlert = (key: keyof MonitorAlerts, on: boolean) => {
    persist({ ...settings, alerts: { ...settings.alerts, [key]: on } });
  };

  const testNow = async () => {
    setBusy(true); setMsg('');
    const ok = await requestNotifyPermission();
    if (!ok) { setBusy(false); setMsg('لازم تسمح بالإشعارات أول.'); return; }
    await notify('تجربة إشعار 🔔', 'كذا بتوصلك التنبيهات من موجة.');
    try { await runMonitorCheck(); } catch {}
    setBusy(false);
    setMsg('أرسلنا لك إشعار تجريبي. لو وصلك، كل شي تمام.');
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;
  }

  const on = settings.enabled;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        {/* المفتاح الرئيسي */}
        <View style={[s.hero, on && s.heroOn]}>
          <View style={[s.heroIcon, { backgroundColor: on ? C.blue : C.rowBg }]}>
            <Icon name="bell" size={24} color={on ? C.onAccent : C.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>المراقبة التلقائية</Text>
            <Text style={s.heroSub}>
              {on ? 'شغّالة — نراقب اتصالك عنك' : 'مطفأة'}
            </Text>
          </View>
          {busy ? <ActivityIndicator color={C.blue} /> : (
            <Switch
              value={on}
              onValueChange={toggleMaster}
              trackColor={{ false: C.track, true: C.blueSoft }}
              thumbColor={on ? C.blue : '#fff'}
            />
          )}
        </View>

        {!!msg && <Text style={[s.msg, on ? s.msgOk : undefined]}>{msg}</Text>}

        <Text style={s.explain}>
          يفحص التطبيق راوترك كل ١٥ دقيقة تقريباً وأنت على شبكة البيت، ويرسل لك تنبيه لحظة يصير شي مهم — حتى لو التطبيق مقفل.
          ما نقرأ ولا نخزّن أي كلمة مرور، بس حالة الإشارة والاستهلاك.
        </Text>

        {routerCount === 0 && (
          <View style={s.warn}>
            <Text style={s.warnText}>ما عندك راوترات محفوظة بعد. أضف راوتر عشان تشتغل المراقبة عليه.</Text>
          </View>
        )}

        {/* التنبيهات */}
        <Text style={s.grp}>وش نبّهك عنه</Text>
        <View style={[s.card, !on && s.cardOff]}>
          {ALERT_ROWS.map((row, i) => (
            <View key={row.key} style={[s.row, i < ALERT_ROWS.length - 1 && s.rowBorder]}>
              <View style={[s.rowIcon, { backgroundColor: row.color + '18' }]}>
                <Icon name={row.icon} size={17} color={row.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{row.title}</Text>
                <Text style={s.rowSub}>{row.sub}</Text>
              </View>
              <Switch
                value={settings.alerts[row.key]}
                disabled={!on}
                onValueChange={v => toggleAlert(row.key, v)}
                trackColor={{ false: C.track, true: C.blueSoft }}
                thumbColor={settings.alerts[row.key] && on ? C.blue : '#fff'}
              />
            </View>
          ))}
        </View>

        {/* تجربة */}
        <Pressable style={[s.testBtn, busy && s.off]} disabled={busy} onPress={testNow}>
          <Icon name="bell" size={16} color={C.blue} />
          <Text style={s.testTxt}>أرسل لي إشعار تجريبي</Text>
        </Pressable>

        <Text style={s.note}>
          ملاحظة: أندرويد يقرر توقيت الفحص حسب البطارية، فقد يتأخر التنبيه شوي أحياناً. للأهمية القصوى خلّ التطبيق مستثنى من توفير البطارية.
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  hero: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, padding: S.lg,
  },
  heroOn: { borderColor: C.blueSoft },
  heroIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: C.text, fontSize: 17, fontWeight: '800', textAlign: 'right' },
  heroSub: { color: C.sub, fontSize: 13, textAlign: 'right', marginTop: 2 },
  msg: { color: C.sub, fontSize: 12.5, textAlign: 'center', lineHeight: 20 },
  msgOk: { color: C.green },
  explain: { color: C.sub, fontSize: 12.5, lineHeight: 21, textAlign: 'right' },
  warn: { backgroundColor: C.goldSoft, borderColor: C.amberSoft, borderWidth: 1, borderRadius: R.md, padding: S.md },
  warnText: { color: '#9a6a12', fontSize: 12.5, textAlign: 'right', lineHeight: 20 },
  grp: { color: C.text, fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 4 },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, paddingHorizontal: S.lg },
  cardOff: { opacity: 0.5 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.line },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  rowSub: { color: C.sub, fontSize: 11.5, textAlign: 'right', marginTop: 2 },
  testBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.rowBg, borderColor: C.blueSoft, borderWidth: 1, borderRadius: R.md, paddingVertical: 13,
  },
  testTxt: { color: C.blue, fontSize: 14, fontWeight: '800' },
  off: { opacity: 0.5 },
  note: { color: C.muted, fontSize: 11, textAlign: 'right', lineHeight: 18 },
});
