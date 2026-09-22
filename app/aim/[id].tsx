import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet, Dimensions,
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

// ═══ Design tokens (هوية Bandly) ═══
const BLUE = '#3567F5';
const PURPLE = '#7655F5';
const TEXT = '#14264A';
const MUTED = '#71809A';
const BG = '#F4F8FF';
const SUCCESS = '#13B783';
const CARD = '#FFFFFF';
const CARD_BG = '#FAFCFF';
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
  if (level === 'fair') return '#F59E0B';
  return '#DC2626';
}

/** ═══ Gauge دائري حديث (SVG) ═══ */
function SignalGauge({ value, color }: { value: number; color: string }) {
  const size = 190;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const dash = C * v;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r} stroke="#E8EFF8" strokeWidth={stroke} fill="none" />
        <Circle
          cx={cx} cy={cy} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${dash} ${C}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <Circle cx={cx} cy={cy} r={r - stroke - 2} fill="#FFFFFF" />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Icon name="antenna" size={20} color={color} />
        <Text style={g.gaugeVal}>{Math.round(v * 100)}</Text>
        <Text style={g.gaugePct}>%</Text>
        <Text style={g.gaugeLbl}>قوة الإشارة</Text>
      </View>
    </View>
  );
}

/** ═══ رسم أنتنا + موجات ═══ */
function AntennaVisual({ color }: { color: string }) {
  return (
    <View style={g.antWrap}>
      <Svg width={130} height={190} viewBox="0 0 130 190">
        {/* العمود */}
        <Circle cx={65} cy={170} r={4} fill="#A4B0C4" />
        <Line x1={65} y1={100} x2={65} y2={170} stroke="#A4B0C4" strokeWidth={6} strokeLinecap="round" />
        <Line x1={45} y1={182} x2={85} y2={182} stroke="#94A3B8" strokeWidth={4} strokeLinecap="round" />
        {/* جسم الأنتنا */}
        <Path
          d="M 30 30 Q 30 20 40 20 L 90 20 Q 100 20 100 30 L 100 100 Q 100 110 90 110 L 40 110 Q 30 110 30 100 Z"
          fill="#F9FBFF" stroke="#DCE6F5" strokeWidth={2}
        />
        <Path d="M 40 35 L 90 35" stroke="#E2E8F0" strokeWidth={3} strokeLinecap="round" />
        <Path d="M 40 50 L 90 50" stroke="#E2E8F0" strokeWidth={3} strokeLinecap="round" />
        {/* سهم */}
        <Path d="M 65 90 L 65 60 M 55 70 L 65 58 L 75 70" stroke="#94A3B8" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* موجات الإشارة */}
        <Path d="M 105 60 Q 130 60 130 90" stroke={color} strokeWidth={3} fill="none" opacity={0.4} strokeLinecap="round" />
        <Path d="M 110 45 Q 145 45 145 90" stroke={color} strokeWidth={3} fill="none" opacity={0.25} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/** ═══ بطاقة Metric ═══ */
function MetricBox({ icon, label, value, unit, iconBg, iconColor }: {
  icon: IconName; label: string; value?: string | number; unit?: string; iconBg: string; iconColor: string;
}) {
  return (
    <View style={g.metric}>
      <View style={[g.metricIcon, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={14} color={iconColor} />
      </View>
      <Text style={g.metricLbl}>{label}</Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 2, marginTop: 2 }}>
        <Text style={g.metricVal}>{value ?? '—'}</Text>
        {unit ? <Text style={g.metricUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

/** ═══ بطاقة قسم ═══ */
function SectionCard({ children }: { children: React.ReactNode }) {
  return <View style={g.section}>{children}</View>;
}

/** ═══ صف معلومة ═══ */
function InfoRow({ icon, label, value, color }: { icon: IconName; label: string; value: string; color?: string }) {
  return (
    <View style={g.infoRow}>
      <View style={g.infoIcon}>
        <Icon name={icon} size={14} color={BLUE} />
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Text style={g.infoLbl}>{label}</Text>
        <Text style={[g.infoVal, color && { color }]}>{value}</Text>
      </View>
    </View>
  );
}

/** ═══ صف نصيحة ═══ */
function TipRow({ text }: { text: string }) {
  return (
    <View style={g.tipRow}>
      <Text style={g.tipCheck}>✓</Text>
      <Text style={g.tipTxt}>{text}</Text>
    </View>
  );
}

/** ═══ بوصلة/مؤشر ═══ */
function CompassIndicator({ value, color }: { value: number; color: string }) {
  const size = 130;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const angle = -45 + value * 90; // -45° للضعيف، +45° للقوي
  const pct = Math.round(value * 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r + 6} fill="#F4F8FF" stroke={BORDER} strokeWidth={1} />
        <Circle cx={cx} cy={cy} r={r} fill="#FFFFFF" stroke={BORDER} strokeWidth={2} />
        {/* علامات */}
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * 2 * Math.PI;
          const r1 = r - 3;
          const r2 = i % 3 === 0 ? r - 12 : r - 7;
          return (
            <Line
              key={i}
              x1={cx + Math.cos(a) * r1}
              y1={cy + Math.sin(a) * r1}
              x2={cx + Math.cos(a) * r2}
              y2={cy + Math.sin(a) * r2}
              stroke={i % 3 === 0 ? '#94A3B8' : '#CBD5E1'}
              strokeWidth={i % 3 === 0 ? 2 : 1}
              strokeLinecap="round"
            />
          );
        })}
        {/* العقرب */}
        <G rotation={angle} origin={`${cx}, ${cy}`}>
          <Path
            d={`M ${cx} ${cy - r + 8} L ${cx - 8} ${cy + 8} L ${cx} ${cy + 3} L ${cx + 8} ${cy + 8} Z`}
            fill={color}
          />
        </G>
        <Circle cx={cx} cy={cy} r={5} fill="#14264A" />
      </Svg>
      <View style={{ position: 'absolute', bottom: 6, alignItems: 'center' }}>
        <Text style={{ color: TEXT, fontSize: 13, fontWeight: '900' }}>{pct}%</Text>
      </View>
    </View>
  );
}

/** ═══ خط بياني (SVG) ═══ */
function LineChart({ values, min, max, color }: { values: number[]; min: number; max: number; color: string }) {
  const W = SCREEN_W - 80;
  const H = 110;
  const pad = { top: 8, bottom: 20, left: 0, right: 6 };
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
          <Stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <Stop offset="100%" stopColor={color} stopOpacity="0" />
        </SvgLinearGradient>
      </Defs>
      {/* خطوط أفقية */}
      {[0, 0.33, 0.66, 1].map((f, i) => (
        <Line key={i} x1={0} y1={pad.top + f * innerH} x2={W} y2={pad.top + f * innerH} stroke={BORDER} strokeWidth={1} />
      ))}
      <Path d={areaPath} fill="url(#areaGrad)" />
      <Path d={linePath} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={last.x} cy={last.y} r={5} fill={color} />
      <Circle cx={last.x} cy={last.y} r={9} fill={color} opacity={0.25} />
    </Svg>
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

  // ═══ الصوت: يعمل فقط لما المستخدم يشغّله ═══
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

  const stability = readings.length >= 5
    ? (() => {
        const last = readings.slice(-5).map(r => r.smooth ?? r.rsrp).filter(n => n !== undefined);
        if (last.length < 3) return null;
        const maxDiff = Math.max(...last) - Math.min(...last);
        return maxDiff <= 3 ? 'stable' : maxDiff <= 7 ? 'ok' : 'unstable';
      })()
    : null;

  const chartValues = readings.slice(-30).map(r => r.smooth ?? r.rsrp ?? -110);

  return (
    <View style={g.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[g.content, { paddingBottom: insets.bottom + 100 }]}
      >
        {/* ═══ Header ═══ */}
        <View style={g.header}>
          <Pressable style={g.iconBtn} onPress={() => reset()}>
            <Icon name="refresh" size={18} color={TEXT} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={g.title}>مساعد التوجيه</Text>
            <Text style={g.subtitle}>اضبط اتجاه الهوائي للحصول على أفضل إشارة</Text>
          </View>
          <Pressable
            style={g.iconBtn}
            onPress={() => Alert.alert('كيف تستخدم الشاشة؟',
              '١) اختر 4G أو 5G\n٢) حرّك الراوتر ببطء\n٣) الجوال يهتز أسرع كل ما قويت الإشارة\n٤) لما تلقى أفضل نقطة، ثبّت على البرج')}
          >
            <Icon name="bulb" size={18} color={PURPLE} />
          </Pressable>
        </View>

        {/* ═══ Mode selector ═══ */}
        <View style={g.modeWrap}>
          <Pressable style={g.modeBtn} onPress={() => setMode('guide')}>
            {mode === 'guide' ? (
              <LinearGradient
                colors={[BLUE, PURPLE]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={g.modeGrad}
              >
                <Text style={g.modeTxtOn}>وضع التوجيه</Text>
                <Icon name="aim" size={15} color="#FFF" />
              </LinearGradient>
            ) : (
              <View style={g.modeInner}>
                <Text style={g.modeTxt}>وضع التوجيه</Text>
                <Icon name="aim" size={15} color={MUTED} />
              </View>
            )}
          </Pressable>
          <Pressable style={g.modeBtn} onPress={() => setMode('watch')}>
            {mode === 'watch' ? (
              <LinearGradient
                colors={[BLUE, PURPLE]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={g.modeGrad}
              >
                <Text style={g.modeTxtOn}>وضع المراقبة</Text>
                <Icon name="eye" size={15} color="#FFF" />
              </LinearGradient>
            ) : (
              <View style={g.modeInner}>
                <Text style={g.modeTxt}>وضع المراقبة</Text>
                <Icon name="eye" size={15} color={MUTED} />
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
            {/* ═══ Hero card ═══ */}
            <View style={g.heroCard}>
              <View style={g.heroVisual}>
                <AntennaVisual color={lvlColor} />
                <SignalGauge value={pct} color={lvlColor} />
              </View>

              {/* Metrics row */}
              <View style={g.metricsRow}>
                <MetricBox
                  icon="tower" label="PCI" value={current?.cell.pci ?? '—'}
                  iconBg="#EEE8FF" iconColor="#7C3AED"
                />
                <MetricBox
                  icon="chart" label="RSRP" value={shown ?? '—'} unit="dBm"
                  iconBg="#DFF9ED" iconColor="#16A34A"
                />
                <MetricBox
                  icon="speed" label="SINR" value={current?.sinr ?? '—'} unit="dB"
                  iconBg="#E1F5FF" iconColor="#0891B2"
                />
                <MetricBox
                  icon="bands" label="Band" value={currentBand ?? '—'}
                  iconBg="#FEF3C7" iconColor="#D97706"
                />
              </View>

              {/* Stability status */}
              {stability && (
                <View style={[g.stableBox, {
                  backgroundColor: stability === 'stable' ? '#ECFBF6' : stability === 'ok' ? '#FFFBEB' : '#FEF2F2',
                  borderColor: stability === 'stable' ? '#BEEFE0' : stability === 'ok' ? '#FCD34D' : '#FECACA',
                }]}>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={[g.stableTitle, {
                      color: stability === 'stable' ? '#079B72' : stability === 'ok' ? '#92400E' : '#991B1B',
                    }]}>
                      {stability === 'stable' ? '✓ الإشارة مستقرة' : stability === 'ok' ? '⚠ الإشارة متغيرة قليلاً' : '⚠ الإشارة متقلبة'}
                    </Text>
                    <Text style={[g.stableSub, {
                      color: stability === 'stable' ? '#67958A' : stability === 'ok' ? '#A16207' : '#B91C1C',
                    }]}>
                      {stability === 'stable'
                        ? 'جودة الاتصال جيدة — جرّب تحسينها بتحريك الهوائي'
                        : stability === 'ok'
                          ? 'جرّب تحريك الراوتر ببطء وانتظر ٣-٥ ثواني'
                          : 'حرّك الراوتر ببطء — الأرقام تتغير بسرعة'}
                    </Text>
                  </View>
                  <View style={[g.stableCheck, {
                    backgroundColor: stability === 'stable' ? SUCCESS : stability === 'ok' ? '#F59E0B' : '#DC2626',
                  }]}>
                    <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 15 }}>✓</Text>
                  </View>
                </View>
              )}
            </View>

            {/* ═══ Band / Tech selector ═══ */}
            <SectionCard>
              <View style={g.sectionHead}>
                <View style={g.sectionIcon}>
                  <Icon name="bands" size={16} color={BLUE} />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={g.sectionTitle}>اختيار التردد</Text>
                  <Text style={g.sectionSub}>التقنية والترددات المتاحة</Text>
                </View>
              </View>

              {/* Tech toggle */}
              <View style={g.techRow}>
                {(['LTE', 'NR'] as Tech[]).map(t => {
                  const on = tech === t;
                  const disabled = t === 'NR' && !nrSeen && !nrActive;
                  return (
                    <Pressable
                      key={t}
                      style={[g.techBtn, on && {
                        backgroundColor: t === 'NR' ? PURPLE : BLUE,
                        borderColor: t === 'NR' ? PURPLE : BLUE,
                      }, disabled && { opacity: 0.4 }]}
                      onPress={() => !disabled && switchTech(t)}
                      disabled={disabled}
                    >
                      <Text style={[g.techTxt, on && { color: '#FFF' }]}>
                        {t === 'NR' ? '5G' : '4G'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Band chips */}
              {bandList.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={g.chipsRow}
                >
                  {bandList.map(b => {
                    const on = currentBand === b;
                    const isNr = b.startsWith('n');
                    return (
                      <View
                        key={b}
                        style={[g.chip, on && {
                          backgroundColor: isNr ? PURPLE : BLUE,
                          borderColor: isNr ? PURPLE : BLUE,
                        }]}
                      >
                        <Text style={[g.chipTxt, on && { color: '#FFF' }]}>{b}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </SectionCard>

            {/* ═══ Best direction ═══ */}
            {best && (
              <SectionCard>
                <View style={g.sectionHead}>
                  <View style={[g.sectionIcon, { backgroundColor: '#EEE8FF' }]}>
                    <Icon name="aim" size={16} color={PURPLE} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={g.sectionTitle}>أفضل نقطة وصلت لها</Text>
                    <Text style={g.sectionSub}>مؤشر جودة التوجيه الحالي</Text>
                  </View>
                </View>

                <View style={g.directionBody}>
                  <CompassIndicator value={pct} color={lvlColor} />
                  <View style={g.directionInfo}>
                    <InfoRow
                      icon="tower" label="البرج"
                      value={cellName(best.cell)}
                    />
                    <InfoRow
                      icon="chart" label="أفضل RSRP"
                      value={bestShown !== undefined ? `${bestShown} dBm` : '—'}
                    />
                    <InfoRow
                      icon="spark" label="الفرق عن البداية"
                      value={
                        delta !== undefined
                          ? `${delta > 0 ? '+' : ''}${delta} dB`
                          : '—'
                      }
                      color={delta !== undefined && delta > 0 ? SUCCESS : delta !== undefined && delta < 0 ? '#DC2626' : MUTED}
                    />
                  </View>
                </View>

                {canPin && best.cell.pci && cellKey(pinned) !== cellKey(best.cell) && (
                  <Pressable style={g.ctaSmall} onPress={pinBest} disabled={pinBusy}>
                    {pinBusy ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={g.ctaSmallTxt}>📌 ثبّت على برج أفضل نقطة</Text>
                    )}
                  </Pressable>
                )}

                {pinned && (
                  <Pressable style={[g.ctaSmall, { backgroundColor: '#E0E7FF' }]} onPress={pinDuringAim} disabled={pinBusy}>
                    <Text style={[g.ctaSmallTxt, { color: BLUE }]}>
                      ✓ مثبّت على {cellName(pinned)} — اضغط للفك
                    </Text>
                  </Pressable>
                )}
              </SectionCard>
            )}

            {/* ═══ 5G hunt ═══ */}
            {waitingNr && (
              <SectionCard>
                <View style={g.sectionHead}>
                  <View style={[g.sectionIcon, { backgroundColor: '#EEE8FF' }]}>
                    <Icon name="antenna" size={16} color={PURPLE} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={g.sectionTitle}>صيد إشارة 5G</Text>
                    <Text style={g.sectionSub}>
                      {waking !== null ? 'نبحث — حرّك الراوتر ببطء' : '5G ما يظهر إلا وقت التحميل'}
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={[g.wakeBtn, waking !== null && g.wakeBtnOn]}
                  onPress={wake5g}
                >
                  <Text style={[g.wakeTxt, waking !== null && { color: PURPLE }]}>
                    {waking !== null ? `⏹ إيقاف البحث (${waking}ث)` : '⚡ ابحث عن 5G'}
                  </Text>
                </Pressable>
              </SectionCard>
            )}

            {/* ═══ Sound + haptics ═══ */}
            <View style={g.togglesRow}>
              <Pressable
                style={[g.toggleBtn, sound && { backgroundColor: PURPLE, borderColor: PURPLE }]}
                onPress={() => setSound(v => !v)}
              >
                <Text style={[g.toggleIcon, sound && { color: '#FFF' }]}>
                  {sound ? '🔊' : '🔈'}
                </Text>
                <Text style={[g.toggleTxt, sound && { color: '#FFF' }]}>
                  {sound ? 'الصوت مفعّل' : 'تفعيل الصوت'}
                </Text>
              </Pressable>
              <Pressable
                style={[g.toggleBtn, haptics && { backgroundColor: SUCCESS, borderColor: SUCCESS }]}
                onPress={() => setHaptics(h => !h)}
              >
                <Text style={[g.toggleIcon, haptics && { color: '#FFF' }]}>📳</Text>
                <Text style={[g.toggleTxt, haptics && { color: '#FFF' }]}>
                  {haptics ? 'اهتزاز مفعّل' : 'تشغيل الاهتزاز'}
                </Text>
              </Pressable>
            </View>

            {/* ═══ Chart ═══ */}
            {readings.length > 3 && (
              <SectionCard>
                <View style={g.sectionHead}>
                  <View style={g.sectionIcon}>
                    <Icon name="chart" size={16} color={BLUE} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={g.sectionTitle}>تاريخ قوة الإشارة</Text>
                    <Text style={g.sectionSub}>آخر {Math.min(30, readings.length)} قراءة</Text>
                  </View>
                  <View style={g.rsrpBadge}>
                    <Text style={g.rsrpBadgeTxt}>{shown ?? '—'} dBm</Text>
                  </View>
                </View>
                <View style={{ marginTop: 8, alignItems: 'center' }}>
                  <LineChart values={chartValues} min={-125} max={-60} color={lvlColor} />
                </View>
                <View style={g.chartLabels}>
                  <Text style={g.chartLbl}>الآن</Text>
                  <Text style={g.chartLbl}>قبل قليل</Text>
                </View>
              </SectionCard>
            )}

            {/* ═══ Tips ═══ */}
            <View style={g.tipsCard}>
              <View style={g.tipsHead}>
                <View style={[g.sectionIcon, { backgroundColor: '#FEF3C7' }]}>
                  <Icon name="bulb" size={16} color="#D97706" />
                </View>
                <Text style={g.tipsTitle}>نصائح لتحسين الإشارة</Text>
              </View>
              <TipRow text="ارفع الهوائي لأعلى نقطة ممكنة" />
              <TipRow text="ابتعد عن العوائق المعدنية والجدران السميكة" />
              <TipRow text="جرّب الاتجاهات المختلفة حتى تجد أفضل إشارة" />
              <TipRow text="ثبّت الهوائي عند الوصول لأفضل قراءة" />
            </View>

            {!!error && <Text style={g.err}>{error}</Text>}
          </>
        )}
      </ScrollView>

      {/* ═══ CTA أسفل ثابت ═══ */}
      {!loading && (
        <View style={[g.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={() => { reset(); if (!sound) setSound(true); }}>
            <LinearGradient
              colors={[BLUE, PURPLE]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={g.ctaGrad}
            >
              <Icon name="antenna" size={20} color="#FFF" />
              <Text style={g.ctaTxt}>ابدأ التوجيه الآن</Text>
            </LinearGradient>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ═══ Styles ═══
const g = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 16, paddingTop: 14, gap: 14 },

  // Header
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  iconBtn: {
    width: 46, height: 46, borderRadius: 16, backgroundColor: CARD,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  title: { fontSize: 22, fontWeight: '900', color: TEXT, textAlign: 'center' },
  subtitle: { fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 3 },

  // Mode
  modeWrap: {
    flexDirection: 'row-reverse', gap: 6,
    backgroundColor: CARD, borderRadius: 20, padding: 5,
    borderWidth: 1, borderColor: BORDER,
  },
  modeBtn: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  modeGrad: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: 16,
  },
  modeInner: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: 16,
  },
  modeTxt: { color: MUTED, fontWeight: '800', fontSize: 13 },
  modeTxtOn: { color: '#FFF', fontWeight: '900', fontSize: 13 },

  // Hero
  heroCard: {
    backgroundColor: CARD, borderRadius: 26, padding: 14,
    borderWidth: 1, borderColor: BORDER, gap: 12,
    shadowColor: '#0D2350', shadowOpacity: 0.05, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  heroVisual: {
    height: 240, borderRadius: 22, backgroundColor: '#EEF5FF',
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 6,
  },

  // Antenna visual
  antWrap: { alignItems: 'center', justifyContent: 'center' },

  // Gauge
  gaugeVal: { color: TEXT, fontSize: 52, fontWeight: '900', letterSpacing: -1, lineHeight: 58 },
  gaugePct: { color: MUTED, fontSize: 14, fontWeight: '800', marginTop: -6 },
  gaugeLbl: { color: MUTED, fontSize: 11, marginTop: 2, fontWeight: '700' },

  // Metrics
  metricsRow: { flexDirection: 'row-reverse', gap: 8 },
  metric: {
    flex: 1, minHeight: 88, borderRadius: 16,
    backgroundColor: CARD_BG, padding: 9,
    borderWidth: 1, borderColor: BORDER,
  },
  metricIcon: {
    width: 26, height: 26, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  metricLbl: { color: MUTED, fontSize: 10.5, fontWeight: '700' },
  metricVal: { color: TEXT, fontSize: 13.5, fontWeight: '900' },
  metricUnit: { color: MUTED, fontSize: 9, fontWeight: '700' },

  // Stability
  stableBox: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 16, borderWidth: 1,
  },
  stableTitle: { fontSize: 14, fontWeight: '900', textAlign: 'right' },
  stableSub: { fontSize: 11, marginTop: 3, textAlign: 'right', lineHeight: 16 },
  stableCheck: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },

  // Section
  section: {
    backgroundColor: CARD, borderRadius: 22, padding: 14, gap: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  sectionHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  sectionIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: '#E1F5FF',
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { color: TEXT, fontSize: 15.5, fontWeight: '900', textAlign: 'right' },
  sectionSub: { color: MUTED, fontSize: 11, textAlign: 'right', marginTop: 2 },

  // Tech
  techRow: { flexDirection: 'row-reverse', gap: 8 },
  techBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 12,
    backgroundColor: CARD_BG, alignItems: 'center',
    borderWidth: 1.5, borderColor: BORDER,
  },
  techTxt: { color: TEXT, fontWeight: '900', fontSize: 13.5 },

  // Chips
  chipsRow: { flexDirection: 'row-reverse', gap: 8, paddingVertical: 2 },
  chip: {
    height: 40, paddingHorizontal: 18, borderRadius: 20,
    backgroundColor: CARD_BG, borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  chipTxt: { color: TEXT, fontWeight: '800', fontSize: 13 },

  // Direction
  directionBody: { flexDirection: 'row-reverse', gap: 12, alignItems: 'center' },
  directionInfo: { flex: 1, gap: 8 },
  infoRow: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    backgroundColor: CARD_BG, borderRadius: 12, padding: 10,
    borderWidth: 1, borderColor: BORDER,
  },
  infoIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: '#EEF3FF',
    alignItems: 'center', justifyContent: 'center',
  },
  infoLbl: { color: MUTED, fontSize: 10.5, fontWeight: '700' },
  infoVal: { color: TEXT, fontSize: 13.5, fontWeight: '900', marginTop: 2 },

  // CTA small
  ctaSmall: {
    backgroundColor: BLUE, borderRadius: 14,
    paddingVertical: 12, alignItems: 'center',
  },
  ctaSmallTxt: { color: '#FFF', fontWeight: '900', fontSize: 13.5 },

  // Wake 5G
  wakeBtn: {
    backgroundColor: PURPLE, borderRadius: 14,
    paddingVertical: 12, alignItems: 'center',
  },
  wakeBtnOn: { backgroundColor: '#EEE8FF', borderWidth: 1.5, borderColor: PURPLE },
  wakeTxt: { color: '#FFF', fontWeight: '900', fontSize: 13.5 },

  // Toggles
  togglesRow: { flexDirection: 'row-reverse', gap: 10 },
  toggleBtn: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center',
    justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 16,
    backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER,
  },
  toggleIcon: { fontSize: 18 },
  toggleTxt: { color: TEXT, fontWeight: '900', fontSize: 13 },

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
    borderRadius: 22, backgroundColor: '#F7F3FF',
    borderWidth: 1, borderColor: '#E4D9FF',
    padding: 16, gap: 8,
  },
  tipsHead: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    marginBottom: 4,
  },
  tipsTitle: { color: PURPLE, fontSize: 15.5, fontWeight: '900', flex: 1, textAlign: 'right' },
  tipRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 3 },
  tipCheck: { color: SUCCESS, fontSize: 14, fontWeight: '900' },
  tipTxt: { flex: 1, textAlign: 'right', color: '#68718A', fontSize: 12.5, lineHeight: 19 },

  // Footer CTA
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: BG + 'F0',
  },
  ctaGrad: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 17, borderRadius: 22,
    shadowColor: '#7655F5', shadowOpacity: 0.4,
    shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  ctaTxt: { color: '#FFF', fontWeight: '900', fontSize: 16 },

  // Error
  err: { color: '#DC2626', fontSize: 12, textAlign: 'center' },
});
