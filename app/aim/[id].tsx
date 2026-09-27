import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet,
  Share, Vibration, Platform, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LiveHost, createLiveSession, CmdAction, CMD_LABEL, LIVE_BASE } from '../../src/services/live';
import Svg, { Circle, Path, Line, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { Icon, IconName } from '../../src/ui/Icon';
import {
  P, shadow, Hero, Section, Ring, Chip, ToggleCard, PrimaryBtn, Collapse, lvlLabel,
} from '../../src/ui/Pro';

// ═══ Haptics ═══
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
import { Level, LEVEL_COLOR, overallLevel, signalScore, parseBands, parseNrBands } from '../../src/utils/signal';
import { trafficBurst } from '../../src/utils/nrprobe';
import { AimBeeper } from '../../src/utils/aimSound';

// ═══ Design tokens ═══
const BLUE = P.blue;
const PURPLE = P.violet;
const TEXT = P.text;
const MUTED = P.sub;
const SUCCESS = P.green;
const WARN = P.amber;
const DANGER = P.red;

type Tech = 'LTE' | 'NR';

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
const levelColor = (level: Level): string => LEVEL_COLOR[level];

type Trend = 'up' | 'down' | 'flat';
const trendOf = (now?: number, prev?: number): Trend =>
  now !== undefined && prev !== undefined ? (now > prev + 0.5 ? 'up' : now < prev - 0.5 ? 'down' : 'flat') : 'flat';

// ═══ سهم الاتجاه ═══
function TrendMark({ t, light }: { t: Trend; light?: boolean }) {
  if (t === 'flat') return <View style={[a.flat, light && { backgroundColor: 'rgba(255,255,255,0.6)' }]} />;
  return (
    <View style={[a.trend, { backgroundColor: t === 'up' ? '#16c784' : '#ff5a5f' }]}>
      <Icon name={t} size={11} color="#fff" stroke={3} />
    </View>
  );
}

// ═══ رسم الإشارة ═══
function LineChart({ values, min, max, color, width }: { values: number[]; min: number; max: number; color: string; width: number }) {
  const H = 120;
  const pad = { top: 10, bottom: 10, left: 6, right: 10 };
  if (values.length < 2 || width <= 0) return <View style={{ height: H }} />;
  const innerW = width - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const range = max - min || 1;
  const stepX = innerW / (values.length - 1);
  const pts = values.map((v, i) => ({
    x: pad.left + i * stepX,
    y: pad.top + innerH - ((Math.max(min, Math.min(max, v)) - min) / range) * innerH,
  }));
  // منحنى ناعم
  let line = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]; const p1 = pts[i];
    const mx = (p0.x + p1.x) / 2;
    line += ` C ${mx} ${p0.y} ${mx} ${p1.y} ${p1.x} ${p1.y}`;
  }
  const area = `${line} L ${pts[pts.length - 1].x} ${pad.top + innerH} L ${pts[0].x} ${pad.top + innerH} Z`;
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={H}>
      <Defs>
        <SvgLinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <Stop offset="100%" stopColor={color} stopOpacity="0" />
        </SvgLinearGradient>
      </Defs>
      {[-70, -90, -110].map((v, i) => {
        const y = pad.top + innerH - ((v - min) / range) * innerH;
        return <Line key={i} x1={0} y1={y} x2={width} y2={y} stroke="#edf1f8" strokeWidth={1} strokeDasharray="4 5" />;
      })}
      <Path d={area} fill="url(#area)" />
      <Path d={line} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={last.x} cy={last.y} r={9} fill={color} opacity={0.18} />
      <Circle cx={last.x} cy={last.y} r={5} fill="#fff" stroke={color} strokeWidth={3} />
    </Svg>
  );
}

// ═══ خانة زجاجية داخل الترويسة ═══
function GlassStat({ label, value, unit, trend }: { label: string; value?: string | number; unit?: string; trend?: Trend }) {
  return (
    <View style={a.gStat}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5 }}>
        <Text style={a.gLbl}>{label}</Text>
        {trend && <TrendMark t={trend} light />}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={a.gVal} numberOfLines={1} adjustsFontSizeToFit>{value ?? '—'}</Text>
        {!!unit && value !== undefined && <Text style={a.gUnit}> {unit}</Text>}
      </View>
    </View>
  );
}

// ═══ خانة معلومة تحت العدادين ═══
function InfoPill({ icon, label, value, color, bg }: { icon: IconName; label: string; value?: string; color: string; bg: string }) {
  return (
    <View style={a.pill}>
      <View style={[a.pillIcon, { backgroundColor: bg }]}>
        <Icon name={icon} size={14} color={color} stroke={2.2} />
      </View>
      <Text style={a.pillLbl}>{label}</Text>
      <Text style={[a.pillVal, { color: value ? P.text : P.faint }]} numberOfLines={1} adjustsFontSizeToFit>{value ?? '—'}</Text>
    </View>
  );
}

