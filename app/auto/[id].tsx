import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Pressable, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { Profile, listProfiles, ROLES } from '../../src/store/profiles';
import { listGameLog, periodStats, PERIODS, PeriodStat } from '../../src/store/gameLog';
import { AutoSettings, AutoState, NightlyMode, getAuto, saveAuto, getAutoState } from '../../src/store/automation';
import { getMonitorSettings } from '../../src/store/monitor';
import { C, tFg } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';

const NIGHTLY: { id: NightlyMode; title: string; sub: string }[] = [
  { id: 'off', title: 'متوقفة', sub: 'ما نعيد تشغيل الراوتر أبداً' },
  { id: 'smart', title: 'بس إذا يحتاج', sub: 'لو صار بطيء، أو شغال أكثر من يومين، أو الإشارة ضعفت' },
  { id: 'daily', title: 'كل ليلة', sub: 'إعادة تشغيل يومية بين ٣:٣٠ و٥ الفجر' },
];

const PERIOD_HOURS: Record<string, string> = {
  morning: '٥ الصبح – ١٢ الظهر',
  noon: '١٢ – ٦ المغرب',
  evening: '٦ – ١١ الليل',
  night: '١١ الليل – ٥ الفجر',
};

const clock = (t: number) => {
  const d = new Date(t);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function AutoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [auto, setAuto] = useState<AutoSettings | null>(null);
  const [state, setState] = useState<AutoState>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [periods, setPeriods] = useState<PeriodStat[]>([]);
  const [monitorOn, setMonitorOn] = useState(true);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive || !r) return;
      const [a, st, ps, log, mon] = await Promise.all([
        getAuto(r.id), getAutoState(r.id), listProfiles(r.id), listGameLog(r.id), getMonitorSettings(),
      ]);
      if (!alive) return;
      setInfo(r);
      setAuto(a);
      setState(st);
      setProfiles(ps.sort((x, y) => (x.role ? 0 : 1) - (y.role ? 0 : 1)));
      setPeriods(periodStats(log));
      setMonitorOn(mon.enabled);
    })();
    return () => { alive = false; };
  }, [id]));

  const update = (next: AutoSettings) => {
    setAuto(next);
    if (info) saveAuto(info.id, next);
  };

  if (!auto || !info) {
    return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;
  }

  const profName = (p: Profile) => {
    const role = p.role ? ROLES.find(r => r.id === p.role) : undefined;
    return role ? `${role.icon} ${role.name}` : p.name;
  };
  const anyOn = auto.nightly !== 'off' || auto.smart.enabled;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        {anyOn && !monitorOn && (
          <Pressable style={s.warn} onPress={() => router.push('/monitor' as Href)}>
            <Text style={s.warnTxt}>⚠️ الوضع الذكي يشتغل مع «المراقبة» بالخلفية، وهي مقفلة الحين. اضغط هنا وفعّلها ‹</Text>
          </Pressable>
        )}

        <GlassCard title="التبديل حسب الوقت" icon="🌙" tint={C.violetSoft} collapsible={false}>
          <View style={s.switchRow}>
            <Switch
              value={auto.smart.enabled}
              onValueChange={v => update({ ...auto, smart: { ...auto.smart, enabled: v } })}
              trackColor={{ true: C.blue, false: C.line }}
              thumbColor="#fff"
            />
            <Text style={s.switchTxt}>بدّل الإعداد لحاله حسب وقت اليوم</Text>
          </View>
          <Text style={s.hint}>
            اختار لكل فترة ملف من ملفاتك. مثلاً وقت الذروة بالليل تردد أهدى، والصبح الأسرع. التبديل يصير أول ما تبدأ الفترة.
          </Text>

          {profiles.length === 0 ? (
            <Pressable onPress={() => router.push(`/profiles/${info.id}` as Href)}>
              <Text style={s.link}>ما عندك ملفات محفوظة — احفظ إعداداتك من «الملفات» أو ثبّت الأفضل من مُحسّن الألعاب ‹</Text>
            </Pressable>
          ) : (
            PERIODS.map(p => {
              const stat = periods.find(x => x.id === p.id);
              const cur = auto.smart.map[p.id] ?? null;
              return (
                <View key={p.id} style={[s.period, !auto.smart.enabled && s.dim]}>
                  <View style={s.periodHead}>
                    <Text style={s.periodHours}>{PERIOD_HOURS[p.id]}</Text>
                    <Text style={s.periodName}>{p.name}</Text>
                  </View>
                  {!!stat?.bestSetup && (
                    <Text style={s.suggest}>💡 حسب فحوصاتك الأفضل بهالوقت: {stat.bestSetup}{stat.avgScore !== undefined ? ` (متوسط ${stat.avgScore}/100)` : ''}</Text>
                  )}
                  <View style={s.chips}>
                    <Pressable
                      style={[s.chip, cur === null && s.chipOn]}
                      disabled={!auto.smart.enabled}
                      onPress={() => update({ ...auto, smart: { ...auto.smart, map: { ...auto.smart.map, [p.id]: null } } })}
                    >
                      <Text style={[s.chipTxt, cur === null && s.chipTxtOn]}>لا تغيّر</Text>
                    </Pressable>
                    {profiles.map(pr => (
                      <Pressable
                        key={pr.id}
                        style={[s.chip, cur === pr.id && s.chipOn]}
                        disabled={!auto.smart.enabled}
                        onPress={() => update({ ...auto, smart: { ...auto.smart, map: { ...auto.smart.map, [p.id]: pr.id } } })}
                      >
                        <Text style={[s.chipTxt, cur === pr.id && s.chipTxtOn]} numberOfLines={1}>{profName(pr)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })
          )}
          {!!state.lastSwitchAt && (
            <Text style={s.hint}>آخر تبديل تلقائي: {new Date(state.lastSwitchAt).toLocaleDateString('ar-SA', { weekday: 'long' })} {clock(state.lastSwitchAt)}</Text>
          )}
        </GlassCard>

        <GlassCard title="الصيانة الليلية" icon="🔄" tint={C.greenSoft} collapsible={false}>
          <Text style={s.hint}>
            الراوترات تثقل مع الوقت. نعيد تشغيله الفجر وما أحد يستخدم النت، ونقيس البنق قبل وبعد، ويوصلك التقرير الصبح.
          </Text>
          {NIGHTLY.map(n => (
            <Pressable key={n.id} style={[s.opt, auto.nightly === n.id && s.optOn]} onPress={() => update({ ...auto, nightly: n.id })}>
              <View style={[s.radio, auto.nightly === n.id && s.radioOn]} />
              <View style={{ flex: 1 }}>
                <Text style={s.optTitle}>{n.title}</Text>
                <Text style={s.optSub}>{n.sub}</Text>
              </View>
            </Pressable>
          ))}
          <Text style={s.hint}>ما نعيد التشغيل لو أحد يحمّل وقتها. ولازم جوالك يكون على واي فاي البيت بالليل.</Text>
          {!!state.report && (
            <View style={s.report}>
              <Text style={s.reportTitle}>آخر صيانة: {new Date(state.report.at).toLocaleDateString('ar-SA', { weekday: 'long' })} {clock(state.report.at)}</Text>
              <Text style={s.reportSub}>
                {state.report.reason}
                {state.report.beforePing !== undefined && state.report.afterPing !== undefined
                  ? ` · البنق ${state.report.beforePing}ms ← ${state.report.afterPing}ms` : ''}
              </Text>
            </View>
          )}
        </GlassCard>
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  link: { color: C.blue, fontSize: 13, fontWeight: '800', textAlign: 'right', lineHeight: 20 },
  warn: { backgroundColor: C.amberSoft, borderRadius: 14, padding: 12 },
  warnTxt: { color: tFg('#8a4b00'), fontWeight: '800', fontSize: 13, textAlign: 'right', lineHeight: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchTxt: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right', flexShrink: 1 },
  dim: { opacity: 0.45 },
  period: { backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1.5, borderColor: C.cardBorder, padding: 10, gap: 6 },
  periodHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  periodName: { color: C.text, fontWeight: '900', fontSize: 14 },
  periodHours: { color: C.sub, fontSize: 11 },
  suggest: { color: C.violet, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.cardBorder, maxWidth: 170 },
  chipOn: { backgroundColor: C.blue, borderColor: C.blue },
  chipTxt: { color: C.text, fontWeight: '700', fontSize: 12 },
  chipTxtOn: { color: C.onAccent },
  opt: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1.5, borderColor: C.cardBorder, padding: 11 },
  optOn: { borderColor: C.blue, borderWidth: 2, backgroundColor: C.card },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.line },
  radioOn: { borderColor: C.blue, backgroundColor: C.blue },
  optTitle: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  optSub: { color: C.sub, fontSize: 11.5, textAlign: 'right', marginTop: 2 },
  report: { backgroundColor: C.card, borderRadius: 14, padding: 10, gap: 2, borderWidth: 1.5, borderColor: C.cardBorder },
  reportTitle: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right' },
  reportSub: { color: C.sub, fontSize: 12, textAlign: 'right' },
});
