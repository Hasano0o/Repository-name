import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
// HAPTICS_SAFE: الاهتزاز اختياري — لو المكتبة ناقصة تشتغل الشاشة بدونه
let HapticsMod: any = null;
try { HapticsMod = require('expo-haptics'); } catch { HapticsMod = null; }
const Haptics = {
  ImpactFeedbackStyle: HapticsMod?.ImpactFeedbackStyle ?? { Heavy: 'heavy', Medium: 'medium', Light: 'light' },
  NotificationFeedbackType: HapticsMod?.NotificationFeedbackType ?? { Success: 'success' },
  impactAsync: (s: any) => (HapticsMod?.impactAsync ? HapticsMod.impactAsync(s) : Promise.resolve()),
  notificationAsync: (s: any) => (HapticsMod?.notificationAsync ? HapticsMod.notificationAsync(s) : Promise.resolve()),
};
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Signal, CellTower, CellLockTarget } from '../../src/drivers/types';
import { LEVEL_COLOR, LEVEL_LABEL, overallLevel, signalScore, parseBands, parseNrBands } from '../../src/utils/signal';
import { C } from '../../src/ui/theme';
import { linkHealth } from '../../src/utils/linkHealth';
import { LinkHealthChips } from '../../src/ui/LinkHealth';
import { trafficBurst } from '../../src/utils/nrprobe';
import { AimBeeper } from '../../src/utils/aimSound';
import { GlassCard } from '../../src/ui/GlassCard';
import { SignalRing } from '../../src/ui/SignalRing';
import { TimeChart, Series } from '../../src/ui/TimeChart';

type Tech = 'LTE' | 'NR';

/** خلية محددة: تقنية + تردد + PCI — عشان نعرف القراءة من أي برج */
interface CellId { tech: Tech; band?: number; pci?: string; arfcn?: string; }

interface Reading {
  t: number;
  rsrp?: number;
  sinr?: number;
  /** متوسط آخر ٣ قراءات على نفس الخلية — أثبت من القراءة اللحظية */
  smooth?: number;
  score: number;
  cell: CellId;
}

const MAX_POINTS = 90;
const SMOOTH_N = 3;

const cellKey = (c?: CellId | null) => (c ? `${c.tech}:${c.band ?? '?'}:${c.pci ?? '?'}` : '');
const cellName = (c?: CellId | null) => {
  if (!c) return '—';
  const b = c.band ? (c.tech === 'NR' ? `n${c.band}` : `B${c.band}`) : c.tech === 'NR' ? '5G' : '4G';
  return c.pci ? `${b} · PCI ${c.pci}` : b;
};

/** يستخرج قراءة التقنية المختارة من إشارة الراوتر — بدون خلط 4G و5G */
function readOf(sig: Signal, tech: Tech): { rsrp?: number; sinr?: number; cell: CellId } | null {
  if (tech === 'NR') {
    if (sig.nrRsrp === undefined) return null;
    const m = (sig.nrBand ?? '').match(/(\d+)/);
    return {
      rsrp: sig.nrRsrp, sinr: sig.nrSinr,
      cell: { tech: 'NR', band: m ? parseInt(m[1], 10) : undefined, pci: sig.nrPci, arfcn: sig.nrArfcn },
    };
  }
  if (sig.rsrp === undefined) return null;
  const b = parseBands(sig.band).find(x => x.startsWith('B'));
  return {
    rsrp: sig.rsrp, sinr: sig.sinr,
    cell: { tech: 'LTE', band: b ? parseInt(b.slice(1), 10) : undefined, pci: sig.pci, arfcn: sig.earfcn },
  };
}

