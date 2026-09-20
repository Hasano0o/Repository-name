import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { BandConfig, Carrier, CellTower } from '../../src/drivers/types';
import { labBands, seenBands, labCombos, runCaLab, LabRow, comboName } from '../../src/utils/bandLab';
import { snapshot, safeApply, trialMessage, Snapshot } from '../../src/utils/safeLock';
import { C, R, S } from '../../src/ui/theme';

const ACCENT = '#0ea5a4';

export default function CaLab() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [bands, setBands] = useState<number[]>([]);
  const [base, setBase] = useState<Snapshot | null>(null);
  const [rows, setRows] = useState<LabRow[]>([]);
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
        const b = labBands(c, car, cells, seen);
        setBands(b);
        setRows(labCombos(b).map(x => ({ bands: x, status: 'pending' })));
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
    const mins = Math.ceil((rows.length * 55 + 30) / 60);
    Alert.alert(
      'مختبر الدمج',
      `بنجرب ${rows.length} تركيبات (${rows.map(r => comboName(r.bands)).join('، ')}).\n` +
      `ياخذ حوالي ${mins} دقائق، والإنترنت ينقطع لحظات مع كل تركيبة.\n` +
      'ما يستهلك باقة، وبالآخر نرجع إعدادك تلقائياً.',
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'ابدأ', onPress: run }],
    );
  };

  const run = async () => {
    if (!info || !cfg) return;
    cancel.current = false;
    setRunning(true); setFinished(false); setError('');
    const list: LabRow[] = rows.map(r => ({ bands: r.bands, status: 'pending' }));
    setRows([...list]);
    try {
      setStatus('نقيس الإعداد الحالي (التلقائي)...');
      const b = await snapshot(info, false, 3);
      if (mounted.current) setBase(b);
      setStatus('');
      await runCaLab({
        r: info, cfg, rows: list,
        update: (i, p) => { list[i] = { ...list[i], ...p }; if (mounted.current) setRows([...list]); },
        isCancelled: () => cancel.current,
      });
      if (mounted.current) setFinished(true);
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? String(e));
    } finally {
      if (mounted.current) { setRunning(false); setStatus(''); }
    }
  };

  const done = rows.filter(r => r.status === 'done' && r.snap);
  const ranked = [...done].sort((a, b) => (b.snap!.cap) - (a.snap!.cap));
  const best = ranked[0];
  const gain = best && base && base.cap > 0 ? best.snap!.cap / base.cap - 1 : undefined;
  const worth = gain !== undefined && gain >= 0.1;

  const apply = () => {
    if (!info || !cfg || !best) return;
    const label = `تثبيت ${comboName(best.bands)}`;
    Alert.alert(label, 'بنثبّتها بأمان: نقيس قبل وبعد، ولو ما كانت أفضل نرجع إعدادك.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'ثبّت', onPress: async () => {
          setRunning(true);
          try {
            const res = await safeApply({
              r: info,
              key: `band:LTE:${best.bands.join('+')}`,
              label,
              apply: d => d.setBand!(best.bands, cfg.nrLocked),
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

  const rel = (x?: Snapshot | null) =>
    x && base && base.cap > 0 ? Math.round((x.cap / base.cap) * 100) : undefined;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.card}>
          <Text style={s.title}>🔗 مختبر الدمج</Text>
          <Text style={s.body}>
            الراوتر يدمج أكثر من تردد عشان يسرّع. بس أحياناً تركيبة معيّنة أسرع من اللي يختاره تلقائياً.
            هنا نجرب التركيبات الممكنة في مكانك ونقول لك الأفضل.
          </Text>
          {loading ? <ActivityIndicator color={ACCENT} /> : (
            <Text style={s.meta}>
              {bands.length >= 2
                ? `الترددات المتاحة حولك: ${bands.map(b => `B${b}`).join('، ')}`
                : 'ما لقينا أكثر من تردد واحد قوي حولك — ما فيه تركيبات دمج نجربها.'}
            </Text>
          )}
          {!loading && rows.length > 0 && (
            <Pressable
              style={[s.btn, running && { backgroundColor: C.red }]}
              onPress={running ? () => { cancel.current = true; } : start}
            >
              <Text style={s.btnText}>{running ? '⏹ إيقاف (ونرجع إعدادك)' : finished ? '🔁 أعد التجربة' : '▶ ابدأ التجربة'}</Text>
            </Pressable>
          )}
          {!!status && <Text style={s.status}>{status}</Text>}
          {!!error && <Text style={s.err}>{error}</Text>}
        </View>

        {base && (
          <View style={s.row}>
            <View style={s.rowHead}>
              <Text style={s.rowName}>التلقائي (إعدادك الحالي)</Text>
              <Text style={[s.rowPct, { color: C.sub }]}>100٪</Text>
            </View>
            <Text style={s.rowLine}>{base.bands || '—'} · {base.carriers} نواقل · {Math.round(base.bw)} MHz</Text>
          </View>
        )}

        {rows.map(r => {
          const pct = rel(r.snap);
          const isBest = finished && best === r;
          return (
            <View key={r.bands.join('+')} style={[s.row, isBest && { borderColor: ACCENT, backgroundColor: ACCENT + '12' }]}>
              <View style={s.rowHead}>
                <Text style={s.rowName}>{isBest ? '🏆 ' : ''}{comboName(r.bands)}</Text>
                {r.status === 'testing' ? <ActivityIndicator size="small" color={ACCENT} /> :
                  pct !== undefined ? (
                    <Text style={[s.rowPct, { color: pct >= 110 ? C.green : pct <= 85 ? C.red : C.sub }]}>{pct}٪</Text>
                  ) : r.status === 'failed' ? <Text style={[s.rowPct, { color: C.red }]}>✗</Text> : <Text style={s.rowPct}>—</Text>}
              </View>
              {r.snap ? (
                <Text style={s.rowLine}>
                  {r.snap.bands || '—'} · {r.snap.carriers} نواقل · {Math.round(r.snap.bw)} MHz
                  {r.snap.sinr !== undefined ? ` · SINR ${Math.round(r.snap.sinr)}` : ''}
                </Text>
              ) : !!r.note && <Text style={s.rowNote}>{r.note}</Text>}
            </View>
          );
        })}

        {finished && (
          <View style={[s.card, { borderColor: worth ? C.green : C.line }]}>
            {best && gain !== undefined ? (
              worth ? (
                <>
                  <Text style={[s.verdict, { color: C.green }]}>
                    أفضل تركيبة: {comboName(best.bands)} — أسرع بحوالي {Math.round(gain * 100)}٪ من التلقائي
                  </Text>
                  <Pressable style={[s.btn, { backgroundColor: C.green }]} onPress={apply} disabled={running}>
                    <Text style={s.btnText}>ثبّت {comboName(best.bands)} بأمان</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={s.verdict}>
                  ✅ الإعداد التلقائي هو الأفضل أو قريب منه — لا تثبّت شي، الراوتر يختار صح.
                </Text>
              )
            ) : (
              <Text style={s.verdict}>ما قدرنا نقيس التركيبات — جرّب مرة ثانية.</Text>
            )}
            <Text style={s.note}>النسبة = السرعة المتوقعة مقارنة بالإعداد التلقائي (١٠٠٪).</Text>
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
  rowPct: { fontWeight: '800', fontSize: 15, color: C.muted },
  rowLine: { color: C.sub, fontSize: 12, textAlign: 'right' },
  rowNote: { color: C.muted, fontSize: 12, textAlign: 'right' },
  verdict: { color: C.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right', lineHeight: 22 },
  note: { color: C.muted, fontSize: 11.5, textAlign: 'right' },
});
