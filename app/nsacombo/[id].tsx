import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { BandConfig, Carrier, CellTower } from '../../src/drivers/types';
import { snapshot, waitOnline, trialMessage, Snapshot, safeApply } from '../../src/utils/safeLock';
import { C, R, S } from '../../src/ui/theme';

const ACCENT = '#f59e0b';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Combo { lte: number[]; nr: number[] }

function comboName(c: Combo): string {
  const l = c.lte.map(b => `B${b}`).join('+');
  const n = c.nr.map(b => `n${b}`).join('+');
  if (l && n) return `${l} + ${n}`;
  return l || n;
}

interface Row extends Combo {
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;
  snap?: Snapshot | null;
}

function buildCombos(lteTop: number[], nrTop: number[]): Combo[] {
  const out: Combo[] = [];
  for (const nr of nrTop) {
    for (const lte of lteTop) {
      out.push({ lte: [lte], nr: [nr] });
    }
  }
  return out.slice(0, 8);
}

export default function NsaCombo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [lteTop, setLteTop] = useState<number[]>([]);
  const [nrTop, setNrTop] = useState<number[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
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
        if (!mounted.current) return;
        setCfg(c);

        // أفضل ترددات 4G: من النواقل + الأبراج + المدعومة
        const score = new Map<number, number>();
        for (const x of car) if (x.tech === 'LTE') score.set(x.band, Math.max(score.get(x.band) ?? -999, (x.rsrp ?? -100) + 50));
        for (const x of cells) if (x.tech === 'LTE' && x.band && x.rsrp !== undefined) {
          score.set(x.band, Math.max(score.get(x.band) ?? -999, x.rsrp));
        }
        const lteList = [...score.entries()]
          .filter(([b]) => c.supported.includes(b))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([b]) => b);

        // ترددات 5G من المدعومة (نأخذ الشائعة أول)
        const NR_PREF = [78, 41, 40, 77, 1, 3, 5, 8, 20, 28];
        const nrList = NR_PREF.filter(b => c.nrSupported.includes(b)).slice(0, 3);

        setLteTop(lteList);
        setNrTop(nrList);
        setRows(buildCombos(lteList, nrList).map(x => ({ ...x, status: 'pending' })));
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
    const mins = Math.ceil((rows.length * 55) / 60);
    Alert.alert(
      'دمج 4G + 5G (NSA)',
      `بنجرب ${rows.length} تركيبة (${rows.map(comboName).join('، ')}).\n\n` +
      `⏱ ~${mins} دقيقة · 📶 ينقطع الاتصال · 📊 ~30 ميقا/تركيبة (نصحّي 5G بتحميل قصير).\n\n` +
      'بالآخر نرجع إعدادك تلقائياً.',
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'ابدأ', onPress: run }],
    );
  };

  const run = async () => {
    if (!info || !cfg) return;
    cancel.current = false;
    setRunning(true); setFinished(false); setError('');
    const list: Row[] = rows.map(r => ({ lte: r.lte, nr: r.nr, status: 'pending' }));
    setRows([...list]);
    const upd = (i: number, p: Partial<Row>) => {
      list[i] = { ...list[i], ...p };
      if (mounted.current) setRows([...list]);
    };
    try {
      for (let i = 0; i < list.length; i++) {
        if (cancel.current) break;
        const c = list[i];
        upd(i, { status: 'testing', note: 'نثبّت...' });
        try {
          await withSession(info, d => d.setBand!(c.lte, c.nr), false);
          upd(i, { note: 'ننتظر الاتصال...' });
          const ok = await waitOnline(info, 40000, () => cancel.current);
          if (cancel.current) { upd(i, { status: 'pending', note: undefined }); break; }
          if (!ok) { upd(i, { status: 'failed', note: 'ما اتصل' }); continue; }
          upd(i, { note: 'نصحّي 5G...' });
          // Wake 5G with traffic burst
          try {
            const { trafficBurst } = require('../../src/utils/nrprobe');
            const burst = trafficBurst(8000, 20_000_000, () => cancel.current);
            await sleep(2500);
            const snap = await snapshot(info, true, 3);
            await burst.catch(() => 0);
            upd(i, { status: snap ? 'done' : 'failed', snap, note: snap ? undefined : 'فشل القياس' });
          } catch {
            upd(i, { note: 'نقيس...' });
            await sleep(6000);
            const snap = await snapshot(info, true, 3);
            upd(i, { status: snap ? 'done' : 'failed', snap, note: snap ? undefined : 'فشل القياس' });
          }
        } catch (e: any) {
          upd(i, { status: 'failed', note: e?.message ?? 'خطأ' });
        }
      }
    } finally {
      try { await withSession(info, d => d.setBand!(cfg.locked, cfg.nrLocked), false); } catch {}
      await waitOnline(info, 45000, () => false);
      if (mounted.current) { setRunning(false); setFinished(true); setStatus(''); }
    }
  };

  const apply = () => {
    if (!info || !cfg || !best) return;
    const label = `تثبيت ${comboName(best)}`;
    Alert.alert(label, 'بنثبّتها بأمان: نقيس قبل وبعد، ولو ما كانت أفضل نرجع إعدادك.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'ثبّت', onPress: async () => {
          setRunning(true);
          try {
            const res = await safeApply({
              r: info,
              key: `nsa:${best.lte.join('+')}:${best.nr.join('+')}`,
              label,
              withNr: best.nr.length > 0,
              apply: d => d.setBand!(best.lte, best.nr),
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

  const done = rows.filter(r => r.status === 'done' && r.snap);
  const ranked = [...done].sort((a, b) => (b.snap!.cap) - (a.snap!.cap));
  const best = ranked[0];

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.card}>
          <Text style={s.title}>🔗 دمج 4G + 5G (NSA)</Text>
          <Text style={s.body}>
            الراوتر يقدر يدمج تردد 4G (المرساة) مع تردد 5G في نفس الوقت — هذا اللي يسمى NSA.
            الاختيار الصحيح للثنائي يفرق كبير في السرعة. هنا نجرب عدة تركيبات ونقول لك الأسرع.
          </Text>
          {loading ? <ActivityIndicator color={ACCENT} /> : (
            <>
              <Text style={s.meta}>
                {lteTop.length && nrTop.length
                  ? `4G: ${lteTop.map(b => 'B' + b).join('، ')}  ·  5G: ${nrTop.map(b => 'n' + b).join('، ')}`
                  : !nrTop.length
                    ? 'ما لقينا ترددات 5G مدعومة — تأكد أن الراوتر يدعم 5G.'
                    : 'ما لقينا ترددات 4G قوية — جرّب لاحقاً.'}
              </Text>
              <Text style={s.warn}>⏱ ياخذ ~دقيقة/تركيبة · 📶 ينقطع الاتصال · 📊 ~30 ميقا/تركيبة</Text>
            </>
          )}
          {!loading && rows.length > 0 && (
            <Pressable
              style={[s.btn, running && { backgroundColor: C.red }]}
              onPress={running ? () => { cancel.current = true; } : start}
            >
              <Text style={s.btnText}>{running ? '⏹ إيقاف (ونرجع إعدادك)' : finished ? '🔁 أعد التجربة' : '▶ ابدأ التجربة'}</Text>
            </Pressable>
          )}
          {!!status && <Text style={s.statusText}>{status}</Text>}
          {!!error && <Text style={s.err}>{error}</Text>}
        </View>

        {rows.map(r => {
          const isBest = finished && best && best.lte.join('+') === r.lte.join('+') && best.nr.join('+') === r.nr.join('+');
          return (
            <View key={comboName(r)} style={[s.row, isBest && { borderColor: ACCENT, backgroundColor: ACCENT + '12' }]}>
              <View style={s.rowHead}>
                <Text style={s.rowName}>{isBest ? '🏆 ' : ''}{comboName(r)}</Text>
                {r.status === 'testing'
                  ? <ActivityIndicator size="small" color={ACCENT} />
                  : r.snap
                    ? <Text style={[s.rowPct, { color: (r.snap.nr ? C.green : C.sub) }]}>{r.snap.nr ? '5G✓' : '5G✗'}</Text>
                    : r.status === 'failed'
                      ? <Text style={[s.rowPct, { color: C.red }]}>✗</Text>
                      : <Text style={s.rowPct}>—</Text>}
              </View>
              {r.snap ? (
                <Text style={s.rowLine}>
                  {r.snap.bands || '—'} · {r.snap.carriers} نواقل · {Math.round(r.snap.bw)} MHz
                  {r.snap.sinr !== undefined ? ` · SINR ${Math.round(r.snap.sinr)}` : ''}
                  {r.snap.rsrp !== undefined ? ` · RSRP ${Math.round(r.snap.rsrp)}` : ''}
                </Text>
              ) : r.note ? <Text style={s.rowNote}>{r.note}</Text> : null}
            </View>
          );
        })}

        {finished && (
          <View style={[s.card, { borderColor: best ? C.green : C.line }]}>
            {best ? (
              <>
                <Text style={[s.verdict, { color: C.green }]}>
                  أفضل تركيبة: {comboName(best)} — {best.nr.length ? '5G نشط ✓' : 'بدون 5G'} ({best.snap?.bands || '—'})
                </Text>
                <Pressable style={[s.btn, { backgroundColor: C.green }]} onPress={apply} disabled={running}>
                  <Text style={s.btnText}>ثبّت {comboName(best)} بأمان</Text>
                </Pressable>
              </>
            ) : (
              <Text style={s.verdict}>ما قدرنا نقيس أي تركيبة — جرّب مرة ثانية.</Text>
            )}
            <Text style={s.note}>5G✓ = الراوتر اتصل فعلاً على 5G في هذي التركيبة.</Text>
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
  warn: { color: '#d97706', fontSize: 12, textAlign: 'right', fontWeight: '700', lineHeight: 18 },
  btn: { backgroundColor: ACCENT, borderRadius: R.md, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  statusText: { color: ACCENT, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  err: { color: C.red, fontSize: 12.5, textAlign: 'right' },
  row: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: R.md, padding: S.md, gap: 4 },
  rowHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  rowName: { color: C.text, fontWeight: '800', fontSize: 14.5 },
  rowPct: { fontWeight: '800', fontSize: 14, color: C.muted },
  rowLine: { color: C.sub, fontSize: 12, textAlign: 'right' },
  rowNote: { color: C.muted, fontSize: 12, textAlign: 'right' },
  verdict: { color: C.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right', lineHeight: 22 },
  note: { color: C.muted, fontSize: 11.5, textAlign: 'right' },
});
