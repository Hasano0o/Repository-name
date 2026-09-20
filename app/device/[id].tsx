import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { DeviceDetails, Usage, DataPlan, ConnectedDevice } from '../../src/drivers/types';
import { GlassCard } from '../../src/ui/GlassCard';
import { UsageRing } from '../../src/ui/UsageRing';
import { DeviceRow } from '../../src/ui/DeviceRow';
import { Icon } from '../../src/ui/Icon';
import { C } from '../../src/ui/theme';
import { fmtBytes } from '../../src/utils/format';

function Pill({ label, value, wide }: { label: string; value?: string; wide?: boolean }) {
  return (
    <View style={[s.pill, wide && { flexBasis: '100%' }]}>
      <Text style={s.pillLabel}>{label}</Text>
      <Text style={s.pillValue} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

export default function DeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [details, setDetails] = useState<DeviceDetails | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [plan, setPlan] = useState<DataPlan | null>(null);
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const [blocked, setBlocked] = useState<ConnectedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [canPlan, setCanPlan] = useState(false);
  const [canBlock, setCanBlock] = useState(false);
  const alive = useRef(true);
  const [error, setError] = useState('');

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (r: SavedRouter) => {
    const [d, u, p, dev, blk] = await withSession(r, async drv => Promise.all([
      drv.getDeviceDetails ? drv.getDeviceDetails().catch(() => null) : Promise.resolve(null),
      drv.getUsage ? drv.getUsage().catch(() => null) : Promise.resolve(null),
      drv.getDataPlan ? drv.getDataPlan().catch(() => null) : Promise.resolve(null),
      drv.getDevices ? drv.getDevices().catch(() => [] as ConnectedDevice[]) : Promise.resolve([] as ConnectedDevice[]),
      drv.getBlockedDevices ? drv.getBlockedDevices().catch(() => [] as ConnectedDevice[]) : Promise.resolve([] as ConnectedDevice[]),
    ])) as [DeviceDetails | null, Usage | null, DataPlan | null, ConnectedDevice[], ConnectedDevice[]];
    if (!alive.current) return;
    setDetails(d); setUsage(u); setPlan(p); setDevices(dev); setBlocked(blk);
    const caps = await withSession(r, async drv => ({
      plan: typeof drv.setDataPlan === 'function',
      block: typeof drv.blockDevice === 'function',
    }));
    if (!alive.current) return;
    setCanPlan(caps.plan); setCanBlock(caps.block);
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try { await load(r); } catch (e: any) { setError(e?.message ?? String(e)); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, load]));

  const setLimit = async (gb: number) => {
    if (!info) return;
    setBusy(true);
    try {
      await withSession(info, d => d.setDataPlan!({
        startDay: plan?.startDay ?? 1,
        limitBytes: gb * 1e9,
        monthThreshold: plan?.monthThreshold ?? 90,
      }), false);
      await load(info);
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const toggleBlock = (d: ConnectedDevice, block: boolean) => {
    if (!info) return;
    Alert.alert(block ? 'حظر الجهاز' : 'إلغاء الحظر', d.name || d.mac, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: block ? 'احظر' : 'ألغِ الحظر',
        style: block ? 'destructive' : 'default',
        onPress: async () => {
          setBusy(true);
          try {
            await withSession(info, drv => drv.blockDevice!(d.mac, block, d.name), false);
            await load(info);
          } catch (e: any) { setError(e?.message ?? String(e)); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;

  const total = usage ? usage.downloadBytes + usage.uploadBytes : 0;
  const limit = plan?.limitBytes ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((total / limit) * 100)) : 0;
  const barColor = pct >= 90 ? C.red : pct >= 70 ? C.gold : C.green;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.page}>
      {!!error && <Text style={s.err}>{error}</Text>}

      {!!details && (
        <GlassCard title="معلومات الجهاز" subtitle="DEVICE / NETWORK" icon="📟" tint={C.blueSoft} collapsible={false}>
          <View style={s.pills}>
            <Pill label="الموديل" value={details.model} />
            <Pill label="المشغّل" value={details.operator || details.simStatus} />
            <Pill label="الإصدار" value={details.software} wide />
            <Pill label="IP الخارجي" value={details.wanIp} />
            <Pill label="DNS" value={details.dns} />
          </View>
        </GlassCard>
      )}

      {!!usage && (
        <GlassCard title="استهلاك هذا الشهر" subtitle="DATA USAGE" icon="📊" tint={C.greenSoft} collapsible={false}>
          <UsageRing download={usage.downloadBytes} upload={usage.uploadBytes} size={150} />
          {limit > 0 ? (
            <View style={{ gap: 6, marginTop: 8 }}>
              <View style={s.planHead}>
                <Text style={[s.planPct, { color: barColor }]}>{pct}%</Text>
                <Text style={s.planTitle}>من باقة {fmtBytes(limit)}</Text>
              </View>
              <View style={s.barBg}>
                <View style={[s.bar, { width: `${pct}%` as const, backgroundColor: barColor }]} />
              </View>
              <Text style={s.hint}>المتبقي {fmtBytes(Math.max(0, limit - total))}</Text>
            </View>
          ) : (
            <Text style={s.hint}>حدد حجم باقتك عشان نحسب المتبقي</Text>
          )}
          {canPlan && <View style={s.planRow}>
            {[0, 100, 200, 500, 1000].map(gb => (
              <Pressable
                key={gb}
                style={[s.planChip, limit === gb * 1e9 && s.planChipOn]}
                disabled={busy}
                onPress={() => setLimit(gb)}
              >
                <Text style={[s.planChipTxt, limit === gb * 1e9 && { color: C.onAccent }]}>
                  {gb === 0 ? 'بدون' : gb + 'GB'}
                </Text>
              </Pressable>
            ))}
          </View>}
        </GlassCard>
      )}

      <GlassCard
        title={`الأجهزة المتصلة (${devices.length})`}
        subtitle="CONNECTED DEVICES"
        icon="🔗"
        tint={C.violetSoft}
        collapsible={false}
      >
        {devices.length === 0 && <Text style={s.hint}>ما فيه أجهزة متصلة</Text>}
        {devices.map(d => (
          <DeviceRow key={d.mac} device={d} onBlock={() => canBlock ? toggleBlock(d, true) : Alert.alert('غير مدعوم', 'راوترك ما يدعم حظر الأجهزة')} onLimit={() => {}} />
        ))}
        {devices.length > 0 && <Text style={s.hint}>اسحب أي جهاز لخيارات الحظر</Text>}

        {blocked.length > 0 && (
          <View style={s.blockedWrap}>
            <Text style={s.blockedTitle}>المحظورة ({blocked.length})</Text>
            {blocked.map(b => (
              <View key={b.mac} style={s.blockedRow}>
                <Pressable style={s.unblock} disabled={busy} onPress={() => toggleBlock(b, false)}>
                  <Text style={s.unblockTxt}>إلغاء الحظر</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={s.blockedName} numberOfLines={1}>{b.name || 'جهاز'}</Text>
                  <Text style={s.blockedMac}>{b.mac}</Text>
                </View>
                <Icon name="lock" size={16} color={C.red} />
              </View>
            ))}
          </View>
        )}
      </GlassCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  page: { padding: 13, gap: 10, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  pills: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  pill: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: C.rowBg, borderRadius: 13,
    borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 11, paddingVertical: 9, gap: 3,
  },
  pillLabel: { color: C.muted, fontSize: 10, textAlign: 'right' },
  pillValue: { color: C.text, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  planHead: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 8 },
  planPct: { fontSize: 18, fontWeight: '900' },
  planTitle: { color: C.sub, fontSize: 12.5 },
  barBg: { height: 7, borderRadius: 999, backgroundColor: C.track, overflow: 'hidden' },
  bar: { height: 7, borderRadius: 999 },
  planRow: { flexDirection: 'row-reverse', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  planChip: {
    backgroundColor: C.rowBg, borderRadius: 10, borderWidth: 1, borderColor: C.cardBorder,
    paddingHorizontal: 11, paddingVertical: 6,
  },
  planChipOn: { backgroundColor: C.blue, borderColor: C.blue },
  planChipTxt: { color: C.sub, fontSize: 11.5, fontWeight: '700' },
  hint: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 6 },
  blockedWrap: { marginTop: 12, gap: 8 },
  blockedTitle: { color: C.sub, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  blockedRow: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    backgroundColor: C.rowBg, borderRadius: 13, padding: 10,
  },
  blockedName: { color: C.text, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  blockedMac: { color: C.muted, fontSize: 10, textAlign: 'right' },
  unblock: { backgroundColor: C.redSoft, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 6 },
  unblockTxt: { color: C.red, fontSize: 11.5, fontWeight: '800' },
  err: { color: C.red, fontSize: 13, textAlign: 'center' },
});
