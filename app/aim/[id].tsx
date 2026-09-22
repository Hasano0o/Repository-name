import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, ActivityIndicator, Alert,
  StyleSheet, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import Svg, {
  Circle, Path, Line, Defs, LinearGradient as SvgLinearGradient, Stop, G,
} from 'react-native-svg';
import { Icon, IconName } from '../../src/ui/Icon';

// ═══ Haptics (اختياري) ═══
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
import { trafficBurst } from '../../src/utils/nrprobe';
import { AimBeeper } from '../../src/utils/aimSound';

const { width: SCREEN_W } = Dimensions.get('window');

// ═══ Design tokens (نفس المرجع البصري) ═══
const BLUE = '#3567F5';
const PURPLE = '#7655F5';
const TEXT = '#14264A';
const MUTED = '#71809A';
const BG = '#F4F8FF';
const SUCCESS = '#13B783';
const WARN = '#F59E0B';
const DANGER = '#DC2626';
const CARD = '#FFFFFF';
const BORDER = '#E6ECF5';

type Tech = 'LTE' | 'NR';
type Mode = 'guide' | 'watch';

interface CellId { tech: Tech; band?: number; pci?: string; arfcn?: string; }
interface Reading {
  t: number; rsrp?: number; sinr?: number; smooth?: number; score: number; cell: CellId;
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
function levelColor(level: string): string {
  if (level === 'excellent') return '#16A34A';
  if (level === 'good') return SUCCESS;
  if (level === 'fair') return WARN;
  return DANGER;
}
/** تقدير المسافة للبرج من RSRP (خشن لكن معقول) */
function estimateDistance(rsrp?: number): string {
  if (rsrp === undefined) return '—';
  const clamped = Math.max(-125, Math.min(-60, rsrp));
  // -60 dBm ≈ 150م | -80 ≈ 800م | -100 ≈ 3 كم | -125 ≈ 8 كم
  const m = 150 * Math.pow(10, (-60 - clamped) / 25);
  if (m < 1000) return `${Math.round(m / 50) * 50} م`;
  return `${(m / 1000).toFixed(1)} كم`;
}

// ═══ صورة أنتنا واقعية (SVG) ═══
function AntennaVisual({ color, active }: { color: string; active: boolean }) {
  return (
    <View style={a.wrap}>
      <Svg width={160} height={220} viewBox="0 0 160 220">
        {/* سماء + جبال */}
        <Defs>
          <SvgLinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#B8DAFF" />
            <Stop offset="100%" stopColor="#E5F1FF" />
          </SvgLinearGradient>
        </Defs>
        <Path d="M 0 0 L 160 0 L 160 220 L 0 220 Z" fill="url(#sky)" />
        {/* جبل خلفي */}
        <Path d="M 0 170 L 40 140 L 70 160 L 110 130 L 160 160 L 160 220 L 0 220 Z" fill="#C8D9EC" opacity={0.6} />
        {/* موجات الرادار */}
        {active && (
          <>
            <Path d="M 90 90 Q 130 90 130 110" stroke={color} strokeWidth={3.5} fill="none" opacity={0.55} strokeLinecap="round" />
            <Path d="M 92 78 Q 145 78 145 110" stroke={color} strokeWidth={3} fill="none" opacity={0.35} strokeLinecap="round" />
            <Path d="M 94 66 Q 160 66 160 110" stroke={color} strokeWidth={2.5} fill="none" opacity={0.2} strokeLinecap="round" />
          </>
        )}
        {/* عمود الدعم */}
        <Line x1={72} y1={140} x2={72} y2={205} stroke="#94A3B8" strokeWidth={5} strokeLinecap="round" />
        {/* قاعدة */}
        <Line x1={52} y1={210} x2={92} y2={210} stroke="#64748B" strokeWidth={4} strokeLinecap="round" />
        {/* مشبك */}
        <Path d="M 70 130 L 80 130 L 80 145 L 70 145 Z" fill="#64748B" />
        {/* صندوق الأنتنا */}
        <Path
          d="M 30 40 Q 30 32 40 32 L 82 32 Q 92 32 92 40 L 92 128 Q 92 136 82 136 L 40 136 Q 30 136 30 128 Z"
          fill="#F9FBFF" stroke="#CBD5E1" strokeWidth={2.5}
        />
        {/* خطوط داخلية */}
        <Line x1={40} y1={55} x2={82} y2={55} stroke="#E2E8F0" strokeWidth={2} />
        <Line x1={40} y1={70} x2={82} y2={70} stroke="#E2E8F0" strokeWidth={2} />
        {/* سهم للأعلى */}
        <Path d="M 61 115 L 61 85 M 50 98 L 61 82 L 72 98" stroke="#94A3B8" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* نقطة الإشارة */}
        <Circle cx={100} cy={55} r={5} fill={color} />
        <Circle cx={100} cy={55} r={10} fill={color} opacity={0.28} />
      </Svg>
    </View>
  );
}

