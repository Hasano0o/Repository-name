import { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, StyleSheet, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Signal, Traffic } from '../../src/drivers/types';
import {
  rsrpLevel, rsrqLevel, sinrLevel, rssiLevel, overallLevel, signalScore,
} from '../../src/utils/signal';
import { fmtRate } from '../../src/utils/format';
import { Icon } from '../../src/ui/Icon';
import {
  P, Hero, GlassBtn, Section, MeterTile, InfoCell, Grid, Cell, Ring, Chip,
  RANGE, ratioOf, lvlLabel,
} from '../../src/ui/Pro';

import { tBg, tFg } from '../../src/ui/theme';
import { hostLabel } from '../../src/drivers/device';
type Info = { label: string; value?: string; accent?: string };

/** يعرض الخانات المتوفرة فقط — أول [max] خانات، والباقي خلف «عرض الكل» عشان الصفحة ما تزدحم */
function InfoGrid({ rows, max = 4 }: { rows: Info[]; max?: number }) {
  const [all, setAll] = useState(false);
  const shown = rows.filter(r => r.value !== undefined && r.value !== '');
  const hidden = rows.length - shown.length;
  const extra = shown.length - max;
  const list = all || extra <= 0 ? shown : shown.slice(0, max);
  return (
    <>
      {list.length > 0 && (
        <Grid>
          {list.map(r => (
            <Cell key={r.label}><InfoCell label={r.label} value={r.value!} accent={r.accent} /></Cell>
          ))}
        </Grid>
      )}
      {extra > 0 && (
        <Pressable onPress={() => setAll(v => !v)} style={({ pressed }) => [d.moreBtn, pressed && { opacity: 0.7 }]}>
          <Text style={d.moreTxt}>{all ? 'إخفاء التفاصيل المتقدمة' : `عرض التفاصيل المتقدمة (${extra})`}</Text>
          <View style={{ transform: [{ rotate: all ? '-90deg' : '90deg' }] }}>
            <Icon name="chevron" size={14} color={P.blue} />
          </View>
        </Pressable>
      )}
      {all && hidden > 0 && (
        <Text style={d.hiddenNote}>
          {hidden === 1 ? 'خانة واحدة' : `${hidden} خانات`} ما يوفرها هذا الراوتر
        </Text>
      )}
    </>
  );
}