export default function AimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [tech, setTech] = useState<Tech>('LTE');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [best, setBest] = useState<Reading | null>(null);
  const [haptics, setHaptics] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nrSeen, setNrSeen] = useState(false);
  const [nrCell, setNrCell] = useState<CellTower | null>(null);
  const [nrBest, setNrBest] = useState<number | null>(null);
  const [pinned, setPinned] = useState<CellId | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [canPin, setCanPin] = useState(false);
  /** 5G ما اتصل لكن نقرأ برج 5G مجاور (يظهر وقت التحميل) */
  const [nrNb, setNrNb] = useState(false);
  const [waking, setWaking] = useState<number | null>(null);
  const wakeStop = useRef(false);
  useEffect(() => () => { wakeStop.current = true; }, []);

  const busy = useRef(false);
  const lastPulse = useRef(0);
  const hapticsRef = useRef(true);
  const techRef = useRef<Tech>('LTE');
  const bestRef = useRef<Reading | null>(null);
  const recentRef = useRef<Reading[]>([]);
  const nrRef = useRef(false);
  const nrBestRef = useRef<number | null>(null);
  const cellTick = useRef(0);
  const nrUsableRef = useRef(false);
  /** تثبيت مؤقت أثناء التوجيه — يُفك تلقائياً عند الخروج */
  const tempPinRef = useRef(false);
  const infoRef = useRef<SavedRouter | null>(null);

  useEffect(() => { hapticsRef.current = haptics; }, [haptics]);

  // وضع الصوت: نغمات تتقارب كل ما تحسنت الإشارة (مثل حساس الركن)
  const [sound, setSound] = useState(false);
  const beeperRef = useRef<AimBeeper | null>(null);
  useEffect(() => {
    if (!sound) return;
    const b = new AimBeeper();
    beeperRef.current = b;
    b.start();
    return () => { b.stop(); beeperRef.current = null; };
  }, [sound]);
  useEffect(() => { techRef.current = tech; }, [tech]);

  const pulse = useCallback((score: number) => {
    if (!hapticsRef.current) return;
    const now = Date.now();
    const gap = 1400 - Math.round(score * 1100);
    if (now - lastPulse.current < gap) return;
    lastPulse.current = now;
    const style = score > 0.75
      ? Haptics.ImpactFeedbackStyle.Heavy
      : score > 0.45
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
    Haptics.impactAsync(style).catch(() => {});
  }, []);

  const tick = useCallback(async (r: SavedRouter) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const sig = await withSession(r, async d => {
        setCanPin(typeof d.lockCell === 'function' && typeof d.unlockCell === 'function');
        return d.getSignal ? d.getSignal() : null;
      });
      if (!sig) return;
      setSignal(sig);
      setError('');

      if (sig.nrRsrp !== undefined && !nrRef.current) {
        nrRef.current = true;
        setNrSeen(true);
        if (hapticsRef.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }

      let rd = readOf(sig, techRef.current);
      // 5G ما اتصل: نوجّه على أقوى برج 5G مجاور يشوفه الراوتر (يظهر وقت التحميل)
      if (!rd && techRef.current === 'NR') {
        try {
          const cells = await withSession(r, d => (d.getCells ? d.getCells() : Promise.resolve([] as CellTower[])));
          const top = cells.filter(c => c.tech === 'NR' && c.rsrp !== undefined)
            .sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))[0];
          if (top) {
            setNrCell(top);
            rd = { rsrp: top.rsrp, sinr: top.sinr, cell: { tech: 'NR', band: top.band, pci: top.pci, arfcn: top.arfcn } };
          }
        } catch {}
        setNrNb(!!rd);
      } else if (techRef.current === 'NR') {
        setNrNb(false);
      }
      if (rd) {
        // المتوسط على نفس الخلية فقط — لو تغيّر البرج نبدأ من جديد
        const key = cellKey(rd.cell);
        const recent = recentRef.current.filter(x => cellKey(x.cell) === key);
        const vals = [...recent.slice(-(SMOOTH_N - 1)).map(x => x.rsrp), rd.rsrp]
          .filter((n): n is number => n !== undefined);
        const smooth = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : undefined;
        const score = signalScore({ rsrp: smooth ?? rd.rsrp, sinr: rd.sinr });
        const reading: Reading = { t: Date.now(), rsrp: rd.rsrp, sinr: rd.sinr, smooth, score, cell: rd.cell };
        recentRef.current = [...recent, reading].slice(-SMOOTH_N);

        setReadings(list => [...list, reading].slice(-MAX_POINTS));
        setBaseline(b => (b === null ? (smooth ?? rd.rsrp ?? null) : b));

        // أفضل نقطة تُحسب من المتوسط وبعد ٣ قراءات على الأقل — مو من قفزة لحظية
        if (vals.length >= SMOOTH_N && (!bestRef.current || score > bestRef.current.score)) {
          bestRef.current = reading;
          setBest(reading);
        }
        pulse(score);
        beeperRef.current?.update(score);
      }

      if (Date.now() - cellTick.current > 3000) {
        cellTick.current = Date.now();
        try {
          const cells = await withSession(r, d => (d.getCells ? d.getCells() : Promise.resolve([] as CellTower[])));
          const nrs = cells.filter(c => c.tech === 'NR' && c.rsrp !== undefined);
          const top = nrs.sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))[0] ?? null;
          setNrCell(top);
          if (top?.rsrp !== undefined) {
            if (nrBestRef.current === null || top.rsrp > nrBestRef.current) {
              nrBestRef.current = top.rsrp;
              setNrBest(top.rsrp);
            }
            if (top.rsrp > -110 && !nrUsableRef.current) {
              nrUsableRef.current = true;
              if (hapticsRef.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            }
          }
        } catch {}
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      busy.current = false;
    }
  }, [pulse]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      infoRef.current = r;
      await tick(r);
      if (!alive) return;
      setLoading(false);
      timer = setInterval(() => tick(r), 1000);
    })();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      // فك التثبيت المؤقت عند الخروج
      if (tempPinRef.current && infoRef.current) {
        tempPinRef.current = false;
        withSession(infoRef.current, d => (d.unlockCell ? d.unlockCell() : Promise.resolve()), false).catch(() => {});
      }
    };
  }, [id, tick]));

  const reset = () => {
    bestRef.current = null;
    recentRef.current = [];
    nrRef.current = false;
    setBest(null);
    setReadings([]);
    const rd = signal ? readOf(signal, techRef.current) : null;
    setBaseline(rd?.rsrp ?? null);
    setNrSeen(false);
    nrBestRef.current = null;
    nrUsableRef.current = false;
    setNrBest(null);
  };

  const switchTech = (t: Tech) => {
    if (t === tech) return;
    setTech(t);
    techRef.current = t;
    bestRef.current = null;
    recentRef.current = [];
    setBest(null);
    setReadings([]);
    setBaseline(null);
  };

  /** ينتظر الاتصال بعد التثبيت، ولو ما رجع يفك التثبيت تلقائياً */
  const lockAndVerify = async (r: SavedRouter, target: CellLockTarget): Promise<boolean> => {
    await withSession(r, d => d.lockCell!(target), false);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await new Promise(res => setTimeout(res, 3000));
      try {
        const ok = await withSession(r, async d => {
          const conn = d.isConnected ? await d.isConnected() : true;
          const sg = conn && d.getSignal ? await d.getSignal() : null;
          return conn && !!sg && (sg.rsrp !== undefined || sg.nrRsrp !== undefined);
        }, false);
        if (ok) return true;
      } catch {}
    }
    try { await withSession(r, d => d.unlockCell!(), false); } catch {}
    return false;
  };

  const toTarget = (c: CellId): CellLockTarget | null =>
    c.pci ? { tech: c.tech, band: c.band, arfcn: c.arfcn, pci: c.pci } : null;

  /** يثبّت البرج الحالي أثناء التوجيه عشان الراوتر ما يتنقل والأرقام تصير قابلة للمقارنة */
  const pinDuringAim = async () => {
    if (!info || pinBusy) return;
    if (pinned) {
      setPinBusy(true);
      try {
        await withSession(info, d => d.unlockCell!(), false);
        setPinned(null);
        tempPinRef.current = false;
      } catch (e: any) {
        Alert.alert('ما انفك التثبيت', e?.message ?? String(e));
      } finally { setPinBusy(false); }
      return;
    }
    const rd = signal ? readOf(signal, tech) : null;
    const target = rd ? toTarget(rd.cell) : null;
    if (!rd || !target) { Alert.alert('غير متاح', 'ما قدرنا نعرف رقم البرج الحالي (PCI) — ما نقدر نثبّت عليه.'); return; }
    setPinBusy(true);
    try {
      const ok = await lockAndVerify(info, target);
      if (ok) {
        setPinned(rd.cell);
        tempPinRef.current = true;
        reset();
      } else {
        Alert.alert('ما نجح التثبيت', 'الراوتر ما ثبت على البرج، فرجّعناه للوضع التلقائي.');
      }
    } catch (e: any) {
      Alert.alert('ما نجح التثبيت', e?.message ?? String(e));
    } finally { setPinBusy(false); }
  };

  /** يثبّت نهائياً على برج أفضل نقطة (يبقى بعد الخروج من الشاشة) */
  const pinBest = () => {
    if (!info || !best) return;
    const target = toTarget(best.cell);
    if (!target) { Alert.alert('غير متاح', 'ما عندنا رقم هذا البرج (PCI) — ما نقدر نثبّت عليه.'); return; }
    Alert.alert(
      'ثبّت على برج أفضل نقطة',
      `بنثبّت الراوتر على ${cellName(best.cell)} ويبقى مثبّت بعد ما تطلع من الشاشة.\n\nلو ما اتصل خلال ٣٠ ثانية نرجّعه تلقائياً. وتقدر تفك التثبيت من شاشة الأبراج.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ثبّت', onPress: async () => {
            setPinBusy(true);
            try {
              const ok = await lockAndVerify(info, target);
              if (ok) {
                setPinned(best.cell);
                tempPinRef.current = false; // دائم — ما نفكه عند الخروج
                Alert.alert('تم', `الراوتر مثبّت على ${cellName(best.cell)}`);
              } else {
                Alert.alert('ما نجح التثبيت', 'الراوتر ما اتصل على هذا البرج، فرجّعناه للوضع التلقائي.');
              }
            } catch (e: any) {
              Alert.alert('ما نجح التثبيت', e?.message ?? String(e));
            } finally { setPinBusy(false); }
          },
        },
      ],
    );
  };

  const current = readings[readings.length - 1];
  const shown = current?.smooth ?? current?.rsrp;
  const level = overallLevel(current ? { rsrp: shown, sinr: current.sinr } : null);
  const delta = shown !== undefined && baseline !== null ? shown - baseline : undefined;
  const bands = parseBands(signal?.band);
  const nrBands = parseNrBands(signal?.nrBand);
  const nrActive = signal?.nrRsrp !== undefined;
  const bestShown = best?.smooth ?? best?.rsrp;
  const otherCell = !!best && !!current && cellKey(best.cell) !== cellKey(current.cell);
  const waitingNr = tech === 'NR' && !nrActive && !nrNb;

  /** تحميل متواصل يصحّي 5G وقت التوجيه — بحد أعلى للوقت والاستهلاك */
  const wake5g = () => {
    if (waking !== null) { wakeStop.current = true; return; }
    Alert.alert(
      'صحّي 5G',
      'بنحمّل لمدة دقيقة تقريباً عشان الراوتر يشوف أبراج 5G ويتصل عليها.\nيستهلك حتى ١٠٠ ميقا من باقتك. تقدر توقفه متى ما بغيت.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ابدأ', onPress: () => {
            const SECS = 60;
            wakeStop.current = false;
            setWaking(SECS);
            const t0 = Date.now();
            const iv = setInterval(() => {
              const left = Math.max(0, SECS - Math.round((Date.now() - t0) / 1000));
              setWaking(w => (w === null ? null : left));
            }, 1000);
            trafficBurst(SECS * 1000, 100_000_000, () => wakeStop.current)
              .catch(() => 0)
              .finally(() => { clearInterval(iv); setWaking(null); });
          },
        },
      ],
    );
  };

  const series: Series[] = [
    { label: 'RSRP', color: tech === 'NR' ? C.violet : C.blue, values: readings.map(r => r.smooth ?? r.rsrp), min: -125, max: -60, unit: 'dBm' },
  ];

  return (
    <LinearGradient colors={nrSeen ? [C.greenSoft, C.bgBottom] : [C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        {loading && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={C.blue} />
            <Text style={s.muted}>نبدأ القياس...</Text>
          </View>
        )}

        {!loading && (
          <View style={s.seg}>
            {(['LTE', 'NR'] as Tech[]).map(t => {
              const on = tech === t;
              const disabled = t === 'NR' && !nrSeen && !nrActive;
              return (
                <Pressable
                  key={t}
                  style={[s.segBtn, on && { backgroundColor: t === 'NR' ? C.violet : C.blue }, disabled && { opacity: 0.4 }]}
                  onPress={() => !disabled && switchTech(t)}
                  disabled={disabled}
                >
                  <Text style={[s.segText, on && { color: C.onAccent }]}>
                    {t === 'NR' ? 'وجّه على 5G' : 'وجّه على 4G'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {!loading && canPin && (
          <Pressable
            style={[s.pinBar, pinned ? s.pinBarOn : null, pinBusy && { opacity: 0.6 }]}
            onPress={pinDuringAim}
            disabled={pinBusy}
          >
            {pinBusy ? <ActivityIndicator color={pinned ? C.onAccent : C.blue} /> : null}
            <Text style={[s.pinText, pinned ? { color: C.onAccent } : null]}>
              {pinned
                ? `📌 مثبّت على ${cellName(pinned)} — اضغط للفك`
                : '📌 ثبّت البرج الحالي أثناء التوجيه'}
            </Text>
          </Pressable>
        )}
        {!loading && canPin && !pinned && (
          <Text style={s.hint}>
            ننصح فيه: بدون تثبيت، الراوتر ينتقل بين الأبراج وأنت تحرّكه، فتتغيّر الأرقام بسبب البرج مو بسبب المكان.
            التثبيت هنا مؤقت وينفك لحاله لما تطلع من الشاشة.
          </Text>
        )}

        {!loading && (
          <GlassCard collapsible={false}>
            {waitingNr ? (
              <View style={s.center}>
                <Text style={s.waitTitle}>{waking !== null ? 'ندوّر على أبراج 5G…' : '5G غير نشط الحين'}</Text>
                <Text style={s.hint}>
                  {waking !== null
                    ? 'حرّك الراوتر ببطء — أول ما يظهر برج 5G بنبدأ نقيسه هنا.'
                    : '5G ما يظهر إلا وقت التحميل. اضغط الزر وحرّك الراوتر — نقيس أقوى برج 5G يشوفه الراوتر.'}
                </Text>
              </View>
            ) : (
              <>
                <View style={{ alignItems: 'center' }}>
                  <SignalRing
                    score={current?.score ?? 0}
                    color={LEVEL_COLOR[level]}
                    label={LEVEL_LABEL[level]}
                    sub={shown !== undefined ? `${shown} dBm` : '—'}
                    note={current?.sinr !== undefined ? `SINR ${current.sinr} dB` : undefined}
                  />
                </View>
                <Text style={s.cellNow}>على {cellName(current?.cell)}</Text>
                {tech === 'NR' && !nrActive && nrNb && (
                  <Text style={[s.hint, { textAlign: 'center' }]}>
                    برج 5G قريب — الراوتر ما اتصل عليه بعد. وجّه لين توصل −110 dBm أو أحسن عشان الشبكة تضيفه.
                  </Text>
                )}
                <LinkHealthChips items={linkHealth(signal, tech)} />

                {delta !== undefined && (
                  <View style={[s.delta, { backgroundColor: delta > 0 ? C.greenSoft : delta < 0 ? C.redSoft : C.rowBg }]}>
                    <Text style={[s.deltaText, { color: delta > 0 ? C.green : delta < 0 ? C.red : C.sub }]}>
                      {delta > 0 ? `↑ أفضل بـ ${delta} dB من نقطة البداية` :
                       delta < 0 ? `↓ أسوأ بـ ${Math.abs(delta)} dB من نقطة البداية` :
                       'نفس نقطة البداية'}
                    </Text>
                  </View>
                )}
              </>
            )}

            <View style={s.chips}>
              {[...bands, ...nrBands].map(b => (
                <View key={b} style={[s.chip, b.startsWith('n') && s.chipNr]}>
                  <Text style={[s.chipText, b.startsWith('n') && { color: C.violet }]}>{b}</Text>
                </View>
              ))}
            </View>

            {tech === 'NR' && !nrActive && (
              <Pressable style={[s.wakeBtn, waking !== null && s.wakeBtnOn]} onPress={wake5g}>
                <Text style={[s.wakeText, waking !== null && { color: C.violet }]}>
                  {waking !== null ? `⏹ إيقاف التحميل (${waking} ث)` : '⚡ صحّي 5G وابدأ التوجيه'}
                </Text>
              </Pressable>
            )}

            {!!error && <Text style={s.err}>{error}</Text>}
          </GlassCard>
        )}

        {!loading && best && (
          <GlassCard title="أفضل نقطة وصلت لها" subtitle="BEST SPOT" icon="🏆" tint={C.goldSoft} collapsible={false}>
            <View style={s.bestRow}>
              <Text style={s.bestVal}>{bestShown !== undefined ? `${bestShown} dBm` : '—'}</Text>
              <Text style={s.bestLabel}>متوسط أقوى نقطة</Text>
            </View>
            <View style={s.bestRow}>
              <Text style={s.bestVal}>{best.sinr !== undefined ? `${best.sinr} dB` : '—'}</Text>
              <Text style={s.bestLabel}>SINR عندها</Text>
            </View>
            <View style={s.bestRow}>
              <Text style={s.bestVal}>{cellName(best.cell)}</Text>
              <Text style={s.bestLabel}>على برج</Text>
            </View>

            {otherCell ? (
              <Text style={s.warn}>
                ⚠️ أفضل نقطة كانت على برج ثاني ({cellName(best.cell)})، والراوتر الحين على {cellName(current?.cell)}.
                عشان كذا ما ترجع لنفس الرقم حتى لو رجعت لنفس المكان.
              </Text>
            ) : shown !== undefined && bestShown !== undefined ? (
              <Text style={s.hint}>
                {shown >= bestShown - 1
                  ? '✓ أنت الآن عند أفضل نقطة أو قريب منها جداً'
                  : `ارجع للخلف — أفضل نقطة كانت أقوى بـ ${bestShown - shown} dB`}
              </Text>
            ) : null}

            {canPin && best.cell.pci && cellKey(pinned) !== cellKey(best.cell) && (
              <Pressable style={[s.btn, pinBusy && { opacity: 0.5 }]} onPress={pinBest} disabled={pinBusy}>
                <Text style={s.btnText}>📌 ثبّت على برج أفضل نقطة</Text>
              </Pressable>
            )}
          </GlassCard>
        )}

        {!loading && nrCell && (
          <GlassCard title="صيد إشارة 5G" subtitle="5G HUNT" icon="🛰️" tint={C.violetSoft} collapsible={false}>
            <View style={s.bestRow}>
              <Text style={[s.nrVal, { color: (nrCell.rsrp ?? -140) > -110 ? C.green : (nrCell.rsrp ?? -140) > -118 ? C.gold : C.red }]}>
                {nrCell.rsrp !== undefined ? `${nrCell.rsrp} dBm` : '—'}
              </Text>
              <Text style={s.bestLabel}>
                أقوى 5G مرصود {nrCell.band ? `(n${nrCell.band})` : ''}
              </Text>
            </View>
            <View style={s.nrBarBg}>
              <View style={[s.nrBarTarget]} />
              <View style={[s.nrBar, {
                width: `${Math.max(0, Math.min(100, ((nrCell.rsrp ?? -140) + 140) / 0.5))}%`,
                backgroundColor: (nrCell.rsrp ?? -140) > -110 ? C.green : C.gold,
              }]} />
            </View>
            <Text style={s.hint}>
              {(nrCell.rsrp ?? -140) > -110
                ? '✓ صارت قوية كفاية للاتصال — ثبّت الراوتر هنا وانتظر دقيقة'
                : `تحتاج تحسين ${Math.round(-110 - (nrCell.rsrp ?? -140))} dB للوصول لحد الاتصال (−110)`}
            </Text>
            {nrBest !== null && (
              <Text style={s.hint}>أفضل قيمة وصلت لها في هذي الجلسة: {nrBest} dBm</Text>
            )}
          </GlassCard>
        )}

        {!loading && readings.length > 1 && (
          <GlassCard title="آخر دقيقة ونصف" subtitle="LIVE TRACE" icon="📉" tint={C.blueSoft}>
            <TimeChart times={readings.map(r => r.t)} series={series} height={140} />
          </GlassCard>
        )}

        {!loading && (
          <Pressable style={[s.soundBtn, sound && s.soundBtnOn]} onPress={() => setSound(v => !v)}>
            <Text style={[s.soundTitle, sound && { color: C.onAccent }]}>
              {sound ? '🔊 وضع الصوت شغّال — اضغط للإيقاف' : '🔈 وضع الصوت (للأنتنا فوق السطح)'}
            </Text>
            <Text style={[s.soundSub, sound && { color: C.onAccentSoft }]}>
              نغمات تتقارب وتعلى كل ما تحسنت الإشارة — وجّه بدون ما تطالع الشاشة
            </Text>
          </Pressable>
        )}

        {!loading && (
          <GlassCard title="كيف تستخدمها" subtitle="HOW TO" icon="💡" tint={C.violetSoft} defaultOpen={!best}>
            <Text style={s.hint}>١. اضغط «ثبّت البرج الحالي» فوق — عشان الأرقام تتغيّر بسبب المكان بس.</Text>
            <Text style={s.hint}>٢. حرّك الراوتر ببطء، وانتظر ٣–٥ ثواني في كل مكان. الرقم الكبير متوسط آخر ٣ قراءات، فيحتاج لحظة يستقر.</Text>
            <Text style={s.hint}>٣. الجوال يهتز أسرع كل ما قويت الإشارة — تقدر تحرّك بدون ما تطالع الشاشة.</Text>
            <Text style={s.hint}>٤. لما تلقى أفضل مكان، ثبّت الراوتر فيه. وإذا تبغى الراوتر يبقى على نفس البرج، اضغط «ثبّت على برج أفضل نقطة».</Text>
            <View style={s.btnRow}>
              <Pressable style={[s.btnGhost]} onPress={() => setHaptics(h => !h)}>
                <Text style={s.btnGhostText}>{haptics ? 'إيقاف الاهتزاز' : 'تشغيل الاهتزاز'}</Text>
              </Pressable>
              <Pressable style={s.btnSolid} onPress={reset}>
                <Text style={s.btnText}>ابدأ من جديد</Text>
              </Pressable>
            </View>
          </GlassCard>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  muted: { color: C.sub, textAlign: 'center' },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  warn: { color: C.gold, fontSize: 12.5, textAlign: 'right', lineHeight: 20, fontWeight: '700' },
  err: { color: C.red, fontSize: 12, textAlign: 'center' },
  waitTitle: { color: C.violet, fontWeight: '800', fontSize: 17 },
  soundBtn: { backgroundColor: C.card, borderColor: C.blue, borderWidth: 1, borderRadius: 16, padding: 14, gap: 4 },
  soundBtnOn: { backgroundColor: C.blue },
  soundTitle: { color: C.blue, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  soundSub: { color: C.sub, fontSize: 11.5, textAlign: 'right' },
  wakeBtn: { marginTop: 12, backgroundColor: C.violet, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  wakeBtnOn: { backgroundColor: C.violetSoft, borderWidth: 1, borderColor: C.violet },
  wakeText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  cellNow: { color: C.sub, fontSize: 12.5, textAlign: 'center', fontWeight: '700' },
  seg: {
    flexDirection: 'row-reverse', backgroundColor: C.card, borderRadius: 14, padding: 4, gap: 4,
    borderWidth: 1, borderColor: C.cardBorder,
  },
  segBtn: { flex: 1, borderRadius: 11, paddingVertical: 9, alignItems: 'center' },
  segText: { color: C.text, fontWeight: '800', fontSize: 13.5 },
  pinBar: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: C.blue, borderRadius: 14, paddingVertical: 12, backgroundColor: C.blueSoft,
  },
  pinBarOn: { backgroundColor: C.blue, borderColor: C.blue },
  pinText: { color: C.blue, fontWeight: '800', fontSize: 14 },
  delta: { borderRadius: 14, padding: 12 },
  deltaText: { fontWeight: '800', textAlign: 'center', fontSize: 14 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  chip: { backgroundColor: C.blueSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 5 },
  chipNr: { backgroundColor: C.violetSoft, borderColor: C.cardBorder },
  chipText: { color: C.blue, fontWeight: '800' },
  bestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bestVal: { color: C.text, fontWeight: '800', fontSize: 16 },
  bestLabel: { color: C.sub, textAlign: 'right', flexShrink: 1 },
  nrVal: { fontWeight: '800', fontSize: 20 },
  nrBarBg: { height: 12, borderRadius: 6, backgroundColor: C.track, overflow: 'hidden', justifyContent: 'center' },
  nrBar: { height: 12, borderRadius: 6, position: 'absolute', left: 0 },
  nrBarTarget: { position: 'absolute', left: '60%', width: 2, height: 12, backgroundColor: C.text, opacity: 0.35 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 13, alignItems: 'center', marginTop: 4 },
  btnSolid: { flex: 1, backgroundColor: C.blue, borderRadius: 14, padding: 13, alignItems: 'center' },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  btnGhost: { flex: 1, borderWidth: 1, borderColor: C.blue, borderRadius: 14, padding: 13, alignItems: 'center' },
  btnGhostText: { color: C.blue, fontWeight: '800', fontSize: 14 },
});
