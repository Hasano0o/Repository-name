import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { safeApply, trialMessage } from '../../src/utils/safeLock';
import { BandConfig, CellTower } from '../../src/drivers/types';
import { OptTarget, buildCandidates } from '../../src/utils/optimize';
import { bandLabel, freqLabel } from '../../src/utils/bands';
import { saveProfile } from '../../src/store/profiles';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import {
  testBand, scoreResult, testLabel, verdictText,
  BandTestResult, TestMode,
} from '../../src/utils/bandTest';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function scoreColor(sc: number): string {
  if (sc >= 0.8) return '#16a34a';
  if (sc >= 0.6) return '#22c55e';
  if (sc >= 0.4) return '#f59e0b';
  if (sc >= 0.25) return '#f97316';
  return '#dc2626';
}

function rowSummary(r: BandTestResult): string {
  const parts: string[] = [];
  if (r.rsrpAvg !== undefined) parts.push(`RSRP ${r.rsrpAvg.toFixed(0)}`);
  if (r.sinrAvg !== undefined) parts.push(`SINR ${r.sinrAvg.toFixed(1)}`);
  if (r.speedMbps !== undefined) parts.push(`${r.speedMbps.toFixed(1)}Mbps`);
  if (r.disconnectCount > 0) parts.push(`${r.disconnectCount} قطعة`);
  if (r.pciChanges > 0) parts.push(`برج متغير`);
  return parts.join(' · ');
}

function rowDetail(r: BandTestResult): string {
  const parts: string[] = [];
  if (r.rsrpMin !== undefined && r.rsrpMax !== undefined) {
    parts.push(`RSRP ${r.rsrpMin.toFixed(0)}…${r.rsrpMax.toFixed(0)}`);
  }
  if (r.sinrMin !== undefined && r.sinrMax !== undefined) {
    parts.push(`SINR ${r.sinrMin.toFixed(1)}…${r.sinrMax.toFixed(1)}`);
  }
  parts.push(`ثبات ${r.onlinePct}%`);
  return parts.join(' · ');
}

