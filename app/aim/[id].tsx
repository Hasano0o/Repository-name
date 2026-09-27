import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
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
            <Hero colors={isNr ? ['#6a45ec', '#a24bd8'] : [P.heroA, P.heroB]}>
              <View style={a.heroTop}>
                <View style={a.heroTag}>
                  <Icon name="tower" size={13} color="#fff" stroke={2.2} />
                  <Text style={a.heroTagTxt} numberOfLines={1}>{current ? cellName(current.cell) : isNr ? '5G' : '4G'}</Text>
                </View>
                {stab ? (
                  <View style={a.heroTag}>
                    <View style={[a.stabDot, { backgroundColor: stab.c }]} />
                    <Text style={a.heroTagTxt}>{stab.t}</Text>
                  </View>
                ) : (
                  <View style={a.heroTag}>
                    <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.7 }] }} />
                    <Text style={a.heroTagTxt}>نجمع القراءات</Text>
                  </View>
                )}
              </View>

              <View style={{ alignItems: 'center', marginTop: 8 }}>
                <Ring ratio={pct} size={196} stroke={14}>
                  <Text style={a.ringLbl}>RSRP</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <Text style={a.ringVal}>{shown ?? '—'}</Text>
                    {shown !== undefined && <Text style={a.ringUnit}> dBm</Text>}
                  </View>
                  <View style={a.ringRow}>
                    <TrendMark t={trendR} light />
                    <Text style={a.ringLevel}>{current ? lvlLabel(level) : '—'} · {Math.round(pct * 100)}%</Text>
                  </View>
                </Ring>
                {delta !== undefined && (
                  <View style={[a.deltaPill, { backgroundColor: delta > 0.5 ? 'rgba(22,199,132,0.9)' : delta < -0.5 ? 'rgba(255,90,95,0.9)' : 'rgba(255,255,255,0.2)' }]}>
                    <Text style={a.deltaTxt}>
                      {delta > 0.5 ? `+${Math.round(delta)}` : delta < -0.5 ? `${Math.round(delta)}` : '0'} dB عن البداية
                    </Text>
                  </View>
                )}
              </View>

              <View style={a.gRow}>
                <GlassStat label="SINR" value={current?.sinr} unit="dB" trend={trendS} />
                <View style={a.gSep} />
                <GlassStat label="الباند" value={currentBand} />
                <View style={a.gSep} />
                <GlassStat label="PCI" value={current?.cell.pci} />
              </View>

              {!!stab && <Text style={a.heroHint}>{stab.d}</Text>}
            </Hero>

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

  err: { color: DANGER, fontSize: 12, textAlign: 'center' },
});
