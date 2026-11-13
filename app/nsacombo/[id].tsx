import { runRouterOp } from '../../src/utils/routerOp';
import { useLeaveGuard } from '../../src/ui/useLeaveGuard';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { reportError } from '../../src/services/errors';
import { withSession } from '../../src/store/sessions';
import { BandConfig, Carrier, CellTower } from '../../src/drivers/types';
import { snapshot, waitOnline, trialMessage, Snapshot, safeApply } from '../../src/utils/safeLock';
import { C, R, S, tFg } from '../../src/ui/theme';
import { trafficBurst } from '../../src/utils/nrprobe';
import { useOperatorBands } from '../../src/store/operator';
import { freqLabel } from '../../src/utils/bands';
import { squashBands, manualCombos } from '../../src/utils/nsaPick';

import { sheet } from '../../src/i18n';
const ACCENT = '#f59e0b';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const COMBO_MAX_MS = 90_000;
const TIMEOUT = Symbol('timeout');
/** حد أقصى لكل تركيبة — ما نخلي المستخدم ينتظر للأبد لو الراوتر علق */
function capped<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return new Promise(res => {
    const t = setTimeout(() => res(TIMEOUT), ms);
    p.then(v => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(TIMEOUT); });
  });
}

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
  startedAt?: number;
  snap?: Snapshot | null;
}

/**
 * التركيبات: أفضل 4G مع بعض + 5G (مثل B1+B3+n78) أول — التثبيت على 4G واحد يقطع دمج 4G
 * فغالباً أبطأ. بعدها كل 4G لحاله مع 5G.
 */