export default function OptimizeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [cands, setCands] = useState<OptTarget[]>([]);
  const [mode, setMode] = useState<TestMode>('quick');
  const [rows, setRows] = useState<BandTestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const cancel = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel.current = true; };
  }, []);

  const load = useCallback(async (r: SavedRouter) => {
    const [c, cells] = await withSession(r, async d => Promise.all([
      d.getBandConfig ? d.getBandConfig() : Promise.resolve(null),
      d.getCells ? d.getCells().catch(() => [] as CellTower[]) : Promise.resolve([] as CellTower[]),
    ]));
    if (!mounted.current) return;
    setCfg(c);
    const fromCells: OptTarget[] = [];
    for (const x of cells) if (x.band) fromCells.push({ tech: x.tech, band: x.band });
    setCands(buildCandidates(fromCells, c?.supported ?? [], c?.nrSupported ?? [], 6));
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try { await load(r); } catch (e: any) { setError(e?.message ?? String(e)); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, load]));

  const waitOnline = async (r: SavedRouter, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (cancel.current) return false;
      await sleep(2500);
      try {
        const ok = await withSession(r, async d => (d.isConnected ? d.isConnected() : true));
        if (ok) return true;
      } catch {}
    }
    return false;
  };

  const run = async () => {
    if (!info || !cfg || !cands.length) return;
    const origLte = cfg.locked;
    const origNr = cfg.nrLocked;
    cancel.current = false;
    setRunning(true); setError('');
    const list: BandTestResult[] = cands.map(t => ({
      tech: t.tech, band: t.band, status: 'pending' as const,
      disconnectCount: 0, totalSamples: 0, onlinePct: 100,
      pciChanges: 0, durationMs: 0, samples: [],
    }));
    setRows([...list]);

    const upd = (i: number, p: Partial<BandTestResult>) => {
      list[i] = { ...list[i], ...p };
      if (mounted.current) setRows([...list]);
    };

    try {
      for (let i = 0; i < list.length; i++) {
        if (cancel.current) break;
        const { tech, band } = list[i];
        upd(i, { status: 'testing', note: 'نقفل التردد...' });
        try {
          await withSession(info, d => (
            tech === 'NR' ? d.setBand!(origLte, [band]) : d.setBand!([band], origNr)
          ), false);
          upd(i, { note: 'ننتظر الاتصال...' });
          const ok = await waitOnline(info, 35000);
          if (cancel.current) { upd(i, { status: 'pending', note: undefined }); break; }
          if (!ok) { upd(i, { status: 'failed', note: 'ما اتصل على هذا التردد' }); continue; }

          await sleep(2500);
          upd(i, { note: 'نقيس بالتفصيل...' });

          const res = await testBand(info, tech, band, {
            mode,
            isCancelled: () => cancel.current,
            onProgress: p => {
              const merged: Partial<BandTestResult> = { ...p };
              delete (merged as any).elapsedMs;
              upd(i, { ...merged, note: 'نقيس...' });
            },
          });

          if (res.status === 'done') {
            upd(i, { ...res, note: undefined });
          } else if (res.status === 'pending') {
            upd(i, { status: 'pending', note: undefined });
          } else {
            upd(i, { ...res, note: 'فشل القياس' });
          }
        } catch (e: any) {
          upd(i, { status: 'failed', note: e?.message ?? 'خطأ' });
        }
      }
    } finally {
      // ترتيب النتائج
      const done = list.filter(r => r.status === 'done');
      const ranked = [...done].sort((a, b) => scoreResult(b) - scoreResult(a));
      const best = ranked[0];

      if (best && !cancel.current && mounted.current) {
        setStatus('نرجّع إعدادك الأصلي للمقارنة...');
        try {
          try { await withSession(info, d => d.setBand!(origLte, origNr), false); } catch {}
          await waitOnline(info, 45000);

          const label = `التثبيت على ${bandLabel(best.tech, best.band)}`;
          const res = await safeApply({
            r: info,
            key: `band:${best.tech}:${best.band}`,
            label,
            withNr: best.tech === 'NR',
            apply: d => (best.tech === 'NR' ? d.setBand!(origLte, [best.band]) : d.setBand!([best.band], origNr)),
            revert: d => d.setBand!(origLte, origNr),
            onStatus: st => { if (mounted.current) setStatus(st); },
          });
          if (!res.kept) {
            if (mounted.current) {
              const m = trialMessage(res, label);
              Alert.alert(m.title, m.body + '\n\nيعني إعدادك الحالي هو الأفضل.');
            }
            throw new Error('__kept_original__');
          }
          try {
            await saveProfile({
              routerId: info.id,
              name: 'أفضل تردد — ' + bandLabel(best.tech, best.band),
              bands: best.tech === 'NR' ? origLte : [best.band],
              nrBands: best.tech === 'NR' ? [best.band] : origNr,
              mode: cfg.mode,
            });
          } catch {}
          if (mounted.current) {
            const sc = scoreResult(best);
            const why = verdictText(best, ranked[ranked.length - 1] ?? best);
            Alert.alert(
              'تم التحسين',
              `ثبّتناك على ${bandLabel(best.tech, best.band)} — التقييم ${testLabel(best)} (${Math.round(sc * 100)}%).\n` +
              (why ? `السبب: ${why}\n` : '') +
              'وحفظناه كملف تعريف.',
            );
          }
        } catch (e: any) {
          if (mounted.current && e?.message !== '__kept_original__') setError(e?.message ?? String(e));
        }
      } else {
        setStatus('نرجّع إعدادك السابق...');
        try { await withSession(info, d => d.setBand!(origLte, origNr), false); } catch {}
      }

      if (mounted.current) {
        setRunning(false);
        setStatus('');
        try { await load(info); } catch {}
      }
    }
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;

  const done = rows.filter(r => r.status === 'done');
  const ranked = [...done].sort((a, b) => scoreResult(b) - scoreResult(a));
  const best = ranked[0];
  const canRun = !!cfg && cands.length > 0 && !running;
  const estMin = mode === 'full' ? Math.ceil((cands.length * 65) / 60) : Math.ceil((cands.length * 12) / 60);

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      {!!error && <Text style={s.err}>{error}</Text>}

      <GlassCard title="المُحسِّن التلقائي" icon="🪄" tint={C.violet} collapsible={false}>
        <Text style={s.p}>
          يجرب كل تردد متاح، يقيس القوة والنقاء والاستقرار والسرعة، ويثبّتك على الأفضل تلقائياً — ويحفظه كملف تعريف.
        </Text>

        <Text style={s.sub}>المرشّحون: {cands.map(c => bandLabel(c.tech, c.band)).join('، ') || 'ما فيه'}</Text>

        {/* اختيار نوع الفحص */}
        <View style={s.modeRow}>
          <Pressable
            style={[s.modeBtn, mode === 'quick' && s.modeBtnOn]}
            onPress={() => !running && setMode('quick')}
            disabled={running}
          >
            <Text style={[s.modeTxt, mode === 'quick' && s.modeTxtOn]}>فحص سريع</Text>
            <Text style={[s.modeSub, mode === 'quick' && s.modeTxtOn]}>6 ثواني / تردد</Text>
          </Pressable>
          <Pressable
            style={[s.modeBtn, mode === 'full' && s.modeBtnOn]}
            onPress={() => !running && setMode('full')}
            disabled={running}
          >
            <Text style={[s.modeTxt, mode === 'full' && s.modeTxtOn]}>فحص دقيق</Text>
            <Text style={[s.modeSub, mode === 'full' && s.modeTxtOn]}>55 ثانية + سرعة</Text>
          </Pressable>
        </View>

        <Text style={s.warn}>
          {mode === 'full'
            ? `⏱ المتوقع ~${estMin} دقيقة. ينقطع الاتصال خلاله. يستهلك ~30 ميقا/تردد لقياس السرعة.`
            : `⏱ المتوقع ~${estMin} دقيقة. ينقطع الاتصال خلاله. لا يستهلك باقة.`}
        </Text>

        {running ? (
          <>
            <Pressable style={[s.btn, s.btnRed]} onPress={() => { cancel.current = true; }}>
              <Text style={s.btnTxt}>إيقاف</Text>
            </Pressable>
            {!!status && <Text style={s.status}>{status}</Text>}
          </>
        ) : (
          <>
            <Pressable style={[s.btn, !canRun && s.btnOff]} disabled={!canRun} onPress={run}>
              <Text style={s.btnTxt}>ابدأ التحسين</Text>
            </Pressable>
            <Pressable
              style={[s.btn, { backgroundColor: '#9333ea', marginTop: 8 }]}
              onPress={() => router.push(`/anchor/${id}` as Href)}
            >
              <Text style={s.btnTxt}>🔍 مرساة 5G — أي تردد يفتح 5G؟</Text>
            </Pressable>
          </>
        )}
      </GlassCard>

      {rows.length > 0 && (
        <GlassCard title="النتائج" icon="📊" tint={C.blue} collapsible={false}>
          {ranked.length > 0 && (
            <Text style={s.headline}>
              🏆 الأفضل: {bandLabel(best.tech, best.band)} — {testLabel(best)} ({Math.round(scoreResult(best) * 100)}%)
            </Text>
          )}
          {rows.map((r, i) => {
            const isBest = best && best.tech === r.tech && best.band === r.band;
            const sc = r.status === 'done' ? scoreResult(r) : 0;
            const col = scoreColor(sc);
            return (
              <View key={i} style={[s.row, isBest && s.rowBest]}>
                <View style={s.scoreCol}>
                  {r.status === 'done' ? (
                    <>
                      <Text style={[s.score, { color: col }]}>{Math.round(sc * 100)}%</Text>
                      <Text style={s.rowSub}>{testLabel(r)}</Text>
                    </>
                  ) : r.status === 'testing' ? (
                    <ActivityIndicator color={C.blue} />
                  ) : (
                    <Text style={s.rowSub}>
                      {r.status === 'failed' ? 'فشل' : 'بالانتظار'}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>
                    {bandLabel(r.tech, r.band)} {isBest ? '⭐' : ''}
                    <Text style={s.rowSub}>  {freqLabel(r.tech, r.band)}</Text>
                  </Text>
                  {r.status === 'done' ? (
                    <>
                      <Text style={s.rowMain}>{rowSummary(r)}</Text>
                      <Text style={s.rowSub}>{rowDetail(r)}</Text>
                    </>
                  ) : (
                    <Text style={s.rowSub}>{r.note ?? ''}</Text>
                  )}
                </View>
              </View>
            );
          })}
          {ranked.length > 1 && (
            <Text style={s.explain}>
              {(() => {
                const worst = ranked[ranked.length - 1];
                const why = verdictText(best, worst);
                return why
                  ? `💡 الفرق بين الأفضل والأسوأ: ${why}`
                  : '💡 الفرق بين الترددات طفيف — أي واحد يكفي.';
              })()}
            </Text>
          )}
        </GlassCard>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 14, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  p: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  sub: { color: C.text, fontSize: 12.5, textAlign: 'right', marginTop: 8 },
  warn: { color: C.gold, fontSize: 12, textAlign: 'right', marginTop: 6, lineHeight: 18 },
  status: { color: C.sub, fontSize: 12.5, textAlign: 'center', marginTop: 8 },
  headline: { color: C.text, fontSize: 14, fontWeight: '800', textAlign: 'right', marginBottom: 8 },
  explain: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 10, lineHeight: 18 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  modeBtn: {
    flex: 1, borderWidth: 1, borderColor: C.cardBorder,
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8,
    alignItems: 'center', backgroundColor: C.rowBg,
  },
  modeBtnOn: { backgroundColor: C.violet, borderColor: C.violet },
  modeTxt: { color: C.text, fontWeight: '800', fontSize: 13 },
  modeTxtOn: { color: '#ffffff' },
  modeSub: { color: C.muted, fontSize: 10.5, marginTop: 2 },
  btn: { backgroundColor: C.violet, borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  btnRed: { backgroundColor: C.red },
  btnOff: { opacity: 0.45 },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 15 },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.cardBorder,
  },
  rowBest: { backgroundColor: C.violetSoft, borderRadius: 12, paddingHorizontal: 8 },
  scoreCol: { alignItems: 'flex-start', minWidth: 68 },
  rowTitle: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  rowMain: { color: C.text, fontSize: 12, textAlign: 'right', marginTop: 2 },
  rowSub: { color: C.muted, fontSize: 11, textAlign: 'right' },
  score: { fontWeight: '900', fontSize: 18 },
  err: { color: C.red, fontSize: 13, textAlign: 'center' },
});
