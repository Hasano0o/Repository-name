import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { safeApply, trialMessage } from '../../src/utils/safeLock';
import { BandConfig, CellTower } from '../../src/drivers/types';
import { measureLatency, gamingGrade, LatencyResult } from '../../src/utils/latency';
import { bandLabel, freqLabel } from '../../src/utils/bands';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';

type Tech = 'LTE' | 'NR';
interface Target { tech: Tech; band: number; }
interface Row extends Target {
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;
  res?: LatencyResult;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function PingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [avail, setAvail] = useState<Target[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [now, setNow] = useState<LatencyResult | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
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
    try {
      const [c, cells] = await withSession(r, async d => Promise.all([
        d.getBandConfig ? d.getBandConfig() : Promise.resolve(null),
        d.getCells ? d.getCells().catch(() => [] as CellTower[]) : Promise.resolve([] as CellTower[]),
      ]));
      if (!mounted.current) return;
      setCfg(c);
      const seen = new Map<string, Target>();
      for (const x of cells) {
        if (!x.band) continue;
        seen.set(x.tech + x.band, { tech: x.tech, band: x.band });
      }
      const list = [...seen.values()].sort((a, b) => (a.tech === b.tech ? a.band - b.band : a.tech === 'NR' ? -1 : 1));
      setAvail(list);
      setPicked(list.slice(0, 4).map(x => x.tech + x.band));
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? String(e));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      await load(r);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, load]));

  const measureNow = async () => {
    setBusy(true);
    setStatus('نقيس الاستجابة الحالية...');
    try {
      setNow(await measureLatency(12));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

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
    if (!info || !cfg) return;
    const targets = avail.filter(a => picked.includes(a.tech + a.band));
    if (!targets.length) { Alert.alert('اختر ترددات', 'حدد تردداً واحداً على الأقل'); return; }

    const origLte = cfg.locked;
    const origNr = cfg.nrLocked;
    cancel.current = false;
    setRunning(true);
    setError('');

    const list: Row[] = targets.map(t => ({ ...t, status: 'pending' }));
    setRows([...list]);
    const upd = (i: number, p: Partial<Row>) => {
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
          upd(i, { note: 'نقيس الاستجابة...' });
          await sleep(3000);
          const res = await measureLatency(14);
          if (!res.samples) { upd(i, { status: 'failed', note: 'ما وصلنا للإنترنت' }); continue; }
          upd(i, { status: 'done', res, note: undefined });
        } catch (e: any) {
          upd(i, { status: 'failed', note: e?.message ?? 'خطأ' });
        }
      }
    } finally {
      setStatus('نرجّع إعدادك السابق...');
      try { await withSession(info, d => d.setBand!(origLte, origNr), false); } catch {}
      if (mounted.current) {
        setRunning(false);
        setStatus('');
        await load(info);
      }
    }
  };

  const done = rows.filter(r => r.status === 'done' && r.res);
  const ranked = [...done].sort((a, b) => gamingGrade(b.res!).score - gamingGrade(a.res!).score);
  const best = ranked[0];

  const applyBest = () => {
    if (!info || !cfg || !best) return;
    Alert.alert(
      'تثبيت للألعاب',
      `بنقفل على ${bandLabel(best.tech, best.band)} — استجابة ${best.res!.median}ms وتذبذب ${best.res!.jitter}ms.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ثبّت', onPress: async () => {
            setBusy(true);
            try {
              const label = `تثبيت ${bandLabel(best.tech, best.band)} للألعاب`;
              const res = await safeApply({
                r: info,
                key: `band:${best.tech}:${best.band}`,
                label,
                withNr: best.tech === 'NR',
                apply: d => (best.tech === 'NR'
                  ? d.setBand!(cfg.locked, [best.band])
                  : d.setBand!([best.band], cfg.nrLocked)),
                revert: d => d.setBand!(cfg.locked, cfg.nrLocked),
              });
              await load(info);
              const m = trialMessage(res, label);
              Alert.alert(m.title, m.body);
            } catch (e: any) {
              Alert.alert('ما تم', e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const toggle = (k: string) => {
    if (running) return;
    setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]));
  };

  const mins = Math.ceil((picked.length * 55) / 60);

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        {loading && <View style={s.center}><ActivityIndicator size="large" color={C.blue} /></View>}

        {!!error && <View style={s.errBox}><Text style={s.err}>{error}</Text></View>}

        {!!status && (
          <View style={s.statusBox}>
            <Text style={s.statusText}>{status}</Text>
            <ActivityIndicator color={C.blue} />
          </View>
        )}

        {!loading && (
          <GlassCard title="استجابتك الآن" icon="🎮" tint={C.greenSoft} collapsible={false}>
            {now ? (
              <>
                <View style={s.statRow}>
                  <Stat v={`${now.median}`} u="ms" l="الاستجابة" c={now.median < 50 ? C.green : now.median < 90 ? C.gold : C.red} />
                  <Stat v={`${now.jitter}`} u="ms" l="التذبذب" c={now.jitter < 10 ? C.green : now.jitter < 25 ? C.gold : C.red} />
                  <Stat v={`${now.lossPct}`} u="%" l="الفقد" c={now.lossPct === 0 ? C.green : C.red} />
                </View>
                <Text style={[s.grade, { color: gamingGrade(now).score > 0.7 ? C.green : gamingGrade(now).score > 0.4 ? C.gold : C.red }]}>
                  {gamingGrade(now).label}
                </Text>
              </>
            ) : (
              <Text style={s.hint}>اضغط القياس عشان نعرف وضعك الحالي قبل أي تغيير</Text>
            )}
            <Pressable style={[s.btn, busy && s.dim]} onPress={measureNow} disabled={busy || running}>
              <Text style={s.btnText}>{busy ? 'نقيس...' : 'قياس الآن'}</Text>
            </Pressable>
            <Text style={s.hint}>
              القياس يمر عبر الواي فاي والراوتر معاً، فالرقم أعلى قليلاً من داخل اللعبة — لكنه صالح للمقارنة بين الترددات
            </Text>
          </GlassCard>
        )}

        {!loading && avail.length > 0 && !cfg && (
        <Text style={s.hint}>راوترك ما يدعم قفل الترددات — مقارنة الترددات غير متاحة</Text>
      )}

      {!loading && avail.length > 0 && cfg && (
          <GlassCard title="قارن الترددات" icon="🔬" tint={C.goldSoft} collapsible={false}>
            <Text style={s.hint}>
              نقفل على كل تردد ونقيس استجابته فعلياً. الإنترنت بينقطع أثناء الفحص، وبعده نرجّع إعدادك
            </Text>

            <View style={s.grid}>
              {avail.map(a => {
                const k = a.tech + a.band;
                const on = picked.includes(k);
                return (
                  <Pressable key={k} style={[s.band, on && s.bandOn, running && s.dim]} onPress={() => toggle(k)}>
                    <Text style={[s.bandName, on && { color: C.onAccent }]}>{bandLabel(a.tech, a.band)}</Text>
                    <Text style={[s.bandFreq, on && { color: C.onAccent }]}>{freqLabel(a.tech, a.band) || ' '}</Text>
                  </Pressable>
                );
              })}
            </View>

            {!running ? (
              <Pressable style={[s.btn, (busy || !picked.length) && s.dim]} onPress={run} disabled={busy || !picked.length}>
                <Text style={s.btnText}>ابدأ الفحص ({mins} دقيقة تقريباً)</Text>
              </Pressable>
            ) : (
              <Pressable style={[s.btnGhost, { borderColor: C.red }]} onPress={() => { cancel.current = true; }}>
                <Text style={[s.btnGhostText, { color: C.red }]}>إيقاف</Text>
              </Pressable>
            )}

            {rows.map(r => {
              const g = r.res ? gamingGrade(r.res) : null;
              const col = !g ? C.sub : g.score > 0.7 ? C.green : g.score > 0.4 ? C.gold : C.red;
              return (
                <View key={r.tech + r.band} style={s.row}>
                  <View style={s.rowHead}>
                    <View style={s.rowState}>
                      {r.status === 'testing' && <ActivityIndicator size="small" color={C.blue} />}
                      <Text style={[s.rowNote, { color: r.status === 'failed' ? C.red : col }]}>
                        {r.status === 'done' && g ? g.label : r.status === 'pending' ? 'بالانتظار' : r.note}
                      </Text>
                    </View>
                    <Text style={[s.rowName, r.tech === 'NR' && { color: C.violet }]}>
                      {bandLabel(r.tech, r.band)}
                    </Text>
                  </View>
                  {r.res && (
                    <Text style={s.rowVals}>
                      استجابة {r.res.median}ms · أدنى {r.res.min}ms · تذبذب {r.res.jitter}ms · فقد {r.res.lossPct}%
                    </Text>
                  )}
                </View>
              );
            })}

            {!running && best && (
              <View style={s.bestBox}>
                <Text style={s.bestTitle}>
                  الأفضل للألعاب: {bandLabel(best.tech, best.band)} — {best.res!.median}ms
                </Text>
                <Pressable style={[s.btn, busy && s.dim]} onPress={applyBest} disabled={busy}>
                  <Text style={s.btnText}>ثبّت عليه</Text>
                </Pressable>
              </View>
            )}
          </GlassCard>
        )}

        {!loading && (
          <GlassCard title="وش يهم في الألعاب" icon="💡" tint={C.violetSoft} defaultOpen={false}>
            <Text style={s.hint}>
              الاستجابة (ping) أهم من السرعة. تحت 50ms ممتاز، و50 إلى 90 جيد، وفوق 150 تحس بالتأخير
            </Text>
            <Text style={s.hint}>
              التذبذب (jitter) أخطر من الاستجابة نفسها — استجابة 80ms ثابتة أفضل من 40ms متذبذبة، لأن التذبذب يسبب الارتعاش المفاجئ
            </Text>
            <Text style={s.hint}>
              الفقد فوق 1% يسبب انقطاع الحركة داخل اللعبة حتى لو كانت الاستجابة ممتازة
            </Text>
            <Text style={s.hint}>
              5G عادةً أقل استجابة من 4G — إذا كان عندك تردد 5G فهو أول المرشحين
            </Text>
          </GlassCard>
        )}
        <Text style={s.cloudflareNote}>
          ملاحظة: قياس الاستجابة يستخدم خادم Cloudflare (speed.cloudflare.com) — لا تُرسل أي بيانات شخصية، فقط اختبار زمن الاستجابة.
        </Text>

      </ScrollView>
    </LinearGradient>
  );
}

function Stat({ v, u, l, c }: { v: string; u: string; l: string; c: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statV, { color: c }]}>{v}</Text>
      <Text style={s.statU}>{u}</Text>
      <Text style={s.statL}>{l}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  cloudflareNote: {
    color: C.muted,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
    lineHeight: 17,
  },
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', paddingVertical: 40 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  errBox: { backgroundColor: C.redSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 14, padding: 12 },
  err: { color: C.red, fontWeight: '700', textAlign: 'right' },
  statusBox: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, backgroundColor: C.blueSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 14, padding: 12 },
  statusText: { color: C.blue, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  stat: { flex: 1, alignItems: 'center', backgroundColor: C.rowBg, borderRadius: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.cardBorder },
  statV: { fontWeight: '800', fontSize: 20 },
  statU: { color: C.muted, fontSize: 10 },
  statL: { color: C.sub, fontSize: 11, fontWeight: '700', marginTop: 2 },
  grade: { fontWeight: '800', textAlign: 'center', fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  band: { flexBasis: '30%', flexGrow: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 14, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  bandOn: { backgroundColor: C.blue, borderColor: C.blue },
  bandName: { color: C.text, fontWeight: '800', fontSize: 16 },
  bandFreq: { color: C.sub, fontSize: 10, marginTop: 2 },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 13, alignItems: 'center' },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  btnGhost: { borderWidth: 1, borderRadius: 14, padding: 13, alignItems: 'center' },
  btnGhostText: { fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.45 },
  row: { backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 11, gap: 6 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowState: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  rowNote: { fontWeight: '700', fontSize: 12 },
  rowName: { color: C.text, fontWeight: '800', fontSize: 15 },
  rowVals: { color: C.sub, fontSize: 11, textAlign: 'right' },
  bestBox: { borderTopWidth: 1, borderTopColor: C.cardBorder, paddingTop: 12, gap: 10 },
  bestTitle: { color: C.green, fontWeight: '800', fontSize: 15, textAlign: 'right' },
});
