import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Share, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Signal, NetworkInfo, DeviceDetails, Usage, CellTower } from '../../src/drivers/types';
import { loadHistory } from '../../src/store/history';
import { measureLatency, LatencyResult } from '../../src/utils/latency';
import { buildSummary, reportToText, ReportInput, ReportSummary } from '../../src/utils/report';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [input, setInput] = useState<ReportInput | null>(null);
  const [sum, setSum] = useState<ReportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const build = useCallback(async (r: SavedRouter, withPing: boolean) => {
    setStatus('نجمع البيانات...');
    const [net, signal, details, usage, cells] = await withSession(r, async d => Promise.all([
      d.getNetworkInfo ? d.getNetworkInfo().catch(() => null) : Promise.resolve(null),
      d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
      d.getDeviceDetails ? d.getDeviceDetails().catch(() => null) : Promise.resolve(null),
      d.getUsage ? d.getUsage().catch(() => null) : Promise.resolve(null),
      d.getCells ? d.getCells().catch(() => [] as CellTower[]) : Promise.resolve([] as CellTower[]),
    ])) as [NetworkInfo | null, Signal | null, DeviceDetails | null, Usage | null, CellTower[]];

    let latency: LatencyResult | null = null;
    if (withPing) {
      setStatus('نقيس الاستجابة...');
      try { latency = await measureLatency(12); } catch {}
    }

    const history = await loadHistory(r.id);
    const inp: ReportInput = {
      routerName: r.name,
      host: r.host,
      driverName: r.driverName,
      net, signal, details, usage, cells, history, latency,
    };
    setInput(inp);
    setSum(buildSummary(inp));
    setStatus('');
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      try { await build(r, false); } catch (e: any) { setError(e?.message ?? String(e)); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, build]));

  const refresh = async (withPing: boolean) => {
    const r = await getRouter(id);
    if (!r) return;
    setBusy(true); setError('');
    try { await build(r, withPing); } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); setStatus(''); }
  };

  const share = async () => {
    if (!input || !sum) return;
    try { await Share.share({ message: reportToText(input, sum) }); } catch {}
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      {!!error && <Text style={s.err}>{error}</Text>}
      {!!status && <Text style={s.status}>{status}</Text>}

      <GlassCard title="تقييم الاتصال" subtitle="Connection grade" icon="🧾" tint={C.green} collapsible={false}>
        <Text style={s.headline}>{sum?.headline ?? '—'}</Text>
        <Text style={s.sub}>{input?.routerName} · {input?.host}</Text>
        <View style={s.btnRow}>
          <Pressable style={[s.btn, s.btnAlt, busy && s.btnOff]} disabled={busy} onPress={() => refresh(false)}>
            <Text style={s.btnAltTxt}>تحديث</Text>
          </Pressable>
          <Pressable style={[s.btn, busy && s.btnOff]} disabled={busy} onPress={() => refresh(true)}>
            {busy ? <ActivityIndicator color={C.onAccent} /> : <Text style={s.btnTxt}>تحديث مع قياس البنق</Text>}
          </Pressable>
        </View>
      </GlassCard>

      <GlassCard title="التفاصيل" subtitle="Details" icon="📋" tint={C.blue} collapsible={false}>
        {(sum?.lines ?? []).map((l, i) => (
          <Text key={i} style={l.startsWith('  ') ? s.lineSub : s.line}>{l}</Text>
        ))}
      </GlassCard>

      <GlassCard title="ملاحظات وتوصيات" subtitle="Advice" icon="💡" tint={C.gold} collapsible={false}>
        {(sum?.advice ?? []).map((a, i) => <Text key={i} style={s.advice}>• {a}</Text>)}
      </GlassCard>

      <Pressable style={s.btnWide} onPress={share}>
        <Text style={s.btnTxt}>مشاركة التقرير</Text>
      </Pressable>
      <Text style={s.note}>ينفع ترسله لدعم المشغّل كدليل على ضعف التغطية.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 14, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  headline: { color: C.text, fontSize: 22, fontWeight: '900', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 12.5, textAlign: 'right', marginTop: 4 },
  line: { color: C.text, fontSize: 13, textAlign: 'right', paddingVertical: 3 },
  lineSub: { color: C.sub, fontSize: 12, textAlign: 'right', paddingVertical: 2 },
  advice: { color: C.text, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  btnRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 12 },
  btn: { flex: 1, backgroundColor: C.green, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  btnAlt: { backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  btnAltTxt: { color: C.text, fontWeight: '800', fontSize: 14 },
  btnOff: { opacity: 0.45 },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  btnWide: { backgroundColor: C.blue, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  note: { color: C.muted, fontSize: 11.5, textAlign: 'center' },
  err: { color: C.red, fontSize: 13, textAlign: 'center' },
  status: { color: C.sub, fontSize: 12.5, textAlign: 'center' },
});
