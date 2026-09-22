import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import Svg, { Circle, Path, Rect, G, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
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

const MAX_POINTS = 120;
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

/** ═══ دائرة النسبة (SVG) ═══ */
function ScoreRing({ value, color, size = 130 }: { value: number; color: string; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * Math.max(0, Math.min(1, value));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* الخلفية */}
        <Circle cx={cx} cy={cy} r={r} stroke="#e5e7eb" strokeWidth={stroke} fill="none" />
        {/* القوس */}
        <Circle
          cx={cx} cy={cy} r={r}
          stroke={color} strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
      <Icon name="tower" size={20} color={color} />
      <Text style={{ color: C.text, fontSize: 30, fontWeight: '900', letterSpacing: -1, marginTop: 2 }}>
        {Math.round(value * 100)}
      </Text>
      <Text style={{ color: C.muted, fontSize: 9, fontWeight: '800' }}>%</Text>
    </View>
  );
}

/** ═══ رسم أنتنا واقعي (SVG) ═══ */
function AntennaIllustration({ width = 180, height = 140 }: { width?: number; height?: number }) {
  return (
    <View style={{ width, height, borderRadius: 14, overflow: 'hidden' }}>
      <LinearGradient
        colors={['#a5d8ff', '#d0ebff', '#e7f5ff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ flex: 1 }}
      >
        <Svg width={width} height={height} viewBox="0 0 180 140">
          {/* سحاب في الخلفية */}
          <Circle cx={30} cy={30} r={12} fill="#ffffff" opacity={0.5} />
          <Circle cx={45} cy={32} r={10} fill="#ffffff" opacity={0.5} />
          <Circle cx={140} cy={25} r={8} fill="#ffffff" opacity={0.4} />

          {/* موجات الرادار */}
          <Circle cx={65} cy={55} r={45} stroke="#10b981" strokeWidth={1.5} fill="none" opacity={0.25} />
          <Circle cx={65} cy={55} r={35} stroke="#10b981" strokeWidth={1.5} fill="none" opacity={0.4} />
          <Circle cx={65} cy={55} r={25} stroke="#10b981" strokeWidth={1.5} fill="none" opacity={0.6} />

          {/* عمود الدعم */}
          <Rect x={88} y={70} width={4} height={70} fill="#adb5bd" />
          {/* قاعدة */}
          <Rect x={60} y={130} width={60} height={6} rx={2} fill="#868e96" />

          {/* صندوق الأنتنا */}
          <Rect x={38} y={40} width={54} height={50} rx={6} fill="#ffffff" stroke="#adb5bd" strokeWidth={2} />
          {/* لمعة داخلية */}
          <Rect x={42} y={44} width={46} height={20} rx={4} fill="#dee2e6" opacity={0.6} />
          {/* سهم للأعلى */}
          <Path d="M 65 78 L 65 62 M 58 68 L 65 60 L 72 68" stroke="#adb5bd" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />

          {/* مشبك */}
          <Rect x={86} y={60} width={8} height={12} rx={2} fill="#868e96" />

          {/* نقطة الإشارة */}
          <Circle cx={114} cy={40} r={4} fill="#16a34a" />
          <Circle cx={114} cy={40} r={8} fill="#16a34a" opacity={0.25} />
        </Svg>
      </LinearGradient>
    </View>
  );
}

/** ═══ رسم بياني (SVG) ═══ */
function LineChart({ values, min, max, color }: { values: number[]; min: number; max: number; color: string }) {
  const width = 320;
  const height = 90;
  const padding = { top: 6, bottom: 6, left: 4, right: 4 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  if (values.length < 2) return <View style={{ height }} />;
  const range = max - min || 1;
  const step = innerW / (values.length - 1);
  const points = values.map((v, i) => {
    const x = padding.left + i * step;
    const y = padding.top + innerH - ((Math.max(min, Math.min(max, v)) - min) / range) * innerH;
    return { x, y };
  });
  const linePath = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <SvgLinearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <Stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </SvgLinearGradient>
      </Defs>
      {/* خطوط شبكة */}
      {[0, 0.5, 1].map((f, i) => (
        <Path key={i} d={`M 0 ${padding.top + f * innerH} L ${width} ${padding.top + f * innerH}`} stroke="#f1f5f9" strokeWidth={1} />
      ))}
      <Path d={areaPath} fill="url(#areaFill)" />
      <Path d={linePath} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* نقطة أخيرة */}
      <Circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={4} fill={color} />
      <Circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={7} fill={color} opacity={0.3} />
    </Svg>
  );
}

/** ═══ بوصلة (SVG) ═══ */
function Compass({ angle, size = 110 }: { angle: number; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* الحلقة */}
        <Circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke="#e5e7eb" strokeWidth={2} />
        {/* علامات */}
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * 2 * Math.PI - Math.PI / 2;
          const isMajor = i % 4 === 0;
          const r1 = r - (isMajor ? 8 : 4);
          const r2 = r - 2;
          return (
            <Path
              key={i}
              d={`M ${cx + Math.cos(a) * r1} ${cy + Math.sin(a) * r1} L ${cx + Math.cos(a) * r2} ${cy + Math.sin(a) * r2}`}
              stroke={isMajor ? '#64748b' : '#cbd5e1'}
              strokeWidth={isMajor ? 2 : 1}
              strokeLinecap="round"
            />
          );
        })}
        {/* سهم أخضر */}
        <G rotation={angle} origin={`${cx}, ${cy}`}>
          <Path d={`M ${cx} ${cy - r + 14} L ${cx - 7} ${cy - 4} L ${cx + 7} ${cy - 4} Z`} fill="#16a34a" />
          <Path d={`M ${cx} ${cy - r + 14} L ${cx - 7} ${cy - 4} L ${cx + 7} ${cy - 4} Z`} fill="#16a34a" />
        </G>
        {/* مركز */}
        <Circle cx={cx} cy={cy} r={4} fill="#334155" />
      </Svg>
      <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', marginTop: 30 }}>{Math.round(angle)}°</Text>
      <Text style={{ color: C.muted, fontSize: 10, marginTop: -2 }}>من الشمال</Text>
    </View>
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

  // ═══ الصوت: يشتغل فقط لما sound === true ═══
  useEffect(() => {
    if (!sound) {
      if (beeperRef.current) {
        beeperRef.current.stop();
        beeperRef.current = null;
      }
      return;
    }
    if (beeperRef.current) return;
    const b = new AimBeeper();
    beeperRef.current = b;
    b.start();
    return () => {
      b.stop();
      beeperRef.current = null;
    };
  }, [sound]);

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
  const lvlColor = level === 'excellent' ? '#16a34a' : level === 'good' ? '#22c55e' : level === 'fair' ? '#f59e0b' : '#dc2626';
  const pct = current?.score ?? 0;
  const bandList = [...new Set([...bands, ...nrBands])];
  const currentBand = current?.cell.band ? (current.cell.tech === 'NR' ? `n${current.cell.band}` : `B${current.cell.band}`) : undefined;

  // حالة الاستقرار
  const stability = readings.length >= 5
    ? (() => {
        const last = readings.slice(-5).map(r => r.smooth ?? r.rsrp).filter(n => n !== undefined);
        if (last.length < 3) return null;
        const maxDiff = Math.max(...last) - Math.min(...last);
        return maxDiff <= 3 ? 'stable' : maxDiff <= 7 ? 'ok' : 'unstable';
      })()
    : null;

  // رسم بياني
  const chartValues = readings.slice(-30).map(r => r.smooth ?? r.rsrp ?? -110);

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 100 }]}>
        {/* ═══ Header مركزي ═══ */}
        <View style={s.header}>
          <Pressable onPress={() => { reset(); }} hitSlop={10} style={s.backBtn}>
            <Icon name="refresh" size={18} color={C.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
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
            onPress={() => setMode('guide')}
          >
            <Icon name="aim" size={15} color={mode === 'guide' ? '#fff' : C.text} />
            <Text style={[s.modeTxt, mode === 'guide' && s.modeTxtOn]}>وضع التوجيه</Text>
          </Pressable>
          <Pressable
            style={[s.modeBtn, mode === 'watch' && s.modeBtnOn]}
            onPress={() => setMode('watch')}
          >
            <Icon name="eye" size={15} color={mode === 'watch' ? '#fff' : C.text} />
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
              <AntennaIllustration width={170} height={140} />
              <ScoreRing value={pct} color={lvlColor} size={130} />
            </View>

            {/* ═══ 4 إحصائيات ═══ */}
            <View style={s.statsRow}>
              <View style={s.statBox}>
                <View style={[s.statIconWrap, { backgroundColor: '#f3e8ff' }]}>
                  <Icon name="tower" size={14} color="#7c3aed" />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={s.statLbl}>PCI</Text>
                  <Text style={s.statVal}>{current?.cell.pci ?? '—'}</Text>
                </View>
              </View>
              <View style={s.statBox}>
                <View style={[s.statIconWrap, { backgroundColor: '#dcfce7' }]}>
                  <Icon name="chart" size={14} color="#16a34a" />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={s.statLbl}>RSRP</Text>
                  <Text style={[s.statVal, { color: lvlColor }]}>
                    {shown ?? '—'} <Text style={s.statUnit}>dBm</Text>
                  </Text>
                </View>
              </View>
              <View style={s.statBox}>
                <View style={[s.statIconWrap, { backgroundColor: '#dbeafe' }]}>
                  <Icon name="speed" size={14} color="#2563eb" />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={s.statLbl}>SINR</Text>
                  <Text style={s.statVal}>
                    {current?.sinr ?? '—'} <Text style={s.statUnit}>dB</Text>
                  </Text>
                </View>
              </View>
              <View style={s.statBox}>
                <View style={[s.statIconWrap, { backgroundColor: '#fef3c7' }]}>
                  <Icon name="bands" size={14} color="#d97706" />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={s.statLbl}>Band</Text>
                  <Text style={s.statVal}>{currentBand ?? '—'}</Text>
                </View>
              </View>
            </View>

            {/* ═══ Stability card ═══ */}
            {stability && (
              <View style={[s.stabilityCard, {
                backgroundColor: stability === 'stable' ? '#ecfdf5' : stability === 'ok' ? '#fffbeb' : '#fef2f2',
                borderColor: stability === 'stable' ? '#a7f3d0' : stability === 'ok' ? '#fcd34d' : '#fecaca',
              }]}>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                    <View style={[s.stabilityDot, { backgroundColor: stability === 'stable' ? '#16a34a' : stability === 'ok' ? '#f59e0b' : '#dc2626' }]} />
                    <Text style={[s.stabilityTitle, { color: stability === 'stable' ? '#065f46' : stability === 'ok' ? '#92400e' : '#991b1b' }]}>
                      {stability === 'stable' ? 'الإشارة مستقرة' : stability === 'ok' ? 'الإشارة متغيرة قليلاً' : 'الإشارة متقلبة'}
                    </Text>
                  </View>
                  <Text style={[s.stabilitySub, { color: stability === 'stable' ? '#047857' : stability === 'ok' ? '#a16207' : '#b91c1c' }]}>
                    {stability === 'stable' ? 'جودة الاتصال جيدة - يمكنك تحسينها بتحريك الهوائي' : stability === 'ok' ? 'جرّب تحريك الراوتر قليلاً' : 'حرّك الراوتر ببطء وانتظر 5 ثواني'}
                  </Text>
                </View>
                <View style={[s.stabilityCheck, { backgroundColor: stability === 'stable' ? '#16a34a' : stability === 'ok' ? '#f59e0b' : '#dc2626' }]}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>✓</Text>
                </View>
              </View>
            )}

            {/* ═══ اختيار الترددات ═══ */}
            <View style={s.card}>
              <View style={s.cardHead}>
                <View style={s.cardIconWrap}>
                  <Icon name="bands" size={16} color={C.blue} />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={s.cardTitle}>اختيار الترددات</Text>
                  <Text style={s.cardSub}>الترددات المتاحة على شبكتك</Text>
                </View>
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
                {bandList.map(b => {
                  const on = currentBand === b;
                  const isNr = b.startsWith('n');
                  return (
                    <View
                      key={b}
                      style={[s.chip, on && { backgroundColor: isNr ? C.violet : C.blue, borderColor: 'transparent' }]}
                    >
                      <Text style={[s.chipTxt, on && { color: '#fff' }]}>{b}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            {/* ═══ أفضل نقطة توجيه ═══ */}
            {best && (
              <View style={s.card}>
                <View style={s.cardHead}>
                  <View style={s.cardIconWrap}>
                    <Icon name="aim" size={16} color={C.blue} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={s.cardTitle}>أفضل نقطة توجيه</Text>
                    <Text style={s.cardSub}>اتجه الهوائي إلى هذه الزاوية</Text>
                  </View>
                </View>
                <View style={s.bestBody}>
                  <Compass angle={(pct * 360)} size={115} />
                  <View style={s.bestStats}>
                    <View style={s.bestStatBox}>
                      <Text style={[s.bestStatVal, { color: '#16a34a' }]}>
                        {delta !== undefined ? `${delta > 0 ? '+' : ''}${Math.round(delta * 5)}%` : '+0%'}
                      </Text>
                      <Text style={s.bestStatLbl}>تحسن متوقع</Text>
                    </View>
                    <View style={s.bestStatBox}>
                      <Text style={s.bestStatVal}>{bestShown ?? '—'} dBm</Text>
                      <Text style={s.bestStatLbl}>RSRP الأفضل</Text>
                    </View>
                    <View style={s.bestStatBox}>
                      <Text style={s.bestStatVal}>PCI {best.cell.pci ?? '—'}</Text>
                      <Text style={s.bestStatLbl}>البرج</Text>
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

            {/* ═══ الصوت والاهتزاز ═══ */}
            <View style={s.soundRow}>
              <Pressable
                style={[s.soundBtn, sound && s.soundBtnOn]}
                onPress={() => setSound(v => !v)}
              >
                <Text style={[s.soundIcon, sound && { color: '#fff' }]}>{sound ? '🔊' : '🔈'}</Text>
                <Text style={[s.soundTxt, sound && { color: '#fff' }]}>
                  {sound ? 'الصوت مفعّل' : 'تفعيل الصوت'}
                </Text>
              </Pressable>
              <Pressable
                style={[s.soundBtn, haptics && s.hapticBtnOn]}
                onPress={() => setHaptics(h => !h)}
              >
                <Text style={[s.soundIcon, haptics && { color: '#fff' }]}>📳</Text>
                <Text style={[s.soundTxt, haptics && { color: '#fff' }]}>
                  {haptics ? 'اهتزاز مفعّل' : 'تشغيل الاهتزاز'}
                </Text>
              </Pressable>
            </View>

            {/* ═══ 5G Hunt ═══ */}
            {waitingNr && (
              <View style={s.card}>
                <Text style={s.cardTitle}>🛰️ صيد إشارة 5G</Text>
                <Text style={s.hint}>
                  {waking !== null ? 'نبحث عن أبراج 5G — حرّك الراوتر ببطء' : '5G ما يظهر إلا وقت التحميل.'}
                </Text>
                <Pressable style={[s.wakeBtn, waking !== null && s.wakeBtnOn]} onPress={wake5g}>
                  <Text style={[s.wakeTxt, waking !== null && { color: C.violet }]}>
                    {waking !== null ? `⏹ إيقاف (${waking}ث)` : '⚡ ابحث عن 5G'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* ═══ تاريخ الإشارة ═══ */}
            {readings.length > 3 && (
              <View style={s.card}>
                <View style={s.cardHead}>
                  <View style={s.cardIconWrap}>
                    <Icon name="chart" size={16} color={C.blue} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={s.cardTitle}>تاريخ قوة الإشارة</Text>
                  </View>
                  <View style={s.rsrpBadge}>
                    <Text style={s.rsrpBadgeTxt}>RSRP {shown ?? '—'} dBm</Text>
                  </View>
                </View>
                <View style={s.chartWrap}>
                  <LineChart values={chartValues} min={-125} max={-60} color={lvlColor} />
                </View>
                <View style={s.chartLabels}>
                  <Text style={s.chartLbl}>الآن</Text>
                  <Text style={s.chartLbl}>قبل دقيقة</Text>
                </View>
              </View>
            )}

            {/* ═══ نصائح ═══ */}
            <View style={s.card}>
              <View style={s.cardHead}>
                <View style={[s.cardIconWrap, { backgroundColor: '#fef3c7' }]}>
                  <Icon name="bulb" size={16} color="#d97706" />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={s.cardTitle}>نصائح لتحسين الإشارة</Text>
                </View>
              </View>
              <View style={s.tipRow}>
                <Text style={s.tipCheck}>✓</Text>
                <Text style={s.tip}>احرص على رفع الهوائي لأعلى نقطة ممكنة.</Text>
              </View>
              <View style={s.tipRow}>
                <Text style={s.tipCheck}>✓</Text>
                <Text style={s.tip}>ابتعد عن العوائق المعدنية والجدران السميكة.</Text>
              </View>
              <View style={s.tipRow}>
                <Text style={s.tipCheck}>✓</Text>
                <Text style={s.tip}>جرّب الاتجاهات المختلفة حتى تجد أفضل إشارة.</Text>
              </View>
            </View>

            {!!error && <Text style={s.err}>{error}</Text>}
          </>
        )}
      </ScrollView>

      {/* ═══ CTA أسفل ثابت ═══ */}
      {!loading && (
        <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={s.cta}
            onPress={() => {
              reset();
              if (!sound) setSound(true);
            }}
          >
            <LinearGradient
              colors={['#3b82f6', '#7c3aed']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.ctaInner}
            >
              <Text style={s.ctaTxt}>▶ ابدأ التوجيه الآن</Text>
              <Icon name="aim" size={18} color="#fff" />
            </LinearGradient>
          </Pressable>
        </View>
      )}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12 },

  // Header
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 4 },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.line,
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  headerSub: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 1 },

  // Mode
  modeToggle: {
    flexDirection: 'row-reverse', gap: 8,
    backgroundColor: C.card, borderRadius: 14, padding: 4,
    borderWidth: 1, borderColor: C.line,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center',
    justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 10,
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
    flexDirection: 'row-reverse', alignItems: 'center',
    gap: 10, backgroundColor: C.card, borderRadius: 20,
    borderWidth: 1, borderColor: C.line,
    padding: 12, minHeight: 170,
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },

  // Stats
  statsRow: { flexDirection: 'row-reverse', gap: 8 },
  statBox: {
    flex: 1, backgroundColor: C.card,
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 8,
    borderWidth: 1, borderColor: C.line,
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
  },
  statIconWrap: {
    width: 24, height: 24, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  statLbl: { color: C.muted, fontSize: 9.5, fontWeight: '700' },
  statVal: { color: C.text, fontSize: 13, fontWeight: '900' },
  statUnit: { color: C.muted, fontSize: 8.5, fontWeight: '600' },

  // Stability
  stabilityCard: {
    flexDirection: 'row-reverse', alignItems: 'center',
    gap: 10, paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 14, borderWidth: 1,
  },
  stabilityDot: { width: 8, height: 8, borderRadius: 4 },
  stabilityTitle: { fontSize: 13.5, fontWeight: '900' },
  stabilitySub: { fontSize: 11, textAlign: 'right', marginTop: 2, fontWeight: '600' },
  stabilityCheck: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },

  // Cards
  card: {
    backgroundColor: C.card, borderRadius: 18,
    borderWidth: 1, borderColor: C.line,
    padding: 14, gap: 10,
  },
  cardHead: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
  },
  cardIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: C.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '900', textAlign: 'right' },
  cardSub: { color: C.muted, fontSize: 10.5, textAlign: 'right', marginTop: 1 },

  // Tech
  techRow: { flexDirection: 'row-reverse', gap: 8 },
  techBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    backgroundColor: C.rowBg, alignItems: 'center',
  },
  techTxt: { color: C.text, fontWeight: '800', fontSize: 13 },

  // Chips
  chipsRow: { flexDirection: 'row-reverse', gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 18, paddingVertical: 8,
    backgroundColor: C.rowBg, borderRadius: 999,
    borderWidth: 1, borderColor: C.line,
  },
  chipTxt: { color: C.text, fontWeight: '800', fontSize: 12.5 },

  // Best spot
  bestBody: { flexDirection: 'row-reverse', gap: 10, alignItems: 'center' },
  bestStats: { flex: 1, gap: 6 },
  bestStatBox: {
    backgroundColor: C.rowBg, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10,
    flexDirection: 'row-reverse', justifyContent: 'space-between',
    alignItems: 'center',
  },
  bestStatLbl: { color: C.muted, fontSize: 11, fontWeight: '700' },
  bestStatVal: { color: C.text, fontSize: 13, fontWeight: '900' },
  bestPinBtn: {
    backgroundColor: C.blue, borderRadius: 12,
    paddingVertical: 11, alignItems: 'center', marginTop: 4,
  },
  bestPinTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5 },

  // Sound
  soundRow: { flexDirection: 'row-reverse', gap: 8 },
  soundBtn: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center',
    justifyContent: 'center', gap: 8,
    paddingVertical: 13, borderRadius: 14,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
  },
  soundBtnOn: { backgroundColor: C.violet, borderColor: C.violet },
  hapticBtnOn: { backgroundColor: C.green, borderColor: C.green },
  soundIcon: { fontSize: 18 },
  soundTxt: { color: C.text, fontWeight: '800', fontSize: 13 },

  // Wake
  wakeBtn: {
    backgroundColor: C.violet, borderRadius: 12,
    paddingVertical: 11, alignItems: 'center',
  },
  wakeBtnOn: { backgroundColor: C.violetSoft, borderWidth: 1, borderColor: C.violet },
  wakeTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5 },

  // Chart
  rsrpBadge: {
    backgroundColor: C.blue, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  rsrpBadgeTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  chartWrap: { height: 90, marginTop: 4 },
  chartLabels: {
    flexDirection: 'row-reverse', justifyContent: 'space-between',
    marginTop: -4,
  },
  chartLbl: { color: C.muted, fontSize: 10 },

  // Tips
  tipRow: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    paddingVertical: 4,
  },
  tipCheck: { color: C.muted, fontSize: 13, fontWeight: '900' },
  tip: { color: C.sub, fontSize: 12.5, textAlign: 'right', flex: 1, lineHeight: 19 },

  // Footer CTA
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: C.bg + 'F0',
  },
  cta: {
    borderRadius: 16, overflow: 'hidden',
    shadowColor: '#7c3aed', shadowOpacity: 0.35,
    shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  ctaInner: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16,
  },
  ctaTxt: { color: '#fff', fontWeight: '900', fontSize: 15.5 },
});
