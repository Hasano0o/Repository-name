import { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Share, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Signal, NetworkInfo, DeviceDetails, Usage, CellTower } from '../../src/drivers/types';
import { loadHistory } from '../../src/store/history';
import { measureLatency, LatencyResult } from '../../src/utils/latency';
import { buildSummary, reportToText, ReportInput, ReportSummary } from '../../src/utils/report';
import { overallLevel, LEVEL_COLOR, LEVEL_LABEL, parseBands, parseNrBands } from '../../src/utils/signal';
import { C } from '../../src/ui/theme';
import { Icon } from '../../src/ui/Icon';
import { GlassCard } from '../../src/ui/GlassCard';

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [input, setInput] = useState<ReportInput | null>(null);
  const [sum, setSum] = useState<ReportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [imgBusy, setImgBusy] = useState(false);
  const shotRef = useRef<View>(null);

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

  const shareImage = async () => {
    if (!input || !sum || imgBusy) return;
    setImgBusy(true);
    try {
      const uri = await captureRef(shotRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'مشاركة تقرير الاتصال' });
      } else {
        await Share.share({ url: uri });
      }
    } catch {}
    finally { setImgBusy(false); }
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;

  const sig = input?.signal;
  const level = overallLevel(sig);
  const cardColor = LEVEL_COLOR[level];
  const shareBands = [...new Set([...parseBands(sig?.band), ...parseNrBands(sig?.nrBand)])].slice(0, 4);
  const today = new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      {!!error && <Text style={s.err}>{error}</Text>}
      {!!status && <Text style={s.status}>{status}</Text>}

      {/* البطاقة القابلة للمشاركة كصورة */}
      {input && sum && (
        <View ref={shotRef} collapsable={false} style={s.shot}>
          <LinearGradient colors={['#f4f8ff', '#eaf2ff', '#e8f8f1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.shotInner}>
            <View style={s.shotHead}>
              <View style={s.brandDot}><Icon name="tower" size={16} color={C.onAccent} /></View>
              <Text style={s.brand}>موجة</Text>
              <Text style={s.shotDate}>{today}</Text>
            </View>

            <View style={[s.gradeBadge, { backgroundColor: cardColor + '1a', borderColor: cardColor + '55' }]}>
              <Text style={[s.gradeDot, { color: cardColor }]}>●</Text>
              <Text style={[s.gradeTxt, { color: cardColor }]}>{sum.headline}</Text>
            </View>
            <Text style={s.shotRouter}>{input.routerName}{input.net?.operator ? ` · ${input.net.operator}` : ''}</Text>

            <View style={s.shotMetrics}>
              <View style={s.shotMetric}>
                <Text style={[s.shotVal, { color: cardColor }]}>{sig?.rsrp ?? '—'}</Text>
                <Text style={s.shotLbl}>RSRP</Text>
              </View>
              <View style={s.shotSep} />
              <View style={s.shotMetric}>
                <Text style={s.shotVal}>{sig?.sinr ?? '—'}</Text>
                <Text style={s.shotLbl}>SINR</Text>
              </View>
              <View style={s.shotSep} />
              <View style={s.shotMetric}>
                <Text style={s.shotVal}>{LEVEL_LABEL[level]}</Text>
                <Text style={s.shotLbl}>التقييم</Text>
              </View>
            </View>

            {shareBands.length > 0 && (
              <View style={s.shotChips}>
                {shareBands.map(b => (
                  <View key={b} style={[s.shotChip, b.startsWith('n') && { backgroundColor: C.violetSoft }]}>
                    <Text style={[s.shotChipTxt, b.startsWith('n') && { color: C.violet }]}>{b}</Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={s.shotFoot}>تقرير من تطبيق موجة · لإدارة ومراقبة الراوتر</Text>
          </LinearGradient>
        </View>
      )}

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

      <Pressable style={[s.btnWide, imgBusy && s.btnOff]} disabled={imgBusy} onPress={shareImage}>
        {imgBusy ? <ActivityIndicator color={C.onAccent} /> : (
          <View style={s.btnInner}>
            <Icon name="share" size={16} color={C.onAccent} />
            <Text style={s.btnTxt}>مشاركة كصورة</Text>
          </View>
        )}
      </Pressable>
      <Pressable style={[s.btnWide, s.btnGhost]} onPress={share}>
        <Text style={s.btnGhostTxt}>مشاركة كنص</Text>
      </Pressable>
      <Text style={s.note}>الصورة أنيقة للمشاركة في واتساب وتويتر · والنص ينفع لدعم المشغّل كدليل على ضعف التغطية.</Text>
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

  btnInner: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnGhost: { backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  btnGhostTxt: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'center' },

  // البطاقة القابلة للمشاركة
  shot: { borderRadius: 22, overflow: 'hidden' },
  shotInner: { padding: 18, gap: 12, borderRadius: 22 },
  shotHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  brandDot: { width: 30, height: 30, borderRadius: 10, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  brand: { color: C.text, fontSize: 18, fontWeight: '900', flex: 1, textAlign: 'right' },
  shotDate: { color: C.sub, fontSize: 11.5 },
  gradeBadge: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  gradeDot: { fontSize: 10 },
  gradeTxt: { fontSize: 18, fontWeight: '900' },
  shotRouter: { color: C.text, fontSize: 13.5, fontWeight: '700', textAlign: 'right' },
  shotMetrics: {
    flexDirection: 'row-reverse', alignItems: 'center',
    backgroundColor: '#ffffffcc', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 8,
  },
  shotMetric: { flex: 1, alignItems: 'center', gap: 3 },
  shotVal: { color: C.text, fontSize: 19, fontWeight: '900' },
  shotLbl: { color: C.muted, fontSize: 11 },
  shotSep: { width: 1, height: 30, backgroundColor: C.line },
  shotChips: { flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap' },
  shotChip: { backgroundColor: C.blueSoft, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 4 },
  shotChipTxt: { color: C.blue, fontSize: 12.5, fontWeight: '800' },
  shotFoot: { color: C.muted, fontSize: 10.5, textAlign: 'center', marginTop: 2 },
});
