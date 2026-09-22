import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { BandConfig, Signal, CellTower } from '../../src/drivers/types';
import { LEVEL_COLOR, LEVEL_LABEL, overallLevel, parseBands, signalScore } from '../../src/utils/signal';
import { bandFreq, SCAN_PREFERRED, bandLabel, freqLabel, nrFreq } from '../../src/utils/bands';
import { fmtTime } from '../../src/utils/format';
import { C, R, S, T } from '../../src/ui/theme';
import { HeroCard, MetricCard } from '../../src/ui/Cards';
import { Icon } from '../../src/ui/Icon';
import { Skeleton, ErrorCard } from '../../src/ui/States';
import { trafficBurst } from '../../src/utils/nrprobe';
import { safeApply, lastTrial, trialNote, trialMessage } from '../../src/utils/safeLock';

type ScanStatus = 'pending' | 'testing' | 'done' | 'nocov' | 'error';
interface ScanRow { tech: 'LTE' | 'NR'; band: number; status: ScanStatus; rsrp?: number; sinr?: number; score?: number; note?: string; }
interface QuickRow { tech: 'LTE' | 'NR'; band: number; rsrp?: number; sinr?: number; score: number; cells: number; live: boolean; }

/** صف موحّد للنتائج — من الفحص السريع أو الدقيق */
interface Result { tech: 'LTE' | 'NR'; band: number; rsrp?: number; sinr?: number; score: number; live: boolean; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const round1 = (v?: number) => (v === undefined ? undefined : Math.round(v * 10) / 10);
const bandNums = (band?: string) => parseBands(band).map(b => parseInt(b.slice(1), 10));
const names = (bs: number[]) => bs.map(b => `B${b}`).join(' + ');

/** رأس مرحلة مرقّم */
function Stage({
  n, title, sub, right, children,
}: { n: number; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: S.sm }}>
      <View style={st.head}>
        <View style={st.num}><Text style={st.numText}>{n}</Text></View>
        <View style={{ flexShrink: 1 }}>
          <Text style={st.title}>{title}</Text>
          {!!sub && <Text style={st.sub}>{sub}</Text>}
        </View>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

export default function BandsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [seen, setSeen] = useState<number[]>([]);
  const [nrSelected, setNrSelected] = useState<number[]>([]);
  const [quick, setQuick] = useState<QuickRow[]>([]);
  const [quickAt, setQuickAt] = useState<number | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [scan, setScan] = useState<ScanRow[]>([]);
  const [scanAt, setScanAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const cancelRef = useRef(false);
  const scanningRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (scanningRef.current) cancelRef.current = true;
    };
  }, []);

  const load = useCallback(async (r: SavedRouter) => {
    setError('');
    try {
      const [c, sig, cells] = await withSession(r, async d => {
        if (!d.getBandConfig) throw new Error('هذا الراوتر ما يدعم التحكم بالترددات');
        return Promise.all([
          d.getBandConfig(),
          d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
          d.getCells ? d.getCells().catch(() => [] as CellTower[]) : Promise.resolve([] as CellTower[]),
        ]);
      });
      if (!mounted.current) return;
      setCfg(c);
      setSignal(sig);
      setSelected(c.locked);
      setNrSelected(c.nrLocked);
      setSeen([...new Set(cells.map(x => x.band).filter((n): n is number => !!n))]);
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try {
        const raw = await AsyncStorage.getItem(`scan:${r.id}`);
        if (raw) {
          const j = JSON.parse(raw);
          setScan(j.rows ?? []);
          setScanAt(j.at ?? null);
        }
      } catch {}
      await load(r);
      if (mounted.current) setLoading(false);
    })();
  }, [id, load]);

  const waitConnected = async (r: SavedRouter, bands: number[], timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (cancelRef.current) return false;
      await sleep(3000);
      try {
        const res = await withSession(r, async d => {
          const conn = d.isConnected ? await d.isConnected() : true;
          const sig = conn && d.getSignal ? await d.getSignal() : null;
          return { conn, sig };
        });
        if (!res.conn) continue;
        const active = bandNums(res.sig?.band);
        if (!bands.length || !active.length || active.some(b => bands.includes(b))) return true;
      } catch {}
    }
    return false;
  };

  const applyBands = async (bands: number[]) => {
    if (!info || !cfg) return;
    const prev = cfg.locked;
    cancelRef.current = false;
    setBusy(true);
    setError('');
    if (bands.length) {
      const nrPrev = cfg.nrLocked;
      const label = `التثبيت على ${names(bands)}`;
      try {
        const res = await safeApply({
          r: info,
          key: `band:LTE:${[...bands].sort((a, b) => a - b).join('+')}`,
          label,
          apply: d => d.setBand!(bands, nrPrev),
          revert: d => d.setBand!(prev, nrPrev),
          onStatus: setStatus,
          isCancelled: () => cancelRef.current,
        });
        const m = trialMessage(res, label);
        Alert.alert(m.title, m.body);
        await load(info);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        if (mounted.current) { setBusy(false); setStatus(''); }
      }
      return;
    }
    try {
      setStatus(bands.length ? `نثبّت على ${names(bands)}...` : 'نلغي التثبيت...');
      await withSession(info, d => d.setBand!(bands), false);
      setStatus('ننتظر الراوتر يتصل بالشبكة...');
      const ok = await waitConnected(info, bands, 45000);
      if (!ok && bands.length) {
        setStatus('ما اتصل — نرجع الإعداد السابق...');
        await withSession(info, d => d.setBand!(prev), false);
        Alert.alert('ما نجح التثبيت', 'الراوتر ما قدر يتصل على الترددات المختارة، فرجعنا الإعداد السابق تلقائياً.');
      } else if (ok) {
        Alert.alert('تم', bands.length ? `الراوتر مثبّت الحين على ${names(bands)}` : 'ألغينا التثبيت — الراوتر يختار بنفسه');
      }
      await load(info);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      if (mounted.current) { setBusy(false); setStatus(''); }
    }
  };

  const applyNr = async (nr: number[]) => {
    if (!info || !cfg) return;
    const prev = cfg.nrLocked;
    cancelRef.current = false;
    setBusy(true);
    setError('');
    try {
      if (nr.length) {
        const label = `تثبيت 5G على ${nr.map(b => 'n' + b).join(' + ')}`;
        const res = await safeApply({
          r: info,
          key: `band:NR:${[...nr].sort((a, b) => a - b).join('+')}`,
          label,
          withNr: true,
          apply: d => d.setBand!(cfg.locked, nr),
          revert: d => d.setBand!(cfg.locked, prev),
          onStatus: setStatus,
          isCancelled: () => cancelRef.current,
        });
        const m = trialMessage(res, label);
        Alert.alert(m.title, m.body);
        await load(info);
        return;
      }
      setStatus('نلغي تثبيت 5G...');
      await withSession(info, d => d.setBand!(cfg.locked, nr), false);
      await load(info);
      Alert.alert('تم', 'ألغينا تثبيت 5G');
    } catch (e: any) {
      setError(e?.message ?? String(e));
      try { await withSession(info, d => d.setBand!(cfg.locked, prev), false); } catch {}
    } finally {
      if (mounted.current) { setBusy(false); setStatus(''); }
    }
  };

  const confirmApply = async (bands: number[]) => {
    const t = bands.length && info
      ? await lastTrial(info.id, `band:LTE:${[...bands].sort((a, b) => a - b).join('+')}`)
      : undefined;
    Alert.alert(
      bands.length ? 'تثبيت التردد' : 'إلغاء التثبيت',
      bands.length
        ? `بنثبّت الراوتر على ${names(bands)} بأمان: نقيس قبل وبعد، ولو صار أسوأ أو ما اتصل نرجع إعدادك تلقائياً.\nالإنترنت بينقطع لحظات.` +
          (bands.length === 1 ? '\n\n⚠️ تردد واحد يوقف دمج الترددات — لو تبي تحافظ على الدمج اختر أكثر من تردد.' : '') +
          (t ? `\n\n🧠 ${trialNote(t)}` : '')
        : 'بنرجع الراوتر يختار التردد بنفسه. الإنترنت بينقطع لحظات.',
      [{ text: 'إلغاء', style: 'cancel' }, { text: bands.length ? 'تثبيت' : 'إلغاء التثبيت', onPress: () => applyBands(bands) }],
    );
  };

  const confirmApplyNr = async (nr: number[]) => {
    const t = nr.length && info
      ? await lastTrial(info.id, `band:NR:${[...nr].sort((a, b) => a - b).join('+')}`)
      : undefined;
    Alert.alert(
      nr.length ? 'تثبيت تردد 5G' : 'إلغاء تثبيت 5G',
      nr.length
        ? `بنثبّت 5G على ${nr.map(b => 'n' + b).join(' + ')} بأمان: نقيس قبل وبعد (مع تحميل قصير حوالي ٥٠ ميقا عشان 5G يصحى)، ولو صار أسوأ نرجع إعدادك تلقائياً.` +
          (t ? `\n\n🧠 ${trialNote(t)}` : '')
        : 'بنرجع الراوتر يختار تردد 5G بنفسه.',
      [{ text: 'إلغاء', style: 'cancel' }, { text: nr.length ? 'تثبيت' : 'إلغاء التثبيت', onPress: () => applyNr(nr) }],
    );
  };

  const applyResult = (r: Result) => (r.tech === 'NR' ? confirmApplyNr([r.band]) : confirmApply([r.band]));

  const runQuickScan = useCallback(async (silent = false) => {
    if (!info) return [] as QuickRow[];
    setQuickBusy(true);
    if (!silent) setError('');
    try {
      const [cells, sig] = await withSession(info, async d => Promise.all([
        d.getCells ? d.getCells() : Promise.resolve([] as CellTower[]),
        d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
      ]));
      const liveBands = bandNums(sig?.band);
      const liveNr = (sig?.nrBand ?? '').match(/(\d+)/);
      const byBand = new Map<string, QuickRow>();
      for (const c of cells) {
        if (!c.band) continue;
        const key = c.tech + ':' + c.band;
        const cur = byBand.get(key);
        const score = signalScore({ rsrp: c.rsrp, sinr: c.sinr });
        if (!cur || score > cur.score) {
          byBand.set(key, {
            tech: c.tech,
            band: c.band,
            rsrp: c.rsrp,
            sinr: c.sinr,
            score,
            cells: (cur?.cells ?? 0) + 1,
            live: c.tech === 'NR'
              ? !!liveNr && parseInt(liveNr[1], 10) === c.band
              : liveBands.includes(c.band),
          });
        } else {
          cur.cells += 1;
        }
      }
      const rows = [...byBand.values()].sort((a, b) => b.score - a.score);
      if (mounted.current) {
        setQuick(rows);
        setQuickAt(Date.now());
      }
      return rows;
    } catch (e: any) {
      if (mounted.current && !silent) setError(e?.message ?? String(e));
      return [] as QuickRow[];
    } finally {
      if (mounted.current) setQuickBusy(false);
    }
  }, [info]);

  const runScan = async (targets: { tech: 'LTE' | 'NR'; band: number }[]) => {
    if (!info || !cfg) return;
    const original = cfg.locked;
    cancelRef.current = false;
    scanningRef.current = true;
    setScanning(true);
    setError('');
    const rows: ScanRow[] = targets.map(x => ({ tech: x.tech, band: x.band, status: 'pending' }));
    const update = (i: number, patch: Partial<ScanRow>) => {
      rows[i] = { ...rows[i], ...patch };
      if (mounted.current) setScan([...rows]);
    };
    setScan([...rows]);

    try {
      for (let i = 0; i < targets.length; i++) {
        if (cancelRef.current) break;
        const { tech, band } = targets[i];
        const isNr = tech === 'NR';
        update(i, { status: 'testing', note: 'نثبّت التردد...' });
        try {
          await withSession(info, d => (isNr ? d.setBand!([], [band]) : d.setBand!([band])), false);
          update(i, { note: 'ننتظر الاتصال...' });
          const ok = await waitConnected(info, isNr ? [] : [band], 30000);
          if (cancelRef.current) { update(i, { status: 'pending', note: undefined }); break; }
          if (!ok) { update(i, { status: 'nocov', note: 'ما فيه تغطية' }); continue; }
          update(i, { note: 'نقيس الإشارة...' });
          await sleep(4000);
          const rs: number[] = [];
          const ss: number[] = [];
          // 5G (NSA) ينام بدون بيانات — نحمّل شوي أثناء القياس عشان يصحى
          let burst: Promise<number> | null = null;
          if (isNr) {
            update(i, { note: 'نصحّي 5G بتحميل قصير...' });
            burst = trafficBurst(12000, 30_000_000, () => cancelRef.current);
            await sleep(3000);
          }
          for (let k = 0; k < 3 && !cancelRef.current; k++) {
            const sig = await withSession(info, d => (d.getSignal ? d.getSignal() : Promise.resolve({} as Signal)), false);
            const r = isNr ? sig.nrRsrp : sig.rsrp;
            const s2 = isNr ? sig.nrSinr : sig.sinr;
            if (r !== undefined) rs.push(r);
            if (s2 !== undefined) ss.push(s2);
            await sleep(2500);
          }
          if (burst) await burst.catch(() => 0);
          if (isNr && rs.length === 0) { update(i, { status: 'nocov', note: 'ما نشط 5G — الأرجح الشريحة أو الباقة' }); continue; }
          const rsrp = round1(avg(rs));
          const sinr = round1(avg(ss));
          update(i, { status: 'done', rsrp, sinr, score: signalScore({ rsrp, sinr }), note: undefined });
        } catch (e: any) {
          update(i, { status: 'error', note: e?.message ?? 'خطأ' });
        }
      }
    } finally {
      try {
        await withSession(info, d => d.setBand!(original, cfg.nrLocked), false);
      } catch (e: any) {
        Alert.alert(
          '⚠️ تنبيه مهم',
          'انتهى الفحص، لكن تعذّر إرجاع إعداد التردد السابق — راوترك الآن على آخر تردد جرّبناه.\n\n' + (e?.message ?? ''),
          [{ text: 'حسناً' }],
        );
      }
      scanningRef.current = false;
      const at = Date.now();
      try {
        await AsyncStorage.setItem(`scan:${info.id}`, JSON.stringify({ at, rows: rows.filter(r => r.status !== 'pending') }));
      } catch {}
      const nrRows = rows.filter(r => r.tech === 'NR' && r.status !== 'pending');
      if (mounted.current && nrRows.length > 0 && nrRows.every(r => r.status === 'nocov')) {
        Alert.alert(
          '5G ما اشتغل',
          'جربنا ترددات 5G مع تحميل عشان تصحى، وما نشط ولا واحد.\nلو البرج يدعم 5G، الأرجح أن شريحتك أو باقتك ما تدعم 5G — تواصل مع شركة الاتصالات.',
          [{ text: 'حسناً' }],
        );
      }
      if (mounted.current) {
        setScanning(false);
        setScanAt(at);
        setScan(rows.filter(r => r.status !== 'pending'));
        await load(info);
      }
    }
  };

  const startDeepScan = () => {
    if (!cfg) return;
    const preferred = SCAN_PREFERRED.filter(b => cfg.supported.includes(b));
    const lte = selected.length ? selected : preferred.length ? preferred : cfg.supported;
    // 5G يدخل تلقائياً: المختار، وإلا الشائعة عندنا من المدعومة
    const NR_COMMON = [78, 41, 40, 28, 1, 3];
    const nr = nrSelected.length
      ? nrSelected
      : NR_COMMON.filter(b => cfg.nrSupported.includes(b)).slice(0, 4);
    const targets: { tech: 'LTE' | 'NR'; band: number }[] = [
      ...lte.map(b => ({ tech: 'LTE' as const, band: b })),
      ...nr.map(b => ({ tech: 'NR' as const, band: b })),
    ];
    const label = targets.map(x => bandLabel(x.tech, x.band)).join(' + ');
    const mins = Math.ceil((targets.length * 45) / 60);
    Alert.alert(
      'الفحص الدقيق',
      `بنجرب ${targets.length} ترددات (${label}).\nياخذ حوالي ${mins} دقائق، والإنترنت بينقطع أثناء الفحص.${nr.length ? `\nترددات 5G نقيسها مع تحميل قصير (حوالي ${nr.length * 30} ميقا) عشان تصحى.` : ''}\nبعد ما يخلص نرجع إعدادك الحالي تلقائياً.`,
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'ابدأ', onPress: () => runScan(targets) }],
    );
  };

  const changeMode = (mode: string) => {
    if (!info || !cfg || mode === cfg.mode || busy || scanning) return;
    const label = cfg.modes.find(m => m.value === mode)?.label ?? mode;
    Alert.alert('وضع الشبكة', `تبي تحول إلى "${label}"؟ الإنترنت بينقطع لحظات.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تحويل', onPress: async () => {
          const prev = cfg.mode;
          cancelRef.current = false;
          setBusy(true);
          setError('');
          try {
            setStatus('نغيّر وضع الشبكة...');
            await withSession(info, d => d.setNetworkMode!(mode), false);
            setStatus('ننتظر الاتصال...');
            const ok = await waitConnected(info, [], 45000);
            if (!ok) {
              setStatus('ما اتصل — نرجع الإعداد السابق...');
              await withSession(info, d => d.setNetworkMode!(prev), false);
              Alert.alert('ما نجح التحويل', 'الراوتر ما اتصل على الوضع المختار، فرجعنا الإعداد السابق.');
            }
            await load(info);
          } catch (e: any) {
            setError(e?.message ?? String(e));
          } finally {
            if (mounted.current) { setBusy(false); setStatus(''); }
          }
        },
      },
    ]);
  };

  const toggle = (b: number) => {
    if (busy || scanning) return;
    setSelected(sel => (sel.includes(b) ? sel.filter(x => x !== b) : [...sel, b].sort((x, y) => x - y)));
  };

  // ---------- المشتقّات ----------
  const [showAll, setShowAll] = useState(false);
  const active = bandNums(signal?.band);
  const knownBands = new Set<number>([...active, ...seen]);
  const displayedBands = showAll
    ? (cfg?.supported ?? [])
    : (cfg?.supported ?? []).filter(b => knownBands.has(b));
  const level = overallLevel(signal);
  const locked = busy || scanning;
  const dirty = cfg ? selected.join(',') !== cfg.locked.join(',') : false;
  const nrDirty = cfg ? nrSelected.join(',') !== cfg.nrLocked.join(',') : false;

  const deepDone: Result[] = scan
    .filter(r => r.status === 'done' && r.score !== undefined)
    .map(r => ({ tech: r.tech, band: r.band, rsrp: r.rsrp, sinr: r.sinr, score: r.score ?? 0, live: false }));

  /** الفحص الدقيق أدق، فله الأولوية إذا فيه نتائج */
  const usingDeep = deepDone.length > 0;
  const results: Result[] = (usingDeep
    ? deepDone
    : quick.map(q => ({ tech: q.tech, band: q.band, rsrp: q.rsrp, sinr: q.sinr, score: q.score, live: q.live })))
    .sort((a, b) => b.score - a.score);
  const resultsAt = usingDeep ? scanAt : quickAt;
  const best = results.find(r => r.score > 0);
  const bestIsCurrent = !!best && (best.tech === 'LTE'
    ? cfg?.locked.length === 1 && cfg.locked[0] === best.band
    : cfg?.nrLocked.length === 1 && cfg.nrLocked[0] === best.band);

  const verdict = (() => {
    if (!cfg) return '';
    const where = active.length ? names(active) : '—';
    if (cfg.locked.length) return `أنت مثبّت على ${names(cfg.locked)}، والإشارة ${LEVEL_LABEL[level]}.`;
    return `الراوتر يختار التردد بنفسه، وهو الآن على ${where} والإشارة ${LEVEL_LABEL[level]}.`;
  })();

  const modeLabel = cfg?.modes.find(m => m.value === cfg.mode)?.label ?? '';

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        {loading && (
          <View style={{ gap: S.lg }}>
            <View style={s.skelCard}>
              <Skeleton w={90} h={24} radius={R.pill} />
              <Skeleton h={54} radius={R.md} />
              <Skeleton w={'80%'} h={12} />
            </View>
            <Skeleton h={44} radius={R.md} />
            <Skeleton h={78} radius={R.lg} />
          </View>
        )}

        {!!error && (
          <ErrorCard
            message={error}
            hint="تأكد أن جوالك متصل بشبكة الراوتر نفسها."
            onRetry={info ? () => load(info) : undefined}
            retrying={locked}
          />
        )}

        {!!status && (
          <View style={s.statusCard}>
            <Text style={s.statusText}>{status}</Text>
            <ActivityIndicator color={C.blue} />
          </View>
        )}

        {/* ═════ المرحلة ١ — الاتصال الحالي ═════ */}
        {!loading && cfg && (
          <Stage n={1} title="الاتصال الحالي" sub="وين أنت الحين">
            <HeroCard>
              <View style={s.heroTop}>
                <View style={[s.pill, { backgroundColor: LEVEL_COLOR[level] }]}>
                  <Text style={s.pillText}>{LEVEL_LABEL[level]}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                  <Text style={s.heroBand}>{active.length ? names(active) : '—'}</Text>
                  <Text style={s.heroFreq}>
                    {active.length === 1 ? bandFreq(active[0]) : `${active.length || 0} تردد نشط`}
                    {signal?.nrBand ? ` · ${signal.nrBand}` : ''}
                  </Text>
                </View>
              </View>

              <View style={s.statRow}>
                <View style={s.stat}>
                  <Text style={s.statVal}>{signal?.sinr ?? '—'}</Text>
                  <Text style={s.statKey}>SINR</Text>
                </View>
                <View style={s.statDiv} />
                <View style={s.stat}>
                  <Text style={s.statVal}>{signal?.rsrp ?? '—'}</Text>
                  <Text style={s.statKey}>RSRP</Text>
                </View>
                <View style={s.statDiv} />
                <View style={s.stat}>
                  <Text style={[s.statVal, { fontSize: 15 }]}>{cfg.locked.length ? 'مثبّت' : 'تلقائي'}</Text>
                  <Text style={s.statKey}>الوضع</Text>
                </View>
              </View>

              <Text style={s.verdict}>{verdict}</Text>

              {cfg.locked.length > 0 && (
                <Pressable style={[s.ghost, locked && s.off]} onPress={() => confirmApply([])} disabled={locked}>
                  <Text style={s.ghostText}>إلغاء التثبيت</Text>
                </Pressable>
              )}
            </HeroCard>
          </Stage>
        )}

        {/* ═════ المرحلة ٢ — اكتشاف أفضل تردد ═════ */}
        {!loading && cfg && (
          <Stage
            n={2}
            title="اكتشاف أفضل تردد"
            sub={resultsAt ? `آخر فحص ${fmtTime(resultsAt)}` : 'ما فحصنا بعد'}
          >
            <MetricCard>
              {!scanning ? (
                <Pressable
                  style={[s.primary, (quickBusy || locked) && s.off]}
                  onPress={() => runQuickScan()}
                  disabled={quickBusy || locked}
                >
                  <Icon name="spark" size={16} color={C.onAccent} />
                  <Text style={s.primaryText}>{quickBusy ? 'نفحص...' : 'فحص'}</Text>
                </Pressable>
              ) : (
                <Pressable style={[s.ghost, { borderColor: C.red }]} onPress={() => { cancelRef.current = true; }}>
                  <Text style={[s.ghostText, { color: C.red }]}>إيقاف الفحص</Text>
                </Pressable>
              )}

              <Text style={s.hint}>
                الفحص السريع يقرأ الأبراج المجاورة وأنت متصل — ثوانٍ وبدون انقطاع.
              </Text>

              {/* التوصية */}
              {best && !scanning && (
                <View style={s.rec}>
                  <View style={s.recHead}>
                    <Text style={s.recTag}>التوصية</Text>
                    <Text style={s.recBand}>{bandLabel(best.tech, best.band)}</Text>
                  </View>
                  <Text style={s.recLine}>
                    {bestIsCurrent
                      ? `أنت أصلاً على أقوى تردد متاح (${freqLabel(best.tech, best.band)}). ما فيه داعي تغيّر شي.`
                      : `أقوى تردد عندك الحين هو ${bandLabel(best.tech, best.band)} (${freqLabel(best.tech, best.band)})` +
                        `${best.rsrp !== undefined ? ` بقوة ${best.rsrp} dBm` : ''}. تثبيت عليه يمنع الراوتر يتنقل لتردد أضعف.`}
                  </Text>
                  {!bestIsCurrent && (
                    <Pressable style={[s.primary, locked && s.off]} onPress={() => applyResult(best)} disabled={locked}>
                      <Text style={s.primaryText}>تثبيت على {bandLabel(best.tech, best.band)}</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {resultsAt && results.length === 0 && !quickBusy && !scanning && (
                <Text style={s.hint}>ما رجّع الراوتر أبراج مجاورة — جرّب الفحص الدقيق من التحكم المتقدم.</Text>
              )}

              {/* النتائج */}
              {results.map((r, i) => {
                const lvl = overallLevel(r);
                const color = LEVEL_COLOR[lvl];
                return (
                  <View key={'r' + r.tech + r.band} style={s.row}>
                    <View style={s.rowHead}>
                      <View style={s.rowState}>
                        <Text style={[s.rowNote, { color }]}>{LEVEL_LABEL[lvl]}</Text>
                        {i === 0 && <View style={s.tag}><Text style={s.tagText}>الأقوى</Text></View>}
                        {r.live && <View style={s.dot} />}
                      </View>
                      <View style={s.rowBand}>
                        <Text style={s.rowFreq}>{freqLabel(r.tech, r.band)}</Text>
                        <Text style={[s.rowName, r.tech === 'NR' && { color: C.violet }]}>{bandLabel(r.tech, r.band)}</Text>
                      </View>
                    </View>
                    <View style={s.barBg}>
                      <View style={[s.bar, { width: `${Math.round(r.score * 100)}%` as const, backgroundColor: color }]} />
                    </View>
                    <Text style={s.rowVals}>RSRP {r.rsrp ?? '—'} dBm · SINR {r.sinr ?? '—'} dB</Text>
                  </View>
                );
              })}

              {/* تقدّم الفحص الدقيق */}
              {scanning && scan.map(r => (
                <View key={'p' + r.tech + r.band} style={s.row}>
                  <View style={s.rowHead}>
                    <View style={s.rowState}>
                      {r.status === 'testing' && <ActivityIndicator size="small" color={C.blue} />}
                      <Text style={[
                        s.rowNote,
                        (r.status === 'nocov' || r.status === 'error') && { color: C.red },
                        r.status === 'done' && { color: C.green },
                      ]}>
                        {r.status === 'done' ? 'تم' : r.status === 'pending' ? 'بالانتظار' : r.note}
                      </Text>
                    </View>
                    <View style={s.rowBand}>
                      <Text style={s.rowFreq}>{freqLabel(r.tech, r.band)}</Text>
                      <Text style={[s.rowName, r.tech === 'NR' && { color: C.violet }]}>{bandLabel(r.tech, r.band)}</Text>
                    </View>
                  </View>
                </View>
              ))}

              {scanning && <Text style={s.warn}>إذا طلعت من الشاشة يوقف الفحص ويرجع إعدادك</Text>}
              {usingDeep && !scanning && <Text style={s.hint}>هذي نتائج الفحص الدقيق — قياس فعلي من كل تردد.</Text>}
            </MetricCard>
          </Stage>
        )}

        {/* ═════ المرحلة ٣ — التحكم المتقدم ═════ */}
        {!loading && cfg && (
          <Stage
            n={3}
            title="التحكم المتقدم"
            sub={advanced ? 'اختيار يدوي — للمتمرّسين' : 'اضغط للفتح'}
            right={
              <Pressable onPress={() => setAdvanced(v => !v)} hitSlop={10} style={st.toggle}>
                <Icon name={advanced ? 'up' : 'down'} size={16} color={C.blue} />
              </Pressable>
            }
          >
            {!advanced ? (
              <Pressable style={s.collapsed} onPress={() => setAdvanced(true)}>
                <Text style={s.collapsedText}>
                  وضع الشبكة{modeLabel ? ` (${modeLabel})` : ''} · الاختيار اليدوي · ترددات 5G · الفحص الدقيق
                </Text>
              </Pressable>
            ) : (
              <View style={{ gap: S.md }}>

                {/* وضع الشبكة */}
                {cfg.modes.length > 1 && (
                  <MetricCard>
                    <Text style={s.blockTitle}>وضع الشبكة</Text>
                    <Text style={s.hint}>تحديد نوع الشبكة اللي يستخدمها الراوتر. في بعض المناطق 4G ثابت أفضل من 5G متذبذب.</Text>
                    <View style={s.wrap}>
                      {cfg.modes.map(m => {
                        const on = m.value === cfg.mode;
                        return (
                          <Pressable key={m.value} style={[s.chip, on && s.chipOn]} onPress={() => changeMode(m.value)} disabled={locked}>
                            <Text style={[s.chipText, on && { color: C.onAccent }]}>{m.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </MetricCard>
                )}

                {/* الاختيار اليدوي 4G */}
                <MetricCard>
                  <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={s.blockTitle}>ترددات 4G</Text>
                    <Pressable onPress={() => setShowAll(v => !v)} hitSlop={8}>
                      <Text style={{ color: C.blue, fontSize: 12, fontWeight: '800' }}>
                        {showAll ? 'عرض الفعّالة فقط' : 'عرض الكل'}
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={s.hint}>اختيار أكثر من تردد يسمح للراوتر يجمع بينهم (4G+). النقطة الخضراء = متصل الآن.</Text>
                  <View style={s.grid}>
                    {displayedBands.map(b => {
                      const on = selected.includes(b);
                      const live = active.includes(b);
                      const known = live || seen.includes(b);
                      return (
                        <Pressable key={b} style={[s.bandCard, on && s.bandCardOn, locked && { opacity: 0.6 }]} onPress={() => toggle(b)}>
                          <View style={[s.miniCheck, on && s.miniCheckOn]}>
                            {on && <Text style={s.checkMark}>✓</Text>}
                          </View>
                          <View style={{ flex: 1, alignItems: 'flex-end' }}>
                            <Text style={[s.bandNameSm, on && { color: C.onAccent }]}>B{b}</Text>
                            <Text style={[s.bandFreqSm, on && { color: C.onAccentSoft }]}>{bandFreq(b)?.replace(' MHz', '') || '—'}</Text>
                          </View>
                          {live && <View style={s.bandLiveDotSm} />}
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={s.btnRow}>
                    <Pressable
                      style={[s.ghost, (locked || !cfg.locked.length) && s.off]}
                      onPress={() => confirmApply([])}
                      disabled={locked || !cfg.locked.length}
                    >
                      <Text style={s.ghostText}>إلغاء التثبيت</Text>
                    </Pressable>
                    <Pressable
                      style={[s.primary, (locked || !selected.length || !dirty) && s.off]}
                      onPress={() => confirmApply(selected)}
                      disabled={locked || !selected.length || !dirty}
                    >
                      <Text style={s.primaryText}>تثبيت</Text>
                    </Pressable>
                  </View>
                </MetricCard>

                {/* ترددات 5G */}
                {cfg.nrSupported.length > 0 && (
                  <MetricCard>
                    <Text style={s.blockTitle}>ترددات 5G</Text>
                    <Text style={s.hint}>
                      تثبيت مستقل عن 4G. التثبيت على تردد ما فيه تغطية يوقف 5G تماماً — تأكد من الفحص أولاً.
                    </Text>
                    <View style={s.grid}>
                      {cfg.nrSupported.map(b => {
                        const on = nrSelected.includes(b);
                        return (
                          <Pressable
                            key={'n' + b}
                            style={[s.bandCard, on && s.bandCardNrOn, locked && { opacity: 0.6 }]}
                            onPress={() => {
                              if (locked) return;
                              setNrSelected(sel => (sel.includes(b) ? sel.filter(x => x !== b) : [...sel, b].sort((x, y) => x - y)));
                            }}
                          >
                            <View style={[s.miniCheck, on && s.miniCheckNrOn]}>
                              {on && <Text style={s.checkMarkNr}>✓</Text>}
                            </View>
                            <View style={{ flex: 1, alignItems: 'flex-end' }}>
                              <Text style={[s.bandNameSm, on && { color: C.onAccent }]}>n{b}</Text>
                              <Text style={[s.bandFreqSm, on && { color: C.onAccentSoft }]}>{nrFreq(b)?.replace(' MHz', '') || '—'}</Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={s.btnRow}>
                      <Pressable
                        style={[s.ghost, (locked || !cfg.nrLocked.length) && s.off]}
                        onPress={() => confirmApplyNr([])}
                        disabled={locked || !cfg.nrLocked.length}
                      >
                        <Text style={s.ghostText}>إلغاء التثبيت</Text>
                      </Pressable>
                      <Pressable
                        style={[s.primary, (locked || !nrSelected.length || !nrDirty) && s.off]}
                        onPress={() => confirmApplyNr(nrSelected)}
                        disabled={locked || !nrSelected.length || !nrDirty}
                      >
                        <Text style={s.primaryText}>تثبيت</Text>
                      </Pressable>
                    </View>
                  </MetricCard>
                )}

                {/* الفحص الدقيق */}
                <MetricCard>
                  <Text style={s.blockTitle}>الفحص الدقيق</Text>
                  <Text style={s.hint}>
                    {selected.length
                      ? `يجرّب الترددات المختارة فعلياً: ${names(selected)}`
                      : 'يجرّب الترددات المنتشرة واحداً واحداً ويقيس كل واحد. أدق من الفحص السريع، لكن الإنترنت ينقطع أثناءه.'}
                  </Text>
                  <Pressable style={[s.ghost, locked && s.off]} onPress={startDeepScan} disabled={locked}>
                    <Text style={s.ghostText}>ابدأ الفحص الدقيق</Text>
                  </Pressable>
                </MetricCard>

              </View>
            )}
          </Stage>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: S.sm },
  num: { width: 22, height: 22, borderRadius: R.pill, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  numText: { color: C.onAccent, fontWeight: '800', fontSize: T.label },
  title: { color: C.text, fontWeight: '800', fontSize: T.h2, textAlign: 'right' },
  sub: { color: C.muted, fontSize: T.tiny + 0.5, textAlign: 'right', marginTop: 1 },
  toggle: { width: 30, height: 30, borderRadius: R.sm, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' },
});

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.xl },
  skelCard: {
    backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line,
    padding: S.lg, gap: S.md, alignItems: 'flex-end',
  },
  statusCard: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: S.sm,
    backgroundColor: C.blueSoft, borderColor: C.line, borderWidth: 1, borderRadius: R.lg, padding: S.md,
  },
  statusText: { color: C.blue, fontWeight: '700', textAlign: 'right', flexShrink: 1 },

  // المرحلة ١
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.md },
  pill: { borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: 5 },
  pillText: { color: '#fff', fontWeight: '800', fontSize: T.label },
  heroBand: { color: C.text, fontWeight: '800', fontSize: T.h1 },
  heroFreq: { color: C.sub, fontSize: T.label, marginTop: 2 },
  statRow: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: C.card, borderRadius: R.md, paddingVertical: S.sm },
  stat: { flex: 1, alignItems: 'center', gap: 1 },
  statVal: { color: C.text, fontWeight: '800', fontSize: T.h2 },
  statKey: { color: C.muted, fontSize: T.tiny },
  statDiv: { width: 1, height: 22, backgroundColor: C.lineSoft },
  verdict: { color: C.text, fontSize: T.body, textAlign: 'right', lineHeight: 21 },

  // المرحلة ٢
  rec: { backgroundColor: C.blueSoft, borderRadius: R.md, padding: S.md, gap: S.sm },
  recHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: S.sm },
  recTag: { color: C.blue, fontWeight: '800', fontSize: T.tiny, backgroundColor: C.card, borderRadius: R.sm, paddingHorizontal: 7, paddingVertical: 2 },
  recBand: { color: C.text, fontWeight: '800', fontSize: T.h2 },
  recLine: { color: C.text, fontSize: T.label + 0.5, textAlign: 'right', lineHeight: 20 },

  row: { backgroundColor: C.rowBg, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: S.md, gap: 7 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowState: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  rowNote: { color: C.sub, fontWeight: '700', fontSize: T.label },
  rowBand: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  rowName: { color: C.text, fontWeight: '800', fontSize: T.h2 },
  rowFreq: { color: C.muted, fontSize: T.tiny + 0.5 },
  rowVals: { color: C.sub, fontSize: T.tiny + 1, textAlign: 'right' },
  barBg: { height: 7, borderRadius: 4, backgroundColor: C.track, overflow: 'hidden' },
  bar: { height: 7, borderRadius: 4 },
  tag: { backgroundColor: C.green, borderRadius: R.pill, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { color: '#fff', fontWeight: '800', fontSize: T.tiny },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green },

  // المرحلة ٣
  collapsed: { backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: S.md },
  collapsedText: { color: C.muted, fontSize: T.label, textAlign: 'right' },
  blockTitle: { color: C.text, fontWeight: '800', fontSize: T.body + 1, textAlign: 'right' },
  wrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderColor: C.line, backgroundColor: C.rowBg, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: 8 },
  chipOn: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { color: C.text, fontWeight: '700', fontSize: T.label + 0.5 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  band: {
    flexBasis: '22%', flexGrow: 1, alignItems: 'center', paddingVertical: 9, borderRadius: R.md,
    backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.line,
  },
  bandOn: { backgroundColor: C.blue, borderColor: C.blue },
  bandCard: {
    flexBasis: '31%',
    flexGrow: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: R.md,
    backgroundColor: C.rowBg,
    borderWidth: 1.5,
    borderColor: C.line,
  },
  bandCardOn: { backgroundColor: C.blue, borderColor: C.blue },
  bandCardNrOn: { backgroundColor: C.violet, borderColor: C.violet },
  miniCheck: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.8,
    borderColor: C.line,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniCheckOn: { borderColor: C.card },
  miniCheckNrOn: { borderColor: C.card },
  checkMark: { color: C.blue, fontWeight: '900', fontSize: 12, lineHeight: 13 },
  checkMarkNr: { color: C.violet, fontWeight: '900', fontSize: 12, lineHeight: 13 },
  bandNameSm: { color: C.text, fontWeight: '800', fontSize: 14, lineHeight: 15 },
  bandFreqSm: { color: C.muted, fontSize: 10.5, marginTop: 1 },
  bandLiveDotSm: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.green,
  },
  band2: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: R.md,
    backgroundColor: C.rowBg,
    borderWidth: 1.5,
    borderColor: C.line,
  },
  band2On: { backgroundColor: C.blue, borderColor: C.blue },
  band2NrOn: { backgroundColor: C.violet, borderColor: C.violet },
  bandLiveDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: C.green,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: C.line,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.card, borderColor: C.card },
  checkNrOn: { backgroundColor: C.card, borderColor: C.card },
  checkMark: { color: C.blue, fontWeight: '900', fontSize: 16, lineHeight: 18 },
  bandName: { color: C.text, fontWeight: '800', fontSize: T.body + 1 },
  bandFreq: { color: C.muted, fontSize: T.tiny, marginTop: 1 },
  bandUnknown: { color: C.muted, fontSize: T.tiny - 1, marginTop: 1 },
  bandDot: { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 4, backgroundColor: C.green },

  // مشترك
  hint: { color: C.muted, fontSize: T.label, textAlign: 'right', lineHeight: 18 },
  warn: { color: C.gold, fontSize: T.label, textAlign: 'center', fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: S.sm },
  primary: {
    flex: 1, backgroundColor: C.blue, borderRadius: R.md, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row-reverse', gap: 7,
  },
  primaryText: { color: C.onAccent, fontWeight: '800', fontSize: T.body + 1 },
  ghost: { flex: 1, borderWidth: 1, borderColor: C.blue, borderRadius: R.md, paddingVertical: 12, alignItems: 'center' },
  ghostText: { color: C.blue, fontWeight: '800', fontSize: T.body + 0.5 },
  off: { opacity: 0.4 },
});