export default function DetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async (r: SavedRouter) => {
    try {
      const [sig, trf] = await withSession(r, async dd => Promise.all([
        dd.getSignal ? dd.getSignal().catch(() => null) : Promise.resolve(null),
        dd.getTraffic ? dd.getTraffic().catch(() => null) : Promise.resolve(null),
      ]));
      if (!alive.current) return;
      setSignal(sig);
      setTraffic(trf);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => {
    alive.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive.current) return;
      if (!r) { setLoading(false); return; }
      setInfo(r);
      await load(r);
      if (alive.current) setLoading(false);
    })();
    return () => { alive.current = false; };
  }, [id, load]));

  const onRefresh = async () => {
    if (!info) return;
    setRefreshing(true);
    await load(info);
    setRefreshing(false);
  };

  const hasNr = !!signal && (signal.nrRsrp !== undefined || !!signal.nrBand);
  const level = overallLevel(signal);
  const score = signalScore(signal ?? undefined);
  const str = (v?: number | string) => (v === undefined || v === null ? undefined : String(v));

  return (
    <View style={{ flex: 1, backgroundColor: P.bg }}>
      <Stack.Screen options={{ title: 'التفاصيل التقنية', headerStyle: { backgroundColor: P.bg } }} />
      <ScrollView
        contentContainerStyle={[d.page, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={P.blue} colors={[P.blue]} />}
      >
        {loading && (
          <View style={d.center}>
            <ActivityIndicator size="large" color={P.blue} />
            <Text style={d.muted}>نقرأ البيانات...</Text>
          </View>
        )}

        {!loading && signal && info && (
          <>
            {/* ═══ الترويسة ═══ */}
            <Hero>
              <View style={d.heroTop}>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={d.heroKicker}>كل الأرقام الفنية</Text>
                  <Text style={d.heroTitle} numberOfLines={1}>{info.name}</Text>
                  <Text style={d.heroSub}>{hostLabel(info.host)}</Text>
                </View>
                <GlassBtn icon="refresh" onPress={onRefresh} busy={refreshing} />
              </View>

              <View style={d.heroBody}>
                <View style={{ flex: 1, gap: 10 }}>
                  <HeroStat label="قوة الإشارة" v={signal.rsrp} unit="dBm" />
                  <HeroStat label="جودة الإشارة" v={signal.sinr} unit="dB" />
                  <View style={d.heroChips}>
                    {!!signal.band && <View style={d.glassChip}><Text style={d.glassChipTxt}>{signal.band}</Text></View>}
                    {!!signal.nrBand && <View style={d.glassChip}><Text style={d.glassChipTxt}>5G · {signal.nrBand}</Text></View>}
                  </View>
                </View>
                <Ring ratio={score} size={132} stroke={11}>
                  <Text style={d.ringNum}>{Math.round(score * 100)}</Text>
                  <Text style={d.ringLbl}>{lvlLabel(level)}</Text>
                </Ring>
              </View>
            </Hero>

            {/* ═══ 4G ═══ */}
            <Section title="قياسات 4G LTE" sub="الإشارة الأساسية" icon="chart"
              right={<Chip text="LTE" />}>
              <View style={{ marginTop: 14, gap: 10 }}>
                <Grid>
                  <Cell><MeterTile label="RSRP" value={signal.rsrp} unit="dBm" level={rsrpLevel(signal.rsrp)} ratio={ratioOf(signal.rsrp, RANGE.rsrp)} /></Cell>
                  <Cell><MeterTile label="SINR" value={signal.sinr} unit="dB" level={sinrLevel(signal.sinr)} ratio={ratioOf(signal.sinr, RANGE.sinr)} /></Cell>
                  <Cell><MeterTile label="RSRQ" value={signal.rsrq} unit="dB" level={rsrqLevel(signal.rsrq)} ratio={ratioOf(signal.rsrq, RANGE.rsrq)} /></Cell>
                  <Cell><MeterTile label="RSSI" value={signal.rssi} unit="dBm" level={rssiLevel(signal.rssi)} ratio={ratioOf(signal.rssi, RANGE.rssi)} /></Cell>
                </Grid>
                <InfoGrid rows={[
                  { label: 'الباند', value: signal.band, accent: P.blue },
                  { label: 'Cell ID', value: str(signal.cellId) },
                  { label: 'PCI', value: str(signal.pci) },
                  { label: 'EARFCN', value: str(signal.earfcn) },
                  { label: 'عرض النطاق', value: [signal.dlBandwidth, signal.ulBandwidth].filter(Boolean).join(' / ') || undefined },
                  { label: 'رقم البرج (eNodeB)', value: str(signal.enodebId) },
                  { label: 'CQI', value: str(signal.cqi) },
                  { label: 'MCS تنزيل / رفع', value: [signal.dlMcs, signal.ulMcs].filter(v => v !== undefined).join(' / ') || undefined },
                  { label: 'قوة الإرسال', value: signal.txPower !== undefined ? `${signal.txPower} dBm` : undefined },
                ]} />
              </View>
            </Section>

            {/* ═══ 5G ═══ */}
            {hasNr && (
              <Section title="قياسات 5G" sub="الطبقة الإضافية (NSA)" icon="antenna"
                tone={P.violet} toneSoft={P.violetSoft}
                right={<Chip text="NR" color={P.violet} bg={P.violetSoft} />}>
                <View style={{ marginTop: 14, gap: 10 }}>
                  <Grid>
                    <Cell><MeterTile label="RSRP" value={signal.nrRsrp} unit="dBm" level={rsrpLevel(signal.nrRsrp)} ratio={ratioOf(signal.nrRsrp, RANGE.rsrp)} /></Cell>
                    <Cell><MeterTile label="SINR" value={signal.nrSinr} unit="dB" level={sinrLevel(signal.nrSinr)} ratio={ratioOf(signal.nrSinr, RANGE.sinr)} /></Cell>
                    <Cell full><MeterTile label="RSRQ" value={signal.nrRsrq} unit="dB" level={rsrqLevel(signal.nrRsrq)} ratio={ratioOf(signal.nrRsrq, RANGE.rsrq)} /></Cell>
                  </Grid>
                  <InfoGrid rows={[
                    { label: 'تردد 5G', value: signal.nrBand, accent: P.violet },
                    { label: 'PCI 5G', value: str(signal.nrPci) },
                    { label: 'ARFCN 5G', value: str(signal.nrArfcn) },
                    { label: 'عرض نطاق 5G', value: str(signal.nrDlBandwidth) },
                  ]} />
                </View>
              </Section>
            )}

            {/* ═══ الحركة ═══ */}
            {traffic && (
              <Section title="الحركة الحالية" sub="السرعة اللحظية على الراوتر" icon="speed"
                tone={P.cyan} toneSoft={P.cyanSoft}>
                <View style={d.trafficRow}>
                  <TrafficTile label="تنزيل" value={fmtRate(traffic.downBytesPerSec)} icon="down" color={P.green} bg={P.greenSoft} />
                  <TrafficTile label="رفع" value={fmtRate(traffic.upBytesPerSec)} icon="up" color={P.blue} bg={P.blueSoft} />
                </View>
              </Section>
            )}
          </>
        )}

        {!loading && !signal && (
          <View style={d.emptyCard}>
            <View style={d.emptyIcon}><Icon name="wifi" size={26} color={P.red} /></View>
            <Text style={d.emptyTitle}>ما قدرنا نقرأ الإشارة</Text>
            <Text style={d.muted}>تأكد إن الراوتر متصل وإنك على شبكته، ثم اسحب للتحديث.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function HeroStat({ label, v, unit }: { label: string; v?: number; unit: string }) {
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={d.hsLbl}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={d.hsVal}>{v ?? '—'}</Text>
        {v !== undefined && <Text style={d.hsUnit}> {unit}</Text>}
      </View>
    </View>
  );
}

function TrafficTile({ label, value, icon, color, bg }: {
  label: string; value: string; icon: 'up' | 'down'; color: string; bg: string;
}) {
  const [num, unit] = value.split(' ');
  return (
    <View style={[d.traffic, { backgroundColor: bg }]}>
      <View style={[d.trafficIcon, { backgroundColor: color }]}>
        <Icon name={icon} size={16} color={tFg('#fff')} stroke={2.4} />
      </View>
      <Text style={d.trafficLbl}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', alignSelf: 'flex-end' }}>
        <Text style={[d.trafficVal, { color }]}>{num}</Text>
        <Text style={d.trafficUnit}> {unit}</Text>
      </View>
    </View>
  );
}

const d = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  muted: { color: P.sub, textAlign: 'center', lineHeight: 20, fontSize: 13 },

  heroTop: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  heroKicker: { color: tFg('rgba(255,255,255,0.75)'), fontSize: 12, fontWeight: '700' },
  heroTitle: { color: tFg('#fff'), fontSize: 22, fontWeight: '800', textAlign: 'right' },
  heroSub: { color: tFg('rgba(255,255,255,0.8)'), fontSize: 12.5, fontWeight: '600' },
  heroBody: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  heroChips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  glassChip: { backgroundColor: tBg('rgba(255,255,255,0.18)'), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  glassChipTxt: { color: tFg('#fff'), fontSize: 11.5, fontWeight: '800' },
  hsLbl: { color: tFg('rgba(255,255,255,0.75)'), fontSize: 11.5, fontWeight: '600' },
  hsVal: { color: tFg('#fff'), fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  hsUnit: { color: tFg('rgba(255,255,255,0.8)'), fontSize: 12, fontWeight: '700' },
  ringNum: { color: tFg('#fff'), fontSize: 36, fontWeight: '800', letterSpacing: -1, lineHeight: 42 },
  ringLbl: { color: tFg('rgba(255,255,255,0.9)'), fontSize: 12.5, fontWeight: '800' },

  hiddenNote: { color: P.faint, fontSize: 11, textAlign: 'center', marginTop: 2 },
  moreBtn: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 12, backgroundColor: P.soft },
  moreTxt: { color: P.blue, fontSize: 12.5, fontWeight: '800' },

  trafficRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 14 },
  traffic: { flex: 1, borderRadius: 18, padding: 14, gap: 4 },
  trafficIcon: { width: 30, height: 30, borderRadius: 14, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end', marginBottom: 4 },
  trafficLbl: { color: P.sub, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  trafficVal: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  trafficUnit: { color: P.sub, fontSize: 12, fontWeight: '700' },

  emptyCard: { backgroundColor: P.card, borderRadius: 24, padding: 24, alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: P.border },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: P.redSoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: P.text, fontSize: 17, fontWeight: '800' },
});
