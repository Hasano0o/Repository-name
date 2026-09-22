import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet, Switch } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { BandConfig, Carrier, CellTower } from '../../src/drivers/types';
import { labBands, seenBands, buildAllCombos, runCaLab, LabRow, Combo } from '../../src/utils/bandLab';
import { snapshot, safeApply, trialMessage, Snapshot } from '../../src/utils/safeLock';
import { C, R, S } from '../../src/ui/theme';

const ACCENT = '#0ea5a4';

const rowLabel = (r: { bands: number[]; nrBands?: number[] }) =>
  r.bands.map(b => 'B' + b).join('+') +
  (r.nrBands?.length ? ' + ' + r.nrBands.map(b => 'n' + b).join('+') : '');

function gradeSpeed(mbps?: number): { label: string; color: string } {
  if (mbps === undefined) return { label: '—', color: C.muted };
  if (mbps >= 40) return { label: 'ممتاز', color: '#16a34a' };
  if (mbps >= 20) return { label: 'جيد', color: '#22c55e' };
  if (mbps >= 8) return { label: 'مقبول', color: '#f59e0b' };
  return { label: 'ضعيف', color: '#dc2626' };
}

function gradePing(ms?: number): { label: string; color: string } {
  if (ms === undefined) return { label: '—', color: C.muted };
  if (ms <= 40) return { label: 'ممتاز', color: '#16a34a' };
  if (ms <= 80) return { label: 'جيد', color: '#22c55e' };
  if (ms <= 150) return { label: 'مقبول', color: '#f59e0b' };
  return { label: 'ضعيف', color: '#dc2626' };
}

