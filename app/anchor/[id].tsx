import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { BandConfig, Carrier, CellTower } from '../../src/drivers/types';
import { labBands, seenBands, runAnchorScan, AnchorRow } from '../../src/utils/bandLab';
import { safeApply, trialMessage } from '../../src/utils/safeLock';
import { C, R, S } from '../../src/ui/theme';

const ACCENT = C.violet;

export default function Anchor5G() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [rows, setRows] = useState<AnchorRow[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const cancel = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try {
        const { c, car, cells } = await withSession(r, async d => ({
          c: d.getBandConfig ? await d.getBandConfig() : null,
          car: d.getCarriers ? await d.getCarriers().catch(() => [] as Carrier[]) : [],
          cells: d.getCells ? await d.getCells().catch(() => [] as CellTower[]) : [],
        }));
        if (!c) throw new Error('راوترك ما يدعم تثبيت الترددات.');
        const seen = await seenBands(r.id);
        if (!mounted.current) return;
        setCfg(c);
        setRows(labBands(c, car, cells, seen).map(b => ({ band: b, status: 'pending' })));
      } catch (e: any) {
        if (mounted.current) setError(e?.message ?? String(e));
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; cancel.current = true; };
  }, [id]);

  const start = () => {
    if (!info || !cfg || !rows.length) return;
    Alert.alert(
      'كاشف مرساة 5G',
      `بنجرب ${rows.length} ترددات 4G واحد واحد، ومع كل تردد نحمّل ١٢ ثانية عشان نشوف هل يفتح 5G.\n` +
      `ياخذ حوالي ${Math.ceil(rows.length * 60 / 60) + 1} دقائق، ويستهلك تقريباً ${rows.length * 25} ميقا.\n` +
      'بالآخر نرجع إعدادك تلقائياً.',
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'ابدأ', onPress: run }],
    );
  };

  const run = async () => {
    if (!info || !cfg) return;
    cancel.current = false;
    setRunning(true); setFinished(false); setError('');
    const list: AnchorRow[] = rows.map(r => ({ band: r.band, status: 'pending' }));
    setRows([...list]);
    try {
      await runAnchorScan({
        r: info, cfg, rows: list,
        update: (i, p) => { list[i] = { ...list[i], ...p }; if (mounted.current) setRows([...list]); },
        isCancelled: () => cancel.current,
      });
      if (mounted.current) setFinished(true);
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? String(e));
    } finally {
      if (mounted.current) setRunning(false);
    }
  };

  const done = rows.filter(r => r.status === 'done');
  const anchors = done.filter(r => r.nrActive).sort((a, b) => (b.nrRsrp ?? -999) - (a.nrRsrp ?? -999));
  const seenOnly = done.filter(r => !r.nrActive && r.nrSeen).sort((a, b) => (b.nrRsrp ?? -999) - (a.nrRsrp ?? -999));
  const best = anchors[0];

  const apply = () => {
    if (!info || !cfg || !best) return;
    const label = `تثبيت B${best.band} كمرساة لـ 5G`;
    Alert.alert(label,
      'بنخلي B' + best.band + ' هو التردد الأساسي عشان 5G يشتغل.\nنقيس قبل وبعد (مع تحميل قصير حوالي ٥٠ ميقا)، ولو ما صار أفضل نرجع إعدادك.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ثبّت', onPress: async () => {
            setRunning(true);
            try {
              const res = await safeApply({
                r: info,
                key: `anchor:B${best.band}`,
                label,
                withNr: true,
                apply: d => d.setBand!([best.band], cfg.nrLocked),
                revert: d => d.setBand!(cfg.locked, cfg.nrLocked),
                onStatus: st => { if (mounted.current) setStatus(st); },
              });
              const m = trialMessage(res, label);
              Alert.alert(m.title, m.body);
            } catch (e: any) {
              setError(e?.message ?? String(e));
            } finally {
              if (mounted.current) { setRunning(false); setStatus(''); }
            }
          },
        },
      ]);
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.card}>
          <Text style={s.title}>⚓ كاشف مرساة 5G</Text>
          <Text style={s.body}>
            5G عندنا يشتغل «فوق» 4G: لازم تردد 4G معيّن يكون الأساسي عشان الشبكة تفتح لك 5G.
            هنا نجرب كل تردد 4G ونشوف أيّها يفتح 5G في مكانك.
          </Text>
          {loading ? <ActivityIndicator color={ACCENT} /> : (
            <Text style={s.meta}>
              {rows.length ? `بنجرب: ${rows.map(r => `B${r.band}`).join('، ')}` : 'ما لقينا ترددات 4G نجربها.'}
            </Text>
          )}
          {!loading && rows.length > 0 && (
            <Pressable
              style={[s.btn, running && { backgroundColor: C.red }]}
              onPress={running ? () => { cancel.current = true; } : start}
            >
              <Text style={s.btnText}>{running ? '⏹ إيقاف (ونرجع إعدادك)' : finished ? '🔁 أعد الفحص' : '▶ ابدأ الفحص'}</Text>
            </Pressable>
          )}
          {!!status && <Text style={s.status}>{status}</Text>}
          {!!error && <Text style={s.err}>{error}</Text>}
        </View>

        {rows.map(r => (
          <View key={r.band} style={[s.row, r.nrActive && { borderColor: ACCENT, backgroundColor: C.violetSoft }]}>
            <View style={s.rowHead}>
              <Text style={s.rowName}>B{r.band}</Text>
              {r.status === 'testing' ? <ActivityIndicator size="small" color={ACCENT} /> :
                r.status === 'done' ? (
                  <Text style={[s.tag, { color: r.nrActive ? ACCENT : r.nrSeen ? C.gold : C.muted }]}>
                    {r.nrActive ? '⚓ يفتح 5G' : r.nrSeen ? 'يشوف 5G بس ما يتصل' : 'ما فيه 5G'}
                  </Text>
                ) : r.status === 'failed' ? <Text style={[s.tag, { color: C.red }]}>✗</Text> : <Text style={s.tag}>—</Text>}
            </View>
            {r.status === 'done' ? (
              <Text style={s.rowLine}>
                4G {r.lteRsrp ?? '—'} dBm
                {r.nrRsrp !== undefined ? ` · 5G ${r.nrBand ? `n${r.nrBand} ` : ''}${r.nrRsrp} dBm` : ''}
              </Text>
            ) : !!r.note && <Text style={s.rowNote}>{r.note}</Text>}
          </View>
        ))}

        {finished && (
          <View style={[s.card, best && { borderColor: ACCENT }]}>
            {best ? (
              <>
                <Text style={[s.verdict, { color: ACCENT }]}>
                  B{best.band} هو مرساة 5G في مكانك{best.nrBand ? ` — يفتح n${best.nrBand}` : ''}.
                </Text>
                <Text style={s.body}>لو الراوتر ما يوصل 5G وأنت على الإعداد التلقائي، ثبّت B{best.band} عشان يضل يفتحه.</Text>
                <Pressable style={s.btn} onPress={apply} disabled={running}>
                  <Text style={s.btnText}>ثبّت B{best.band} بأمان</Text>
                </Pressable>
              </>
            ) : seenOnly.length ? (
              <Text style={s.verdict}>
                الراوتر يشوف 5G ({seenOnly[0].nrBand ? `n${seenOnly[0].nrBand} ` : ''}{seenOnly[0].nrRsrp} dBm) لكنه ضعيف والشبكة ما تضيفه.
                جرّب «التوجيه» على 5G أو مكان أعلى — تحتاج −110 dBm أو أحسن.
              </Text>
            ) : (
              <Text style={s.verdict}>
                ولا تردد فتح 5G في مكانك. الأرجح إن 5G بعيد عنك، أو شريحتك/باقتك ما تدعمه.
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.md },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  body: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  meta: { color: C.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  btn: { backgroundColor: ACCENT, borderRadius: R.md, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  status: { color: ACCENT, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  err: { color: C.red, fontSize: 12.5, textAlign: 'right' },
  row: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: R.md, padding: S.md, gap: 4 },
  rowHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  rowName: { color: C.text, fontWeight: '800', fontSize: 14 },
  tag: { fontWeight: '800', fontSize: 12.5, color: C.muted },
  rowLine: { color: C.sub, fontSize: 12, textAlign: 'right' },
  rowNote: { color: C.muted, fontSize: 12, textAlign: 'right' },
  verdict: { color: C.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right', lineHeight: 22 },
});
