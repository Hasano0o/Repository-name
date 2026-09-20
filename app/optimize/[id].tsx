import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { safeApply, trialMessage } from '../../src/utils/safeLock';
import { BandConfig, CellTower, Signal } from '../../src/drivers/types';
import { measureLatency } from '../../src/utils/latency';
import { OptRow, OptTarget, totalScore, scoreLabel, rankRows, buildCandidates } from '../../src/utils/optimize';
import { bandLabel, freqLabel } from '../../src/utils/bands';
import { saveProfile } from '../../src/store/profiles';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function OptimizeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [cands, setCands] = useState<OptTarget[]>([]);
  const [rows, setRows] = useState<OptRow[]>([]);
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
      await sleep(3000);
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

    const list: OptRow[] = cands.map(t => ({ ...t, status: 'pending' }));
    setRows([...list]);
    const upd = (i: number, p: Partial<OptRow>) => {
      list[i] = { ...list[i], ...p };
      if (mounted.current) setRows([...list]);
    };

    try {
      for (let i = 0; i < list.length; i++) {
        if (cancel.current) break;
        const { tech, band } = list[i];
        upd(i, { status: 'testing', note: 'نقفل التردد...' });
        try {
          await withSession(info, d => (tech === 'NR' ? d.setBand!(origLte, [band]) : d.setBand!([band], origNr)), false);
          upd(i, { note: 'ننتظر الاتصال...' });
          const ok = await waitOnline(info, 35000);
          if (cancel.current) { upd(i, { status: 'pending', note: undefined }); break; }
          if (!ok) { upd(i, { status: 'failed', note: 'ما اتصل على هذا التردد' }); continue; }

          upd(i, { note: 'نقرأ الإشارة...' });
          await sleep(2500);
          const sig: Signal = await withSession(info, d => (d.getSignal ? d.getSignal() : Promise.resolve({} as Signal)));
          const rsrp = tech === 'NR' ? (sig.nrRsrp ?? sig.rsrp) : sig.rsrp;
          const sinr = tech === 'NR' ? (sig.nrSinr ?? sig.sinr) : sig.sinr;

          upd(i, { note: 'نقيس الاستجابة...', rsrp, sinr });
          const lat = await measureLatency(12);
          const score = totalScore(rsrp, sinr, lat.samples ? lat : undefined);
          upd(i, { status: 'done', latency: lat, score, note: undefined });
        } catch (e: any) {
          upd(i, { status: 'failed', note: e?.message ?? 'خطأ' });
        }
      }
    } finally {
      const ranked = rankRows(list);
      const best = ranked[0];
      if (best && !cancel.current) {
        setStatus('نرجّع إعدادك الأصلي عشان نقارن بأمان...');
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
              Alert.alert(m.title, m.body + '\n\nيعني إعدادك الحالي (بدون تثبيت) هو الأفضل.');
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
            Alert.alert(
              'تم التحسين',
              `ثبّتناك على ${bandLabel(best.tech, best.band)} — التقييم ${scoreLabel(best.score ?? 0)}.\nوحفظناه كملف تعريف.`,
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
        setRunning(false); setStatus('');
        try { await load(info); } catch {}
      }
    }
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;

  const ranked = rankRows(rows);
  const best = ranked[0];
  const canRun = !!cfg && cands.length > 0 && !running;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      {!!error && <Text style={s.err}>{error}</Text>}

      <GlassCard title="المُحسِّن التلقائي" subtitle="Auto optimizer" icon="🪄" tint={C.violet} collapsible={false}>
        <Text style={s.p}>
          يجرب كل تردد متاح، يقيس القوة والنقاء والاستجابة، ويثبّتك على الأفضل تلقائياً — ويحفظه كملف تعريف.
        </Text>
        <Text style={s.sub}>المرشّحون: {cands.map(c => bandLabel(c.tech, c.band)).join('، ') || 'ما فيه'}</Text>
        <Text style={s.warn}>ينقطع الاتصال لدقايق أثناء الفحص — لا تشغّله وأنت تحتاج النت.</Text>

        {running ? (
          <>
            <Pressable style={[s.btn, s.btnRed]} onPress={() => { cancel.current = true; }}>
              <Text style={s.btnTxt}>إيقاف</Text>
            </Pressable>
            {!!status && <Text style={s.status}>{status}</Text>}
          </>
        ) : (
          <Pressable style={[s.btn, !canRun && s.btnOff]} disabled={!canRun} onPress={run}>
            <Text style={s.btnTxt}>ابدأ التحسين</Text>
          </Pressable>
        )}
      </GlassCard>

      {rows.length > 0 && (
        <GlassCard title="النتائج" subtitle="Results" icon="📊" tint={C.blue} collapsible={false}>
          {rows.map((r, i) => {
            const isBest = best && best.tech === r.tech && best.band === r.band;
            return (
              <View key={i} style={[s.row, isBest && s.rowBest]}>
                <View style={{ alignItems: 'flex-start', minWidth: 76 }}>
                  {r.status === 'done' ? (
                    <>
                      <Text style={s.score}>{Math.round((r.score ?? 0) * 100)}%</Text>
                      <Text style={s.rowSub}>{scoreLabel(r.score ?? 0)}</Text>
                    </>
                  ) : r.status === 'testing' ? (
                    <ActivityIndicator color={C.blue} />
                  ) : (
                    <Text style={s.rowSub}>{r.status === 'failed' ? 'فشل' : 'بالانتظار'}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>
                    {bandLabel(r.tech, r.band)} {isBest ? '⭐' : ''}
                    <Text style={s.rowSub}>  {freqLabel(r.tech, r.band)}</Text>
                  </Text>
                  <Text style={s.rowSub}>
                    {r.note
                      ? r.note
                      : r.status === 'done'
                        ? `${r.rsrp ?? '—'} dBm · SINR ${r.sinr ?? '—'} · ${r.latency?.median ?? '—'}ms`
                        : ''}
                  </Text>
                </View>
              </View>
            );
          })}
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
  warn: { color: C.gold, fontSize: 12, textAlign: 'right', marginTop: 6 },
  status: { color: C.sub, fontSize: 12.5, textAlign: 'center', marginTop: 8 },
  btn: { backgroundColor: C.violet, borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  btnRed: { backgroundColor: C.red },
  btnOff: { opacity: 0.45 },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 15 },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.cardBorder,
  },
  rowBest: { backgroundColor: C.violetSoft, borderRadius: 12, paddingHorizontal: 8 },
  rowTitle: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  rowSub: { color: C.muted, fontSize: 11.5, textAlign: 'right' },
  score: { color: C.violet, fontWeight: '900', fontSize: 17 },
  err: { color: C.red, fontSize: 13, textAlign: 'center' },
});