// ═══ Gauge دائري (نفس المرجع) ═══
function ScoreGauge({ value, color }: { value: number; color: string }) {
  const size = 168;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const dash = C * v;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r} stroke="#E5EDF9" strokeWidth={stroke} fill="none" />
        <Circle
          cx={cx} cy={cy} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${dash} ${C}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Icon name="antenna" size={20} color={color} />
        <Text style={a.gaugeVal}>{Math.round(v * 100)}</Text>
        <Text style={a.gaugePct}>%</Text>
        <Text style={a.gaugeLbl}>قوة الإشارة</Text>
      </View>
    </View>
  );
}

// ═══ بوصلة (SVG) ═══
function Compass({ value, color }: { value: number; color: string }) {
  const size = 130;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const angle = -135 + value * 270;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r + 4} fill="#F4F8FF" stroke={BORDER} strokeWidth={1} />
        <Circle cx={cx} cy={cy} r={r} fill="#FFFFFF" stroke="#E8EFF8" strokeWidth={2} />
        {Array.from({ length: 16 }, (_, i) => {
          const ang = (i / 16) * 2 * Math.PI - Math.PI / 2;
          const isMajor = i % 4 === 0;
          const r1 = r - (isMajor ? 10 : 5);
          const r2 = r - 2;
          return (
            <Line
              key={i}
              x1={cx + Math.cos(ang) * r1}
              y1={cy + Math.sin(ang) * r1}
              x2={cx + Math.cos(ang) * r2}
              y2={cy + Math.sin(ang) * r2}
              stroke={isMajor ? '#94A3B8' : '#CBD5E1'}
              strokeWidth={isMajor ? 2 : 1}
              strokeLinecap="round"
            />
          );
        })}
        <G rotation={angle} origin={`${cx}, ${cy}`}>
          <Path
            d={`M ${cx} ${cy - r + 16} L ${cx - 8} ${cy + 6} L ${cx} ${cy + 1} L ${cx + 8} ${cy + 6} Z`}
            fill={color}
          />
        </G>
        <Circle cx={cx} cy={cy} r={5} fill="#14264A" />
      </Svg>
      <View style={{ position: 'absolute', bottom: 2, alignItems: 'center' }}>
        <Text style={a.compassDeg}>{Math.round(angle + 135)}°</Text>
        <Text style={a.compassSub}>من الشمال</Text>
      </View>
    </View>
  );
}