function buildCombos(lteTop: number[], nrTop: number[]): Combo[] {
  const out: Combo[] = [];
  const seen = new Set<string>();
  const add = (lte: number[], nr: number[]) => {
    const k = comboName({ lte, nr });
    if (!seen.has(k)) { seen.add(k); out.push({ lte, nr }); }
  };
  for (const nr of nrTop.slice(0, 2)) {
    if (lteTop.length >= 2) add(lteTop.slice(0, 2), [nr]);
    if (lteTop.length >= 3) add(lteTop.slice(0, 3), [nr]);
  }
  for (const nr of nrTop) for (const lte of lteTop) add([lte], [nr]);
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
  const op = useOperatorBands(id);
  /** «اختار بنفسي» — مفتوحة؟ والترددات المختارة */
  const [manual, setManual] = useState(false);
  const [pickLte, setPickLte] = useState<number[]>([]);
  const [pickNr, setPickNr] = useState<number[]>([]);
  const [allBands, setAllBands] = useState(false);
  // خروج وقت الفحص ← تأكيد (كان يكمل بالخلفية ويطلع «الراوتر مشغول» لو رجع)
  useLeaveGuard(running, { what: 'فحص الدمج', onStop: () => { cancel.current = true; } });
  const mounted = useRef(true);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

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
        // اللي الراوتر يقبل تثبيته أول (nrPreferred) — قائمة «المدعومة» العامة فيها ترددات يرفضها ZTE
        const nrPool = c.nrPreferred?.length ? c.nrPreferred : c.nrSupported;
        const nrList = NR_PREF.filter(b => nrPool.includes(b)).slice(0, 3);

        setLteTop(lteList);
        setNrTop(nrList);
        setPickLte(lteList.slice(0, 1));
        setPickNr(nrList.slice(0, 1));
        setRows(buildCombos(lteList, nrList).map(x => ({ ...x, status: 'pending' })));
      } catch (e: any) {
        if (mounted.current) setError(e?.message ?? String(e));
      reportError('nsacombo', e, info);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; cancel.current = true; };
  }, [id]);

  const start = (custom?: Combo[]) => {
    if (!info || !cfg) return;
    const list = custom ?? rows;
    if (!list.length) return;
    const mins = Math.ceil((list.length * 55) / 60);
    Alert.alert(
      'دمج 4G + 5G (NSA)',
      `بنجرب ${list.length} تركيبة (${list.map(comboName).join('، ')}).\n\n` +
      `⏱ ~${mins} دقيقة · 📶 ينقطع الاتصال · 📊 ~30 ميقا/تركيبة (نصحّي 5G بتحميل قصير).\n\n` +
      'بالآخر نرجع إعدادك تلقائياً.',
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'ابدأ', onPress: () => run(list) }],
    );
  };

  const run = async (combos: Combo[]) => {
    if (!info || !cfg) return;
    await runRouterOp(info, 'تجربة تركيبات NSA', async () => {
    cancel.current = false;
    setRunning(true); setFinished(false); setError('');
    const list: Row[] = combos.map(r => ({ lte: r.lte, nr: r.nr, status: 'pending' }));
    setRows([...list]);
    const upd = (i: number, p: Partial<Row>) => {
      list[i] = { ...list[i], ...p };
      if (mounted.current) setRows([...list]);
    };
    try {
      for (let i = 0; i < list.length; i++) {
        if (cancel.current) break;
        const c = list[i];
        upd(i, { status: 'testing', note: 'نثبّت...', startedAt: Date.now() });
        setStatus(`تركيبة ${i + 1} من ${list.length}`);
        let gone = false; // لو طوّلت وتخطيناها، ما نخلي بقيتها تكمّل بالخلفية وتلخبط التركيبة الجاية
        const u = (p: Partial<Row>) => { if (!gone) upd(i, p); };
        const one = async () => {
          await withSession(info, d => d.setBand!(c.lte, c.nr), false);
          if (gone) return;
          u({ note: 'ننتظر الاتصال...' });
          const ok = await waitOnline(info, 40000, () => cancel.current || gone);
          if (gone) return;
          if (cancel.current) { u({ status: 'pending', note: undefined, startedAt: undefined }); return 'stop'; }
          if (!ok) { u({ status: 'failed', note: 'ما اتصل' }); return; }
          u({ note: 'نصحّي 5G...' });
          // الـ5G في NSA ما ينضاف إلا مع تحميل مستمر — نحمّل ١٥ ثانية ونقيس وسطه
          const burst = trafficBurst(15000, 35_000_000, () => cancel.current || gone);
          await sleep(4000);
          if (gone) return;
          u({ note: 'نقيس...' });
          const snap = await snapshot(info, true, 4);
          await burst.catch(() => 0);
          u({ status: snap ? 'done' : 'failed', snap, note: snap ? undefined : 'فشل القياس' });
        };
        try {
          const pending = one();
          const r = await capped(pending, COMBO_MAX_MS);
          if (r === 'stop') break;
          if (r === TIMEOUT) {
            gone = true;
            // انتهت المهلة بس أوامر هالتركيبة ممكن لسا شغالة على الراوتر — ننتظرها تخلص فعلاً
            // قبل التركيبة الجاية (لا أمرين فوق بعض)
            setStatus('الراوتر لسا ينفّذ التركيبة اللي طوّلت — ننتظره يخلص...');
            await pending.catch(() => {});
          }
          if (r === TIMEOUT && list[i].status === 'testing') {
            upd(i, { status: 'failed', note: 'طوّل الراوتر — تخطيناها' });
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
    });
  };

  const apply = (pick?: Combo, withNr?: boolean) => {
    const best = pick ?? bestRow;
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
              withNr: withNr ?? true,
              apply: d => d.setBand!(best.lte, best.nr),
              revert: d => d.setBand!(cfg.locked, cfg.nrLocked),
              onStatus: st => { if (mounted.current) setStatus(st); },
            });
            const m = trialMessage(res, label);
            Alert.alert(m.title, m.body);
          } catch (e: any) {
            setError(e?.message ?? String(e));
            reportError('nsacombo', e, info);
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
  const bestRow = best;
  const keepLte = (b: number) => allBands || !op || op.bands.lte.includes(b) || lteTop.includes(b) || pickLte.includes(b);
  const keepNr = (b: number) => allBands || !op || op.bands.nr.includes(b) || nrTop.includes(b) || pickNr.includes(b);
  const lteChoices = cfg ? [...cfg.supported].sort((a, b) => a - b).filter(keepLte) : [];
  const nrPool = cfg ? (cfg.nrPreferred?.length ? cfg.nrPreferred : cfg.nrSupported) : [];
  const nrChoices = [...nrPool].sort((a, b) => a - b).filter(keepNr);
  const hidden = cfg && op && !allBands ? (cfg.supported.length - lteChoices.length) + (nrPool.length - nrChoices.length) : 0;
  const toggle = (list: number[], set: (v: number[]) => void, b: number) =>
    set(list.includes(b) ? list.filter(x => x !== b) : [...list, b]);
  const myCombos = manualCombos(pickLte, pickNr);

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
              onPress={running ? () => { cancel.current = true; } : () => start()}
            >
              <Text style={s.btnText}>{running ? '⏹ إيقاف (ونرجع إعدادك)' : finished ? '🔁 أعد التجربة' : '▶ ابدأ التجربة'}</Text>
            </Pressable>
          )}
          {!!status && <Text style={s.statusText}>{status}</Text>}
          {!!error && <Text style={s.err}>{error}</Text>}
        </View>

        {!loading && !!cfg && (
          <View style={s.card}>
            <Pressable onPress={() => setManual(v => !v)} hitSlop={6} style={s.manualHead}>
              <Text style={s.title}>✋ اختار بنفسي</Text>
              <Text style={s.manualToggle}>{manual ? 'اخفِ' : 'افتح'}</Text>
            </Pressable>
            {manual && (
              <>
                <Text style={s.body}>اختار تردد 4G (المرساة) وتردد 5G أو أكثر — تقدر تجرّبها وتقارن، أو تثبّتها على طول.</Text>
                <Text style={s.pickTitle}>4G</Text>
                <View style={s.chips}>
                  {lteChoices.map(b => {
                    const on = pickLte.includes(b);
                    return (
                      <Pressable key={'l' + b} disabled={running} onPress={() => toggle(pickLte, setPickLte, b)} style={[s.chip, on && s.chipOn]}>
                        <Text style={[s.chipTxt, on && s.chipTxtOn]}>B{b}</Text>
                        {!!freqLabel('LTE', b) && <Text style={[s.chipSub, on && s.chipTxtOn]}>{freqLabel('LTE', b)}</Text>}
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={s.pickTitle}>5G</Text>
                <View style={s.chips}>
                  {nrChoices.map(b => {
                    const on = pickNr.includes(b);
                    return (
                      <Pressable key={'n' + b} disabled={running} onPress={() => toggle(pickNr, setPickNr, b)} style={[s.chip, on && s.chipOnNr]}>
                        <Text style={[s.chipTxt, on && s.chipTxtOn]}>n{b}</Text>
                        {!!freqLabel('NR', b) && <Text style={[s.chipSub, on && s.chipTxtOn]}>{freqLabel('NR', b)}</Text>}
                      </Pressable>
                    );
                  })}
                </View>
                {!!op && (hidden > 0 || allBands) && (
                  <Pressable onPress={() => setAllBands(v => !v)} hitSlop={6}>
                    <Text style={s.more}>{allBands ? `اعرض ترددات ${op.name} بس` : `معروض ترددات ${op.name} بس · اعرض كل ترددات الراوتر (+${hidden})`}</Text>
                  </Pressable>
                )}
                {myCombos.length > 0 ? (
                  <>
                    <Text style={s.meta}>بنجرب: {myCombos.map(comboName).join('، ')}</Text>
                    <View style={s.btnRow}>
                      <Pressable style={[s.btn, s.btnHalf, running && s.off]} disabled={running} onPress={() => start(myCombos)}>
                        <Text style={s.btnText}>▶ جرّب اختياري</Text>
                      </Pressable>
                      <Pressable style={[s.btn, s.btnHalf, { backgroundColor: C.green }, running && s.off]} disabled={running}
                        onPress={() => apply({ lte: [...pickLte].sort((a, b) => a - b), nr: [...pickNr].sort((a, b) => a - b) })}>
                        <Text style={s.btnText}>ثبّت على طول</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <Text style={s.note}>اختار تردد 4G واحد على الأقل وتردد 5G واحد على الأقل.</Text>
                )}
              </>
            )}
          </View>
        )}

        {rows.map(r => {
          const isBest = finished && best && best.lte.join('+') === r.lte.join('+') && best.nr.join('+') === r.nr.join('+');
          return (
            <Pressable key={comboName(r)} disabled={running || !r.snap} onPress={() => apply(r, !!r.snap?.nr)}
              style={[s.row, isBest && { borderColor: ACCENT, backgroundColor: ACCENT + '12' }]}>
              <View style={s.rowHead}>
                <Text style={s.rowName}>{isBest ? '🏆 ' : ''}{comboName(r)}</Text>
                {r.status === 'testing'
                  ? <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      <ActivityIndicator size="small" color={ACCENT} />
                      {!!r.startedAt && <Text style={s.secs}>{Math.round((Date.now() - r.startedAt) / 1000)}ث</Text>}
                    </View>
                  : r.snap
                    ? <Text style={[s.rowPct, { color: (r.snap.nr ? C.green : C.sub) }]}>{r.snap.nr ? '5G✓' : '5G✗'}</Text>
                    : r.status === 'failed'
                      ? <Text style={[s.rowPct, { color: C.red }]}>✗</Text>
                      : <Text style={s.rowPct}>—</Text>}
              </View>
              {r.snap ? (
                <>
                  <Text style={s.rowLine}>
                    {squashBands(r.snap.bands || '—')} · {r.snap.carriers} نواقل · {Math.round(r.snap.bw)} MHz
                    {r.snap.sinr !== undefined ? ` · SINR ${Math.round(r.snap.sinr)}` : ''}
                    {r.snap.rsrp !== undefined ? ` · RSRP ${Math.round(r.snap.rsrp)}` : ''}
                  </Text>
                  {finished && !running && <Text style={s.tapHint}>اضغط عشان تثبّت هذي</Text>}
                </>
              ) : r.note ? <Text style={s.rowNote}>{r.note}</Text> : null}
            </Pressable>
          );
        })}

        {finished && (
          <View style={[s.card, { borderColor: best ? C.green : C.line }]}>
            {best ? (
              <>
                <Text style={[s.verdict, { color: C.green }]}>
                  أفضل تركيبة: {comboName(best)} — {best.snap?.nr ? 'اشتغل 5G ✓' : '5G ما اشتغل'} ({squashBands(best.snap?.bands || '—')})
                </Text>
                {!rows.some(r => r.snap?.nr) && (
                  <Text style={s.note}>
                    ولا تركيبة شغّلت الـ5G. يعني البرج ما يضيف 5G مع هالترددات الحين (غالباً زحمة أو تغطية 5G ضعيفة عندك) — مو عطل في راوترك. التلقائي يبقى أفضل لك، أو جرّب بوقت ثاني.
                  </Text>
                )}
                <Pressable style={[s.btn, { backgroundColor: C.green }]} onPress={() => apply(best, !!best.snap?.nr)} disabled={running}>
                  <Text style={s.btnText}>ثبّت {comboName(best)} بأمان</Text>
                </Pressable>
              </>
            ) : (
              <Text style={s.verdict}>ما قدرنا نقيس أي تركيبة — جرّب مرة ثانية.</Text>
            )}
            <Text style={s.note}>علامة الصح جنب 5G تعني إن الراوتر اتصل فعلاً على 5G في هذي التركيبة. تقدر تضغط أي تركيبة فوق وتثبّتها بدل الأفضل.</Text>
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: S.md },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  body: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  meta: { color: C.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  warn: { color: tFg('#d97706'), fontSize: 12, textAlign: 'right', fontWeight: '700', lineHeight: 18 },
  btn: { backgroundColor: ACCENT, borderRadius: R.md, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  statusText: { color: ACCENT, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  err: { color: C.red, fontSize: 12.5, textAlign: 'right' },
  row: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: R.md, padding: S.md, gap: 4 },
  rowHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  rowName: { color: C.text, fontWeight: '800', fontSize: 14.5 },
  rowPct: { fontWeight: '800', fontSize: 14, color: C.muted },
  rowLine: { color: C.sub, fontSize: 12, textAlign: 'right' },
  secs: { color: C.muted, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowNote: { color: C.muted, fontSize: 12, textAlign: 'right' },
  verdict: { color: C.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right', lineHeight: 22 },
  note: { color: C.muted, fontSize: 11.5, textAlign: 'right', lineHeight: 17 },
  manualHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  manualToggle: { color: ACCENT, fontWeight: '800', fontSize: 13 },
  pickTitle: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right', marginTop: 4 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center', minWidth: 58, backgroundColor: C.card },
  chipOn: { backgroundColor: '#2f6bff', borderColor: '#2f6bff' },
  chipOnNr: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  chipTxt: { color: C.text, fontWeight: '800', fontSize: 13 },
  chipSub: { color: C.muted, fontSize: 10 },
  chipTxtOn: { color: '#ffffff' },
  more: { color: ACCENT, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  btnRow: { flexDirection: 'row-reverse', gap: 8 },
  btnHalf: { flex: 1 },
  off: { opacity: 0.5 },
  tapHint: { color: ACCENT, fontSize: 11, fontWeight: '700', textAlign: 'right' },
});
