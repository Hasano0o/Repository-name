import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { Icon } from '../../src/ui/Icon';

// HAPTICS_SAFE
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
import { LEVEL_LABEL, overallLevel, signalScore, parseBands, parseNrBands } from '../../src/utils/signal';
import { C, R, S, T } from '../../src/ui/theme';
import { trafficBurst } from '../../src/utils/nrprobe';
import { AimBeeper } from '../../src/utils/aimSound';

type Tech = 'LTE' | 'NR';
type Mode = 'guide' | 'watch';

interface CellId { tech: Tech; band?: number; pci?: string; arfcn?: string; }
interface Reading {
  t: number;
  rsrp?: number;
  sinr?: number;
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

/** ═══ دائرة النسبة ═══ */
function ScoreCircle({ value, color, label }: { value: number; color: string; label: string }) {
  const size = 110;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* الخلفية الداكنة */}
      <View style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: 10, borderColor: color + '22',
      }} />
      {/* القوس النشط */}
      <View style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: 10, borderColor: 'transparent',
        borderTopColor: color, borderRightColor: color,
        transform: [{ rotate: '45deg' }],
        opacity: value > 0.5 ? 1 : 0.7,
      }} />
      <Text style={{ color: C.text, fontSize: 34, fontWeight: '900', letterSpacing: -1 }}>
        {Math.round(value * 100)}
      </Text>
      <Text style={{ color, fontSize: 11, fontWeight: '800', marginTop: -2 }}>{label}</Text>
    </View>
  );
}