// ═══ Chart خطي (SVG) ═══
function LineChart({ values, min, max, color }: { values: number[]; min: number; max: number; color: string }) {
  const W = SCREEN_W - 76;
  const H = 120;
  const pad = { top: 10, bottom: 22, left: 6, right: 6 };
  if (values.length < 2) return <View style={{ height: H }} />;
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const range = max - min || 1;
  const stepX = innerW / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad.left + i * stepX;
    const y = pad.top + innerH - ((Math.max(min, Math.min(max, v)) - min) / range) * innerH;
    return { x, y };
  });
  const linePath = pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${pad.top + innerH} L ${pts[0].x} ${pad.top + innerH} Z`;
  const last = pts[pts.length - 1];
  return (
    <Svg width={W} height={H}>
      <Defs>
        <SvgLinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <Stop offset="100%" stopColor={color} stopOpacity="0" />
        </SvgLinearGradient>
      </Defs>
      {[-60, -90, -120].map((v, i) => {
        const y = pad.top + innerH - ((v - min) / range) * innerH;
        return <Line key={i} x1={0} y1={y} x2={W} y2={y} stroke={BORDER} strokeWidth={1} />;
      })}
      <Path d={areaPath} fill="url(#areaGrad)" />
      <Path d={linePath} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={last.x} cy={last.y} r={5} fill={color} />
      <Circle cx={last.x} cy={last.y} r={9} fill={color} opacity={0.22} />
    </Svg>
  );
}

// ═══ Metric صغيرة ═══
function MetricBox({ icon, label, value, unit, iconBg, iconColor }: {
  icon: IconName; label: string; value?: string | number; unit?: string; iconBg: string; iconColor: string;
}) {
  return (
    <View style={a.metric}>
      <View style={[a.metricIcon, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={13} color={iconColor} />
      </View>
      <Text style={a.metricLbl}>{label}</Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 2 }}>
        <Text style={a.metricVal}>{value ?? '—'}</Text>
        {unit ? <Text style={a.metricUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════
// الشاشة الرئيسية
// ═══════════════════════════════════════════════════
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

  // ═══ الصوت — فقط لما sound === true ═══
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
    return () => { b.stop(); beeperRef.current = null; };
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
  const lvlColor = levelColor(level);
  const pct = current?.score ?? 0;
  const bandList = [...new Set([...bands, ...nrBands])];
  const currentBand = current?.cell.band ? (current.cell.tech === 'NR' ? `n${current.cell.band}` : `B${current.cell.band}`) : undefined;
  const distance = estimateDistance(shown);
  const improvePct = delta !== undefined && delta !== 0 ? Math.round(Math.abs(delta) * 2.5) : 0;

  const stability = readings.length >= 5
    ? (() => {
        const last = readings.slice(-5).map(r => r.smooth ?? r.rsrp).filter(n => n !== undefined);
        if (last.length < 3) return null;
        const maxDiff = Math.max(...last) - Math.min(...last);
        return maxDiff <= 3 ? 'stable' : maxDiff <= 7 ? 'ok' : 'unstable';
      })()
    : null;

  const chartValues = readings.slice(-30).map(r => r.smooth ?? r.rsrp ?? -110);
  const chartLabels = readings.slice(-4).filter((_, i, arr) => i % Math.ceil(arr.length / 4) === 0);
  const fmtTime = (t: number) => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <View style={a.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[a.content, { paddingBottom: insets.bottom + 100 }]}
      >
        {/* ═══ Header ═══ */}
        <View style={a.header}>
          <Pressable style={a.headerBtn} onPress={reset}>
            <Icon name="chevron" size={20} color={TEXT} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={a.headerTitle}>مساعد التوجيه</Text>
            <Text style={a.headerSub}>اضبط اتجاه الهوائي للحصول على أفضل إشارة</Text>
          </View>
          <Pressable style={a.headerBtn} onPress={() => Alert.alert('مساعدة',
            '١) اختر 4G أو 5G\n٢) حرّك الراوتر ببطء\n٣) الجوال يهتز أسرع كل ما قويت الإشارة\n٤) لما تلقى أفضل نقطة، ثبّت على البرج')}>
            <Icon name="bulb" size={18} color={PURPLE} />
          </Pressable>
        </View>

        {/* ═══ Mode selector ═══ */}
        <View style={a.modeWrap}>
          <Pressable style={a.modeHalf} onPress={() => setMode('watch')}>
            {mode === 'watch' ? (
              <LinearGradient colors={[BLUE, PURPLE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={a.modeActive}>
                <Icon name="eye" size={15} color="#FFF" />
                <Text style={a.modeTxtOn}>وضع المراقبة</Text>
              </LinearGradient>
            ) : (
              <View style={a.modeInner}>
                <Icon name="eye" size={15} color={MUTED} />
                <Text style={a.modeTxt}>وضع المراقبة</Text>
              </View>
            )}
          </Pressable>
          <Pressable style={a.modeHalf} onPress={() => setMode('guide')}>
            {mode === 'guide' ? (
              <LinearGradient colors={[BLUE, PURPLE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={a.modeActive}>
                <Icon name="aim" size={15} color="#FFF" />
                <Text style={a.modeTxtOn}>وضع التوجيه</Text>
              </LinearGradient>
            ) : (
              <View style={a.modeInner}>
                <Icon name="aim" size={15} color={MUTED} />
                <Text style={a.modeTxt}>وضع التوجيه</Text>
              </View>
            )}
          </Pressable>
        </View>

        {loading && (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={BLUE} />
            <Text style={{ color: MUTED }}>نبدأ القياس...</Text>
          </View>
        )}

        {!loading && (
          <>
            {/* ═══ Hero Card ═══ */}
            <View style={a.heroCard}>
              <View style={a.heroVisual}>
                {/* صورة الأنتنا — يسار */}
                <AntennaVisual color={lvlColor} active={mode === 'guide'} />
                {/* Gauge — يمين */}
                <ScoreGauge value={pct} color={lvlColor} />
              </View>

              {/* 4 Metrics */}
              <View style={a.metricsRow}>
                <MetricBox icon="tower" label="PCI" value={current?.cell.pci ?? '—'} iconBg="#EEE8FF" iconColor="#7C3AED" />
                <MetricBox icon="chart" label="RSRP" value={shown ?? '—'} unit="dBm" iconBg="#DFF9ED" iconColor="#16A34A" />
                <MetricBox icon="speed" label="SINR" value={current?.sinr ?? '—'} unit="dB" iconBg="#E1F5FF" iconColor="#0891B2" />
                <MetricBox icon="bands" label="Band" value={currentBand ?? '—'} iconBg="#FEF3C7" iconColor="#D97706" />
              </View>

              {/* Status بار أخضر */}
              {stability && (
                <View style={[a.statusBar, {
                  backgroundColor: stability === 'stable' ? '#ECFBF6' : stability === 'ok' ? '#FFFBEB' : '#FEF2F2',
                  borderColor: stability === 'stable' ? '#BEEFE0' : stability === 'ok' ? '#FCD34D' : '#FECACA',
                }]}>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={[a.statusTitle, {
                      color: stability === 'stable' ? '#079B72' : stability === 'ok' ? '#92400E' : '#991B1B',
                    }]}>
                      {stability === 'stable' ? '✓ الإشارة مستقرة' : stability === 'ok' ? '⚠ الإشارة متغيرة قليلاً' : '⚠ الإشارة متقلبة'}
                    </Text>
                    <Text style={[a.statusSub, {
                      color: stability === 'stable' ? '#67958A' : stability === 'ok' ? '#A16207' : '#B91C1C',
                    }]}>
                      {stability === 'stable' ? 'جودة الاتصال جيدة - يمكنك تحسينها بتحريك الهوائي'
                        : stability === 'ok' ? 'جرّب تحريك الراوتر ببطء وانتظر ٣-٥ ثواني'
                          : 'حرّك الراوتر ببطء — الأرقام تتغير بسرعة'}
                    </Text>
                  </View>
                  <View style={[a.statusCheck, {
                    backgroundColor: stability === 'stable' ? SUCCESS : stability === 'ok' ? WARN : DANGER,
                  }]}>
                    <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 15 }}>✓</Text>
                  </View>
                </View>
              )}
            </View>

            {/* ═══ Band selector ═══ */}
            <View style={a.card}>
              <View style={a.cardHead}>
                <View style={a.cardIcon}>
                  <Icon name="bands" size={16} color={BLUE} />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={a.cardTitle}>اختيار التردد</Text>
                  <Text style={a.cardSub}>الترددات المتاحة على شبكتك</Text>
                </View>
              </View>

              <View style={a.techRow}>
                {(['LTE', 'NR'] as Tech[]).map(t => {
                  const on = tech === t;
                  const disabled = t === 'NR' && !nrSeen && !nrActive;
                  return (
                    <Pressable
                      key={t}
                      style={[a.techBtn, on && {
                        backgroundColor: t === 'NR' ? PURPLE : BLUE,
                        borderColor: t === 'NR' ? PURPLE : BLUE,
                      }, disabled && { opacity: 0.4 }]}
                      onPress={() => !disabled && switchTech(t)}
                      disabled={disabled}
                    >
                      <Text style={[a.techTxt, on && { color: '#FFF' }]}>{t === 'NR' ? '5G' : '4G'}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {bandList.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={a.chipsRow}>
                  {bandList.map(b => {
                    const on = currentBand === b;
                    const isNr = b.startsWith('n');
                    return (
                      <View key={b} style={[a.chip, on && {
                        backgroundColor: isNr ? PURPLE : BLUE,
                        borderColor: isNr ? PURPLE : BLUE,
                      }]}>
                        <Text style={[a.chipTxt, on && { color: '#FFF' }]}>{b}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            {/* ═══ Best direction ═══ */}
            {best && (
              <View style={a.card}>
                <View style={a.cardHead}>
                  <View style={[a.cardIcon, { backgroundColor: PURPLE + '18' }]}>
                    <Icon name="aim" size={16} color={PURPLE} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={a.cardTitle}>أفضل نقطة توجيه</Text>
                    <Text style={a.cardSub}>اتجه الهوائي إلى هذه الزاوية</Text>
                  </View>
                </View>

                <View style={a.dirBody}>
                  <Compass value={pct} color={lvlColor} />
                  <View style={a.dirStats}>
                    <View style={a.dirStatRow}>
                      <Icon name="spark" size={14} color={SUCCESS} />
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={a.dirStatLbl}>تحسن متوقع</Text>
                        <Text style={[a.dirStatVal, { color: SUCCESS }]}>
                          {improvePct > 0 ? `+${improvePct}%` : '—'}
                        </Text>
                      </View>
                    </View>
                    <View style={a.dirStatRow}>
                      <Icon name="pin" size={14} color={BLUE} />
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={a.dirStatLbl}>المسافة</Text>
                        <Text style={a.dirStatVal}>{distance}</Text>
                      </View>
                    </View>
                    <View style={a.dirStatRow}>
                      <Icon name="tower" size={14} color={PURPLE} />
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={a.dirStatLbl}>البرج</Text>
                        <Text style={a.dirStatVal} numberOfLines={1}>
                          {cellName(best.cell)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {canPin && best.cell.pci && cellKey(pinned) !== cellKey(best.cell) && (
                  <Pressable style={a.pinBtn} onPress={pinBest} disabled={pinBusy}>
                    {pinBusy ? <ActivityIndicator color="#FFF" /> : (
                      <Text style={a.pinTxt}>📌 ثبّت على برج أفضل نقطة</Text>
                    )}
                  </Pressable>
                )}

                {pinned && (
                  <Pressable style={[a.pinBtn, { backgroundColor: '#E0E7FF' }]} onPress={pinDuringAim} disabled={pinBusy}>
                    <Text style={[a.pinTxt, { color: BLUE }]}>✓ مثبّت على {cellName(pinned)}</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* ═══ 5G Hunt ═══ */}
            {waitingNr && (
              <View style={a.card}>
                <View style={a.cardHead}>
                  <View style={[a.cardIcon, { backgroundColor: PURPLE + '18' }]}>
                    <Icon name="antenna" size={16} color={PURPLE} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={a.cardTitle}>صيد إشارة 5G</Text>
                    <Text style={a.cardSub}>
                      {waking !== null ? 'نبحث — حرّك الراوتر ببطء' : '5G ما يظهر إلا وقت التحميل'}
                    </Text>
                  </View>
                </View>
                <Pressable style={[a.wakeBtn, waking !== null && a.wakeBtnOn]} onPress={wake5g}>
                  <Text style={[a.wakeTxt, waking !== null && { color: PURPLE }]}>
                    {waking !== null ? `⏹ إيقاف البحث (${waking}ث)` : '⚡ ابحث عن 5G'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* ═══ Sound + Haptics — compact row ═══ */}
            <View style={a.togglesRow}>
              <Pressable
                style={[a.toggleBtn, sound && { backgroundColor: PURPLE, borderColor: PURPLE }]}
                onPress={() => setSound(v => !v)}
              >
                <Text style={[a.toggleIcon, sound && { color: '#FFF' }]}>{sound ? '🔊' : '🔈'}</Text>
                <Text style={[a.toggleTxt, sound && { color: '#FFF' }]}>
                  {sound ? 'الصوت' : 'تشغيل الصوت'}
                </Text>
              </Pressable>
              <Pressable
                style={[a.toggleBtn, haptics && { backgroundColor: SUCCESS, borderColor: SUCCESS }]}
                onPress={() => setHaptics(h => !h)}
              >
                <Text style={[a.toggleIcon, haptics && { color: '#FFF' }]}>📳</Text>
                <Text style={[a.toggleTxt, haptics && { color: '#FFF' }]}>
                  {haptics ? 'اهتزاز' : 'تشغيل الاهتزاز'}
                </Text>
              </Pressable>
            </View>

            {/* ═══ Chart ═══ */}
            {readings.length > 3 && (
              <View style={a.card}>
                <View style={a.cardHead}>
                  <View style={a.cardIcon}>
                    <Icon name="chart" size={16} color={BLUE} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={a.cardTitle}>تاريخ قوة الإشارة</Text>
                    <Text style={a.cardSub}>آخر {Math.min(30, readings.length)} قراءة</Text>
                  </View>
                  <View style={a.rsrpBadge}>
                    <Text style={a.rsrpBadgeTxt}>{shown ?? '—'} dBm</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'center', marginTop: 8 }}>
                  <LineChart values={chartValues} min={-125} max={-60} color={lvlColor} />
                </View>
                <View style={a.chartLabels}>
                  <Text style={a.chartLbl}>قبل قليل</Text>
                  <Text style={a.chartLbl}>الآن</Text>
                </View>
              </View>
            )}

            {/* ═══ Tips ═══ */}
            <View style={a.tipsCard}>
              <View style={a.tipsHead}>
                <View style={[a.cardIcon, { backgroundColor: '#FEF3C7' }]}>
                  <Icon name="bulb" size={16} color={WARN} />
                </View>
                <Text style={a.tipsTitle}>نصائح لتحسين الإشارة</Text>
              </View>
              <View style={a.tipRow}><Text style={a.tipCheck}>✓</Text><Text style={a.tipTxt}>ارفع الهوائي لأعلى نقطة ممكنة</Text></View>
              <View style={a.tipRow}><Text style={a.tipCheck}>✓</Text><Text style={a.tipTxt}>ابتعد عن العوائق المعدنية والجدران السميكة</Text></View>
              <View style={a.tipRow}><Text style={a.tipCheck}>✓</Text><Text style={a.tipTxt}>جرّب الاتجاهات المختلفة حتى تجد أفضل إشارة</Text></View>
              <View style={a.tipRow}><Text style={a.tipCheck}>✓</Text><Text style={a.tipTxt}>ثبّت الهوائي عند الوصول لأفضل قراءة</Text></View>
            </View>

            {!!error && <Text style={a.err}>{error}</Text>}
          </>
        )}
      </ScrollView>

      {/* ═══ CTA ثابت ═══ */}
      {!loading && (
        <View style={[a.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={() => { reset(); if (!sound) setSound(true); }}>
            <LinearGradient
              colors={[BLUE, PURPLE]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={a.cta}
            >
              <Icon name="aim" size={20} color="#FFF" />
              <Text style={a.ctaTxt}>ابدأ التوجيه الآن</Text>
            </LinearGradient>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const a = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },

  // Header
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  headerBtn: {
    width: 44, height: 44, borderRadius: 15, backgroundColor: CARD,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: TEXT, textAlign: 'center' },
  headerSub: { fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 2 },

  // Mode
  modeWrap: {
    flexDirection: 'row-reverse', gap: 6,
    backgroundColor: CARD, borderRadius: 18, padding: 5,
    borderWidth: 1, borderColor: BORDER,
  },
  modeHalf: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  modeActive: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: 14,
  },
  modeInner: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: 14,
  },
  modeTxt: { color: MUTED, fontWeight: '800', fontSize: 13 },
  modeTxtOn: { color: '#FFF', fontWeight: '900', fontSize: 13 },

  // Hero
  heroCard: {
    backgroundColor: CARD, borderRadius: 24, padding: 14, gap: 12,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: '#0D2350', shadowOpacity: 0.05, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  heroVisual: {
    height: 230, borderRadius: 20, backgroundColor: '#EEF5FF',
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 4,
  },

  // Antenna
  wrap: { alignItems: 'center', justifyContent: 'center' },

  // Gauge
  gaugeVal: { color: TEXT, fontSize: 44, fontWeight: '900', letterSpacing: -1, lineHeight: 48 },
  gaugePct: { color: MUTED, fontSize: 13, fontWeight: '800', marginTop: -4 },
  gaugeLbl: { color: MUTED, fontSize: 11, marginTop: 2, fontWeight: '700' },

  // Compass
  compassDeg: { color: TEXT, fontSize: 15, fontWeight: '900' },
  compassSub: { color: MUTED, fontSize: 9.5, marginTop: -1 },

  // Metric
  metricsRow: { flexDirection: 'row-reverse', gap: 8 },
  metric: {
    flex: 1, minHeight: 82, borderRadius: 14,
    backgroundColor: '#FAFCFF', padding: 9,
    borderWidth: 1, borderColor: BORDER, gap: 3,
  },
  metricIcon: {
    width: 24, height: 24, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  metricLbl: { color: MUTED, fontSize: 10, fontWeight: '700' },
  metricVal: { color: TEXT, fontSize: 13, fontWeight: '900' },
  metricUnit: { color: MUTED, fontSize: 8.5, fontWeight: '700' },

  // Status
  statusBar: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    paddingVertical: 11, paddingHorizontal: 13,
    borderRadius: 14, borderWidth: 1,
  },
  statusTitle: { fontSize: 13, fontWeight: '900', textAlign: 'right' },
  statusSub: { fontSize: 10.5, marginTop: 2, textAlign: 'right', lineHeight: 15 },
  statusCheck: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  // Card
  card: {
    backgroundColor: CARD, borderRadius: 20, padding: 14, gap: 10,
    borderWidth: 1, borderColor: BORDER,
  },
  cardHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  cardIcon: {
    width: 30, height: 30, borderRadius: 10, backgroundColor: '#E1F5FF',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: TEXT, fontSize: 14.5, fontWeight: '900', textAlign: 'right' },
  cardSub: { color: MUTED, fontSize: 10.5, textAlign: 'right', marginTop: 2 },

  // Tech
  techRow: { flexDirection: 'row-reverse', gap: 8 },
  techBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#FAFCFF', alignItems: 'center',
    borderWidth: 1.5, borderColor: BORDER,
  },
  techTxt: { color: TEXT, fontWeight: '900', fontSize: 13.5 },

  // Chips
  chipsRow: { flexDirection: 'row-reverse', gap: 8, paddingVertical: 2 },
  chip: {
    height: 38, paddingHorizontal: 18, borderRadius: 19,
    backgroundColor: '#FAFCFF', borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  chipTxt: { color: TEXT, fontWeight: '800', fontSize: 12.5 },

  // Direction
  dirBody: { flexDirection: 'row-reverse', gap: 12, alignItems: 'center' },
  dirStats: { flex: 1, gap: 8 },
  dirStatRow: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    backgroundColor: '#FAFCFF', borderRadius: 12, padding: 9,
    borderWidth: 1, borderColor: BORDER,
  },
  dirStatLbl: { color: MUTED, fontSize: 10, fontWeight: '700' },
  dirStatVal: { color: TEXT, fontSize: 13.5, fontWeight: '900', marginTop: 1 },

  pinBtn: {
    backgroundColor: BLUE, borderRadius: 14,
    paddingVertical: 11, alignItems: 'center', marginTop: 4,
  },
  pinTxt: { color: '#FFF', fontWeight: '900', fontSize: 13.5 },

  // Wake
  wakeBtn: {
    backgroundColor: PURPLE, borderRadius: 12,
    paddingVertical: 11, alignItems: 'center',
  },
  wakeBtnOn: { backgroundColor: '#EEE8FF', borderWidth: 1.5, borderColor: PURPLE },
  wakeTxt: { color: '#FFF', fontWeight: '900', fontSize: 13.5 },

  // Toggles
  togglesRow: { flexDirection: 'row-reverse', gap: 10 },
  toggleBtn: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center',
    justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 14,
    backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER,
  },
  toggleIcon: { fontSize: 16 },
  toggleTxt: { color: TEXT, fontWeight: '900', fontSize: 12.5 },

  // Chart
  rsrpBadge: {
    backgroundColor: BLUE, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  rsrpBadgeTxt: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  chartLabels: {
    flexDirection: 'row-reverse', justifyContent: 'space-between',
    marginTop: 4, paddingHorizontal: 4,
  },
  chartLbl: { color: MUTED, fontSize: 10, fontWeight: '700' },

  // Tips
  tipsCard: {
    borderRadius: 20, backgroundColor: '#F7F3FF',
    borderWidth: 1, borderColor: '#E4D9FF',
    padding: 14, gap: 8,
  },
  tipsHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 4 },
  tipsTitle: { color: PURPLE, fontSize: 14.5, fontWeight: '900', flex: 1, textAlign: 'right' },
  tipRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 3 },
  tipCheck: { color: SUCCESS, fontSize: 14, fontWeight: '900' },
  tipTxt: { flex: 1, textAlign: 'right', color: '#68718A', fontSize: 12.5, lineHeight: 19 },

  // Footer CTA
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: BG + 'F0',
  },
  cta: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16, borderRadius: 20,
    shadowColor: PURPLE, shadowOpacity: 0.4,
    shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  ctaTxt: { color: '#FFF', fontWeight: '900', fontSize: 16 },

  err: { color: DANGER, fontSize: 12, textAlign: 'center' },
});