export default function CaLab() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [lteTop, setLteTop] = useState<number[]>([]);
  const [nrTop, setNrTop] = useState<number[]>([]);
  const [base, setBase] = useState<Snapshot | null>(null);
  const [rows, setRows] = useState<LabRow[]>([]);
  const [measureSpeed, setMeasureSpeed] = useState(true);
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

        const ltes = labBands(c, car, cells, seen).slice(0, 3);
        const NR_PREF = [78, 41, 40, 77, 1, 3, 5, 8, 20, 28];
        const nrs = NR_PREF.filter(b => c.nrSupported.includes(b)).slice(0, 3);

        setLteTop(ltes);
        setNrTop(nrs);

        const combos: Combo[] = buildAllCombos(ltes, nrs);
        setRows(combos.map(x => ({ bands: x.lte, nrBands: x.nr, status: 'pending' })));
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
    const mins = Math.ceil((rows.length * (measureSpeed ? 55 : 30)) / 60);
    const mbEst = measureSpeed ? rows.length * 25 : rows.length * 10;
    Alert.alert(
      'مختبر الدمج',
      `بنجرب ${rows.length} تركيبة (4G فردي + 4G+5G + 4G مزدوج).\n\n` +
      `⏱ ~${mins} دقيقة · 📶 ينقطع الاتصال · 📊 ~${mbEst} ميقا.\n\n` +
      'بالآخر نرجع إعدادك تلقائياً.',
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'ابدأ', onPress: run }],
    );
  };

  const run = async () => {
    if (!info || !cfg) return;
    cancel.current = false;
    setRunning(true); setFinished(false); setError('');
    const list: LabRow[] = rows.map(r => ({ bands: r.bands, nrBands: r.nrBands, status: 'pending' }));
    setRows([...list]);
    try {
      setStatus('نقيس الإعداد الحالي (التلقائي)...');
      const b = await snapshot(info, true, 3);
      if (mounted.current) setBase(b);
      setStatus('');
      await runCaLab({
        r: info, cfg, rows: list,
        update: (i, p) => { list[i] = { ...list[i], ...p }; if (mounted.current) setRows([...list]); },
        isCancelled: () => cancel.current,
        measureSpeed,
      });
      if (mounted.current) setFinished(true);
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? String(e));
    } finally {
      if (mounted.current) { setRunning(false); setStatus(''); }
    }
  };

  const done = rows.filter(r => r.status === 'done' && r.snap);
  // الترتيب: نفضّل السرعة، وإلا السعة
  const ranked = [...done].sort((a, b) => {
    const sa = a.speedMbps ?? 0;
    const sb = b.speedMbps ?? 0;
    if (sb !== sa) return sb - sa;
    return (b.snap!.cap) - (a.snap!.cap);
  });
  const best = ranked[0];
  const best5g = ranked.find(r => r.nrActive);

  const apply = () => {
    if (!info || !cfg || !best) return;
    const lbl = rowLabel(best);
    Alert.alert(`تثبيت ${lbl}`, 'بنثبّتها بأمان: نقيس قبل وبعد، ولو ما كانت أفضل نرجع إعدادك.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'ثبّت', onPress: async () => {
          setRunning(true);
          try {
            const res = await safeApply({
              r: info,
              key: `band:LTE:${best.bands.join('+')}:NR:${(best.nrBands ?? []).join('+')}`,
              label: lbl,
              withNr: (best.nrBands?.length ?? 0) > 0,
              apply: d => d.setBand!(best.bands, best.nrBands && best.nrBands.length ? best.nrBands : cfg.nrLocked),
              revert: d => d.setBand!(cfg.locked, cfg.nrLocked),
              onStatus: st => { if (mounted.current) setStatus(st); },
            });
            const m = trialMessage(res, lbl);
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
          <Text style={s.title}>🔗 مختبر الدمج</Text>
          <Text style={s.body}>
            يجرّب كل تركيبة: 4G فردي، 4G+5G (NSA)، و4G مزدوج — ويقيس <Text style={{ color: ACCENT, fontWeight: '800' }}>السرعة الحقيقية</Text> و<Text style={{ color: ACCENT, fontWeight: '800' }}>الاستجابة</Text> على كل وحدة.
          </Text>
          {loading ? <ActivityIndicator color={ACCENT} /> : (
            <>
              <Text style={s.meta}>
                {lteTop.length && nrTop.length
                  ? `4G: ${lteTop.map(b => 'B' + b).join('، ')}  ·  5G: ${nrTop.map(b => 'n' + b).join('، ')}`
                  : !nrTop.length && lteTop.length
                    ? `4G: ${lteTop.map(b => 'B' + b).join('، ')}  ·  5G: غير مدعوم`
                    : 'ما لقينا ترددات كافية'}
              </Text>
              <Text style={s.meta}>
                🧪 {rows.length} تركيبة · ⏱ ~{Math.ceil((rows.length * (measureSpeed ? 55 : 30)) / 60)} دقيقة
              </Text>
            </>
          )}
          <View style={s.toggleRow}>
            <Switch
              value={measureSpeed}
              onValueChange={setMeasureSpeed}
              trackColor={{ true: ACCENT, false: C.track }}
              thumbColor={C.onAccent}
              disabled={running}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.toggleTitle}>قياس السرعة الفعلية</Text>
              <Text style={s.toggleSub}>يستهلك ~٢٥ ميقا/تركيبة · أوقفه للاقتصاد</Text>
            </View>
          </View>
          {!loading && rows.length > 0 && (
            <Pressable
              style={[s.btn, running && { backgroundColor: C.red }]}
              onPress={running ? () => { cancel.current = true; } : start}
            >
              <Text style={s.btnText}>
                {running ? '⏹ إيقاف (ونرجع إعدادك)' : finished ? '🔁 أعد التجربة' : '▶ ابدأ التجربة'}
              </Text>
            </Pressable>
          )}
          {!!status && <Text style={s.status}>{status}</Text>}
          {!!error && <Text style={s.err}>{error}</Text>}
        </View>

        {base && (
          <View style={[s.row, { borderColor: C.cardBorder }]}>
            <View style={s.rowHead}>
              <Text style={s.rowName}>⭐ الإعداد الحالي (التلقائي)</Text>
              <Text style={[s.rowPct, { color: C.sub }]}>مرجع</Text>
            </View>
            <Text style={s.rowLine}>
              {base.bands || '—'} · {base.carriers} نواقل · {Math.round(base.bw)} MHz
              {base.nr ? ' · 5G ✓' : ''}
            </Text>
          </View>
        )}

        {rows.map((r, i) => {
          const isBest = finished && best === r;
          const isBest5g = finished && !isBest && best5g === r;
          const sg = gradeSpeed(r.speedMbps);
          const pg = gradePing(r.pingMs);
          return (
            <View key={i} style={[
              s.row,
              isBest && { borderColor: '#16a34a', borderWidth: 2, backgroundColor: '#f0fdf4' },
              isBest5g && { borderColor: C.violet + '80' },
            ]}>
              <View style={s.rowHead}>
                <Text style={[s.rowName, isBest && { color: '#16a34a' }]}>
                  {isBest ? '🥇 ' : isBest5g ? '🥈 ' : ''}{rowLabel(r)}
                </Text>
                {r.status === 'testing' ? <ActivityIndicator size="small" color={ACCENT} />
                  : r.status === 'failed' ? <Text style={[s.rowPct, { color: C.red }]}>✗</Text>
                    : r.status === 'done' && r.speedMbps !== undefined ? (
                      <Text style={[s.speed, { color: sg.color }]}>{r.speedMbps.toFixed(1)}<Text style={s.speedUnit}> Mbps</Text></Text>
                    ) : <Text style={s.rowPct}>—</Text>}
              </View>
              {r.status === 'done' && (
                <View style={s.metricsRow}>
                  {r.pingMs !== undefined && (
                    <View style={s.chip}>
                      <Text style={[s.chipVal, { color: pg.color }]}>{r.pingMs}<Text style={s.chipUnit}>ms</Text></Text>
                      <Text style={s.chipLbl}>بنق</Text>
                    </View>
                  )}
                  {r.nrActive && (
                    <View style={[s.chip, { borderColor: C.violet }]}>
                      <Text style={[s.chipVal, { color: C.violet }]}>5G ✓</Text>
                      <Text style={s.chipLbl}>نشط</Text>
                    </View>
                  )}
                  {r.snap?.carriers !== undefined && (
                    <View style={s.chip}>
                      <Text style={s.chipVal}>{r.snap.carriers}</Text>
                      <Text style={s.chipLbl}>نواقل</Text>
                    </View>
                  )}
                  {r.snap?.bw !== undefined && (
                    <View style={s.chip}>
                      <Text style={s.chipVal}>{Math.round(r.snap.bw)}<Text style={s.chipUnit}>MHz</Text></Text>
                      <Text style={s.chipLbl}>عرض</Text>
                    </View>
                  )}
                </View>
              )}
              {r.status === 'done' && r.snap && (
                <Text style={s.rowLine}>
                  RSRP {r.snap.rsrp !== undefined ? Math.round(r.snap.rsrp) : '—'} dBm
                  {r.snap.sinr !== undefined ? ` · SINR ${Math.round(r.snap.sinr)}` : ''}
                  {r.snap.bands ? ` · ${r.snap.bands}` : ''}
                </Text>
              )}
              {!!r.note && r.status !== 'done' && <Text style={s.rowNote}>{r.note}</Text>}
            </View>
          );
        })}

        {finished && (
          <View style={[s.card, { borderColor: best ? '#16a34a' : C.line }]}>
            {best ? (
              <>
                <Text style={s.verdict}>
                  {best5g && best5g === best
                    ? `🥇 الأفضل: ${rowLabel(best)} — سرعة ${best.speedMbps?.toFixed(1) ?? '—'} Mbps`
                    : best.nrBands?.length
                      ? `🥇 الأفضل (بدون 5G نشط): ${rowLabel(best)}`
                      : `🥇 الأفضل: ${rowLabel(best)}`}
                </Text>
                {best5g && best5g !== best && (
                  <Text style={s.verdict2}>
                    📡 الأفضل مع 5G نشط: {rowLabel(best5g)} — {best5g.speedMbps?.toFixed(1) ?? '—'} Mbps
                  </Text>
                )}
                <Pressable style={[s.btn, { backgroundColor: '#16a34a' }]} onPress={apply} disabled={running}>
                  <Text style={s.btnText}>ثبّت {rowLabel(best)} بأمان</Text>
                </Pressable>
              </>
            ) : (
              <Text style={s.verdict}>ما قدرنا نقيس — جرّب مرة ثانية.</Text>
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
  meta: { color: C.text, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  toggleRow: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    backgroundColor: C.rowBg, borderRadius: 12, padding: 10, marginTop: 4,
  },
  toggleTitle: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right' },
  toggleSub: { color: C.muted, fontSize: 10.5, textAlign: 'right', marginTop: 1 },
  btn: { backgroundColor: ACCENT, borderRadius: R.md, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  status: { color: ACCENT, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  err: { color: C.red, fontSize: 12.5, textAlign: 'right' },
  row: {
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
    borderRadius: R.md, padding: S.md, gap: 6,
  },
  rowHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  rowName: { color: C.text, fontWeight: '800', fontSize: 14.5 },
  rowPct: { fontWeight: '800', fontSize: 14, color: C.muted },
  speed: { fontWeight: '900', fontSize: 20 },
  speedUnit: { color: C.muted, fontWeight: '700', fontSize: 11 },
  metricsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  chip: {
    alignItems: 'center', backgroundColor: C.rowBg,
    borderRadius: 10, borderWidth: 1, borderColor: C.cardBorder,
    paddingHorizontal: 10, paddingVertical: 5, minWidth: 56,
  },
  chipVal: { color: C.text, fontWeight: '800', fontSize: 13 },
  chipUnit: { color: C.muted, fontWeight: '600', fontSize: 9 },
  chipLbl: { color: C.muted, fontSize: 10, marginTop: 1 },
  rowLine: { color: C.sub, fontSize: 12, textAlign: 'right' },
  rowNote: { color: C.muted, fontSize: 12, textAlign: 'right' },
  verdict: { color: C.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right', lineHeight: 22 },
  verdict2: { color: C.violet, fontWeight: '800', fontSize: 13.5, textAlign: 'right', lineHeight: 20, marginTop: 4 },
});
