/**
 * 🎯 صيد الإشارة — بوصلة توجيه الأنتنا الخارجية.
 * المستخدم يحط الجوال على الأنتنا (أو بنفس اتجاهها) ويلفّها ببطء:
 * نربط كل قراءة إشارة باتجاه البوصلة، نلوّن الحلقة (بارد ← حار)، والسهم يأشر لأقوى اتجاه.
 * البوصلة من expo-sensors — نحمّلها بـ require داخل try عشان النسخ القديمة (بدون المكتبة)
 * توصلها هالشاشة بالتحديث عن بُعد وتعرض «حدّث التطبيق» بدل ما يطيح.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Vibration } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { CellTower, Signal } from '../../src/drivers/types';
import { BAND_FREQ, NR_FREQ } from '../../src/utils/bands';
import { Icon, IconName } from '../../src/ui/Icon';
import { P, shadow } from '../../src/ui/Pro';
import { isDark, tBg, tBd, tFg } from '../../src/ui/theme';
import { sheet, L } from '../../src/i18n';

// ═══ البوصلة (اختيارية) ═══
let Magnetometer: any = null;
try { Magnetometer = require('expo-sensors/build/Magnetometer').default; } catch { Magnetometer = null; }

type Tech = 'LTE' | 'NR';
type Phase = 'loading' | 'nomod' | 'nosensor' | 'scan' | 'found';

const BINS = 24; // كل خانة ١٥°
const STEP = 360 / BINS;
const R = 120;
const CIRC = 2 * Math.PI * R;
const SEG = (CIRC / BINS) * 0.87;
const HEAT = ['#8cc4ff', '#5fc3f5', '#4fd1e8', '#5be0b0', '#7ce98f', '#c9e86a', '#ffc54d', '#ffa63d'];
const UNSCANNED = 'rgba(170,205,255,0.38)';
const DIRS = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
const HERO: [string, string] = isDark ? [P.heroA, P.heroB] : ['#4a95ff', '#1f47c9'];
const KEY = (id: string) => `bandly.hunt.${id}`;
/** حكم الراوتر على المكان (١–٤) — من صفحة «الموقع المقترح» في ZTE */
const PLACE_Q: Record<number, { t: string; bg: string; fg: string }> = {
  4: { t: 'مثالي — حط الراوتر هنا', bg: P.greenSoft, fg: tFg('#1d8f58') },
  3: { t: 'ممتاز — مكان مناسب للراوتر', bg: P.greenSoft, fg: tFg('#1d8f58') },
  2: { t: 'جيد، بس ممكن يتأثر بالجو أو اللي حوله — جرّب مكان ثاني', bg: P.amberSoft, fg: tFg('#8a5a00') },
  1: { t: 'ضعيف — غيّر مكان الراوتر', bg: P.redSoft, fg: tFg('#b3261e') },
};

const norm = (d: number) => ((d % 360) + 360) % 360;
/** الفرق من -180 لـ 180 (موجب = يمين / مع عقارب الساعة) */
const diff = (to: number, from: number) => ((to - from + 540) % 360) - 180;
const dirName = (deg: number) => DIRS[Math.round(norm(deg) / 45) % 8];
const scoreOf = (rsrp?: number, sinr?: number) => (rsrp === undefined ? undefined : rsrp + 0.5 * (sinr ?? 0));

function readOf(sig: Signal | null, tech: Tech): { rsrp?: number; sinr?: number } | null {
  if (!sig) return null;
  if (tech === 'NR') return sig.nrRsrp === undefined ? null : { rsrp: sig.nrRsrp, sinr: sig.nrSinr };
  return sig.rsrp === undefined ? null : { rsrp: sig.rsrp, sinr: sig.sinr };
}

interface Saved { deg: number; at: number; rsrp?: number }

