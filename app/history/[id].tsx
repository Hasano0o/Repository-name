import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { Sample, loadHistory, clearHistory, summarize } from '../../src/store/history';
import { LEVEL_COLOR, rsrpLevel, sinrLevel } from '../../src/utils/signal';
import { fmtRate, fmtTime } from '../../src/utils/format';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { TimeChart, Series } from '../../src/ui/TimeChart';
import { SignalRadar } from '../../src/ui/SignalRadar';

type Range = 1 | 6 | 24;

export default function HistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [all, setAll] = useState<Sample[]>([]);
  const [range, setRange] = useState<Range>(6);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (rid: string) => {
    setAll(await loadHistory(rid));
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      setInfo(r);
      await load(id);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, load]));

  const cutoff = Date.now() - range * 3600_000;
  const list = all.filter(s => s.t >= cutoff);
  const sum = summarize(list);
  const times = list.map(s => s.t);

  const series: Series[] = [
    { label: 'RSRP dBm', color: C.blue, values: list.map(s => s.rsrp), min: -125, max: -60, unit: 'dBm' },
    { label: 'SINR dB', color: C.violet, values: list.map(s => (s.sinr === undefined ? undefined : s.sinr * 2.6 - 125)), min: -125, max: -60, unit: 'dB' },
  ];

  const speedSeries: Series[] = [
    { label: 'تنزيل', color: C.green, values: list.map(s => s.down), min: 0, max: Math.max(1, ...list.map(s => s.down ?? 0)), unit: 'B/s' },
    { label: 'رفع', color: C.gold, values: list.map(s => s.up), min: 0, max: Math.max(1, ...list.map(s => s.up ?? 0)), unit: 'B/s' },
  ];

  const onClear = () => {
    Alert.alert('مسح السجل', 'تبي تمسح كل القراءات المحفوظة لهذا الراوتر؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'مسح', style: 'destructive', onPress: async () => {
          await clearHistory(id);
          setAll([]);
        },
      },
    ]);
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        {loading && (
          <View style={s.center}><ActivityIndicator size="large" color={C.blue} /></View>
        )}

        {!loading && (
          <View style={s.tabs}>
            {([1, 6, 24] as Range[]).map(r => (
              <Pressable key={r} style={[s.tab, range === r && s.tabOn]} onPress={() => setRange(r)}>
                <Text style={[s.tabText, range === r && { color: C.onAccent }]}>
                  {r === 1 ? 'آخر ساعة' : r === 6 ? '٦ ساعات' : '٢٤ ساعة'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {!loading && list.length === 0 && (
          <GlassCard collapsible={false}>
            <Text style={s.muted}>
              ما فيه قراءات محفوظة بعد. التطبيق يسجّل قراءة كل دقيقة وأنت فاتح شاشة الراوتر — افتحها شوي وارجع هنا.
            </Text>
          </GlassCard>
        )}

        {!loading && list.length > 0 && (
          <GlassCard title="منحنى الإشارة" subtitle="SIGNAL OVER TIME" icon="📈" tint={C.blueSoft} collapsible={false}>
            <TimeChart times={times} series={series} />
            <View style={s.stats}>
              <Stat label="أضعف RSRP" value={sum.rsrpMin} unit="dBm" color={LEVEL_COLOR[rsrpLevel(sum.rsrpMin)]} />
              <Stat label="متوسط RSRP" value={sum.rsrpAvg} unit="dBm" color={LEVEL_COLOR[rsrpLevel(sum.rsrpAvg)]} />
              <Stat label="متوسط SINR" value={sum.sinrAvg} unit="dB" color={LEVEL_COLOR[sinrLevel(sum.sinrAvg)]} />
            </View>
          </GlassCard>
        )}

        {!loading && list.length >= 3 && (
          <GlassCard title="نبضة الإشارة" subtitle="LAST 20 READINGS" icon="🎯" tint={C.blueSoft} collapsible={false}>
            <SignalRadar history={list.slice(-20).map(x => ({ rsrp: x.rsrp, sinr: x.sinr }))} />
          </GlassCard>
        )}

        {!loading && list.length > 0 && (
          <GlassCard title="السرعة اللحظية" subtitle="THROUGHPUT" icon="⚡" tint={C.greenSoft}>
            <TimeChart times={times} series={speedSeries} />
            <Text style={s.hint}>
              أعلى تنزيل مسجّل: {fmtRate(Math.max(0, ...list.map(x => x.down ?? 0)))}
            </Text>
          </GlassCard>
        )}

        {!loading && sum.topBands.length > 0 && (
          <GlassCard title="الترددات الأكثر استخداماً" subtitle="BAND USAGE" icon="📊" tint={C.violetSoft}>
            {sum.topBands.map(([band, n]) => {
              const pct = Math.round((n / sum.count) * 100);
              return (
                <View key={band} style={{ gap: 6 }}>
                  <View style={s.bandRow}>
                    <Text style={s.bandPct}>{pct}%</Text>
                    <Text style={s.bandName}>{band}</Text>
                  </View>
                  <View style={s.barBg}>
                    <View style={[s.bar, { width: `${pct}%` }]} />
                  </View>
                </View>
              );
            })}
          </GlassCard>
        )}

        {!loading && list.length > 0 && (
          <>
            <Text style={s.hint}>
              {sum.count} قراءة · من {fmtTime(sum.from ?? 0)} إلى {fmtTime(sum.to ?? 0)}
            </Text>
            <Pressable onPress={onClear}>
              <Text style={s.clear}>مسح السجل</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

function Stat({ label, value, unit, color }: { label: string; value?: number; unit: string; color: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statVal, { color }]}>{value !== undefined ? value : '—'}</Text>
      <Text style={s.statUnit}>{unit}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', paddingVertical: 40 },
  muted: { color: C.sub, textAlign: 'right', lineHeight: 22 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  tabOn: { backgroundColor: C.blue, borderColor: C.blue },
  tabText: { color: C.text, fontWeight: '800', fontSize: 13 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  stat: { flex: 1, alignItems: 'center', backgroundColor: C.rowBg, borderRadius: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.cardBorder },
  statVal: { fontSize: 18, fontWeight: '800' },
  statUnit: { color: C.muted, fontSize: 10 },
  statLabel: { color: C.sub, fontSize: 10, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  bandRow: { flexDirection: 'row', justifyContent: 'space-between' },
  bandName: { color: C.text, fontWeight: '800' },
  bandPct: { color: C.sub, fontWeight: '700' },
  barBg: { height: 8, borderRadius: 4, backgroundColor: C.track, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4, backgroundColor: C.violet },
  clear: { color: C.red, textAlign: 'center', paddingVertical: 8 },
});