/** ═══ بطاقة إحصائية صغيرة ═══ */
function StatBox({ label, value, unit, color }: { label: string; value?: string | number; unit?: string; color?: string }) {
  return (
    <View style={s.statBox}>
      <Text style={s.statLbl}>{label}</Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 2 }}>
        <Text style={[s.statVal, color && { color }]}>{value ?? '—'}</Text>
        {unit ? <Text style={s.statUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

/** ═══ شريط أفقي للخيارات ═══ */
function ChipRow({ items, active, onPress, activeColor }: {
  items: string[];
  active?: string;
  onPress: (v: string) => void;
  activeColor: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row-reverse', gap: 8 }}>
      {items.map(b => {
        const on = active === b;
        return (
          <Pressable
            key={b}
            onPress={() => onPress(b)}
            style={[s.chip, on && { backgroundColor: activeColor }]}
          >
            <Text style={[s.chipTxt, on && { color: '#fff' }]}>{b}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function AimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [tech, setTech] = useState<Tech>('LTE');
  const [mode, setMode] = useState<Mode>('guide');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [best, setBest] = useState<Reading | null>(null);
  const [haptics, setHaptics] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nrSeen, setNrSeen] = useState(false);
  const [nrCell, setNrCell] = useState<CellTower | null>(null);
  const [pinned, setPinned] = useState<CellId | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [canPin, setCanPin] = useState(false);
  const [nrNb, setNrNb] = useState(false);
  const [waking, setWaking] = useState<number | null>(null);
  const [sound, setSound] = useState(false);
  const wakeStop = useRef(false);
  useEffect(() => () => { wakeStop.current = true; }, []);

  const busy = useRef(false);
  const lastPulse = useRef(0);
  const hapticsRef = useRef(true);
  const techRef = useRef<Tech>('LTE');
  const bestRef = useRef<Reading | null>(null);
  const recentRef = useRef<Reading[]>([]);
  const nrRef = useRef(false);
  const cellTick = useRef(0);
  const tempPinRef = useRef(false);
  const infoRef = useRef<SavedRouter | null>(null);
  const beeperRef = useRef<AimBeeper | null>(null);

  useEffect(() => { hapticsRef.current = haptics; }, [haptics]);
  useEffect(() => { techRef.current = tech; }, [tech]);

  // الصوت: يشتغل تلقائياً مع وضع التوجيه
  useEffect(() => {
    if (!sound && mode !== 'guide') return;
    if (sound || mode === 'guide') {
      if (beeperRef.current) return;
      const b = new AimBeeper();
      beeperRef.current = b;
      b.start();
      return () => { b.stop(); beeperRef.current = null; };
    }
  }, [sound, mode]);

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
    if (!rd || !target) { Alert.alert('غير متاح', 'ما قدرنا نعرف رقم البرج الحالي (PCI).'); return; }
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

  const pinBest = () => {
    if (!info || !best) return;
    const target = toTarget(best.cell);
    if (!target) { Alert.alert('غير متاح', 'ما عندنا رقم هذا البرج.'); return; }
    Alert.alert(
      'ثبّت على برج أفضل نقطة',
      `بنثبّت الراوتر على ${cellName(best.cell)} ويبقى مثبّت بعد ما تطلع.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ثبّت', onPress: async () => {
            setPinBusy(true);
            try {
              const ok = await lockAndVerify(info, target);
              if (ok) {
                setPinned(best.cell);
                tempPinRef.current = false;
                Alert.alert('تم', `الراوتر مثبّت على ${cellName(best.cell)}`);
              } else {
                Alert.alert('ما نجح', 'الراوتر ما اتصل على هذا البرج.');
              }
            } catch (e: any) {
              Alert.alert('ما نجح', e?.message ?? String(e));
            } finally { setPinBusy(false); }
          },
        },
      ],
    );
  };

  const wake5g = () => {
    if (waking !== null) { wakeStop.current = true; return; }
    Alert.alert('صحّي 5G', 'بنحمّل لمدة دقيقة تقريباً (يستهلك حتى ١٠٠ ميقا).', [
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
    ]);
  };

  const current = readings[readings.length - 1];
  const shown = current?.smooth ?? current?.rsrp;
  const level = overallLevel(current ? { rsrp: shown, sinr: current.sinr } : null);
  const delta = shown !== undefined && baseline !== null ? shown - baseline : undefined;
  const bands = parseBands(signal?.band);
  const nrBands = parseNrBands(signal?.nrBand);
  const nrActive = signal?.nrRsrp !== undefined;
  const bestShown = best?.smooth ?? best?.rsrp;
  const waitingNr = tech === 'NR' && !nrActive && !nrNb;

  // لون التقييم
  const lvlColor = level === 'excellent' ? '#16a34a' : level === 'good' ? '#22c55e' : level === 'fair' ? '#f59e0b' : '#dc2626';
  // نسبة للمؤشر
  const pct = current?.score ?? 0;

  // حالة الإشارة
  const stability = readings.length >= 5
    ? (() => {
        const last = readings.slice(-5).map(r => r.smooth ?? r.rsrp).filter(n => n !== undefined);
        if (last.length < 3) return null;
        const maxDiff = Math.max(...last) - Math.min(...last);
        return maxDiff <= 3 ? 'stable' : maxDiff <= 7 ? 'ok' : 'unstable';
      })()
    : null;

  const bandList = [...new Set([...bands, ...nrBands])];

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 100 }]}>
        {/* ═══ Header ═══ */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
            <Icon name="chevron" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={s.headerTitle}>مساعد التوجيه</Text>
            <Text style={s.headerSub}>اضبط اتجاه الهوائي للحصول على أفضل إشارة</Text>
          </View>
          <View style={s.headerIcon}>
            <Icon name="aim" size={20} color={C.blue} />
          </View>
        </View>

        {/* ═══ Mode toggle ═══ */}
        <View style={s.modeToggle}>
          <Pressable
            style={[s.modeBtn, mode === 'guide' && s.modeBtnOn]}
            onPress={() => { setMode('guide'); if (!sound) setSound(true); }}
          >
            <Icon name="aim" size={16} color={mode === 'guide' ? '#fff' : C.text} />
            <Text style={[s.modeTxt, mode === 'guide' && s.modeTxtOn]}>وضع التوجيه</Text>
          </Pressable>
          <Pressable
            style={[s.modeBtn, mode === 'watch' && s.modeBtnOn]}
            onPress={() => { setMode('watch'); }}
          >
            <Icon name="eye" size={16} color={mode === 'watch' ? '#fff' : C.text} />
            <Text style={[s.modeTxt, mode === 'watch' && s.modeTxtOn]}>وضع المراقبة</Text>
          </Pressable>
        </View>

        {loading && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={C.blue} />
            <Text style={s.muted}>نبدأ القياس...</Text>
          </View>
        )}

        {!loading && (
          <>
            {/* ═══ Hero: صورة الأنتنا + الدائرة ═══ */}
            <View style={s.hero}>
              <View style={s.heroImageWrap}>
                {/* رسم مبسّط للأنتنا */}
                <View style={s.antennaBase} />
                <View style={s.antennaPole} />
                <View style={s.antennaPanel}>
                  <View style={[s.antennaWave, { opacity: 0.5, width: 100, height: 100, borderRadius: 50 }]} />
                  <View style={[s.antennaWave, { opacity: 0.7, width: 70, height: 70, borderRadius: 35 }]} />
                  <View style={[s.antennaWave, { opacity: 1, width: 40, height: 40, borderRadius: 20 }]} />
                </View>
                <View style={s.antennaDot} />
              </View>
              <ScoreCircle value={pct} color={lvlColor} label={LEVEL_LABEL[level] ?? '—'} />
            </View>

            {/* ═══ Stats row ═══ */}
            <View style={s.statsRow}>
              <StatBox label="PCI" value={current?.cell.pci ?? '—'} />
              <StatBox label="RSRP" value={shown ?? '—'} unit="dBm" color={lvlColor} />
              <StatBox label="SINR" value={current?.sinr ?? '—'} unit="dB" />
              <StatBox label="Band" value={current?.cell.band ? (current.cell.tech === 'NR' ? `n${current.cell.band}` : `B${current.cell.band}`) : '—'} />
            </View>

            {/* ═══ Stability status ═══ */}
            {stability && (
              <View style={[s.stabilityBar, { backgroundColor: stability === 'stable' ? '#dcfce7' : stability === 'ok' ? '#fef3c7' : '#fee2e2' }]}>
                <View style={[s.stabilityDot, { backgroundColor: stability === 'stable' ? '#16a34a' : stability === 'ok' ? '#f59e0b' : '#dc2626' }]} />
                <Text style={[s.stabilityTxt, { color: stability === 'stable' ? '#166534' : stability === 'ok' ? '#92400e' : '#991b1b' }]}>
                  {stability === 'stable' ? 'الإشارة مستقرة' : stability === 'ok' ? 'الإشارة متغيرة قليلاً' : 'الإشارة متقلبة — جرّب تحريك الراوتر'}
                </Text>
              </View>
            )}

            {/* ═══ أزرار التثبيت والصوت ═══ */}
            <View style={s.quickRow}>
              {canPin && (
                <Pressable
                  style={[s.quickBtn, pinned && s.quickBtnOn]}
                  onPress={pinDuringAim}
                  disabled={pinBusy}
                >
                  {pinBusy ? <ActivityIndicator size="small" color={pinned ? '#fff' : C.blue} /> : (
                    <>
                      <Text style={[s.quickIcon, pinned && { color: '#fff' }]}>📌</Text>
                      <Text style={[s.quickTxt, pinned && { color: '#fff' }]}>
                        {pinned ? 'مثبّت' : 'ثبّت'}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
              <Pressable
                style={[s.quickBtn, sound && s.quickBtnSound]}
                onPress={() => setSound(v => !v)}
              >
                <Text style={[s.quickIcon, sound && { color: '#fff' }]}>{sound ? '🔊' : '🔈'}</Text>
                <Text style={[s.quickTxt, sound && { color: '#fff' }]}>الصوت</Text>
              </Pressable>
              <Pressable
                style={[s.quickBtn, haptics && s.quickBtnHaptic]}
                onPress={() => setHaptics(h => !h)}
              >
                <Text style={[s.quickIcon, haptics && { color: '#fff' }]}>📳</Text>
                <Text style={[s.quickTxt, haptics && { color: '#fff' }]}>اهتزاز</Text>
              </Pressable>
            </View>

            {/* ═══ اختيار الترددات ═══ */}
            <View style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardTitle}>📡 الترددات</Text>
                <Text style={s.cardLink}>{tech === 'NR' ? '5G' : '4G'}</Text>
              </View>
              <View style={s.techRow}>
                {(['LTE', 'NR'] as Tech[]).map(t => {
                  const on = tech === t;
                  const disabled = t === 'NR' && !nrSeen && !nrActive;
                  return (
                    <Pressable
                      key={t}
                      style={[s.techBtn, on && { backgroundColor: t === 'NR' ? C.violet : C.blue }, disabled && { opacity: 0.4 }]}
                      onPress={() => !disabled && switchTech(t)}
                      disabled={disabled}
                    >
                      <Text style={[s.techTxt, on && { color: '#fff' }]}>{t === 'NR' ? '5G' : '4G'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ marginTop: 8 }}>
                <ChipRow
                  items={bandList}
                  active={current?.cell.band ? (current.cell.tech === 'NR' ? `n${current.cell.band}` : `B${current.cell.band}`) : undefined}
                  onPress={() => {}}
                  activeColor={tech === 'NR' ? C.violet : C.blue}
                />
              </View>
            </View>

            {/* ═══ أفضل نقطة توجيه ═══ */}
            {best && (
              <View style={s.card}>
                <View style={s.cardHead}>
                  <Text style={s.cardTitle}>🎯 أفضل نقطة توجيه</Text>
                  <Text style={s.cardLink}>{cellName(best.cell)}</Text>
                </View>
                <View style={s.bestBody}>
                  {/* سهم التوجيه */}
                  <View style={s.compass}>
                    <View style={s.compassCircle}>
                      <View style={[s.compassArrow, {
                        transform: [{ rotate: `${(pct * 360) - 45}deg` }],
                      }]}>
                        <Text style={{ fontSize: 40, color: '#16a34a' }}>▲</Text>
                      </View>
                      <Text style={s.compassVal}>{Math.round(pct * 100)}°</Text>
                      <Text style={s.compassSub}>من الشمال</Text>
                    </View>
                  </View>
                  {/* إحصائيات */}
                  <View style={s.bestStats}>
                    <View style={s.bestStatBox}>
                      <Text style={s.bestStatLbl}>تحسن متوقع</Text>
                      <Text style={[s.bestStatVal, { color: '#16a34a' }]}>
                        {delta !== undefined ? `+${Math.round(delta * 10)}%` : '—'}
                      </Text>
                    </View>
                    <View style={s.bestStatBox}>
                      <Text style={s.bestStatLbl}>RSRP الأفضل</Text>
                      <Text style={s.bestStatVal}>{bestShown ?? '—'} dBm</Text>
                    </View>
                    <View style={s.bestStatBox}>
                      <Text style={s.bestStatLbl}>البرج</Text>
                      <Text style={s.bestStatVal}>PCI {best.cell.pci ?? '—'}</Text>
                    </View>
                  </View>
                </View>
                {canPin && best.cell.pci && cellKey(pinned) !== cellKey(best.cell) && (
                  <Pressable style={s.bestPinBtn} onPress={pinBest} disabled={pinBusy}>
                    <Text style={s.bestPinTxt}>📌 ثبّت على برج أفضل نقطة</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* ═══ 5G Hunt ═══ */}
            {waitingNr && (
              <View style={s.card}>
                <Text style={s.cardTitle}>🛰️ صيد إشارة 5G</Text>
                <Text style={s.hint}>
                  {waking !== null ? 'نبحث عن أبراج 5G — حرّك الراوتر ببطء' : '5G ما يظهر إلا وقت التحميل. اضغط للبحث.'}
                </Text>
                <Pressable style={[s.wakeBtn, waking !== null && s.wakeBtnOn]} onPress={wake5g}>
                  <Text style={[s.wakeTxt, waking !== null && { color: C.violet }]}>
                    {waking !== null ? `⏹ إيقاف (${waking}ث)` : '⚡ ابحث عن 5G'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* ═══ رسم بياني مختصر ═══ */}
            {readings.length > 5 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>📈 آخر دقيقة</Text>
                <View style={s.miniChart}>
                  {readings.slice(-30).map((r, i) => {
                    const v = r.smooth ?? r.rsrp ?? -120;
                    const h = Math.max(2, Math.min(60, ((v + 120) / 60) * 60));
                    return (
                      <View
                        key={i}
                        style={{
                          width: 3,
                          height: h,
                          backgroundColor: v > -85 ? '#16a34a' : v > -95 ? '#22c55e' : v > -105 ? '#f59e0b' : '#dc2626',
                          borderRadius: 2,
                        }}
                      />
                    );
                  })}
                </View>
                <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={s.chartLbl}>قبل 30 ث</Text>
                  <Text style={s.chartLbl}>الآن</Text>
                </View>
              </View>
            )}

            {/* ═══ نصائح ═══ */}
            <View style={s.card}>
              <Text style={s.cardTitle}>💡 نصائح لتحسين الإشارة</Text>
              <Text style={s.tip}>✓ ارفع الأنتنا لأعلى نقطة ممكنة</Text>
              <Text style={s.tip}>✓ ابتعد عن العوائق المعدنية والجدران السميكة</Text>
              <Text style={s.tip}>✓ جرّب الاتجاهات المختلفة حتى تجد أفضل إشارة</Text>
              <Text style={s.tip}>✓ استخدم «ثبّت» عشان الأرقام تتغير بسبب المكان فقط</Text>
            </View>

            {!!error && <Text style={s.err}>{error}</Text>}
          </>
        )}
      </ScrollView>

      {/* ═══ CTA أسفل ثابت ═══ */}
      {!loading && (
        <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[s.cta, { backgroundColor: mode === 'guide' ? C.blue : C.violet }]}
            onPress={() => {
              if (mode === 'guide') { reset(); setMode('watch'); }
              else { reset(); setMode('guide'); if (!sound) setSound(true); }
            }}
          >
            <Text style={s.ctaTxt}>
              {mode === 'guide' ? '▶ ابدأ التوجيه الآن' : '🔁 ابدأ من جديد'}
            </Text>
          </Pressable>
        </View>
      )}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12 },

  // Header
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginBottom: 4 },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.line,
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: '900', textAlign: 'right' },
  headerSub: { color: C.muted, fontSize: 11.5, textAlign: 'right', marginTop: 1 },

  // Mode toggle
  modeToggle: {
    flexDirection: 'row-reverse', gap: 8,
    backgroundColor: C.card, borderRadius: 14, padding: 4,
    borderWidth: 1, borderColor: C.line,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center',
    justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10,
  },
  modeBtnOn: { backgroundColor: C.blue },
  modeTxt: { color: C.text, fontWeight: '800', fontSize: 13 },
  modeTxtOn: { color: '#fff' },

  center: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  muted: { color: C.sub, textAlign: 'center' },
  err: { color: C.red, fontSize: 12, textAlign: 'center' },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 18 },

  // Hero
  hero: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 14,
    backgroundColor: C.card, borderRadius: 20,
    borderWidth: 1, borderColor: C.line,
    padding: 16, minHeight: 170,
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  heroImageWrap: {
    flex: 1, height: 140,
    alignItems: 'center', justifyContent: 'flex-end',
    position: 'relative',
  },
  antennaBase: {
    position: 'absolute', bottom: 0, width: 80, height: 10,
    backgroundColor: '#cbd5e1', borderRadius: 3,
  },
  antennaPole: {
    position: 'absolute', bottom: 10, width: 6, height: 50,
    backgroundColor: '#94a3b8', borderRadius: 3,
  },
  antennaPanel: {
    position: 'absolute', bottom: 55,
    width: 90, height: 60,
    backgroundColor: '#e2e8f0',
    borderRadius: 8,
    borderWidth: 2, borderColor: '#94a3b8',
    alignItems: 'center', justifyContent: 'center',
  },
  antennaWave: {
    position: 'absolute',
    borderWidth: 2, borderColor: '#22c55e',
    borderStyle: 'solid',
  },
  antennaDot: {
    position: 'absolute', top: 0, right: '30%',
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#16a34a',
  },

  // Stats row
  statsRow: {
    flexDirection: 'row-reverse', gap: 8,
  },
  statBox: {
    flex: 1, backgroundColor: C.card,
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 8,
    borderWidth: 1, borderColor: C.line,
    alignItems: 'center', gap: 2,
  },
  statLbl: { color: C.muted, fontSize: 10.5, fontWeight: '700' },
  statVal: { color: C.text, fontSize: 16, fontWeight: '900' },
  statUnit: { color: C.muted, fontSize: 9.5, fontWeight: '600' },

  // Stability
  stabilityBar: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12,
  },
  stabilityDot: { width: 9, height: 9, borderRadius: 5 },
  stabilityTxt: { fontSize: 13, fontWeight: '800', textAlign: 'right' },

  // Quick buttons
  quickRow: { flexDirection: 'row-reverse', gap: 8 },
  quickBtn: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center',
    justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
  },
  quickBtnOn: { backgroundColor: C.blue, borderColor: C.blue },
  quickBtnSound: { backgroundColor: C.violet, borderColor: C.violet },
  quickBtnHaptic: { backgroundColor: C.green, borderColor: C.green },
  quickIcon: { fontSize: 16 },
  quickTxt: { color: C.text, fontWeight: '800', fontSize: 13 },

  // Cards
  card: {
    backgroundColor: C.card, borderRadius: 18,
    borderWidth: 1, borderColor: C.line,
    padding: 14, gap: 10,
  },
  cardHead: {
    flexDirection: 'row-reverse', alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: { color: C.text, fontSize: 14.5, fontWeight: '900', textAlign: 'right' },
  cardLink: { color: C.blue, fontSize: 12, fontWeight: '700' },

  // Tech toggle
  techRow: { flexDirection: 'row-reverse', gap: 8 },
  techBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    backgroundColor: C.rowBg, alignItems: 'center',
  },
  techTxt: { color: C.text, fontWeight: '800', fontSize: 13 },

  // Chips
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: C.rowBg, borderRadius: 999,
    borderWidth: 1, borderColor: C.line,
  },
  chipTxt: { color: C.text, fontWeight: '800', fontSize: 12.5 },

  // Best spot
  bestBody: { flexDirection: 'row-reverse', gap: 12, alignItems: 'center' },
  compass: { width: 100, alignItems: 'center' },
  compassCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: C.rowBg, borderWidth: 2, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center',
  },
  compassArrow: { position: 'absolute', top: 6 },
  compassVal: { color: C.text, fontSize: 20, fontWeight: '900', marginTop: 12 },
  compassSub: { color: C.muted, fontSize: 10 },
  bestStats: { flex: 1, gap: 8 },
  bestStatBox: {
    backgroundColor: C.rowBg, borderRadius: 10,
    paddingVertical: 7, paddingHorizontal: 10,
    flexDirection: 'row-reverse', justifyContent: 'space-between',
    alignItems: 'center',
  },
  bestStatLbl: { color: C.muted, fontSize: 11.5, fontWeight: '700' },
  bestStatVal: { color: C.text, fontSize: 13.5, fontWeight: '900' },

  bestPinBtn: {
    backgroundColor: C.blue, borderRadius: 12,
    paddingVertical: 11, alignItems: 'center', marginTop: 4,
  },
  bestPinTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5 },

  // Wake 5G
  wakeBtn: {
    backgroundColor: C.violet, borderRadius: 12,
    paddingVertical: 11, alignItems: 'center',
  },
  wakeBtnOn: { backgroundColor: C.violetSoft, borderWidth: 1, borderColor: C.violet },
  wakeTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5 },

  // Mini chart
  miniChart: {
    flexDirection: 'row-reverse', alignItems: 'flex-end',
    gap: 2, height: 60,
    backgroundColor: C.rowBg, borderRadius: 10, padding: 6,
  },
  chartLbl: { color: C.muted, fontSize: 10 },

  // Tips
  tip: { color: C.sub, fontSize: 12.5, textAlign: 'right', lineHeight: 20 },

  // Footer CTA
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: C.bg + 'F0',
  },
  cta: {
    borderRadius: 16, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.blue, shadowOpacity: 0.3,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ctaTxt: { color: '#fff', fontWeight: '900', fontSize: 15.5 },
});