export default function HuntScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const nav = useRouter();

  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [tech, setTech] = useState<Tech>('LTE');
  const [heading, setHeading] = useState(0);
  const [bins, setBins] = useState<(number | null)[]>(() => Array(BINS).fill(null));
  const [cur, setCur] = useState<{ rsrp?: number; sinr?: number } | null>(null);
  const [start, setStart] = useState<{ rsrp?: number; sinr?: number } | null>(null);
  const [cells, setCells] = useState<CellTower[]>([]);
  const [showCells, setShowCells] = useState(true);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // فحص المكان من الراوتر نفسه (ZTE) — null = غير مدعوم
  const [placeSup, setPlaceSup] = useState(false);
  const [placeStep, setPlaceStep] = useState<number | null>(null);
  const [placeQ, setPlaceQ] = useState<number | null>(null);
  const [placeErr, setPlaceErr] = useState('');
  const placeAlive = useRef(true);

  const headRef = useRef(0);
  const vec = useRef({ x: 0, y: 1, init: false });
  const techRef = useRef<Tech>('LTE');
  techRef.current = tech;
  const foundBuzzed = useRef(false);

  // ═══ تحميل الراوتر والاتجاه المحفوظ ═══
  useEffect(() => {
    (async () => {
      setInfo(await getRouter(id));
      try {
        const raw = await AsyncStorage.getItem(KEY(id));
        if (raw) setSaved(JSON.parse(raw));
      } catch {}
    })();
  }, [id]);

  useEffect(() => {
    if (!info) return;
    placeAlive.current = true;
    // ZTE: فحص الراوتر نفسه — غيره (هواوي…): نقيس من التطبيق بنفس الأحكام الأربعة
    withSession(info, async d => [!!d.placeCheckStart, !!d.getSignal] as const)
      .then(([own, sig]) => { placeOwn.current = own; setPlaceSup(own || sig); }).catch(() => {});
    return () => {
      placeAlive.current = false;
      // لو طلع وهو يفحص نلغي الفحص في الراوتر
      if (placeRunning.current) withSession(info, d => (d.placeCheckCancel ? d.placeCheckCancel() : Promise.resolve())).catch(() => {});
    };
  }, [info]);
  const placeRunning = useRef(false);
  const placeOwn = useRef(false);

  /** فحص من التطبيق: ٤ مراحل × ٥ ثواني، نجمع القوة والصفاء ونحكم بالمتوسط */
  const appPlaceCheck = async (): Promise<number | null> => {
    const rs: number[] = [], ss: number[] = [];
    for (let stage = 0; stage < 4; stage++) {
      setPlaceStep(stage);
      for (let k = 0; k < 4 && placeAlive.current; k++) {
        const sig = await withSession(info!, d => d.getSignal!()).catch(() => null);
        const r = readOf(sig, techRef.current);
        if (r?.rsrp !== undefined) rs.push(r.rsrp);
        if (r?.sinr !== undefined) ss.push(r.sinr);
        await new Promise(res => setTimeout(res, 1250));
      }
      if (!placeAlive.current) return null;
    }
    if (!rs.length) throw new Error('ما قدرنا نقرأ الإشارة من الراوتر');
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const rsrp = avg(rs);
    const sinr = ss.length ? avg(ss) : 10;
    if (rsrp >= -85 && sinr >= 15) return 4;
    if (rsrp >= -95 && sinr >= 8) return 3;
    if (rsrp >= -105 && sinr >= 0) return 2;
    return 1;
  };

  const runPlaceCheck = async () => {
    if (!info || placeRunning.current) return;
    placeRunning.current = true;
    setPlaceErr(''); setPlaceQ(null); setPlaceStep(0);
    try {
      if (!placeOwn.current) {
        const q = await appPlaceCheck();
        if (q && placeAlive.current) {
          setPlaceStep(4); setPlaceQ(q);
          Vibration.vibrate(Platform.OS === 'android' ? 60 : 300);
        }
        return;
      }
      await withSession(info, d => d.placeCheckStart!(), false);
      const t0 = Date.now();
      let sawRunning = false;
      while (placeAlive.current && Date.now() - t0 < 150_000) {
        await new Promise(r => setTimeout(r, 1500));
        const st = await withSession(info, d => d.placeCheckStatus!()).catch(() => null);
        if (!st || !placeAlive.current) continue;
        if (st.step < 4) { sawRunning = true; setPlaceStep(st.step); continue; }
        // «٤» من فحص قديم: ما نصدّقها إلا بعد ما شفناه يشتغل أو مرّت ٨ ثواني
        if ((sawRunning || Date.now() - t0 > 8000) && st.quality) {
          setPlaceStep(4); setPlaceQ(st.quality);
          Vibration.vibrate(Platform.OS === 'android' ? 60 : 300);
          return;
        }
      }
      if (placeAlive.current) setPlaceErr('الراوتر ما رجّع نتيجة — جرّب مرة ثانية');
    } catch (e: any) {
      if (placeAlive.current) setPlaceErr(e?.message ?? 'ما قدرنا نبدأ الفحص');
    } finally {
      placeRunning.current = false;
      if (placeAlive.current) setPlaceStep(st => (st === 4 ? 4 : null));
    }
  };

  // ═══ البوصلة ═══
  useFocusEffect(useCallback(() => {
    let sub: any = null;
    let alive = true;
    activateKeepAwakeAsync('hunt').catch(() => {});
    (async () => {
      if (!Magnetometer) { setPhase('nomod'); return; }
      let ok = false;
      try { ok = await Magnetometer.isAvailableAsync(); } catch { ok = false; }
      if (!alive) return;
      if (!ok) { setPhase('nosensor'); return; }
      setPhase(p => (p === 'loading' ? 'scan' : p));
      try { Magnetometer.setUpdateInterval(100); } catch {}
      sub = Magnetometer.addListener(({ x, y }: { x: number; y: number }) => {
        // الجوال مسطّح وأعلاه باتجاه الأنتنا: الشمال = 0°، الشرق = 90°
        const a = Math.atan2(-x, y);
        const v = vec.current;
        if (!v.init) { v.x = Math.cos(a); v.y = Math.sin(a); v.init = true; }
        else { v.x = v.x * 0.82 + Math.cos(a) * 0.18; v.y = v.y * 0.82 + Math.sin(a) * 0.18; }
        const deg = norm((Math.atan2(v.y, v.x) * 180) / Math.PI);
        if (Math.abs(diff(deg, headRef.current)) >= 1) { headRef.current = deg; setHeading(Math.round(deg)); }
      });
    })();
    return () => { alive = false; sub?.remove?.(); deactivateKeepAwake('hunt'); };
  }, []));

  // ═══ قراءة الإشارة كل ثانيتين وربطها بالاتجاه ═══
  useFocusEffect(useCallback(() => {
    let alive = true;
    let busy = false;
    let n = 0;
    const tick = async () => {
      if (busy || !info) return;
      busy = true;
      try {
        const sig = await withSession(info, d => (d.getSignal ? d.getSignal() : Promise.resolve(null as any)));
        if (!alive) return;
        const r = readOf(sig, techRef.current);
        setCur(r);
        if (r) {
          setStart(s => s ?? r);
          const sc = scoreOf(r.rsrp, r.sinr);
          if (sc !== undefined) {
            const i = Math.round(norm(headRef.current) / STEP) % BINS;
            setBins(b => {
              const nb = b.slice();
              nb[i] = nb[i] === null ? sc : Math.max(nb[i] as number, sc * 0.6 + (nb[i] as number) * 0.4);
              return nb;
            });
          }
        }
        if (n++ % 3 === 0 && info) {
          const cs = await withSession(info, d => (d.getCells ? d.getCells() : Promise.resolve([] as CellTower[])));
          if (alive) setCells(cs ?? []);
        }
      } catch {} finally { busy = false; }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [info]));

  // ═══ الحساب ═══
  const calc = useMemo(() => {
    const vals = bins.filter((v): v is number => v !== null);
    const scanned = vals.length;
    const min = scanned ? Math.min(...vals) : 0;
    const max = scanned ? Math.max(...vals) : 0;
    let best = -1;
    bins.forEach((v, i) => { if (v !== null && (best < 0 || v > (bins[best] as number))) best = i; });
    const bestDeg = best >= 0 ? best * STEP : undefined;
    const ready = scanned >= 4 && max - min >= 2;
    const target = ready ? bestDeg : saved?.deg;
    const delta = target === undefined ? undefined : Math.round(diff(target, heading));
    const sc = scoreOf(cur?.rsrp, cur?.sinr);
    const warm = sc === undefined || !ready ? 0 : Math.max(0, Math.min(1, (sc - min) / Math.max(1, max - min)));
    return { scanned, min, max, bestDeg, ready, target, delta, warm, sc };
  }, [bins, heading, cur, saved]);

  // ═══ لقينا الاتجاه / ابتعدنا عنه ═══
  useEffect(() => {
    if (phase !== 'scan' && phase !== 'found') return;
    const { ready, delta, sc, max } = calc;
    if (phase === 'scan' && ready && delta !== undefined && Math.abs(delta) <= 12 && sc !== undefined && sc >= max - 1.5) {
      setPhase('found');
      if (!foundBuzzed.current) {
        foundBuzzed.current = true;
        Vibration.vibrate(Platform.OS === 'android' ? [0, 70, 90, 70] : 400);
      }
    } else if (phase === 'found' && delta !== undefined && Math.abs(delta) > 30) {
      setPhase('scan');
      foundBuzzed.current = false;
    }
  }, [calc, phase]);

  // ═══ حامي / بارد بالاهتزاز ═══
  useEffect(() => {
    if (phase !== 'scan' || !calc.ready) return;
    if (calc.warm >= 0.85) Vibration.vibrate(Platform.OS === 'android' ? 45 : 10);
    else if (calc.warm >= 0.65) Vibration.vibrate(Platform.OS === 'android' ? 20 : 10);
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══ برج مجاور أقوى من البرج الحالي؟ (في الاتجاه الحالي) ═══
  const betterCell = useMemo(() => {
    const serving = cells.find(c => c.kind === 'serving' && c.tech === tech);
    if (!serving || serving.rsrp === undefined) return null;
    const nb = cells
      .filter(c => c.kind === 'neighbor' && c.tech === tech && c.rsrp !== undefined && c.pci !== serving.pci)
      .sort((a, b) => (b.rsrp as number) - (a.rsrp as number))[0];
    if (!nb) return null;
    const gain = Math.round((nb.rsrp as number) - serving.rsrp);
    return gain >= 4 ? { cell: nb, gain } : null;
  }, [cells, tech]);

  const reset = () => {
    setBins(Array(BINS).fill(null));
    setStart(cur);
    setPhase(p => (p === 'found' ? 'scan' : p));
    foundBuzzed.current = false;
    setJustSaved(false);
  };
  const switchTech = (t: Tech) => { if (t === tech) return; setTech(t); setBins(Array(BINS).fill(null)); setStart(null); setCur(null); setPhase(p => (p === 'found' ? 'scan' : p)); };

  const saveDir = async () => {
    const deg = Math.round(calc.bestDeg ?? heading);
    const s: Saved = { deg, at: Date.now(), rsrp: cur?.rsrp };
    setSaved(s); setJustSaved(true);
    try { await AsyncStorage.setItem(KEY(id), JSON.stringify(s)); } catch {}
    Vibration.vibrate(Platform.OS === 'android' ? 30 : 10);
  };

  // ═══ الواجهة ═══
  const found = phase === 'found';
  const status = found || calc.warm >= 0.85
    ? { t: 'حار', dot: '#f0a12a', bg: tBg('#fff6e6'), bd: tBd('#ffdca3'), fg: tFg('#a35d00') }
    : calc.warm >= 0.5
      ? { t: 'دافي', dot: '#34ce83', bg: tBg('#ffffff'), bd: tBd('#bdeed7'), fg: tFg('#1d8f58') }
      : { t: 'يمسح', dot: '#34ce83', bg: tBg('#ffffff'), bd: tBd('#bdeed7'), fg: tFg('#1d8f58') };

  const instruction = !calc.ready
    ? (calc.scanned === 0 && saved ? 'ارجع لاتجاهك المحفوظ' : 'لف الأنتينا ببطء دورة كاملة')
    : calc.delta === undefined ? '' : Math.abs(calc.delta) <= 12
      ? 'قرّبت — ثبّت يدك شوي'
      : `لف الأنتينا ${calc.delta > 0 ? 'يمين' : 'يسار'}${Math.abs(calc.delta) < 45 ? ' شوي' : ''}`;
  const turnLeft = calc.ready && calc.delta !== undefined && calc.delta < -12;

  if (phase === 'nomod' || phase === 'nosensor') {
    return (
      <LinearGradient colors={[tBg('#f1f6fd'), tBg('#dde9f8')]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.page, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }]}>
          <Header status={null} title="صيد الإشارة" />
          <View style={[s.card, { alignItems: 'center', gap: 12, paddingVertical: 28 }]}>
            <View style={[s.iconBubble, { width: 64, height: 64, backgroundColor: P.blueSoft }]}>
              <Icon name="compass" size={30} color={P.blue} />
            </View>
            <Text style={s.h2}>{phase === 'nomod' ? 'تحتاج آخر نسخة من التطبيق' : 'جوالك ما فيه بوصلة'}</Text>
            <Text style={[s.body, { textAlign: 'center' }]}>
              {phase === 'nomod'
                ? 'صيد الإشارة يستخدم بوصلة الجوال، وهي موجودة بس في النسخة الجديدة. حدّث Bandly من المتجر أو حمّل آخر APK وارجع هنا.'
                : 'هالميزة تحتاج حسّاس البوصلة. تقدر تستخدم «مساعد التوجيه» العادي بالصوت والاهتزاز.'}
            </Text>
            <Pressable onPress={() => nav.back()} style={s.ghostBtn}>
              <Text style={s.ghostTxt}>رجوع لمساعد التوجيه</Text>
            </Pressable>
          </View>
        </ScrollView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[tBg('#f1f6fd'), tBg('#dde9f8')]} style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.page, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }]}>
        <Header status={phase === 'loading' ? null : status} title={found ? 'لقينا أفضل اتجاه' : 'صيد الإشارة'} />

        {/* ═══ 4G / 5G ═══ */}
        <View style={s.seg}>
          {(['LTE', 'NR'] as Tech[]).map(t => (
            <Pressable key={t} onPress={() => switchTech(t)} style={[s.segBtn, tech === t && s.segOn]}>
              <Text style={[s.segTxt, tech === t && { color: tFg('#ffffff') }]}>{t === 'LTE' ? '4G' : '5G'}</Text>
            </Pressable>
          ))}
        </View>

        {/* ═══ البوصلة ═══ */}
        <LinearGradient colors={HERO} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={s.hero}>
          {phase === 'loading' ? (
            <ActivityIndicator color="#fff" style={{ marginVertical: 120 }} />
          ) : (
            <>
              <View style={{ width: 300, height: 300 }}>
                <Svg width={300} height={300} viewBox="0 0 300 300">
                  {found && (
                    <G stroke="#7ce9b0" strokeWidth={3} strokeLinecap="round">
                      <Path d="M60 50 L66 60" /><Path d="M42 74 L52 80" /><Path d="M240 50 L234 60" /><Path d="M258 74 L248 80" />
                    </G>
                  )}
                  <Circle cx={150} cy={150} r={138} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.14)" strokeWidth={1.5} />
                  {bins.map((v, i) => {
                    const t = v === null || !calc.ready ? -1 : (v - calc.min) / Math.max(1, calc.max - calc.min);
                    const color = v === null ? UNSCANNED : t < 0 ? HEAT[2] : HEAT[Math.round(t * (HEAT.length - 1))];
                    return (
                      <Circle key={i} cx={150} cy={150} r={R} fill="none" stroke={color} strokeWidth={20}
                        strokeDasharray={`${SEG} ${CIRC - SEG}`}
                        rotation={i * STEP - heading - 90 - (SEG / CIRC) * 180} origin="150, 150" />
                    );
                  })}
                  {saved && (() => {
                    const a = ((saved.deg - heading - 90) * Math.PI) / 180;
                    return <Circle cx={150 + Math.cos(a) * 138} cy={150 + Math.sin(a) * 138} r={5} fill="#ffffff" stroke="#1f47c9" strokeWidth={2} />;
                  })()}
                  <Path d="M150 4 L158 17 L142 17 Z" fill="#ffffff" />
                  <Circle cx={150} cy={150} r={98} fill="rgba(12,36,120,0.42)" stroke="rgba(255,255,255,0.14)" strokeWidth={1.5} />
                  {found ? (
                    <>
                      <Circle cx={150} cy={150} r={88} fill="rgba(124,233,143,0.25)" />
                      <Circle cx={150} cy={150} r={78} fill="#9df0b4" stroke="#e6ffe9" strokeWidth={5} />
                      <Path d="M116 150 L140 174 L186 126" fill="none" stroke="#0d2350" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  ) : (
                    <>
                      <Circle cx={150} cy={150} r={78} fill="rgba(255,255,255,0.07)" />
                      {calc.delta !== undefined && (
                        <G transform={`translate(150, 104) rotate(${calc.delta})`}>
                          <Path d="M0 -32 L24 28 L0 14 L-24 28 Z" fill="#ffffff" />
                        </G>
                      )}
                    </>
                  )}
                </Svg>
                {!found && (
                  <View pointerEvents="none" style={s.center}>
                    {calc.delta !== undefined ? (
                      <>
                        <Text style={s.deg}>{`${Math.abs(calc.delta)}°`}</Text>
                        <Text style={s.degSub}>{calc.ready ? 'عن اتجاه جوالك' : 'عن اتجاهك المحفوظ'}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={[s.deg, { fontSize: 26 }]}>{`${calc.scanned}/${BINS}`}</Text>
                        <Text style={s.degSub}>جهات ممسوحة</Text>
                      </>
                    )}
                  </View>
                )}
              </View>

              {found ? (
                <View style={{ alignItems: 'center', gap: 6 }}>
                  <Text style={s.foundTitle}>هنا أفضل اتجاه، ثبّتها</Text>
                  <Text style={s.foundSub}>الجوال اهتز مرتين · لا تحرّكها بعد</Text>
                </View>
              ) : (
                <>
                  <View style={s.pill}>
                    <View style={turnLeft ? { transform: [{ scaleX: -1 }] } : undefined}>
                      <Icon name="refresh" size={20} color="#ffffff" stroke={2.2} />
                    </View>
                    <Text style={s.pillTxt}>{instruction}</Text>
                  </View>
                  <View style={s.heatBox}>
                    <View style={s.heatTrack}>
                      <LinearGradient colors={['#3fd0d8', '#47e08a', '#e8e35a', '#ffb648', '#ff6b6b']}
                        start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }}
                        style={{ width: `${Math.max(6, Math.round(calc.warm * 100))}%`, height: '100%', borderRadius: 999 }} />
                    </View>
                    <View style={s.heatLabels}>
                      <Text style={s.heatLbl}>بارد</Text><Text style={s.heatLbl}>دافي</Text><Text style={s.heatLbl}>حار</Text>
                    </View>
                  </View>
                </>
              )}
            </>
          )}
        </LinearGradient>

        {found ? (
          <FoundCard cur={cur} start={start} deg={calc.bestDeg ?? heading} />
        ) : (
          <View style={s.tiles}>
            <Metric label="قوة الإشارة" icon="tower" tone={P.cyan} soft={P.cyanSoft}
              value={cur?.rsrp} unit="dBm" lvl={cur?.rsrp === undefined ? undefined : cur.rsrp >= -90 ? 2 : cur.rsrp >= -105 ? 1 : 0}
              words={['ضعيفة', 'متوسطة', 'جيدة']} />
            <Metric label="صفاء الإشارة" icon="bands" tone={P.amber} soft={P.amberSoft}
              value={cur?.sinr} unit="dB" lvl={cur?.sinr === undefined ? undefined : cur.sinr >= 13 ? 2 : cur.sinr >= 3 ? 1 : 0}
              words={['فيها تشويش', 'مقبولة', 'صافية']} />
          </View>
        )}

        {found ? (
          <View style={{ gap: 10 }}>
            <Pressable onPress={saveDir} style={({ pressed }) => [{ borderRadius: 999, overflow: 'hidden' }, pressed && { opacity: 0.88 }]}>
              <LinearGradient colors={isDark ? [P.heroA, P.heroB] : ['#3d7bff', '#2459e8']} style={s.primary}>
                <Icon name={justSaved ? 'check' : 'bands'} size={20} color="#ffffff" stroke={2.4} />
                <Text style={s.primaryTxt}>{justSaved ? 'انحفظ الاتجاه' : 'احفظ هذا الاتجاه'}</Text>
              </LinearGradient>
            </Pressable>
            <Pressable onPress={reset} style={s.ghostBtn}>
              <Icon name="refresh" size={18} color={P.blue} stroke={2.2} />
              <Text style={s.ghostTxt}>دوّر من جديد</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {betterCell && (
              <View style={[s.card, { borderWidth: 1.5, borderColor: P.green }]}>
                <Text style={s.h2}>فيه برج أقوى من برجك</Text>
                <Text style={s.cellSub}>
                  {`في هالاتجاه، برج رقم ${betterCell.cell.pci} أقوى من البرج اللي متصل عليه بـ ${betterCell.gain} — تقدر تثبّت الراوتر عليه.`}
                </Text>
                <Pressable onPress={() => nav.push(`/towers/${id}` as any)} style={s.ghostBtn}>
                  <Icon name="tower" size={18} color={P.blue} stroke={2.2} />
                  <Text style={s.ghostTxt}>افتح الأبراج وثبّت عليه</Text>
                </Pressable>
              </View>
            )}
            {placeSup && (
              <View style={s.card}>
                <Text style={s.h2}>افحص مكان الراوتر</Text>
                <Text style={s.cellSub}>{placeOwn.current
                  ? 'الراوتر نفسه يقيس الإشارة في مكانه الحالي ويعطيك حكمه. حطه في المكان اللي تبيه واتركه ثابت لين يخلص.'
                  : 'نقيس إشارة الراوتر ٢٠ ثانية في مكانه الحالي ونعطيك حكم. حطه في المكان اللي تبيه واتركه ثابت لين يخلص.'}</Text>
                {placeStep !== null && placeStep < 4 && (
                  <Text style={[s.cellTitle, { textAlign: 'center' }]}>{`جاري الفحص... ${placeStep * 25}%`}</Text>
                )}
                {placeQ !== null && (() => {
                  const r = PLACE_Q[placeQ];
                  return (
                    <View style={[s.chip, { alignSelf: 'stretch', backgroundColor: r.bg, paddingVertical: 10, paddingHorizontal: 14 }]}>
                      <Text style={[s.chipTxt, { color: r.fg, textAlign: 'center' }]}>{r.t}</Text>
                    </View>
                  );
                })()}
                {!!placeErr && <Text style={[s.cellSub, { color: tFg('#b3261e') }]}>{placeErr}</Text>}
                {(placeStep === null || placeStep === 4) && (
                  <Pressable onPress={runPlaceCheck} style={s.ghostBtn}>
                    <Icon name="pin" size={18} color={P.blue} stroke={2.2} />
                    <Text style={s.ghostTxt}>{placeQ !== null ? 'افحص مكان ثاني' : 'افحص هالمكان'}</Text>
                  </Pressable>
                )}
              </View>
            )}
            {cells.length > 0 && (
              <View style={s.card}>
                <Pressable onPress={() => setShowCells(v => !v)} style={s.cardHead}>
                  <Text style={s.h2}>الأبراج اللي يشوفها الراوتر</Text>
                  <Icon name={showCells ? 'up' : 'down'} size={18} color={P.blue} stroke={2.4} />
                </Pressable>
                {showCells && cells
                  .slice()
                  .sort((a, b) => (a.kind === 'serving' ? -1 : b.kind === 'serving' ? 1 : (b.rsrp ?? -200) - (a.rsrp ?? -200)))
                  .slice(0, 4)
                  .map((c, i) => <CellRow key={`${c.tech}${c.pci}${c.arfcn}${i}`} c={c} />)}
              </View>
            )}
            {calc.ready && (
              <Pressable onPress={saveDir} style={s.ghostBtn}>
                <Icon name={justSaved ? 'check' : 'pin'} size={18} color={P.blue} stroke={2.2} />
                <Text style={s.ghostTxt}>{justSaved ? 'انحفظ الاتجاه' : 'احفظ أفضل اتجاه لقيناه'}</Text>
              </Pressable>
            )}
            <Text style={s.tip}>
              {saved
                ? `اتجاهك المحفوظ: ${dirName(saved.deg)} ${saved.deg}° — النقطة البيضاء على الحلقة.\n`
                : ''}
              {'خلّ الجوال مسطّح على الأنتنا وأعلاه بنفس اتجاهها، ولفّها ببطء. أبعد الجوال عن الحديد والمغناطيس.'}
            </Text>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

// ═══ الترويسة ═══
function Header({ status, title }: { status: { t: string; dot: string; bg: string; bd: string; fg: string } | null; title: string }) {
  const nav = useRouter();
  return (
    <View style={s.header}>
      <Pressable onPress={() => nav.back()} style={s.backBtn} accessibilityLabel="رجوع" hitSlop={6}>
        <Icon name="chevron" size={20} color={P.text} stroke={2.2} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>مساعد التوجيه · أنتينا خارجية</Text>
      </View>
      {status ? (
        <View style={[s.status, { backgroundColor: status.bg, borderColor: status.bd }]}>
          <View style={[s.dot, { backgroundColor: status.dot }]} />
          <Text style={[s.statusTxt, { color: status.fg }]}>{status.t}</Text>
        </View>
      ) : <View style={{ width: 44 }} />}
    </View>
  );
}

// ═══ بطاقة قياس ═══
function Metric({ label, icon, tone, soft, value, unit, lvl, words }: {
  label: string; icon: IconName; tone: string; soft: string; value?: number; unit: string; lvl?: number; words: string[];
}) {
  const chip = lvl === undefined ? null : [
    { bg: P.redSoft, fg: tFg('#b3261e') }, { bg: P.amberSoft, fg: tFg('#a85a0c') }, { bg: P.greenSoft, fg: tFg('#1d8f58') },
  ][lvl];
  return (
    <View style={[s.card, { flex: 1, gap: 6, padding: 14 }]}>
      <View style={s.rowBetween}>
        <Text style={s.metricLbl}>{label}</Text>
        <View style={[s.iconBubble, { backgroundColor: soft }]}><Icon name={icon} size={20} color={tone} /></View>
      </View>
      <Text style={s.metricVal}>
        {value === undefined ? '—' : `${Math.round(value)}`}
        <Text style={s.unit}>{` ${unit}`}</Text>
      </Text>
      {chip && lvl !== undefined && (
        <View style={[s.chip, { backgroundColor: chip.bg }]}><Text style={[s.chipTxt, { color: chip.fg }]}>{words[lvl]}</Text></View>
      )}
    </View>
  );
}

// ═══ وش تغيّر من البداية ═══
function FoundCard({ cur, start, deg }: { cur: { rsrp?: number; sinr?: number } | null; start: { rsrp?: number; sinr?: number } | null; deg: number }) {
  const dR = cur?.rsrp !== undefined && start?.rsrp !== undefined ? Math.round(cur.rsrp - start.rsrp) : undefined;
  const dS = cur?.sinr !== undefined && start?.sinr !== undefined ? Math.round(cur.sinr - start.sinr) : undefined;
  const fmt = (v?: number) => (v === undefined ? '—' : v > 0 ? `+${v}` : `${v}`);
  const col = (v?: number) => (v === undefined || v === 0 ? P.text : v > 0 ? tFg('#1d8f58') : tFg('#b3261e'));
  const good = (dR ?? 0) + (dS ?? 0) > 2;
  return (
    <View style={[s.card, { gap: 14 }]}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
        <Icon name="bands" size={20} color={P.blue} stroke={2.4} />
        <Text style={s.h2}>وش تغيّر من بداية التوجيه</Text>
      </View>
      <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
        {[
          { l: 'القوة', v: fmt(dR), u: 'dB', c: col(dR), i: 'wifi' as IconName },
          { l: 'الصفاء', v: fmt(dS), u: 'dB', c: col(dS), i: 'bands' as IconName },
          { l: 'الاتجاه', v: `${Math.round(norm(deg))}°`, u: dirName(deg), c: P.text, i: 'compass' as IconName },
        ].map(x => (
          <View key={x.l} style={s.miniTile}>
            <View style={s.rowBetween}>
              <Text style={s.metricLbl}>{x.l}</Text>
              <View style={[s.iconBubble, { width: 32, height: 32, backgroundColor: P.blueSoft }]}><Icon name={x.i} size={16} color={P.blue} /></View>
            </View>
            <Text style={[s.metricVal, { fontSize: 24, color: x.c }]}>
              {x.v}<Text style={s.unit}>{` ${x.u}`}</Text>
            </Text>
          </View>
        ))}
      </View>
      <View style={[s.note, !good && { backgroundColor: P.blueSoft, borderColor: tBd('#c9d8ff') }]}>
        <View style={[s.noteDot, !good && { backgroundColor: P.blue }]}><Icon name="check" size={14} color="#ffffff" stroke={3} /></View>
        <Text style={s.noteTxt}>
          {good ? 'الإشارة تحسّنت بشكل واضح · السرعة المتوقعة أعلى' : 'هذا أقوى اتجاه لقيناه من الجهات اللي مسحتها'}
        </Text>
      </View>
    </View>
  );
}

// ═══ صف برج بأسماء مفهومة ═══
function CellRow({ c }: { c: CellTower }) {
  const mhz = c.band ? (c.tech === 'NR' ? NR_FREQ : BAND_FREQ)[c.band] : undefined;
  const n = mhz ? parseInt(mhz, 10) : 0;
  const hint = !n ? '' : n < 1000 ? 'يوصل بعيد' : n < 2300 ? 'توازن بين السرعة والمدى' : 'سريع لو البرج قريب';
  const title = c.kind === 'serving' ? 'البرج اللي متصل عليه' : c.kind === 'secondary' ? 'برج مدموج معه' : 'برج احتياطي';
  const lv = c.rsrp === undefined ? undefined : c.rsrp >= -90 ? 2 : c.rsrp >= -105 ? 1 : 0;
  const chip = lv === undefined ? null : [
    { t: 'ضعيف', bg: P.redSoft, fg: tFg('#b3261e') },
    { t: 'متوسط', bg: P.amberSoft, fg: tFg('#8a5a00') },
    { t: 'قوي', bg: P.greenSoft, fg: tFg('#1d8f58') },
  ][lv];
  const nr = c.tech === 'NR';
  return (
    <View style={s.cellRow}>
      <View style={[s.iconBubble, { width: 40, height: 40, backgroundColor: nr ? P.violetSoft : P.cyanSoft }]}>
        <Icon name={nr ? 'spark' : 'tower'} size={19} color={nr ? P.violet : P.cyan} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.cellTitle}>{nr ? `5G · ${title}` : title}</Text>
        <Text style={s.cellSub}>{[mhz, hint].filter(Boolean).join(' · ') || L('تردد غير معروف', 'Unknown band')}</Text>
      </View>
      {chip && <View style={[s.chip, { backgroundColor: chip.bg, paddingHorizontal: 14 }]}><Text style={[s.chipTxt, { color: chip.fg }]}>{chip.t}</Text></View>}
    </View>
  );
}

const s = sheet({
  page: { padding: 16, paddingTop: 12, gap: 14 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: tBg('#ffffff'), alignItems: 'center', justifyContent: 'center', ...shadow },
  title: { fontSize: 20, fontWeight: '800', color: P.text, textAlign: 'center' },
  sub: { fontSize: 12, color: P.sub, textAlign: 'center' },
  status: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5 },
  dot: { width: 9, height: 9, borderRadius: 999 },
  statusTxt: { fontSize: 12, fontWeight: '700' },
  seg: { flexDirection: 'row-reverse', alignSelf: 'center', backgroundColor: tBg('#ffffff'), borderRadius: 999, padding: 4, gap: 4, ...shadow },
  segBtn: { paddingVertical: 7, paddingHorizontal: 22, borderRadius: 999 },
  segOn: { backgroundColor: P.blue },
  segTxt: { fontSize: 13, fontWeight: '700', color: P.sub },
  hero: { borderRadius: 26, paddingVertical: 16, paddingHorizontal: 14, alignItems: 'center', gap: 12, overflow: 'hidden' },
  center: { position: 'absolute', left: 0, right: 0, top: 152, alignItems: 'center' },
  deg: { fontSize: 44, fontWeight: '800', color: '#ffffff', writingDirection: 'ltr' },
  degSub: { fontSize: 13, color: 'rgba(255,255,255,0.88)', marginTop: -2 },
  pill: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
  pillTxt: { fontSize: 17, fontWeight: '700', color: '#ffffff' },
  heatBox: {
    alignSelf: 'stretch', padding: 12, paddingBottom: 10, borderRadius: 18, gap: 8,
    backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  heatTrack: { height: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)', flexDirection: 'row-reverse', overflow: 'hidden' },
  heatLabels: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
  heatLbl: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.92)' },
  foundTitle: { fontSize: 23, fontWeight: '800', color: '#ffffff', textAlign: 'center' },
  foundSub: { fontSize: 14, color: 'rgba(255,255,255,0.9)', textAlign: 'center' },
  tiles: { flexDirection: 'row-reverse', gap: 12 },
  card: { backgroundColor: tBg('#ffffff'), borderRadius: 22, padding: 16, gap: 10, ...shadow },
  cardHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  rowBetween: { flexDirection: 'row-reverse', alignItems: 'flex-start', justifyContent: 'space-between' },
  iconBubble: { width: 42, height: 42, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  h2: { fontSize: 16, fontWeight: '800', color: P.text, textAlign: 'right' },
  body: { fontSize: 14, lineHeight: 22, color: P.sub, textAlign: 'right' },
  metricLbl: { fontSize: 13, fontWeight: '700', color: P.sub, textAlign: 'right' },
  metricVal: { fontSize: 30, fontWeight: '800', color: P.text, textAlign: 'right', writingDirection: 'ltr' },
  unit: { fontSize: 13, fontWeight: '500', color: P.sub },
  chip: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999 },
  chipTxt: { fontSize: 12, fontWeight: '700' },
  miniTile: { flex: 1, backgroundColor: P.soft, borderRadius: 16, padding: 10, gap: 10 },
  note: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16,
    backgroundColor: P.greenSoft, borderWidth: 1, borderColor: tBd('#bdeed7'),
  },
  noteDot: { width: 24, height: 24, borderRadius: 999, backgroundColor: '#34ce83', alignItems: 'center', justifyContent: 'center' },
  noteTxt: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 20, color: P.text, textAlign: 'right' },
  cellRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: P.soft },
  cellTitle: { fontSize: 14, fontWeight: '700', color: P.text, textAlign: 'right' },
  cellSub: { fontSize: 12, color: P.sub, textAlign: 'right' },
  primary: { height: 56, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryTxt: { fontSize: 17, fontWeight: '800', color: '#ffffff' },
  ghostBtn: {
    height: 52, borderRadius: 999, borderWidth: 1.5, borderColor: tBd('#b9cdf2'), backgroundColor: tBg('#ffffff'),
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 10, alignSelf: 'stretch', paddingHorizontal: 20,
  },
  ghostTxt: { fontSize: 16, fontWeight: '700', color: P.blue },
  tip: { fontSize: 12.5, lineHeight: 20, color: P.sub, textAlign: 'center', paddingHorizontal: 8 },
});
