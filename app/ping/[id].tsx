import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { safeApply, trialMessage } from '../../src/utils/safeLock';
import { BandConfig, CellTower, RouterDriver } from '../../src/drivers/types';
import {
  LatencyResult, REGIONS, REGION_KEY, regionById, regionUrls, measureUrl, measureWifi,
  gameScore, scoreWord, scoreLight, diagnose, Diagnosis, Light,
} from '../../src/utils/latency';
import { saveProfile } from '../../src/store/profiles';
import { buildWeekly, weeklyLines } from '../../src/utils/weekly';
import { Consent, TowerRef, TowerInfo, getConsent, setConsent, currentTower, fetchTower, reportTest } from '../../src/services/community';
import { addGameLog, listGameLog, periodStats, PeriodStat } from '../../src/store/gameLog';
import { bandLabel, freqLabel } from '../../src/utils/bands';
import { C } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';

type Tech = 'LTE' | 'NR';
type Kind = 'base' | 'band' | 'lteOnly';
interface Target { key: string; kind: Kind; tech?: Tech; band?: number; label: string; sub?: string }
interface Row extends Target {
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;
  res?: LatencyResult;
  score?: number;
}

const LTE_ONLY = '03';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const lightColor = (l: Light) => (l === 'green' ? C.green : l === 'yellow' ? '#e0a100' : C.red);
const lightEmoji = (l: Light) => (l === 'green' ? '🟢' : l === 'yellow' ? '🟡' : '🔴');
const scoreColor = (sc: number) => lightColor(scoreLight(sc));

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [avail, setAvail] = useState<Target[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [region, setRegion] = useState(REGIONS[0].id);
  const [regionRes, setRegionRes] = useState<Record<string, LatencyResult>>({});
  const [check, setCheck] = useState<{ game: LatencyResult; wifi: LatencyResult | null; dx: Diagnosis } | null>(null);
  const [periods, setPeriods] = useState<PeriodStat[]>([]);
  const [weekly, setWeekly] = useState<string[]>([]);
  const [consent, setConsentState] = useState<Consent>(null);
  const [tower, setTower] = useState<TowerRef | null>(null);
  const [community, setCommunity] = useState<TowerInfo | null>(null);
  const [commLoading, setCommLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const cancel = useRef(false);
  const mounted = useRef(true);

  const reg = regionById(region);

  useEffect(() => {
    mounted.current = true;
    AsyncStorage.getItem(REGION_KEY).then(v => { if (v && mounted.current) setRegion(regionById(v).id); }).catch(() => {});
    return () => { mounted.current = false; cancel.current = true; };
  }, []);

  const pickRegion = (rid: string) => {
    if (running || busy) return;
    setRegion(rid);
    setCheck(null);
    AsyncStorage.setItem(REGION_KEY, rid).catch(() => {});
  };

  const refreshPeriods = useCallback(async (r: SavedRouter, rid: string) => {
    const list = await listGameLog(r.id);
    const w = await buildWeekly(r.id).catch(() => null);
    if (mounted.current) {
      setPeriods(periodStats(list, rid));
      setWeekly(w && (w.checks >= 2 || w.sessions >= 1) ? weeklyLines(w) : []);
    }
  }, []);

  useEffect(() => { if (info) refreshPeriods(info, region); }, [info, region, refreshPeriods]);

  const refreshCommunity = useCallback(async (r: SavedRouter, rid: string) => {
    const c = await getConsent();
    if (!mounted.current) return;
    setConsentState(c);
    if (c !== 'on') return;
    setCommLoading(true);
    try {
      const t = await currentTower(r);
      if (!mounted.current) return;
      setTower(t);
      setCommunity(t ? await fetchTower(t, rid) : null);
    } finally {
      if (mounted.current) setCommLoading(false);
    }
  }, []);

  useEffect(() => { if (info && !running) refreshCommunity(info, region); }, [info, region, running, refreshCommunity]);

  const answerConsent = async (v: 'on' | 'off') => {
    await setConsent(v);
    setConsentState(v);
    if (v === 'on' && info) refreshCommunity(info, region);
  };

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
        const k = x.tech + x.band;
        seen.set(k, { key: k, kind: 'band', tech: x.tech, band: x.band, label: bandLabel(x.tech, x.band), sub: freqLabel(x.tech, x.band) || undefined });
      }
      const bands = [...seen.values()].sort((a, b) => (a.tech === b.tech ? a.band! - b.band! : a.tech === 'NR' ? -1 : 1));
      const list: Target[] = [{ key: 'base', kind: 'base', label: 'إعدادك الحالي', sub: 'للمقارنة' }];
      const hasNr = !!c && (c.nrSupported.length > 0 || cells.some(x => x.tech === 'NR'));
      if (c && hasNr && c.mode !== LTE_ONLY && c.modes.some(m => m.value === LTE_ONLY)) {
        list.push({ key: 'lteOnly', kind: 'lteOnly', label: '4G فقط', sub: 'بدون 5G' });
      }
      list.push(...bands);
      setAvail(list);
      setPicked(prev => (prev.length ? prev.filter(k => list.some(t => t.key === k)) : list.slice(0, 5).map(t => t.key)));
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

  /* ═══ جاهز للعب؟ ═══ */
  const readyCheck = async () => {
    if (!info) return;
    setBusy(true);
    setError('');
    try {
      setStatus('نفحص الواي فاي...');
      const wifi = await measureWifi(info.host, 10).catch(() => null);
      setStatus(`نقيس البنق لسيرفرات ${reg.name}...`);
      // نقرأ استهلاك الراوتر أثناء القياس — نكشف لو فيه جهاز ثاني يحمّل
      const readDown = () => withSession(info, async d => (d.getTraffic ? d.getTraffic() : null)).then(t => t?.downBytesPerSec).catch(() => undefined);
      const [game, down1] = await Promise.all([measureUrl(regionUrls(reg), 20), sleep(1500).then(readDown)]);
      let sinr: number | undefined;
      let down2: number | undefined;
      try {
        const [sig, tr] = await withSession(info, async d => Promise.all([
          d.getSignal ? d.getSignal() : Promise.resolve(null),
          d.getTraffic ? d.getTraffic().catch(() => null) : Promise.resolve(null),
        ]));
        sinr = sig?.sinr ?? sig?.nrSinr;
        down2 = tr?.downBytesPerSec;
      } catch {}
      const downs = [down1, down2].filter((x): x is number => typeof x === 'number');
      const down = downs.length ? Math.max(...downs) : undefined;
      const dx = diagnose(game, wifi, sinr, down);
      if (!mounted.current) return;
      setCheck({ game, wifi, dx });
      if (game.samples) {
        await addGameLog(info.id, { at: Date.now(), region: reg.id, score: dx.score, median: game.median, jitter: game.jitter, lossPct: game.lossPct });
        refreshPeriods(info, reg.id);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      if (mounted.current) { setBusy(false); setStatus(''); }
    }
  };

  /* ═══ أي سيرفر أقرب ═══ */
  const compareRegions = async () => {
    setBusy(true);
    setRegionRes({});
    try {
      for (const r of REGIONS) {
        if (!mounted.current) return;
        setStatus(`نقيس ${r.name}...`);
        const res = await measureUrl(regionUrls(r), 10);
        if (mounted.current) setRegionRes(p => ({ ...p, [r.id]: res }));
      }
    } finally {
      if (mounted.current) { setBusy(false); setStatus(''); }
    }
  };

  /* ═══ مُحسّن اللعبة ═══ */
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

  const applyTarget = (t: Target, c: BandConfig) => (d: RouterDriver): Promise<void> => {
    if (t.kind === 'lteOnly') return d.setNetworkMode!(LTE_ONLY);
    if (t.kind === 'band') return t.tech === 'NR' ? d.setBand!(c.locked, [t.band!]) : d.setBand!([t.band!], c.nrLocked);
    return Promise.resolve();
  };

  const run = async () => {
    if (!info || !cfg) return;
    // الترتيب: الحالي أولاً، بعده 4G فقط (ونرجّع الوضع)، بعدها الترددات
    const order: Kind[] = ['base', 'lteOnly', 'band'];
    const targets = avail
      .filter(a => picked.includes(a.key))
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    if (!targets.length) { Alert.alert('اختر', 'حدد خياراً واحداً على الأقل'); return; }

    const orig = cfg;
    const scanTower = (await getConsent()) === 'on' ? await currentTower(info) : null;
    let modeChanged = false;
    let bandChanged = false;
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
        const t = list[i];
        upd(i, { status: 'testing', note: t.kind === 'base' ? 'نقيس...' : 'نطبّق الإعداد...' });
        try {
          if (t.kind !== 'base') {
            await withSession(info, applyTarget(t, orig), false);
            if (t.kind === 'lteOnly') modeChanged = true; else bandChanged = true;
            upd(i, { note: 'ننتظر الاتصال...' });
            const ok = await waitOnline(info, 35000);
            if (cancel.current) { upd(i, { status: 'pending', note: undefined }); break; }
            if (!ok) { upd(i, { status: 'failed', note: 'ما اتصل على هذا الإعداد' }); continue; }
            upd(i, { note: `نقيس البنق لـ${reg.name}...` });
            await sleep(3000);
          }
          const res = await measureUrl(regionUrls(reg), 20);
          if (!res.samples) { upd(i, { status: 'failed', note: res.error ? `ما وصلنا للسيرفر — ${res.error}` : 'ما وصلنا للسيرفر' }); }
          else {
            const score = gameScore(res);
            upd(i, { status: 'done', res, score, note: undefined });
            await addGameLog(info.id, { at: Date.now(), region: reg.id, score, median: res.median, jitter: res.jitter, lossPct: res.lossPct, setup: t.label });
            if (scanTower && t.kind !== 'base') {
              reportTest(scanTower, { setup: t.label, region: reg.id, score, ping: res.median, jitter: res.jitter, loss: res.lossPct }).catch(() => {});
            }
          }
        } catch (e: any) {
          upd(i, { status: 'failed', note: e?.message ?? 'خطأ' });
        }
        // بعد اختبار 4G فقط نرجّع الوضع قبل ما نجرب الترددات
        if (t.kind === 'lteOnly' && modeChanged) {
          setStatus('نرجّع وضع الشبكة...');
          try { await withSession(info, d => d.setNetworkMode!(orig.mode), false); modeChanged = false; } catch {}
          await waitOnline(info, 30000);
          setStatus('');
        }
      }
    } finally {
      setStatus('نرجّع إعدادك السابق...');
      try {
        if (modeChanged) await withSession(info, d => d.setNetworkMode!(orig.mode), false);
        if (bandChanged) await withSession(info, d => d.setBand!(orig.locked, orig.nrLocked), false);
      } catch {}
      if (mounted.current) {
        setRunning(false);
        setStatus('');
        await load(info);
        refreshPeriods(info, reg.id);
      }
    }
  };

  const ranked = rows.filter(r => r.status === 'done' && r.score !== undefined).sort((a, b) => b.score! - a.score!);
  const best = ranked[0];
  const baseRow = rows.find(r => r.kind === 'base' && r.status === 'done');
  const bestIsBase = !!best && (best.kind === 'base' || (!!baseRow && best.score! - baseRow.score! < 5));

  const applyBest = () => {
    if (!info || !cfg || !best || best.kind === 'base') return;
    Alert.alert(
      'ثبّت للعب',
      `بنطبّق «${best.label}» — درجة ${best.score}/100، بنق ${best.res!.median}ms وتذبذب ${best.res!.jitter}ms.\nإذا صارت الإشارة أسوأ نرجّع تلقائياً.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ثبّت', onPress: async () => {
            setBusy(true);
            try {
              const label = `${best.label} للألعاب`;
              const res = await safeApply({
                r: info,
                key: best.kind === 'lteOnly' ? 'mode:lteOnly' : `band:${best.tech}:${best.band}`,
                label,
                withNr: best.tech === 'NR',
                apply: applyTarget(best, cfg),
                revert: d => (best.kind === 'lteOnly' ? d.setNetworkMode!(cfg.mode) : d.setBand!(cfg.locked, cfg.nrLocked)),
              });
              await load(info);
              const m = trialMessage(res, label);
              let saved = false;
              if (res.kept) {
                try {
                  const now = await withSession(info, async d => (d.getBandConfig ? d.getBandConfig() : null));
                  if (now) {
                    await saveProfile({ routerId: info.id, name: 'وضع الألعاب', bands: now.locked, nrBands: now.nrLocked, mode: now.mode, role: 'game' });
                    saved = true;
                  }
                } catch {}
              }
              Alert.alert(m.title, m.body + (saved ? '\n\n🎮 انحفظ كـ«وضع الألعاب» — ترجع له بضغطة من صفحة الراوتر.' : ''));
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

  const changing = picked.filter(k => k !== 'base').length;
  const mins = Math.max(1, Math.ceil((changing * 60 + 20) / 60));
  const sortedRegions = REGIONS.filter(r => regionRes[r.id]).sort((a, b) => {
    const x = regionRes[a.id], y = regionRes[b.id];
    if (!x.samples) return 1;
    if (!y.samples) return -1;
    return x.median - y.median;
  });
  const hasHistory = periods.some(p => p.count > 0);
  const bestPeriod = [...periods].filter(p => p.count >= 2 && p.avgScore !== undefined).sort((a, b) => b.avgScore! - a.avgScore!)[0];
  const worstPeriod = [...periods].filter(p => p.count >= 2 && p.avgScore !== undefined).sort((a, b) => a.avgScore! - b.avgScore!)[0];

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
          <View style={s.regionBar}>
            <Text style={s.regionTitle}>سيرفر لعبتك</Text>
            <View style={s.chips}>
              {REGIONS.map(r => {
                const on = r.id === region;
                return (
                  <Pressable key={r.id} onPress={() => pickRegion(r.id)} style={[s.chip, on && s.chipOn, (running || busy) && !on && s.dim]}>
                    <Text style={[s.chipText, on && { color: C.onAccent }]}>{r.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.hint}>{reg.hint}</Text>
          </View>
        )}

        {!loading && (
          <GlassCard title="جاهز للعب؟" icon="🎮" tint={C.greenSoft} collapsible={false}>
            {check ? (
              <>
                <View style={[s.verdict, { borderColor: lightColor(check.dx.light) }]}>
                  <Text style={[s.verdictScore, { color: lightColor(check.dx.light) }]}>{check.dx.score}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.verdictTitle, { color: lightColor(check.dx.light) }]}>
                      {lightEmoji(check.dx.light)} {check.dx.title}
                    </Text>
                    {!!check.dx.cause && <Text style={s.verdictCause}>{check.dx.cause}</Text>}
                    {!!check.dx.fix && <Text style={s.verdictFix}>💡 {check.dx.fix}</Text>}
                    {!!check.dx.action && info && (
                      <Pressable onPress={() => router.push(`/${check.dx.action === 'devices' ? 'device' : 'aim'}/${info.id}` as Href)}>
                        <Text style={s.verdictLink}>{check.dx.action === 'devices' ? 'افتح الأجهزة ‹' : 'افتح مساعد التوجيه ‹'}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                <View style={s.statRow}>
                  <Stat v={`${check.game.median}`} u="ms" l="البنق" c={check.game.median < 50 ? C.green : check.game.median < 90 ? '#e0a100' : C.red} />
                  <Stat v={`${check.game.jitter}`} u="ms" l="التذبذب" c={check.game.jitter < 10 ? C.green : check.game.jitter < 25 ? '#e0a100' : C.red} />
                  <Stat v={`${check.game.lossPct}`} u="%" l="الفقد" c={check.game.lossPct === 0 ? C.green : C.red} />
                  <Stat
                    v={check.wifi && check.wifi.samples ? `${check.wifi.median}` : '—'} u="ms" l="الواي فاي"
                    c={!check.wifi || !check.wifi.samples ? C.sub : check.wifi.jitter > 12 || check.wifi.lossPct ? C.red : C.green}
                  />
                </View>
              </>
            ) : (
              <Text style={s.hint}>فحص 20 ثانية قبل الجيم: يقيس البنق لسيرفر لعبتك والواي فاي والإشارة، ويقولك وين المشكلة لو فيه</Text>
            )}
            <Pressable style={[s.btn, (busy || running) && s.dim]} onPress={readyCheck} disabled={busy || running}>
              <Text style={s.btnText}>{busy ? 'نفحص...' : check ? 'افحص مرة ثانية' : 'افحص الحين'}</Text>
            </Pressable>
          </GlassCard>
        )}

        {!loading && info && (
          <Pressable style={s.lagLink} onPress={() => router.push(`/lag/${info.id}` as Href)} disabled={running}>
            <Text style={s.lagArrow}>‹</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.lagTitle}>🕵️ كاشف اللاق</Text>
              <Text style={s.lagSub}>شغّله وأنت تلعب، ويقولك بعد الجيم متى صار اللاق وليش</Text>
            </View>
          </Pressable>
        )}

        {!loading && avail.length > 1 && !cfg && (
          <Text style={s.hint}>راوترك ما يدعم قفل الترددات — مُحسّن اللعبة غير متاح</Text>
        )}

        {!loading && avail.length > 1 && cfg && (
          <GlassCard title="مُحسّن اللعبة" icon="🔬" tint={C.goldSoft} collapsible={false}>
            <Text style={s.hint}>
              نجرّب كل خيار ونقيس البنق لسيرفرات {reg.name} فعلياً، ونعطي كل واحد درجة من 100. النت بينقطع أثناء الفحص، وبعده نرجّع إعدادك
            </Text>

            <View style={s.grid}>
              {avail.map(a => {
                const on = picked.includes(a.key);
                const nr = a.tech === 'NR';
                return (
                  <Pressable key={a.key} style={[s.band, on && s.bandOn, running && s.dim]} onPress={() => toggle(a.key)}>
                    <Text style={[s.bandName, nr && !on && { color: C.violet }, on && { color: C.onAccent }]}>{a.label}</Text>
                    <Text style={[s.bandFreq, on && { color: C.onAccent }]}>{a.sub || ' '}</Text>
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
              const col = r.score === undefined ? C.sub : scoreColor(r.score);
              return (
                <View key={r.key} style={[s.row, best && r.key === best.key && !running && s.rowBest]}>
                  <View style={s.rowHead}>
                    <View style={s.rowState}>
                      {r.status === 'testing' && <ActivityIndicator size="small" color={C.blue} />}
                      {r.status === 'done' && r.score !== undefined ? (
                        <Text style={[s.rowScore, { color: col }]}>{r.score}<Text style={s.rowScoreOf}>/100</Text></Text>
                      ) : (
                        <Text style={[s.rowNote, { color: r.status === 'failed' ? C.red : C.sub }]}>
                          {r.status === 'pending' ? 'بالانتظار' : r.note}
                        </Text>
                      )}
                    </View>
                    <Text style={[s.rowName, r.tech === 'NR' && { color: C.violet }]}>{r.label}</Text>
                  </View>
                  {r.res && (
                    <>
                      <View style={s.barTrack}><View style={[s.barFill, { width: `${Math.max(4, r.score ?? 0)}%`, backgroundColor: col }]} /></View>
                      <Text style={s.rowVals}>
                        {scoreWord(r.score ?? 0)} · بنق {r.res.median}ms · تذبذب {r.res.jitter}ms · فقد {r.res.lossPct}%
                      </Text>
                    </>
                  )}
                </View>
              );
            })}

            {!running && best && (
              <View style={s.bestBox}>
                {bestIsBase ? (
                  <Text style={s.bestTitle}>إعدادك الحالي هو الأفضل للعب الحين 👌 — ما يحتاج تغيّر شي</Text>
                ) : (
                  <>
                    <Text style={s.bestTitle}>
                      الأفضل لـ{reg.name}: {best.label} — {best.score}/100
                      {baseRow ? ` (إعدادك الحالي ${baseRow.score})` : ''}
                    </Text>
                    <Pressable style={[s.btn, busy && s.dim]} onPress={applyBest} disabled={busy}>
                      <Text style={s.btnText}>ثبّت عليه</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
          </GlassCard>
        )}

        {!loading && info && (
          <GlassCard title="على برجك" icon="👥" tint={C.cyanSoft} collapsible={false}>
            {consent === null && (
              <>
                <Text style={s.hint}>
                  شارك نتائج فحصك بدون أي بيانات شخصية — رقم البرج والنتيجة بس. وبالمقابل تشوف وش نجح عند غيرك على نفس برجك، وتعرف إذا الانقطاع عند الكل أو عندك بس
                </Text>
                <View style={s.consentRow}>
                  <Pressable style={[s.btnGhost, { flex: 1, borderColor: C.sub }]} onPress={() => answerConsent('off')}>
                    <Text style={[s.btnGhostText, { color: C.sub }]}>لا شكراً</Text>
                  </Pressable>
                  <Pressable style={[s.btn, { flex: 1 }]} onPress={() => answerConsent('on')}>
                    <Text style={s.btnText}>شارك</Text>
                  </Pressable>
                </View>
              </>
            )}
            {consent === 'off' && (
              <Pressable onPress={() => answerConsent('on')}>
                <Text style={s.hint}>المشاركة مقفلة. اضغط هنا لو تبي تشوف نتائج غيرك على نفس برجك وتشارك نتائجك</Text>
              </Pressable>
            )}
            {consent === 'on' && (
              commLoading ? <ActivityIndicator color={C.blue} /> :
              !tower ? <Text style={s.hint}>راوترك ما يعطينا رقم البرج، فما نقدر نربطك بغيرك</Text> :
              <>
                {(community?.outages ?? []).filter(o => o.to > Date.now() - 20 * 60000).map(o => (
                  <View key={o.from} style={s.outage}>
                    <Text style={s.outageText}>⚠️ {o.users} {o.users > 2 ? 'مستخدمين' : 'مستخدم'} على نفس برجك انقطع عندهم النت من الساعة {new Date(o.from).toLocaleTimeString('ar-SA', { hour: 'numeric', minute: '2-digit' })} — غالباً المشكلة من البرج مو من عندك</Text>
                  </View>
                ))}
                {(community?.outages ?? []).filter(o => o.to <= Date.now() - 20 * 60000).length > 0 && (
                  <Text style={s.hint}>صار انقطاع على هالبرج خلال آخر ٦ ساعات عند أكثر من مستخدم</Text>
                )}
                <Text style={s.hint}>برج {tower.tower}{tower.operator ? ` · ${tower.operator}` : ''} · {community?.users ?? 0} مستخدم فحصوا عليه آخر شهر</Text>
                {community?.best.length ? community.best.map((b, i) => (
                  <View key={b.setup} style={[s.row, i === 0 && s.rowBest]}>
                    <View style={s.rowHead}>
                      <Text style={[s.rowScore, { color: scoreColor(b.score), fontSize: 16 }]}>{b.score}<Text style={s.rowScoreOf}>/100</Text></Text>
                      <Text style={s.rowName}>{i === 0 ? '⭐ ' : ''}{b.setup}</Text>
                    </View>
                    <Text style={s.rowVals}>بنق {b.ping}ms · تذبذب {b.jitter}ms · {b.tests} فحص من {b.users} مستخدم</Text>
                  </View>
                )) : (
                  <Text style={s.hint}>ما فيه نتائج على هذا البرج للحين — شغّل مُحسّن اللعبة، ونتيجتك تساعد اللي بعدك</Text>
                )}
              </>
            )}
          </GlassCard>
        )}

        {!loading && (
          <GlassCard title="أي سيرفر أقرب لك؟" icon="🌍" tint={C.blueSoft} defaultOpen={false}>
            <Text style={s.hint}>نقيس البنق لكل منطقة — اختار داخل اللعبة السيرفر الأقل بنق</Text>
            {sortedRegions.map((r, i) => {
              const res = regionRes[r.id];
              const sc = gameScore(res);
              return (
                <Pressable key={r.id} onPress={() => pickRegion(r.id)} style={[s.row, i === 0 && res.samples > 0 && s.rowBest]}>
                  <View style={s.rowHead}>
                    <Text style={[s.rowScore, { color: res.samples ? scoreColor(sc) : C.red, fontSize: 16 }]}>
                      {res.samples ? `${res.median}ms` : 'ما رد'}
                    </Text>
                    <Text style={s.rowName}>{i === 0 && res.samples ? '⭐ ' : ''}{r.name}</Text>
                  </View>
                  {res.samples > 0
                    ? <Text style={s.rowVals}>تذبذب {res.jitter}ms · فقد {res.lossPct}% · {r.hint}{res.via ? ` · عبر خادم بديل` : ''}</Text>
                    : <Text style={[s.rowVals, { color: C.red }]}>{res.error ?? 'الخادم ما رد'}</Text>}
                </Pressable>
              );
            })}
            <Pressable style={[s.btnGhost, { borderColor: C.blue }, (busy || running) && s.dim]} onPress={compareRegions} disabled={busy || running}>
              <Text style={[s.btnGhostText, { color: C.blue }]}>{sortedRegions.length ? 'قِس مرة ثانية' : 'قِس كل المناطق'}</Text>
            </Pressable>
          </GlassCard>
        )}

        {!loading && weekly.length > 0 && (
          <GlassCard title="أسبوعك" icon="📅" tint={C.mintSoft} defaultOpen={false}>
            {weekly.map(l => <Text key={l} style={s.weekLine}>• {l}</Text>)}
          </GlassCard>
        )}

        {!loading && (
          <GlassCard title="أفضل وقت للعب" icon="🕒" tint={C.violetSoft} defaultOpen={hasHistory}>
            {!hasHistory ? (
              <Text style={s.hint}>كل فحص تسويه ينحفظ مع وقته. بعد كم يوم نقولك أي وقت برجك فيه أهدى، وأي إعداد أفضل لكل وقت</Text>
            ) : (
              <>
                {bestPeriod && worstPeriod && bestPeriod.id !== worstPeriod.id && (
                  <Text style={s.bestTitle}>
                    أفضل وقت: {bestPeriod.name} ({bestPeriod.avgScore}/100) · أسوأ وقت: {worstPeriod.name} ({worstPeriod.avgScore}/100)
                  </Text>
                )}
                {periods.map(p => (
                  <View key={p.id} style={s.row}>
                    <View style={s.rowHead}>
                      <Text style={[s.rowScore, { color: p.avgScore !== undefined ? scoreColor(p.avgScore) : C.sub, fontSize: 16 }]}>
                        {p.avgScore !== undefined ? `${p.avgScore}/100` : '—'}
                      </Text>
                      <Text style={s.rowName}>{p.name}</Text>
                    </View>
                    <Text style={s.rowVals}>
                      {p.count ? `${p.count} فحص · بنق ${p.avgPing}ms · تذبذب ${p.avgJitter}ms` : 'ما فيه فحوصات بهالوقت'}
                      {p.bestSetup ? ` · الأفضل: ${p.bestSetup}` : ''}
                    </Text>
                  </View>
                ))}
                <Text style={s.hint}>لسيرفرات {reg.name} — آخر 30 يوم</Text>
              </>
            )}
          </GlassCard>
        )}

        {!loading && (
          <GlassCard title="وش يهم في الألعاب" icon="💡" tint={C.violetSoft} defaultOpen={false}>
            <Text style={s.hint}>
              التذبذب (jitter) أخطر من البنق نفسه — بنق 80ms ثابت أفضل من 40ms متذبذب، لأن التذبذب يسبب الارتعاش والتقطيع
            </Text>
            <Text style={s.hint}>
              الفقد فوق 1% يسبب انقطاع الحركة داخل اللعبة حتى لو البنق ممتاز
            </Text>
            <Text style={s.hint}>
              أحياناً «4G فقط» أثبت من 4G مع 5G، لأن الراوتر ما يتنقل بين الشبكتين أثناء اللعب
            </Text>
            <Text style={s.hint}>
              تغيير DNS ما يقلل البنق داخل اللعبة — اللي يفرق هو التردد والبرج والواي فاي
            </Text>
          </GlassCard>
        )}
        <Text style={s.note}>
          القياس يمر عبر الواي فاي والراوتر، فالرقم أعلى شوي من اللي داخل اللعبة، لكنه دقيق للمقارنة. ما نرسل أي بيانات شخصية.
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
  weekLine: { color: C.text, fontSize: 13, textAlign: 'right', lineHeight: 21 },
  consentRow: { flexDirection: 'row', gap: 8 },
  outage: { backgroundColor: C.redSoft, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: C.red },
  outageText: { color: C.red, fontWeight: '800', fontSize: 12, textAlign: 'right', lineHeight: 19 },
  lagLink: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderColor: C.pink, borderWidth: 1.5, borderRadius: 18, padding: 14 },
  lagArrow: { color: C.pink, fontSize: 26, fontWeight: '800' },
  lagTitle: { color: C.text, fontWeight: '900', fontSize: 15, textAlign: 'right' },
  lagSub: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 2 },
  note: { color: C.muted, fontSize: 11, textAlign: 'center', paddingHorizontal: 20, marginTop: 4, lineHeight: 17 },
  page: { padding: 16, gap: 14 },
  center: { alignItems: 'center', paddingVertical: 40 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  errBox: { backgroundColor: C.redSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 14, padding: 12 },
  err: { color: C.red, fontWeight: '700', textAlign: 'right' },
  statusBox: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, backgroundColor: C.blueSoft, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 14, padding: 12 },
  statusText: { color: C.blue, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  regionBar: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 18, padding: 12, gap: 8 },
  regionTitle: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  chipOn: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { color: C.text, fontWeight: '700', fontSize: 13 },
  verdict: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderWidth: 2, borderRadius: 16, padding: 12, backgroundColor: C.card },
  verdictScore: { fontSize: 34, fontWeight: '900', minWidth: 58, textAlign: 'center' },
  verdictTitle: { fontWeight: '900', fontSize: 16, textAlign: 'right' },
  verdictCause: { color: C.text, fontSize: 12, textAlign: 'right', lineHeight: 19, marginTop: 4 },
  verdictLink: { color: C.blue, fontWeight: '800', fontSize: 13, textAlign: 'right', marginTop: 6 },
  verdictFix: { color: C.sub, fontSize: 12, textAlign: 'right', lineHeight: 19, marginTop: 2 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  stat: { flex: 1, alignItems: 'center', backgroundColor: C.rowBg, borderRadius: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.cardBorder },
  statV: { fontWeight: '800', fontSize: 18 },
  statU: { color: C.muted, fontSize: 10 },
  statL: { color: C.sub, fontSize: 11, fontWeight: '700', marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  band: { flexBasis: '30%', flexGrow: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 14, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  bandOn: { backgroundColor: C.blue, borderColor: C.blue },
  bandName: { color: C.text, fontWeight: '800', fontSize: 15 },
  bandFreq: { color: C.sub, fontSize: 10, marginTop: 2 },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 13, alignItems: 'center' },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  btnGhost: { borderWidth: 1, borderRadius: 14, padding: 13, alignItems: 'center' },
  btnGhostText: { fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.45 },
  row: { backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 11, gap: 6 },
  rowBest: { borderColor: C.green, borderWidth: 2 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowState: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  rowNote: { fontWeight: '700', fontSize: 12 },
  rowScore: { fontWeight: '900', fontSize: 18 },
  rowScoreOf: { color: C.sub, fontSize: 11, fontWeight: '700' },
  rowName: { color: C.text, fontWeight: '800', fontSize: 15 },
  rowVals: { color: C.sub, fontSize: 11, textAlign: 'right' },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: C.lineSoft, overflow: 'hidden', flexDirection: 'row-reverse' },
  barFill: { height: 6, borderRadius: 3 },
  bestBox: { borderTopWidth: 1, borderTopColor: C.cardBorder, paddingTop: 12, gap: 10 },
  bestTitle: { color: C.green, fontWeight: '800', fontSize: 14, textAlign: 'right', lineHeight: 21 },
});
