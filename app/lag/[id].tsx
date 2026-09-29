import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet, AppState } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Signal, Traffic } from '../../src/drivers/types';
import { REGIONS, REGION_KEY, regionById, regionUrls, pingOnce, wifiOnce } from '../../src/utils/latency';
import {
  PingSample, RouterSample, Gap, LagReport, Cause, CAUSE_TEXT,
  baseline, isSpike, findIncidents, buildReport, listLagSessions, saveLagSession, fmtClock, fmtDur,
} from '../../src/utils/lagDetector';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';

const KEEP_TAG = 'bandly-lag';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const scoreCol = (sc: number) => (sc >= 70 ? C.green : sc >= 45 ? '#e0a100' : C.red);

export default function LagScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [region, setRegion] = useState(REGIONS[0].id);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<{ pings: PingSample[]; last?: RouterSample; base: number; incidents: number; startedAt: number } | null>(null);
  const [report, setReport] = useState<LagReport | null>(null);
  const [history, setHistory] = useState<LagReport[]>([]);
  const [bgNote, setBgNote] = useState(false);
  const [loading, setLoading] = useState(true);

  const run = useRef(false);
  const pings = useRef<PingSample[]>([]);
  const routers = useRef<RouterSample[]>([]);
  const gaps = useRef<Gap[]>([]);
  const started = useRef(0);
  const mounted = useRef(true);

  const reg = regionById(region);

  useEffect(() => {
    mounted.current = true;
    AsyncStorage.getItem(REGION_KEY).then(v => { if (v && mounted.current) setRegion(regionById(v).id); }).catch(() => {});
    const sub = AppState.addEventListener('change', st => { if (st !== 'active' && run.current) setBgNote(true); });
    return () => { mounted.current = false; run.current = false; sub.remove(); deactivateKeepAwake(KEEP_TAG).catch(() => {}); };
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (r) {
        setInfo(r);
        setHistory((await listLagSessions(r.id)).reverse());
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]));

  const pollRouter = async (r: SavedRouter) => {
    const t = Date.now();
    const [res, wifi] = await Promise.all([
      withSession(r, async d => Promise.all([
        d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
        d.getTraffic ? d.getTraffic().catch(() => null) : Promise.resolve(null),
      ])).catch(() => [null, null] as [Signal | null, Traffic | null]),
      wifiOnce(r.host),
    ]);
    const [sig, tr] = res as [Signal | null, Traffic | null];
    const s: RouterSample = {
      t,
      pci: sig?.pci,
      band: sig?.band,
      nrBand: sig?.nrBand,
      nrOn: sig ? sig.nrRsrp !== undefined || !!sig.nrActiveFromStatus : undefined,
      sinr: sig?.sinr,
      rsrp: sig?.rsrp,
      wifiMs: wifi,
      downBps: tr?.downBytesPerSec,
    };
    routers.current.push(s);
    return s;
  };

  const start = async () => {
    if (!info || run.current) return;
    pings.current = [];
    routers.current = [];
    gaps.current = [];
    started.current = Date.now();
    run.current = true;
    setReport(null);
    setBgNote(false);
    setRunning(true);
    activateKeepAwakeAsync(KEEP_TAG).catch(() => {});

    // نختار أول خادم يرد من خوادم المنطقة
    let target = reg.url;
    for (const u of regionUrls(reg)) {
      if ((await pingOnce(u, 3000)) !== null) { target = u; break; }
    }

    let last = Date.now();
    let lastRouter = 0;
    let routerBusy = false;
    let lastSample: RouterSample | undefined;
    let tick = 0;
    let incCount = 0;

    while (run.current && mounted.current) {
      const t0 = Date.now();
      if (t0 - last > 8000) gaps.current.push({ from: last, to: t0 });
      last = t0;

      if (!routerBusy && t0 - lastRouter >= 5000) {
        routerBusy = true;
        lastRouter = t0;
        pollRouter(info).then(s => { lastSample = s; }).catch(() => {}).finally(() => { routerBusy = false; });
      }

      const ms = await pingOnce(target, 2000);
      pings.current.push({ t: t0, ms });
      if (pings.current.length > 7200) pings.current.shift();

      tick++;
      if (mounted.current) {
        const base = baseline(pings.current);
        if (tick % 5 === 0) incCount = findIncidents(pings.current, routers.current, base).length;
        setLive({
          pings: pings.current.slice(-60),
          last: lastSample,
          base,
          incidents: incCount,
          startedAt: started.current,
        });
      }
      const wait = 1000 - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
    }
  };

  const stop = async () => {
    if (!info || !run.current) return;
    run.current = false;
    setRunning(false);
    deactivateKeepAwake(KEEP_TAG).catch(() => {});
    if (pings.current.length < 10) {
      Alert.alert('الجلسة قصيرة', 'نحتاج دقيقة على الأقل عشان نطلع تقرير مفيد');
      setLive(null);
      return;
    }
    const rep = buildReport(started.current, Date.now(), reg.id, pings.current, routers.current, gaps.current);
    await saveLagSession(info.id, rep);
    if (!mounted.current) return;
    setReport(rep);
    setLive(null);
    setHistory((await listLagSessions(info.id)).reverse());
  };

  const cur = live?.pings[live.pings.length - 1];
  const maxBar = Math.max(120, ...(live?.pings.map(p => p.ms ?? 0) ?? [0]));

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        {loading && <View style={s.center}><ActivityIndicator size="large" color={C.blue} /></View>}

        {!loading && !running && !report && (
          <GlassCard title="كاشف اللاق" icon="🕵️" tint={C.pinkSoft} collapsible={false}>
            <Text style={s.hint}>
              شغّله وأنت تلعب. يقيس البنق كل ثانية لسيرفرات {reg.name}، ويراقب الراوتر والواي فاي. وبعد الجيم يقولك متى صار اللاق وليش.
            </Text>
            <View style={s.tipBox}>
              <Text style={s.tipTitle}>للحصول على أدق نتيجة</Text>
              <Text style={s.tip}>• إذا تلعب على بلايستيشن أو كمبيوتر أو جوال ثاني: خلّ هذا الجوال جنبك والتطبيق مفتوح — الشاشة ما تطفي</Text>
              <Text style={s.tip}>• إذا تلعب على نفس الجوال: أندرويد يوقف المراقبة لما تطلع للعبة، وبيوضح لك التقرير الفترات اللي ما انراقبت</Text>
            </View>
            <View style={s.chips}>
              {REGIONS.map(r => (
                <Pressable key={r.id} onPress={() => { setRegion(r.id); AsyncStorage.setItem(REGION_KEY, r.id).catch(() => {}); }} style={[s.chip, r.id === region && s.chipOn]}>
                  <Text style={[s.chipText, r.id === region && { color: C.onAccent }]}>{r.name}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={s.btn} onPress={start}>
              <Text style={s.btnText}>ابدأ المراقبة</Text>
            </Pressable>
          </GlassCard>
        )}

        {running && (
          <GlassCard title="نراقب الحين" icon="🔴" tint={C.pinkSoft} collapsible={false}>
            <View style={s.liveTop}>
              <View style={s.liveBig}>
                <Text style={[s.liveMs, { color: !cur ? C.sub : isSpike(cur.ms, live?.base ?? 0) ? C.red : C.green }]}>
                  {cur ? (cur.ms === null ? '✕' : cur.ms) : '…'}
                </Text>
                <Text style={s.liveU}>{cur?.ms === null ? 'ما رد' : 'ms الحين'}</Text>
              </View>
              <View style={s.liveSide}>
                <Text style={s.liveLine}>الطبيعي: {live?.base ? `${Math.round(live.base)}ms` : '…'}</Text>
                <Text style={s.liveLine}>حوادث لاق: <Text style={{ color: (live?.incidents ?? 0) ? C.red : C.green, fontWeight: '900' }}>{live?.incidents ?? 0}</Text></Text>
                <Text style={s.liveLine}>المدة: {live ? fmtDur(Date.now() - live.startedAt) : '…'}</Text>
                {!!live?.last?.band && <Text style={s.liveLine}>{live.last.band}{live.last.nrOn ? ' + 5G' : ''}{live.last.pci ? ` · برج ${live.last.pci}` : ''}</Text>}
              </View>
            </View>
            <View style={s.bars}>
              {(live?.pings ?? []).map((p, i) => {
                const bad = isSpike(p.ms, live?.base ?? 0);
                const h = p.ms === null ? 100 : Math.max(6, Math.min(100, (p.ms / maxBar) * 100));
                return <View key={i} style={[s.bar, { height: `${h}%`, backgroundColor: bad ? C.red : C.green }]} />;
              })}
            </View>
            {bgNote && <Text style={s.warn}>التطبيق طلع للخلفية — الفترات هذي بتنعلّم في التقرير إنها ما انراقبت</Text>}
            <Pressable style={[s.btn, { backgroundColor: C.red }]} onPress={stop}>
              <Text style={s.btnText}>خلصت اللعب — أعطني التقرير</Text>
            </Pressable>
          </GlassCard>
        )}

        {report && <ReportCard r={report} onNew={() => setReport(null)} onGo={route => info && router.push(`/${route}/${info.id}` as Href)} />}

        {!loading && !running && history.length > 0 && (
          <GlassCard title="جلساتك السابقة" icon="📋" tint={C.violetSoft} defaultOpen={false}>
            {history.slice(0, 8).map(h => (
              <Pressable key={h.startedAt} style={s.row} onPress={() => setReport(h)}>
                <View style={s.rowHead}>
                  <Text style={[s.rowScore, { color: scoreCol(h.score) }]}>{h.score}<Text style={s.of}>/100</Text></Text>
                  <Text style={s.rowName}>{new Date(h.startedAt).toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'numeric' })} · {fmtClock(h.startedAt).slice(0, -3)}</Text>
                </View>
                <Text style={s.rowVals}>
                  {fmtDur(h.endedAt - h.startedAt)} · {h.incidents.length} حادثة لاق
                  {h.topCause ? ` · أغلبها: ${CAUSE_TEXT[h.topCause].title}` : ''}
                </Text>
              </Pressable>
            ))}
          </GlassCard>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const FIX_ROUTE: Partial<Record<Cause, { route: string; label: string }>> = {
  handover: { route: 'towers', label: 'افتح الأبراج' },
  nr: { route: 'ping', label: 'افتح مُحسّن اللعبة' },
  signal: { route: 'aim', label: 'افتح مساعد التوجيه' },
  traffic: { route: 'device', label: 'افتح الأجهزة' },
  network: { route: 'ping', label: 'افتح مُحسّن اللعبة' },
};

function ReportCard({ r, onNew, onGo }: { r: LagReport; onNew: () => void; onGo: (route: string) => void }) {
  const causes = (Object.keys(r.causes) as Cause[]).sort((a, b) => (r.causes[b] ?? 0) - (r.causes[a] ?? 0));
  const fix = r.topCause ? FIX_ROUTE[r.topCause] : undefined;
  return (
    <GlassCard title="تقرير الجلسة" icon="📊" tint={C.greenSoft} collapsible={false}>
      <View style={[s.verdict, { borderColor: scoreCol(r.score) }]}>
        <Text style={[s.verdictScore, { color: scoreCol(r.score) }]}>{r.score}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[s.verdictTitle, { color: scoreCol(r.score) }]}>
            {r.incidents.length === 0 ? 'جلسة نظيفة بدون لاق 👌' : `${r.incidents.length} حادثة لاق — ${r.lagSecs} ثانية تقريباً`}
          </Text>
          <Text style={s.verdictSub}>
            {regionById(r.region).name} · {fmtDur(r.endedAt - r.startedAt)} · بنق طبيعي {r.baseMs}ms · تذبذب {r.jitter}ms · فقد {r.lossPct}%
          </Text>
        </View>
      </View>

      {r.coveragePct < 90 && (
        <Text style={s.warn}>راقبنا {r.coveragePct}% من الوقت فقط — الباقي كان التطبيق بالخلفية</Text>
      )}

      {causes.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={s.secTitle}>ليش صار اللاق</Text>
          {causes.map(c => (
            <View key={c} style={s.causeRow}>
              <Text style={s.causeCount}>{r.causes[c]}×</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.causeTitle}>{CAUSE_TEXT[c].icon} {CAUSE_TEXT[c].title}</Text>
                <Text style={s.causeFix}>💡 {CAUSE_TEXT[c].fix}</Text>
              </View>
            </View>
          ))}
          {fix && (
            <Pressable style={s.btnGhost} onPress={() => onGo(fix.route)}>
              <Text style={s.btnGhostText}>{fix.label}</Text>
            </Pressable>
          )}
        </View>
      )}

      {r.incidents.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={s.secTitle}>الحوادث بالوقت</Text>
          {r.incidents.slice(-12).reverse().map(i => (
            <View key={i.from} style={s.incRow}>
              <Text style={s.incTime}>{fmtClock(i.from)}</Text>
              <Text style={s.incText} numberOfLines={2}>
                {CAUSE_TEXT[i.cause].icon} {i.worstMs !== null ? `${i.worstMs}ms` : 'انقطاع'}
                {i.lost ? ` · ضاع ${i.lost}` : ''} · {Math.max(1, Math.round((i.to - i.from) / 1000) + 1)} ث
                {i.detail ? ` · ${i.detail}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Pressable style={s.btn} onPress={onNew}>
        <Text style={s.btnText}>جلسة جديدة</Text>
      </Pressable>
    </GlassCard>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', paddingVertical: 40 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  warn: { color: '#b45309', fontSize: 12, textAlign: 'right', lineHeight: 19, backgroundColor: C.amberSoft, borderRadius: 12, padding: 10 },
  tipBox: { backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 10, gap: 4 },
  tipTitle: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right' },
  tip: { color: C.sub, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  chipOn: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { color: C.text, fontWeight: '700', fontSize: 13 },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 13, alignItems: 'center' },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  btnGhost: { borderWidth: 1, borderColor: C.blue, borderRadius: 14, padding: 12, alignItems: 'center' },
  btnGhostText: { color: C.blue, fontWeight: '800', fontSize: 14 },
  liveTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14 },
  liveBig: { alignItems: 'center', minWidth: 96 },
  liveMs: { fontSize: 46, fontWeight: '900' },
  liveU: { color: C.sub, fontSize: 11, fontWeight: '700' },
  liveSide: { flex: 1, gap: 3 },
  liveLine: { color: C.text, fontSize: 12, textAlign: 'right', fontWeight: '600' },
  bars: { height: 70, flexDirection: 'row', alignItems: 'flex-end', gap: 1, backgroundColor: C.rowBg, borderRadius: 12, padding: 6, overflow: 'hidden' },
  bar: { flex: 1, borderRadius: 1.5, minWidth: 2 },
  verdict: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderWidth: 2, borderRadius: 16, padding: 12, backgroundColor: C.card },
  verdictScore: { fontSize: 34, fontWeight: '900', minWidth: 58, textAlign: 'center' },
  verdictTitle: { fontWeight: '900', fontSize: 15, textAlign: 'right' },
  verdictSub: { color: C.sub, fontSize: 11, textAlign: 'right', lineHeight: 18, marginTop: 4 },
  secTitle: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  causeRow: { flexDirection: 'row-reverse', gap: 10, alignItems: 'center', backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 10 },
  causeCount: { color: C.red, fontWeight: '900', fontSize: 18, minWidth: 34, textAlign: 'center' },
  causeTitle: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right' },
  causeFix: { color: C.sub, fontSize: 12, textAlign: 'right', lineHeight: 18, marginTop: 2 },
  incRow: { flexDirection: 'row-reverse', gap: 10, alignItems: 'center' },
  incTime: { color: C.text, fontWeight: '800', fontSize: 12, minWidth: 64, textAlign: 'right' },
  incText: { color: C.sub, fontSize: 12, textAlign: 'right', flex: 1 },
  row: { backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 11, gap: 6 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowScore: { fontWeight: '900', fontSize: 18 },
  of: { color: C.sub, fontSize: 11, fontWeight: '700' },
  rowName: { color: C.text, fontWeight: '800', fontSize: 13 },
  rowVals: { color: C.sub, fontSize: 11, textAlign: 'right' },
});
