import { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Signal, Traffic } from '../../src/drivers/types';
import {
  Level, LEVEL_COLOR, rsrpLevel, rsrqLevel, sinrLevel, rssiLevel,
} from '../../src/utils/signal';
import { fmtRate } from '../../src/utils/format';
import { C } from '../../src/ui/theme';
import { Icon } from '../../src/ui/Icon';

function MetricRow({ label, value, unit, level }: { label: string; value?: number; unit: string; level: Level }) {
  return (
    <View style={d.metric}>
      <View style={d.metricVal}>
        <Text style={d.metricNum}>{value !== undefined ? `${value} ${unit}` : '—'}</Text>
        <View style={[d.dot, { backgroundColor: LEVEL_COLOR[level] }]} />
      </View>
      <Text style={d.metricLabel}>{label}</Text>
    </View>
  );
}
function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={d.metric}>
      <Text style={[d.metricNum, { flexShrink: 1 }]}>{value || '—'}</Text>
      <Text style={d.metricLabel}>{label}</Text>
    </View>
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

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'التفاصيل التقنية' }} />
      <ScrollView contentContainerStyle={[d.page, { paddingBottom: insets.bottom + 40 }]}>
        {loading && (
          <View style={d.center}>
            <ActivityIndicator size="large" color={C.blue} />
            <Text style={d.muted}>نقرأ البيانات...</Text>
          </View>
        )}

        {!loading && signal && info && (
          <>
            {/* الرأس */}
            <View style={d.headCard}>
              <Icon name="chart" size={20} color={C.blue} />
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={d.headTitle}>كل الأرقام الفنية</Text>
                <Text style={d.headSub}>{info.name} · {info.host}</Text>
              </View>
              <Pressable onPress={onRefresh} hitSlop={10} style={d.refreshBtn}>
                {refreshing
                  ? <ActivityIndicator size="small" color={C.blue} />
                  : <Icon name="refresh" size={18} color={C.blue} />}
              </Pressable>
            </View>

            {/* 4G */}
            <View style={d.card}>
              <View style={d.cardHead}>
                <Icon name="chart" size={16} color={C.blue} />
                <Text style={d.cardTitle}>قياسات 4G LTE</Text>
              </View>
              <View style={d.grid}>
                <MetricRow label="قوة الإشارة (RSRP)" value={signal.rsrp} unit="dBm" level={rsrpLevel(signal.rsrp)} />
                <MetricRow label="جودة الإشارة (SINR)" value={signal.sinr} unit="dB" level={sinrLevel(signal.sinr)} />
                <MetricRow label="RSRQ" value={signal.rsrq} unit="dB" level={rsrqLevel(signal.rsrq)} />
                <MetricRow label="RSSI" value={signal.rssi} unit="dBm" level={rssiLevel(signal.rssi)} />
                <InfoRow label="الباند" value={signal.band} />
                <InfoRow label="Cell ID" value={signal.cellId} />
                <InfoRow label="PCI" value={signal.pci} />
                <InfoRow label="EARFCN" value={signal.earfcn} />
                <InfoRow label="عرض النطاق" value={[signal.dlBandwidth, signal.ulBandwidth].filter(Boolean).join(' / ')} />
                <InfoRow label="رقم البرج (eNodeB)" value={signal.enodebId} />
                <InfoRow label="CQI" value={signal.cqi !== undefined ? String(signal.cqi) : undefined} />
                <InfoRow label="MCS تنزيل / رفع" value={[signal.dlMcs, signal.ulMcs].filter(v => v !== undefined).join(' / ') || undefined} />
                <InfoRow label="قوة الإرسال" value={signal.txPower !== undefined ? `${signal.txPower} dBm` : undefined} />
              </View>
            </View>

            {/* 5G */}
            {hasNr && (
              <View style={d.card}>
                <View style={d.cardHead}>
                  <Icon name="antenna" size={16} color={C.violet} />
                  <Text style={[d.cardTitle, { color: C.violet }]}>قياسات 5G</Text>
                </View>
                <View style={d.grid}>
                  <MetricRow label="قوة إشارة 5G (RSRP)" value={signal.nrRsrp} unit="dBm" level={rsrpLevel(signal.nrRsrp)} />
                  <MetricRow label="جودة إشارة 5G (SINR)" value={signal.nrSinr} unit="dB" level={sinrLevel(signal.nrSinr)} />
                  <MetricRow label="RSRQ 5G" value={signal.nrRsrq} unit="dB" level={rsrqLevel(signal.nrRsrq)} />
                  <InfoRow label="تردد 5G" value={signal.nrBand} />
                  <InfoRow label="PCI 5G" value={signal.nrPci} />
                  <InfoRow label="ARFCN 5G" value={signal.nrArfcn} />
                  <InfoRow label="عرض نطاق 5G" value={signal.nrDlBandwidth} />
                </View>
              </View>
            )}

            {/* Traffic */}
            {traffic && (
              <View style={d.card}>
                <View style={d.cardHead}>
                  <Icon name="speed" size={16} color={C.blue} />
                  <Text style={d.cardTitle}>الحركة الحالية</Text>
                </View>
                <View style={d.grid}>
                  <View style={d.metric}>
                    <Text style={d.metricNum}>{fmtRate(traffic.downBytesPerSec)}</Text>
                    <Text style={d.metricLabel}>تنزيل</Text>
                  </View>
                  <View style={d.metric}>
                    <Text style={d.metricNum}>{fmtRate(traffic.upBytesPerSec)}</Text>
                    <Text style={d.metricLabel}>رفع</Text>
                  </View>
                </View>
              </View>
            )}
          </>
        )}

        {!loading && !signal && (
          <Text style={d.muted}>ما قدرنا نقرأ الإشارة — تأكد إن الراوتر متصل.</Text>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const d = StyleSheet.create({
  page: { padding: 14, gap: 12 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  muted: { color: C.sub, textAlign: 'center', lineHeight: 20 },
  headCard: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: C.cardBorder,
  },
  headTitle: { color: C.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  headSub: { color: C.sub, fontSize: 11.5, textAlign: 'right', marginTop: 2 },
  refreshBtn: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: C.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    backgroundColor: C.card, borderRadius: 18, padding: 14, gap: 10,
    borderWidth: 1, borderColor: C.cardBorder,
  },
  cardHead: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
  },
  cardTitle: { color: C.text, fontSize: 14.5, fontWeight: '800', textAlign: 'right' },
  grid: { gap: 8, marginTop: 4 },
  metric: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    backgroundColor: C.rowBg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.cardBorder,
  },
  metricVal: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricNum: { color: C.text, fontWeight: '700', fontSize: 13, textAlign: 'left' },
  metricLabel: { color: C.sub, textAlign: 'right', fontSize: 12.5, flexShrink: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