// ═══ خانة في بطاقة أفضل نقطة ═══
function DirStat({ icon, label, value, color, bg }: { icon: IconName; label: string; value: string; color: string; bg: string }) {
  return (
    <View style={a.dirStat}>
      <View style={[a.dirIcon, { backgroundColor: bg }]}>
        <Icon name={icon} size={16} color={color} stroke={2.2} />
      </View>
      <Text style={a.dirLbl}>{label}</Text>
      <Text style={[a.dirVal, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}


// ═══ ألوان العدادين الأصلية (بدون تغيير) ═══
const O_SUCCESS = '#13B783';
const O_DANGER = '#DC2626';
const O_MUTED = '#71809A';

// ═══ مؤشر الإشارة (Hero) ═══
function SignalHero({
  rsrp, sinr, baselineRsrp, baselineSinr, rsrpHistory, sinrHistory, rsrpColor, sinrColor,
}: {
  rsrp?: number;
  sinr?: number;
  baselineRsrp: number | null;
  baselineSinr: number | null;
  rsrpHistory: number[];
  sinrHistory: (number | undefined)[];
  rsrpColor: string;
  sinrColor: string;
}) {
  const deltaR = rsrp !== undefined && baselineRsrp !== null ? rsrp - baselineRsrp : undefined;
  const deltaS = sinr !== undefined && baselineSinr !== null ? sinr - baselineSinr : undefined;

  const prevR = rsrpHistory.length >= 2 ? rsrpHistory[rsrpHistory.length - 2] : undefined;
  const trendR: 'up' | 'down' | 'flat' =
    rsrp !== undefined && prevR !== undefined
      ? rsrp > prevR + 0.5 ? 'up' : rsrp < prevR - 0.5 ? 'down' : 'flat'
      : 'flat';
  const arrowR = trendR === 'up' ? '↑' : trendR === 'down' ? '↓' : '•';
  const trendColorR = trendR === 'up' ? O_SUCCESS : trendR === 'down' ? O_DANGER : O_MUTED;

  const sinrClean = sinrHistory.filter((v): v is number => v !== undefined);
  const prevS = sinrClean.length >= 2 ? sinrClean[sinrClean.length - 2] : undefined;
  const trendS: 'up' | 'down' | 'flat' =
    sinr !== undefined && prevS !== undefined
      ? sinr > prevS + 0.5 ? 'up' : sinr < prevS - 0.5 ? 'down' : 'flat'
      : 'flat';
  const arrowS = trendS === 'up' ? '↑' : trendS === 'down' ? '↓' : '•';
  const trendColorS = trendS === 'up' ? O_SUCCESS : trendS === 'down' ? O_DANGER : O_MUTED;

  return (
    <View style={h.wrap}>
      {/* بطاقة RSRP — spark على اليمين */}
      <View style={[h.card, { borderColor: rsrpColor + '40' }]}>
        <View style={h.cardHead}>
          <Text style={[h.arrow, { color: trendColorR }]}>{arrowR}</Text>
          <Text style={h.cardLbl}>RSRP</Text>
        </View>
        <View style={h.bodyRow}>
          {/* spark يمين */}
          <VSpark value={rsrp} min={-120} max={-70} color={rsrpColor} count={12} />
          {/* قيمة يسار */}
          <View style={h.valueCol}>
            <View style={h.valueRow}>
              <Text style={[h.value, { color: rsrpColor }]}>{rsrp ?? '—'}</Text>
              <Text style={h.unit}>dBm</Text>
            </View>
          </View>
        </View>
        {deltaR !== undefined && (
          <Text style={[h.delta, {
            color: deltaR > 0.5 ? O_SUCCESS : deltaR < -0.5 ? O_DANGER : O_MUTED,
          }]}>
            {deltaR > 0.5 ? `↑ +${Math.round(deltaR)}`
              : deltaR < -0.5 ? `↓ ${Math.round(deltaR)}` : '• 0'} dB
          </Text>
        )}
      </View>

      {/* بطاقة SINR — spark على اليسار */}
      <View style={[h.card, { borderColor: sinrColor + '40' }]}>
        <View style={h.cardHead}>
          <Text style={[h.arrow, { color: trendColorS }]}>{arrowS}</Text>
          <Text style={h.cardLbl}>SINR</Text>
        </View>
        <View style={h.bodyRow}>
          {/* قيمة يمين */}
          <View style={h.valueCol}>
            <View style={h.valueRow}>
              <Text style={[h.value, { color: sinrColor }]}>{sinr ?? '—'}</Text>
              <Text style={h.unit}>dB</Text>
            </View>
          </View>
          {/* spark يسار */}
          <VSpark value={sinr} min={-10} max={30} color={sinrColor} count={12} />
        </View>
        {deltaS !== undefined && (
          <Text style={[h.delta, {
            color: deltaS > 0.5 ? O_SUCCESS : deltaS < -0.5 ? O_DANGER : O_MUTED,
          }]}>
            {deltaS > 0.5 ? `↑ +${Math.round(deltaS)}`
              : deltaS < -0.5 ? `↓ ${Math.round(deltaS)}` : '• 0'} dB
          </Text>
        )}
      </View>
    </View>
  );
}

// ═══ شريط قوة عمودي (12 نقطة) ═══
function VSpark({
  value, min, max, color, count = 12,
}: {
  value?: number;
  min: number;
  max: number;
  color: string;
  count?: number;
}) {
  const strength = value !== undefined
    ? Math.max(0, Math.min(1, (value - min) / (max - min)))
    : 0;
  const lit = Math.round(strength * count);
  return (
    <View style={dot.wrap}>
      {Array.from({ length: count }, (_, i) => {
        // من الأعلى للأسفل: الأعلى = أقوى
        const idx = count - i - 1;
        const on = idx < lit;
        const size = on ? 5 : 4;
        return (
          <View
            key={i}
            style={[
              dot.dot,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: on ? color : '#E0E8F3',
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const dot = StyleSheet.create({
  wrap: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 2, gap: 2,
  },
  dot: {},
});


const h = StyleSheet.create({
  wrap: {
    flexDirection: 'row-reverse', gap: 10, width: '100%',
  },
  card: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16,
    paddingVertical: 12, paddingHorizontal: 10,
    borderWidth: 1.5, gap: 6,
    alignItems: 'center',
  },
  cardHead: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
  },
  cardLbl: { color: O_MUTED, fontSize: 12, fontWeight: '800' },
  arrow: { fontSize: 18, fontWeight: '900' },
  bodyRow: {
    flexDirection: 'row-reverse', alignItems: 'center',
    gap: 6, width: '100%', justifyContent: 'space-between',
  },
  valueCol: { flex: 1, alignItems: 'center' },
  valueRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 2 },
  value: { fontSize: 26, fontWeight: '900', letterSpacing: -1, lineHeight: 30 },
  unit: { color: O_MUTED, fontSize: 10, fontWeight: '800' },
  delta: { fontSize: 10.5, fontWeight: '800' },
});

// ═══ الشاشة ═══
export default function AimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [tech, setTech] = useState<Tech>('LTE');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [baselineSinr, setBaselineSinr] = useState<number | null>(null);
  const [best, setBest] = useState<Reading | null>(null);
  const [haptics, setHaptics] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nrSeen, setNrSeen] = useState(false);
  const [nrCell, setNrCell] = useState<CellTower | null>(null);
  const [pinned, setPinned] = useState<CellId | null>(null);
  // ═══ وضع الفني ═══
  const [live, setLive] = useState<{ code: string; url: string } | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveOn, setLiveOn] = useState(false);
  const [viewers, setViewers] = useState<string[]>([]);
  const [sayMsg, setSayMsg] = useState<{ text: string; from: string; at: number } | null>(null);
  const liveRef = useRef<LiveHost | null>(null);
  const lastRdRef = useRef<{ cell: CellId } | null>(null);
  const pinnedRef = useRef<CellId | null>(null);
  const cmdRef = useRef<(id: number, action: CmdAction, from: string) => void>(() => {});
  useEffect(() => { pinnedRef.current = pinned; }, [pinned]);
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

  // ═══ الصوت — فقط لما المستخدم يضغط ═══
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
        setBaselineSinr(b => (b === null ? (rd.sinr ?? null) : b));
        if (vals.length >= SMOOTH_N && (!bestRef.current || score > bestRef.current.score)) {
          bestRef.current = reading;
          setBest(reading);
        }
        pulse(score);
        beeperRef.current?.update(score);
        lastRdRef.current = rd;
        if (liveRef.current) {
          const b = bestRef.current;
          liveRef.current.send({
            rsrp: smooth ?? rd.rsrp, sinr: rd.sinr, pci: rd.cell.pci, tech: rd.cell.tech,
            band: rd.cell.band ? (rd.cell.tech === 'NR' ? `n${rd.cell.band}` : `B${rd.cell.band}`) : undefined,
            score, level: overallLevel({ rsrp: smooth ?? rd.rsrp, sinr: rd.sinr }),
            best: b ? (b.smooth ?? b.rsrp) : undefined,
            pinned: pinnedRef.current ? cellName(pinnedRef.current) : null,
          });
        }
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
      timer = setInterval(() => tick(r), 2000); // كل ثانيتين لتوفير البطارية
    })();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      if (liveRef.current) {
        liveRef.current.end();
        liveRef.current = null;
        setLive(null);
        deactivateKeepAwake('bandly-live').catch(() => {});
      }
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
    setBaselineSinr(rd?.sinr ?? null);
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
      if (ok) { setPinned(rd.cell); tempPinRef.current = true; reset(); }
      else { Alert.alert('ما نجح التثبيت', 'الراوتر ما ثبت على البرج، فرجّعناه للوضع التلقائي.'); }
    } catch (e: any) {
      Alert.alert('ما نجح التثبيت', e?.message ?? String(e));
    } finally { setPinBusy(false); }
  };

  const pinBest = () => {
    if (!info || !best) return;
    const target = toTarget(best.cell);
    if (!target) { Alert.alert('غير متاح', 'ما عندنا رقم هذا البرج.'); return; }
    Alert.alert('ثبّت على برج أفضل نقطة', `بنثبّت الراوتر على ${cellName(best.cell)} ويبقى مثبّت بعد ما تطلع.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'ثبّت', onPress: async () => {
          setPinBusy(true);
          try {
            const ok = await lockAndVerify(info, target);
            if (ok) { setPinned(best.cell); tempPinRef.current = false; Alert.alert('تم', `الراوتر مثبّت على ${cellName(best.cell)}`); }
            else { Alert.alert('ما نجح', 'الراوتر ما اتصل على هذا البرج.'); }
          } catch (e: any) {
            Alert.alert('ما نجح', e?.message ?? String(e));
          } finally { setPinBusy(false); }
        },
      },
    ]);
  };

  // ═══ وضع الفني — المشاركة ═══
  const shareLink = (c = live) => {
    if (!c) return;
    Share.share({
      message: `ساعدني أضبط إشارة الراوتر 📡\nافتح الرابط وشوف قراءتي مباشرة:\n${c.url}\n\nأو اكتب الكود في Bandly ← وضع الفني: ${c.code}`,
    }).catch(() => {});
  };

  const startShare = async () => {
    if (!info || liveBusy || liveRef.current) return;
    setLiveBusy(true);
    try {
      const s = await createLiveSession(info.name);
      const host = new LiveHost(s.code, s.token, {
        onState: st => setLiveOn(st === 'on'),
        onViewers: (_n, names) => setViewers(names),
        onSay: (text, from) => {
          setSayMsg({ text, from, at: Date.now() });
          if (Platform.OS === 'android') Vibration.vibrate([0, 350, 120, 350]);
          else Vibration.vibrate();
        },
        onCmd: (cid, action, from) => cmdRef.current(cid, action, from),
        onEnd: (why, report) => {
          liveRef.current = null;
          setLive(null);
          setViewers([]);
          deactivateKeepAwake('bandly-live').catch(() => {});
          if (why === 'expired') {
            Alert.alert('انتهت المشاركة', 'انتهت جلسة الفني تلقائياً.'
              + (report?.gain_db != null ? `\nالتحسن: ${report.gain_db > 0 ? '+' : ''}${report.gain_db} dB` : ''));
          }
        },
      });
      liveRef.current = host;
      setLive({ code: s.code, url: s.url });
      activateKeepAwakeAsync('bandly-live').catch(() => {});
      shareLink({ code: s.code, url: s.url });
    } catch (e: any) {
      Alert.alert('ما قدرنا نبدأ المشاركة', `${e?.message ?? e}\nتأكد إن الراوتر متصل بالإنترنت.`);
    } finally {
      setLiveBusy(false);
    }
  };

  const stopShare = () => {
    Alert.alert('إيقاف المشاركة', 'الفني ما راح يشوف قراءتك بعدها. توقف؟', [
      { text: 'لا', style: 'cancel' },
      {
        text: 'أوقف', style: 'destructive', onPress: () => {
          liveRef.current?.end();
          liveRef.current = null;
          setLive(null);
          setViewers([]);
          deactivateKeepAwake('bandly-live').catch(() => {});
        },
      },
    ]);
  };

  // أوامر الفني — ما تتنفذ إلا بموافقة العميل
  cmdRef.current = (cid: number, action: CmdAction, from: string) => {
    const host = liveRef.current;
    if (!host) return;
    const r = infoRef.current;
    if (!r || !canPin) { host.result(cid, false, 'هذا الراوتر ما يدعم التثبيت على برج'); return; }
    let target: CellLockTarget | null = null;
    let cell: CellId | null = null;
    if (action === 'lock_current') { cell = lastRdRef.current?.cell ?? null; target = cell ? toTarget(cell) : null; }
    if (action === 'lock_best') { cell = bestRef.current?.cell ?? null; target = cell ? toTarget(cell) : null; }
    if (action !== 'unlock' && !target) { host.result(cid, false, 'ما عندنا رقم البرج (PCI) للحين'); return; }
    const what = action === 'unlock' ? CMD_LABEL.unlock : `${CMD_LABEL[action]}: ${cellName(cell)}`;
    Vibration.vibrate();
    Alert.alert(`طلب من ${from}`, `${what}\n\nتوافق؟`, [
      { text: 'رفض', style: 'cancel', onPress: () => host.result(cid, false, 'العميل رفض الطلب') },
      {
        text: 'موافق', onPress: async () => {
          setPinBusy(true);
          try {
            if (action === 'unlock') {
              await withSession(r, d => d.unlockCell!(), false);
              setPinned(null);
              tempPinRef.current = false;
              host.result(cid, true, 'تم فك التثبيت — الراوتر على الوضع التلقائي');
            } else {
              const ok = await lockAndVerify(r, target!);
              if (ok) {
                setPinned(cell);
                tempPinRef.current = false;
                host.result(cid, true, `تم التثبيت على ${cellName(cell)}`);
              } else {
                host.result(cid, false, 'الراوتر ما اتصل على هذا البرج، رجع للتلقائي');
              }
            }
          } catch (e: any) {
            host.result(cid, false, `فشل: ${e?.message ?? e}`);
          } finally {
            setPinBusy(false);
          }
        },
      },
    ]);
  };

  // رسالة الفني تختفي بعد ٥ ثواني
  useEffect(() => {
    if (!sayMsg) return;
    const t = setTimeout(() => setSayMsg(m => (m && m.at === sayMsg.at ? null : m)), 5000);
    return () => clearTimeout(t);
  }, [sayMsg]);

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
  // أرقام حقيقية فقط: أفضل قراءة سجّلناها، وكم تبعد عنها الحين
  const gapToBest = bestShown !== undefined && shown !== undefined ? Math.round(bestShown - shown) : undefined;

  const stability = readings.length >= 5
    ? (() => {
        const last = readings.slice(-5).map(r => r.smooth ?? r.rsrp).filter(n => n !== undefined);
        if (last.length < 3) return null;
        const maxDiff = Math.max(...last) - Math.min(...last);
        return maxDiff <= 3 ? 'stable' : maxDiff <= 7 ? 'ok' : 'unstable';
      })()
    : null;

  const chartValues = readings.slice(-30).map(r => r.smooth ?? r.rsrp ?? -110);
  const [chartW, setChartW] = useState(0);

  const rsrpHist = readings.map(r => r.smooth ?? r.rsrp);
  const trendR = trendOf(shown, rsrpHist.length >= 2 ? rsrpHist[rsrpHist.length - 2] : undefined);
  const sinrHist = readings.map(r => r.sinr).filter((v): v is number => v !== undefined);
  const trendS = trendOf(current?.sinr, sinrHist.length >= 2 ? sinrHist[sinrHist.length - 2] : undefined);

  const STAB = {
    stable: { t: 'الإشارة مستقرة', d: 'جودة الاتصال جيدة — يمكنك تحسينها بتحريك الهوائي', c: '#16c784' },
    ok: { t: 'الإشارة متغيرة قليلاً', d: 'جرّب تحريك الراوتر ببطء وانتظر ٣-٥ ثواني', c: '#ffb020' },
    unstable: { t: 'الإشارة متقلبة', d: 'حرّك الراوتر ببطء — الأرقام تتغير بسرعة', c: '#ff5a5f' },
  } as const;
  const stab = stability ? STAB[stability] : null;
  const isNr = tech === 'NR';

  return (
    <View style={a.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[a.content, { paddingBottom: insets.bottom + 110 }]}
      >
        {/* ═══ Header ═══ */}
        <View style={a.header}>
          <Pressable style={a.headerBtn} onPress={reset} hitSlop={6}>
            <Icon name="refresh" size={18} color={TEXT} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={a.headerTitle}>مساعد التوجيه</Text>
            <Text style={a.headerSub}>اضبط اتجاه الهوائي للحصول على أفضل إشارة</Text>
          </View>
          <Pressable style={a.headerBtn} hitSlop={6} onPress={() => Alert.alert('مساعدة',
            '١) اختر 4G أو 5G\n٢) حرّك الراوتر ببطء\n٣) الجوال يهتز أسرع كل ما قويت الإشارة\n٤) لما تلقى أفضل نقطة، ثبّت على البرج')}>
            <Icon name="bulb" size={18} color={PURPLE} />
          </Pressable>
        </View>

        {loading && (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 60 }}>
            <ActivityIndicator size="large" color={BLUE} />
            <Text style={{ color: MUTED }}>نبدأ القياس...</Text>
          </View>
        )}

        {!loading && (
          <>
            {/* ═══ Hero ═══ */}
            {/* ═══ العدادان (كما هما) + شريط المعلومات ═══ */}
            <View style={a.heroCard}>
              <SignalHero
                rsrp={shown}
                sinr={current?.sinr}
                baselineRsrp={baseline}
                baselineSinr={baselineSinr}
                rsrpHistory={readings.map(r => r.smooth ?? r.rsrp ?? -110)}
                sinrHistory={readings.map(r => r.sinr)}
                rsrpColor={lvlColor}
                sinrColor="#3567F5"
              />

              <View style={a.infoStrip}>
                <InfoPill icon="tower" label="PCI" value={current?.cell.pci} color={PURPLE} bg={P.violetSoft} />
                <InfoPill icon="bands" label="الباند" value={currentBand} color={BLUE} bg={P.blueSoft} />
                <InfoPill icon="spark" label="التقييم" value={current ? `${lvlLabel(level)} · ${Math.round(pct * 100)}%` : undefined} color={lvlColor} bg={lvlColor + '1A'} />
              </View>

              {stab ? (
                <View style={[a.stabBar, { backgroundColor: stab.c + '14', borderColor: stab.c + '40' }]}>
                  <View style={[a.stabIcon, { backgroundColor: stab.c }]}>
                    <Icon name={stability === 'stable' ? 'check' : 'bulb'} size={15} color="#fff" stroke={2.6} />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={[a.stabTitle, { color: stab.c }]}>{stab.t}</Text>
                    <Text style={a.stabSub}>{stab.d}</Text>
                  </View>
                </View>
              ) : (
                <View style={[a.stabBar, { backgroundColor: P.soft, borderColor: P.border }]}>
                  <ActivityIndicator size="small" color={MUTED} />
                  <Text style={[a.stabSub, { flex: 1 }]}>نجمع القراءات لتقييم ثبات الإشارة…</Text>
                </View>
              )}
            </View>

            {/* ═══ وضع الفني: شارك مع فني ═══ */}
            {!live ? (
              <Section title="شارك مع فني" sub="الفني يشوف قراءتك حيّة ويوجّهك وهو في مكانه" icon="share"
                tone={P.cyan} toneSoft={P.cyanSoft}>
                <PrimaryBtn small text="شارك قراءتي مع فني" icon="share" onPress={startShare} busy={liveBusy}
                  colors={['#0ea5c6', '#2f6bff']} style={{ marginTop: 12 }} />
                <Pressable onPress={() => Linking.openURL(`${LIVE_BASE}/live/`).catch(() => {})} style={a.linkRow}>
                  <Text style={a.linkTxt}>ما عندك فني؟ شوف الفنيين المعتمدين</Text>
                </Pressable>
              </Section>
            ) : (
              <View style={a.liveCard}>
                <View style={a.liveHead}>
                  <View style={[a.liveDot, { backgroundColor: liveOn ? '#16c784' : '#ffb020' }]} />
                  <Text style={a.liveTitle}>{liveOn ? 'المشاركة شغالة' : 'نعيد الاتصال…'}</Text>
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={stopShare} hitSlop={8} style={a.liveStop}>
                    <Text style={a.liveStopTxt}>إيقاف</Text>
                  </Pressable>
                </View>
                <Text style={a.liveLbl}>كود الجلسة</Text>
                <Text style={a.liveCode}>{live.code.slice(0, 3)} {live.code.slice(3)}</Text>
                <Text style={a.liveViewers}>
                  {viewers.length ? `👀 ${viewers.join('، ')} يتابع قراءتك الحين` : 'بانتظار الفني يفتح الرابط…'}
                </Text>
                <PrimaryBtn small text="أرسل الرابط للفني" icon="share" onPress={() => shareLink()}
                  colors={['#0ea5c6', '#2f6bff']} style={{ marginTop: 10, alignSelf: 'stretch' }} />
                <Text style={a.liveHint}>خلّ التطبيق مفتوح على هذي الشاشة لين يخلص الفني — الشاشة ما راح تنطفي.</Text>
              </View>
            )}

            {/* ═══ Band selector ═══ */}
            <Section title="اختيار التردد" sub="الترددات المتاحة على شبكتك" icon="bands">
              <View style={a.segment}>
                {(['LTE', 'NR'] as Tech[]).map(t => {
                  const on = tech === t;
                  const disabled = t === 'NR' && !nrSeen && !nrActive;
                  return (
                    <Pressable key={t}
                      style={[a.segBtn, on && [a.segOn, { backgroundColor: t === 'NR' ? PURPLE : BLUE }], disabled && { opacity: 0.4 }]}
                      onPress={() => !disabled && switchTech(t)}
                      disabled={disabled}
                    >
                      <Text style={[a.segTxt, on && { color: '#FFF' }]}>{t === 'NR' ? '5G' : '4G LTE'}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {bandList.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={a.chipsRow}>
                  {bandList.map(b => {
                    const on = currentBand === b;
                    const nr = b.startsWith('n');
                    const col = nr ? PURPLE : BLUE;
                    return (
                      <View key={b} style={[a.chip, on && { backgroundColor: col, borderColor: col }]}>
                        {on && <View style={a.chipDot} />}
                        <Text style={[a.chipTxt, { color: on ? '#FFF' : col }]}>{b}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </Section>

            {/* ═══ Best Direction ═══ */}
            {best && (
              <Section title="أفضل نقطة توجيه" sub="ارجع الهوائي لهذي الزاوية" icon="aim"
                tone={PURPLE} toneSoft={P.violetSoft}>
                <View style={a.dirBody}>
                  <DirStat icon="spark" label="أفضل قراءة" color={SUCCESS} bg={P.greenSoft}
                    value={bestShown !== undefined ? `${Math.round(bestShown)} dBm` : '—'} />
                  <DirStat icon="pin" label="أنت الحين"
                    color={gapToBest !== undefined && gapToBest > 1 ? WARN : BLUE}
                    bg={gapToBest !== undefined && gapToBest > 1 ? P.amberSoft : P.blueSoft}
                    value={gapToBest === undefined ? '—' : gapToBest <= 1 ? 'عليها ✓' : `أقل بـ ${gapToBest} dB`} />
                  <DirStat icon="tower" label="البرج" color={PURPLE} bg={P.violetSoft} value={cellName(best.cell)} />
                </View>

                {canPin && best.cell.pci && cellKey(pinned) !== cellKey(best.cell) && (
                  <PrimaryBtn small text="ثبّت على برج أفضل نقطة" icon="pin" onPress={pinBest} busy={pinBusy} style={{ marginTop: 12 }} />
                )}

                {pinned && (
                  <Pressable style={a.pinnedBtn} onPress={pinDuringAim} disabled={pinBusy}>
                    {pinBusy ? <ActivityIndicator color={BLUE} /> : (
                      <>
                        <Text style={a.pinnedTxt}>مثبّت على {cellName(pinned)} — اضغط للفك</Text>
                        <Icon name="check" size={16} color={BLUE} stroke={2.6} />
                      </>
                    )}
                  </Pressable>
                )}
              </Section>
            )}

            {/* ═══ 5G Hunt ═══ */}
            {waitingNr && (
              <Section title="صيد إشارة 5G"
                sub={waking !== null ? 'نبحث — حرّك الراوتر ببطء' : '5G ما يظهر إلا وقت التحميل'}
                icon="antenna" tone={PURPLE} toneSoft={P.violetSoft}>
                {waking !== null ? (
                  <Pressable style={a.wakeOn} onPress={wake5g}>
                    <ActivityIndicator size="small" color={PURPLE} />
                    <Text style={a.wakeOnTxt}>إيقاف البحث ({waking}ث)</Text>
                  </Pressable>
                ) : (
                  <PrimaryBtn small text="ابحث عن 5G" icon="spark" onPress={wake5g}
                    colors={['#6a45ec', '#a24bd8']} style={{ marginTop: 12 }} />
                )}
              </Section>
            )}

            {/* ═══ الصوت والاهتزاز ═══ */}
            <View style={a.togglesRow}>
              <ToggleCard on={sound} label="تفعيل الصوت" onLabel="الصوت مفعّل" icon="sound" color={PURPLE} onPress={() => setSound(v => !v)} />
              <ToggleCard on={haptics} label="تشغيل الاهتزاز" onLabel="اهتزاز مفعّل" icon="vibrate" color={SUCCESS} onPress={() => setHaptics(v => !v)} />
            </View>

            {/* ═══ Chart ═══ */}
            {readings.length > 3 && (
              <Section title="تاريخ قوة الإشارة" sub={`آخر ${Math.min(30, readings.length)} قراءة`} icon="chart"
                right={<Chip text={`${shown ?? '—'} dBm`} color="#fff" bg={lvlColor} />}>
                <View style={{ marginTop: 12 }} onLayout={e => setChartW(e.nativeEvent.layout.width)}>
                  <LineChart values={chartValues} min={-125} max={-60} color={lvlColor} width={chartW} />
                </View>
                <View style={a.chartLabels}>
                  <Text style={a.chartLbl}>قبل قليل</Text>
                  <Text style={a.chartLbl}>الآن</Text>
                </View>
              </Section>
            )}

            {/* ═══ Tips ═══ */}
            <Collapse title="نصائح لتحسين الإشارة" icon="bulb" tone={WARN} toneSoft={P.amberSoft}>
              {[
                'ارفع الهوائي لأعلى نقطة ممكنة',
                'ابتعد عن العوائق المعدنية والجدران السميكة',
                'جرّب الاتجاهات المختلفة حتى تجد أفضل إشارة',
                'ثبّت الهوائي عند الوصول لأفضل قراءة',
              ].map((t, i) => (
                <View key={i} style={a.tipRow}>
                  <View style={a.tipNum}><Text style={a.tipNumTxt}>{i + 1}</Text></View>
                  <Text style={a.tipTxt}>{t}</Text>
                </View>
              ))}
            </Collapse>

            {!!error && <Text style={a.err}>{error}</Text>}
          </>
        )}
      </ScrollView>

      {/* ═══ رسالة الفني ═══ */}
      {sayMsg && (
        <Pressable onPress={() => setSayMsg(null)} style={[a.sayWrap, { top: insets.top + 8 }]}>
          <View style={a.sayBox}>
            <Text style={a.sayFrom}>{sayMsg.from} يقول:</Text>
            <Text style={a.sayTxt}>{sayMsg.text}</Text>
          </View>
        </Pressable>
      )}

      {/* ═══ CTA أسفل ═══ */}
      {!loading && (
        <View style={[a.footer, { paddingBottom: insets.bottom + 12 }]}>
          <PrimaryBtn text="ابدأ التوجيه الآن" icon="aim"
            onPress={() => { reset(); if (!sound) setSound(true); }}
            style={a.cta} />
        </View>
      )}
    </View>
  );
}

const a = StyleSheet.create({
  container: { flex: 1, backgroundColor: P.bg },
  content: { paddingHorizontal: 16, paddingTop: 10, gap: 14 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  headerBtn: {
    width: 44, height: 44, borderRadius: 15, backgroundColor: P.card,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: P.border, ...shadow,
  },
  headerTitle: { fontSize: 21, fontWeight: '800', color: TEXT, textAlign: 'center' },
  headerSub: { fontSize: 11.5, color: MUTED, textAlign: 'center', marginTop: 1 },

  heroCard: {
    backgroundColor: P.card, borderRadius: 24, padding: 14, gap: 12,
    borderWidth: 1, borderColor: P.border, ...shadow,
  },
  infoStrip: { flexDirection: 'row-reverse', gap: 8 },
  pill: {
    flex: 1, alignItems: 'center', gap: 3, backgroundColor: P.soft, borderRadius: 16,
    paddingVertical: 10, paddingHorizontal: 6, borderWidth: 1, borderColor: P.border,
  },
  pillIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  pillLbl: { color: MUTED, fontSize: 10.5, fontWeight: '700' },
  pillVal: { fontSize: 14, fontWeight: '800' },
  stabBar: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12 },
  stabIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stabTitle: { fontSize: 13, fontWeight: '800', textAlign: 'right' },
  stabSub: { color: MUTED, fontSize: 11.5, textAlign: 'right', marginTop: 1 },
  heroTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: 8 },
  heroTag: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexShrink: 1,
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 10, height: 28,
  },
  heroTagTxt: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  stabDot: { width: 8, height: 8, borderRadius: 4 },
  ringLbl: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  ringVal: { color: '#fff', fontSize: 50, fontWeight: '800', letterSpacing: -2, lineHeight: 58 },
  ringUnit: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '700' },
  ringRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  ringLevel: { color: '#fff', fontSize: 13, fontWeight: '800' },
  deltaPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginTop: -6 },
  deltaTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },

  gRow: {
    flexDirection: 'row-reverse', marginTop: 14, backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 18, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  gStat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  gSep: { width: 1, backgroundColor: 'rgba(255,255,255,0.22)', marginVertical: 4 },
  gLbl: { color: 'rgba(255,255,255,0.78)', fontSize: 11, fontWeight: '700' },
  gVal: { color: '#fff', fontSize: 19, fontWeight: '800' },
  gUnit: { color: 'rgba(255,255,255,0.8)', fontSize: 10.5, fontWeight: '700' },
  heroHint: { color: 'rgba(255,255,255,0.85)', fontSize: 11.5, textAlign: 'center', marginTop: 10 },

  trend: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  flat: { width: 8, height: 8, borderRadius: 4, backgroundColor: P.faint, marginHorizontal: 4 },

  segment: { flexDirection: 'row-reverse', backgroundColor: P.soft, borderRadius: 16, padding: 4, marginTop: 14, borderWidth: 1, borderColor: P.border },
  segBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  segOn: { ...shadow, shadowOpacity: 0.15 },
  segTxt: { color: TEXT, fontWeight: '800', fontSize: 13.5 },

  chipsRow: { flexDirection: 'row-reverse', gap: 8, paddingTop: 12 },
  chip: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
    height: 34, paddingHorizontal: 16, borderRadius: 17,
    backgroundColor: P.card, borderWidth: 1.5, borderColor: P.border,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  chipTxt: { fontWeight: '800', fontSize: 12.5 },

  dirBody: { flexDirection: 'row-reverse', gap: 8, marginTop: 14 },
  dirStat: {
    flex: 1, alignItems: 'center', gap: 4, backgroundColor: P.soft, borderRadius: 16,
    paddingVertical: 12, paddingHorizontal: 6, borderWidth: 1, borderColor: P.border,
  },
  dirIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  dirLbl: { color: MUTED, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  dirVal: { fontSize: 14.5, fontWeight: '800', textAlign: 'center' },

  pinnedBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: P.blueSoft, borderRadius: 16, paddingVertical: 12, marginTop: 10,
  },
  pinnedTxt: { color: BLUE, fontWeight: '800', fontSize: 13 },

  wakeOn: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12,
    backgroundColor: P.violetSoft, borderRadius: 16, paddingVertical: 12, borderWidth: 1.5, borderColor: PURPLE + '55',
  },
  wakeOnTxt: { color: PURPLE, fontWeight: '800', fontSize: 13 },

  togglesRow: { flexDirection: 'row-reverse', gap: 10 },

  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, paddingHorizontal: 4 },
  chartLbl: { color: P.faint, fontSize: 10.5, fontWeight: '700' },

  tipRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 5 },
  tipNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: P.amberSoft, alignItems: 'center', justifyContent: 'center' },
  tipNumTxt: { color: WARN, fontSize: 11, fontWeight: '800' },
  tipTxt: { flex: 1, textAlign: 'right', color: '#4b5675', fontSize: 13, lineHeight: 20 },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 10, backgroundColor: P.bg + 'F2',
  },
  cta: {
    borderRadius: 20, shadowColor: P.heroB, shadowOpacity: 0.35,
    shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },

  linkRow: { alignSelf: 'center', paddingTop: 10 },
  linkTxt: { color: P.cyan, fontSize: 12.5, fontWeight: '700' },
  liveCard: {
    backgroundColor: '#eaf8fc', borderRadius: 22, padding: 16, borderWidth: 1.5, borderColor: '#bfeaf5', alignItems: 'center',
  },
  liveHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  liveTitle: { color: TEXT, fontSize: 14.5, fontWeight: '800' },
  liveStop: { backgroundColor: '#ffeef0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  liveStopTxt: { color: DANGER, fontWeight: '800', fontSize: 12.5 },
  liveLbl: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 12 },
  liveCode: { color: TEXT, fontSize: 40, fontWeight: '800', letterSpacing: 4 },
  liveViewers: { color: '#0b7f99', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  liveHint: { color: MUTED, fontSize: 11.5, textAlign: 'center', marginTop: 10, lineHeight: 17 },
  sayWrap: { position: 'absolute', left: 16, right: 16, zIndex: 50 },
  sayBox: {
    backgroundColor: '#0f1f45', borderRadius: 22, paddingVertical: 18, paddingHorizontal: 16, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  sayFrom: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '700' },
  sayTxt: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: 4 },

  err: { color: DANGER, fontSize: 12, textAlign: 'center' },
});
