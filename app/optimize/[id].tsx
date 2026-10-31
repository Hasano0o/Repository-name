import { runRouterOp } from '../../src/utils/routerOp';
import { useLeaveGuard } from '../../src/ui/useLeaveGuard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { useAutoStart } from '../../src/assistant/auto';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { safeApply, trialMessage } from '../../src/utils/safeLock';
import { BandConfig, CellTower } from '../../src/drivers/types';
import { OptTarget, buildCandidates, targetName, targetKey } from '../../src/utils/optimize';
import { bandLabel, freqLabel } from '../../src/utils/bands';
import { saveProfile } from '../../src/store/profiles';
import { C, tBg, tFg } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import {
  testBand, scoreResult, testLabel, verdictText,
  BandTestResult, TestMode,
} from '../../src/utils/bandTest';

import { sheet } from '../../src/i18n';
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

const isComboT = (t: OptTarget) => !!(t.lte || t.nr);
const nameOf = (t: OptTarget) => (isComboT(t) ? targetName(t) : bandLabel(t.tech, t.band));
/** يطبّق المرشّح: تردد واحد، أو دمج (4G كلها مع بعض، و5G لو محددة) */
const applyTarget = (d: any, t: OptTarget) => (
  isComboT(t) ? d.setBand!(t.lte ?? 'keep', t.nr)
  : t.tech === 'NR' ? d.setBand!('keep', [t.band]) : d.setBand!([t.band], undefined)
);

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
  // خروج وقت الفحص ← تأكيد (كان يكمل بالخلفية ويطلع «الراوتر مشغول» لو رجع)
  useLeaveGuard(running, { what: 'المُحسّن التلقائي', onStop: () => { cancel.current = true; } });
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
    setCands(buildCandidates(fromCells, c?.supported ?? [], c?.nrPreferred ?? c?.nrSupported ?? [], 6));
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
    await runRouterOp(info, 'مُحسّن الترددات', async op => {
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

    let nrRejects = 0;
    let combosAdded = false;
    try {
      for (let i = 0; i < list.length || !combosAdded; i++) {
        if (cancel.current) break;
        // خلصنا الترددات المفردة ← نجرب الدمج: أفضل 4G مع بعض + أفضل 5G (مثل B1+B3+n78)
        // التثبيت على تردد واحد يقطع الدمج (CA) — فالدمج غالباً أسرع بكثير
        if (i >= list.length) {
          combosAdded = true;
          const singles = list.filter(r => r.status === 'done' && !r.lte && !r.nr);
          const lteTop = singles.filter(r => r.tech === 'LTE').sort((a, b) => scoreResult(b) - scoreResult(a)).map(r => r.band).slice(0, 3);
          const nrTop = singles.filter(r => r.tech === 'NR').sort((a, b) => scoreResult(b) - scoreResult(a)).map(r => r.band);
          const nrBest = nrTop.length ? [nrTop[0]] : origNr; // [] = 5G على وضعه الأصلي
          const combos: { lte: number[]; nr?: number[] }[] = [];
          if (lteTop.length >= 2) combos.push({ lte: lteTop.slice(0, 2), nr: nrBest });
          if (lteTop.length >= 3) combos.push({ lte: lteTop.slice(0, 3), nr: nrBest });
          if (lteTop.length >= 2 && nrTop.length >= 2) combos.push({ lte: lteTop.slice(0, 2), nr: nrTop.slice(0, 2) });
          for (const c of combos) {
            const t: BandTestResult = {
              tech: 'LTE', band: c.lte[0], lte: c.lte, nr: c.nr, status: 'pending',
              disconnectCount: 0, totalSamples: 0, onlinePct: 100, pciChanges: 0, durationMs: 0, samples: [],
            };
            list.push(t);
          }
          if (combos.length && mounted.current) setRows([...list]);
          if (i >= list.length) break;
        }
        const { tech, band } = list[i];
        const isCombo = !!(list[i].lte || list[i].nr);
        // الراوتر رفض ترددين 5G ورا بعض = ما يسمح بقفل 5G على هالترددات — بس n78/n41 نجربهم دايماً
        if (!isCombo && tech === 'NR' && nrRejects >= 2 && band !== 78 && band !== 41) { upd(i, { status: 'failed', note: 'تخطيناه — راوترك ما يسمح بتثبيت هذا التردد' }); continue; }
        upd(i, { status: 'testing', note: isCombo ? 'نجرب الدمج...' : 'نقفل التردد...' });
        try {
          await withSession(info, d => applyTarget(d, list[i]), false);
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
          const msg = String(e?.message ?? '');
          if (/رفض/.test(msg)) {
            if (tech === 'NR' && !isCombo) nrRejects++;
            // نخلي رد الراوتر ظاهر (بين القوسين) — يفيدنا لو أرسل لنا المستخدم صورة
            const raw = (msg.match(/\(([^()]*)\)\s*$/) || [])[1];
            upd(i, { status: 'failed', note: 'راوترك ما يقبل هذا التردد (ما تغيّر شي)' + (raw ? ` — ${raw}` : '') });
          } else {
            upd(i, { status: 'failed', note: msg || 'خطأ' });
          }
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

          const label = `التثبيت على ${nameOf(best)}`;
          const res = await safeApply({
            op,
            r: info,
            key: `band:${targetKey(best)}`,
            label,
            withNr: best.tech === 'NR' || !!best.nr,
            apply: d => applyTarget(d, best),
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
              name: 'أفضل تردد — ' + nameOf(best),
              bands: best.lte ?? (best.tech === 'NR' ? origLte : [best.band]),
              nrBands: best.nr ?? (best.tech === 'NR' ? [best.band] : origNr),
              mode: cfg.mode,
            });
          } catch {}
          if (mounted.current) {
            const sc = scoreResult(best);
            const why = verdictText(best, ranked[ranked.length - 1] ?? best);
            Alert.alert(
              'تم التحسين',
              `ثبّتناك على ${nameOf(best)} — التقييم ${testLabel(best)} (${Math.round(sc * 100)}%).\n` +
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
    });
  };

  // فتحها المساعد («اختار لي أفضل تردد») ← نعرض التأكيد مباشرة: التجربة تقطع النت
  useAutoStart(!loading && !!cfg && cands.length > 0 && !running, () => Alert.alert(
    'أجرّب الترددات؟',
    `بجرّب ${cands.length} ترددات وأقيس كل واحد. النت بينقطع شوي مع كل تردد (تقريباً ${cands.length * 2} دقايق).\n\nلو ما لقينا أفضل من إعدادك، نرجّعه زي ما كان.`,
    [{ text: 'لا', style: 'cancel' }, { text: 'ابدأ', onPress: () => { run(); } }],
  ));

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

        <Text style={s.sub}>المرشّحون: {cands.map(c => bandLabel(c.tech, c.band)).join('، ') || 'ما فيه'} — وبعدها نجرب دمج الأفضل مع بعض</Text>

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
              style={[s.btn, { backgroundColor: tBg('#9333ea'), marginTop: 8 }]}
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
              🏆 الأفضل: {nameOf(best)} — {testLabel(best)} ({Math.round(scoreResult(best) * 100)}%)
            </Text>
          )}
          {rows.map((r, i) => {
            const isBest = best && targetKey(best) === targetKey(r);
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
                    {nameOf(r)} {isBest ? '⭐' : ''}
                    <Text style={s.rowSub}>  {r.lte || r.nr ? 'دمج' : freqLabel(r.tech, r.band)}</Text>
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

const s = sheet({
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
    flex: 1, borderWidth: 1.5, borderColor: C.cardBorder,
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8,
    alignItems: 'center', backgroundColor: C.rowBg,
  },
  modeBtnOn: { backgroundColor: C.violet, borderColor: C.violet },
  modeTxt: { color: C.text, fontWeight: '800', fontSize: 13 },
  modeTxtOn: { color: tFg('#ffffff') },
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
