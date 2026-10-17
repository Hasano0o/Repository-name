/**
 * المستشار الذكي — قراءة فقط.
 * يقرأ وضعك الحالي كم مرة + الأبراج اللي يشوفها الراوتر + بنقك الحين + اللي قسناه وجربناه قبل،
 * ويقول وش الأفضل (أداء عام أو ألعاب)، ليش، وكم ثقتنا، ووش ناقص.
 * ما يغيّر أي شي في الراوتر — التثبيت نفسه من صفحة الأبراج (بالقفل الآمن).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Carrier, CellLockState, CellTower, Signal } from '../../src/drivers/types';
import { loadTrials, Trial, safeApply, trialMessage } from '../../src/utils/safeLock';
import { runTowerTrials, TrialRow, TrialTarget } from '../../src/utils/towerTrial';
import { loadTowerPings, towerPingKey, pingAgo } from '../../src/store/towerPing';
import { useOperatorBands } from '../../src/store/operator';
import { measureUrl, regionUrls, selectedRegion, gameScore } from '../../src/utils/latency';
import { friendlyBand } from '../../src/utils/bands';
import {
  advise, mergeCellSamples, CurrentState, Candidate, Goal, Verdict, PingEvidence, CONF_LABEL, candidateName,
} from '../../src/utils/advisor';
import { C, tBg, tFg } from '../../src/ui/theme';
import { sheet } from '../../src/i18n';

const ROUNDS = 3;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const num = (v?: string) => {
  const m = (v ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
/** مفاتيح تجارب الدمج والترددات (مو تثبيت برج) */
const COMBO_KEY = /^(combo|band|nsa|nrdual|ltedual|nrprim|anchor|mode):/;

interface Scan {
  current: CurrentState;
  cands: Candidate[];
  trials: Trial[];
  region: string;
  limits: string[];
  canLock: boolean;
  /** التثبيتات الحالية — نرجع لها بعد التجربة، ونرجّع لها لو التثبيت صار أسوأ */
  locks: CellLockState[];
  at: number;
}

const CONF_COLOR = { high: '#13B783', medium: '#f59e0b', low: '#94a3b8' } as const;

export default function Advisor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [goal, setGoal] = useState<Goal>('overall');
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const op = useOperatorBands(id);
  const alive = useRef(true);
  const cancel = useRef(false);

  useEffect(() => {
    alive.current = true;
    getRouter(String(id)).then(r => alive.current && setInfo(r)).catch(() => {});
    return () => { alive.current = false; cancel.current = true; };
  }, [id]);

  const run = async () => {
    if (!info || busy) return;
    cancel.current = false;
    setBusy(true);
    setError('');
    try {
      const sigs: Signal[] = [];
      const rounds: CellTower[][] = [];
      let carriers: Carrier[] = [];
      let limits: string[] = [];
      let canLock = false;
      let locks: CellLockState[] = [];
      for (let i = 0; i < ROUNDS && !cancel.current; i++) {
        setStep(`نقرأ الإشارة والأبراج (${i + 1} من ${ROUNDS})...`);
        try {
          const res = await withSession(info, async d => {
            const s = d.getSignal ? await d.getSignal() : ({} as Signal);
            const c = d.getCarriers ? await d.getCarriers().catch(() => [] as Carrier[]) : [];
            const cells = d.getCells ? await d.getCells().catch(() => [] as CellTower[]) : [];
            const lim: string[] = [];
            if (!d.getCells) lim.push('راوترك ما يعرض الأبراج اللي حوله — نقدر نقيّم وضعك الحالي بس.');
            if (d.cellLockRisk) lim.push(d.cellLockRisk);
            else if (typeof d.lockCell !== 'function') lim.push('راوترك ما يدعم التثبيت على برج — التوصية للمعلومة فقط.');
            const lk = d.getCellLocks ? await d.getCellLocks().catch(() => [] as CellLockState[]) : [];
            return { s, c, cells, lim, lk, lock: typeof d.lockCell === 'function' && typeof d.unlockCell === 'function' && !d.cellLockRisk };
          }, false);
          if (res.s.rsrp !== undefined || res.s.nrRsrp !== undefined) sigs.push(res.s);
          rounds.push(res.cells);
          if (res.c.length) carriers = res.c;
          limits = res.lim;
          canLock = res.lock;
          locks = res.lk;
        } catch (e: any) {
          if (i === ROUNDS - 1 && !sigs.length) throw e;
        }
        if (i < ROUNDS - 1) await sleep(2500);
      }
      if (cancel.current) return;

      setStep('نقيس البنق الحين...');
      const region = await selectedRegion();
      const lat = await measureUrl(regionUrls(region), 12).catch(() => null);
      const nowPing: PingEvidence | undefined = lat && lat.samples
        ? { median: lat.median, jitter: lat.jitter, loss: lat.lossPct, score: gameScore(lat), at: Date.now() }
        : undefined;

      const [trials, pings] = await Promise.all([loadTrials(info.id), loadTowerPings(info.id)]);

      // الوضع الحالي: الأساسي 4G (أو 5G لو SA)
      const last = sigs[sigs.length - 1] ?? ({} as Signal);
      const sa = last.rsrp === undefined && last.nrRsrp !== undefined;
      const pcc = carriers.find(c => c.role === 'PCC');
      const serving: { tech: 'LTE' | 'NR'; pci: string }[] = [];
      if (last.pci) serving.push({ tech: 'LTE', pci: String(last.pci) });
      if (last.nrPci) serving.push({ tech: 'NR', pci: String(last.nrPci) });
      for (const c of carriers) if (c.pci) serving.push({ tech: c.tech, pci: String(c.pci) });
      const current: CurrentState = {
        tech: sa ? 'NR' : 'LTE',
        band: pcc?.band ?? num(sa ? last.nrBand : last.band),
        pci: sa ? last.nrPci : last.pci,
        rsrp: avg(sigs.map(s => (sa ? s.nrRsrp : s.rsrp)).filter((x): x is number => x !== undefined)),
        rsrq: avg(sigs.map(s => (sa ? s.nrRsrq : s.rsrq)).filter((x): x is number => x !== undefined)),
        sinr: avg(sigs.map(s => (sa ? s.nrSinr : s.sinr)).filter((x): x is number => x !== undefined)),
        carriers: carriers.length || 1,
        combo: carriers.length ? carriers.map(c => (c.tech === 'NR' ? 'n' : 'B') + c.band).join(' + ') : undefined,
        samples: sigs.length,
        ping: nowPing,
        serving,
      };

      const cands = mergeCellSamples(rounds).map(c => {
        const p = pings[towerPingKey(c.tech, c.pci)];
        const t = trials.find(x => x.key.startsWith(`cell:${c.tech}:${c.pci}:`));
        const list = op ? (c.tech === 'NR' ? op.bands.nr : op.bands.lte) : null;
        return {
          ...c,
          ping: p ? { median: p.ping, jitter: p.jitter, loss: p.loss, score: p.score, at: p.at } : undefined,
          trial: t ? { verdict: t.verdict, change: t.change, at: t.at } : undefined,
          onOperator: list && c.band ? list.includes(c.band) : undefined,
        } as Candidate;
      });

      if (alive.current) setScan({ current, cands, trials, region: region.name, limits, canLock, locks, at: Date.now() });
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? String(e));
    } finally {
      if (alive.current) { setBusy(false); setStep(''); }
    }
  };

  // الهدف يتغير بدون قراءة جديدة — نفس البيانات، حكم مختلف
  // نتائج التجربة الفعلية (تثبيت + قياس) تغلب قراءات الجيران: فيها النقاء والبنق وقت ما كان الراوتر عليه
  const [measured, setMeasured] = useState<TrialRow[]>([]);
  const cands = useMemo(() => {
    if (!scan) return [];
    return scan.cands.map(c => {
      const m = measured.find(x => x.outcome === 'measured' && x.t.tech === c.tech && x.t.pci === c.pci);
      if (!m) return c;
      return {
        ...c,
        rsrp: m.rsrp ?? c.rsrp, rsrq: m.rsrq ?? c.rsrq, sinr: m.sinr ?? c.sinr,
        samples: Math.max(c.samples, m.samples),
        ping: m.ping ? { median: m.ping.ping, jitter: m.ping.jitter, loss: m.ping.loss, score: m.ping.score, at: m.ping.at } : c.ping,
      };
    });
  }, [scan, measured]);
  const v: Verdict | null = useMemo(() => (scan ? advise(scan.current, cands, goal) : null), [scan, cands, goal]);

  // ─── المرحلة ٤: نجرّب أفضل الأبراج فعلياً ───
  const [trial, setTrial] = useState<{ i: number; n: number; name: string; step: string } | null>(null);
  const [trialNote, setTrialNote] = useState('');
  const trialCancel = useRef(false);
  // للأداء العام ما نضيّع وقتك على أبراج إشارتها أضعف بوضوح؛ للألعاب نجرّبها (البنق ممكن يكون أحسن)
  const trialTargets = (): TrialTarget[] => (v?.ranked ?? [])
    .filter(r => r.c.arfcn && (goal === 'gaming' || r.gain > -0.2))
    .slice(0, 3)
    .map(r => ({ tech: r.c.tech, band: r.c.band, arfcn: r.c.arfcn!, pci: r.c.pci, name: candidateName(r.c) }));

  const runTrial = () => {
    if (!info || !scan || busy) return;
    const targets = trialTargets();
    if (!targets.length) return;
    Alert.alert(
      `نجرّب ${targets.length} ${targets.length === 1 ? 'برج' : 'أبراج'} فعلياً`,
      'نثبّت على كل برج بالدور، نقيس الإشارة والبنق، وبعدها نرجّع إعدادك مثل ما كان.\n\n' +
        `النت بينقطع لحظات مع كل برج، وكل برج ياخذ دقيقة تقريباً. تقدر توقف في أي وقت.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ابدأ', onPress: async () => {
            trialCancel.current = false;
            setBusy(true);
            setError('');
            setTrialNote('');
            try {
              const run = await runTowerTrials(info, targets, scan.locks, {
                onStep: st => alive.current && setTrial(st),
                isCancelled: () => trialCancel.current || !alive.current,
                samples: 3,
              });
              if (!alive.current) return;
              setMeasured(run.rows);
              const ok = run.rows.filter(x => x.outcome === 'measured').length;
              setTrialNote(
                (run.freed
                  ? (run.restored ? '↩️ ما رجع الاتصال بالإرجاع العادي، ففكّينا كل التثبيتات والراوتر لقط أقوى برج. ' : '⚠️ ما قدرنا نتأكد إن الراوتر رجع — افتح صفحة الراوتر واضغط «رجّع الإشارة». ')
                  : run.notRestored?.length
                    ? `⚠️ رجع جزء من إعدادك — هذي ما رجعت كما كانت: ${run.notRestored.join('، ')}. `
                    : run.exact ? '✓ رجّعنا إعدادك بالضبط (تأكدنا من قراءة الراوتر). ' : '✓ رجّعنا إعدادك مثل ما كان. ') +
                (run.cancelled ? 'وقّفنا التجربة. ' : '') +
                `قسنا ${ok} من ${targets.length}.`,
              );
            } catch (e: any) {
              if (alive.current) setError(e?.message ?? String(e));
            } finally {
              if (alive.current) { setTrial(null); setBusy(false); }
            }
          },
        },
      ],
    );
  };

  /** نثبّت الأفضل (بعد ما قسناه) — بالقفل الآمن: قياس قبل وبعد ورجوع لو صار أسوأ */
  const applyBest = () => {
    if (!info || !scan || !v?.best?.c.arfcn) return;
    const c = v.best.c;
    const prevSame = scan.locks.find(l => (l.tech ?? 'LTE') === c.tech && l.pci);
    const label = `التثبيت على ${candidateName(c)}`;
    Alert.alert('ثبّت الأفضل', `${label}\n\nنقيس قبل وبعد، ولو صار أسوأ أو ما اتصل نرجّع إعدادك.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'ثبّت', onPress: async () => {
          setBusy(true);
          setError('');
          try {
            const res = await safeApply({
              r: info,
              key: `cell:${c.tech}:${c.pci}:${c.arfcn}`,
              label,
              withNr: c.tech === 'NR',
              onStatus: st => alive.current && setStep(st),
              apply: d => d.lockCell!({ tech: c.tech, band: c.band, arfcn: c.arfcn, pci: c.pci }),
              revert: d => (prevSame
                ? d.lockCell!({ tech: c.tech, band: prevSame.band, arfcn: prevSame.arfcn, pci: prevSame.pci! })
                : d.unlockCell!(c.tech)),
            });
            const m = trialMessage(res, label);
            Alert.alert(m.title, m.body);
          } catch (e: any) {
            if (alive.current) setError(e?.message ?? String(e));
          } finally {
            if (alive.current) { setBusy(false); setStep(''); }
          }
        },
      },
    ]);
  };
  const combos = useMemo(() => {
    if (!scan) return [];
    const seen = new Set<string>();
    return scan.trials
      .filter(t => COMBO_KEY.test(t.key) && t.verdict === 'better' && Date.now() - t.at < 14 * 86400_000)
      .filter(t => (seen.has(t.key) ? false : (seen.add(t.key), true)))
      .slice(0, 3);
  }, [scan]);

  const cur = scan?.current;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={{ gap: 3 }}>
          <Text style={s.lead}>وش الأفضل لي؟</Text>
          <Text style={s.sub}>نقرأ وضعك والأبراج حولك ونقارن — وما نغيّر شي إلا بإذنك.</Text>
        </View>

        <View style={s.seg}>
          {([['overall', 'أفضل أداء'], ['gaming', 'للألعاب']] as [Goal, string][]).map(([g, label]) => (
            <Pressable key={g} onPress={() => setGoal(g)} style={[s.segBtn, goal === g && s.segOn]}>
              <Text style={[s.segTxt, goal === g && s.segTxtOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={busy ? () => { cancel.current = true; } : run} disabled={!info} style={({ pressed }) => [s.main, pressed && { opacity: 0.85 }, !info && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : null}
          <Text style={s.mainTxt}>{busy ? 'إلغاء' : scan ? 'افحص من جديد' : 'افحص الحين'}</Text>
        </Pressable>
        {!!step && <Text style={s.step}>{step}</Text>}
        {!!error && <Text style={s.err}>{error}</Text>}

        {cur && v && (
          <>
            {/* الخلاصة */}
            <View style={[s.card, { borderColor: (v.kind === 'switch' ? C.blue : v.kind === 'stay' ? '#13B783' : '#94a3b8') + '66' }]}>
              <View style={s.row}>
                <Text style={s.cardTitle}>{v.kind === 'switch' ? 'فيه خيار أفضل' : v.kind === 'stay' ? 'خلك على وضعك' : 'النتيجة غير حاسمة'}</Text>
                <View style={[s.chip, { backgroundColor: CONF_COLOR[v.confidence] }]}>
                  <Text style={s.chipTxt}>{CONF_LABEL[v.confidence]}</Text>
                </View>
              </View>
              <Text style={s.body}>{v.headline}</Text>
              {v.best && (
                <>
                  <View style={[s.badge, { backgroundColor: v.best.measured ? tBg('#e3f8ef') : tBg('#eef3ff') }]}>
                    <Text style={[s.badgeTxt, { color: v.best.measured ? tFg('#0f7a52') : tFg('#2f6bff') }]}>
                      {v.best.measured ? '✓ نتيجة مقاسة' : 'توصية متوقعة — مو قياس سرعة'}
                    </Text>
                  </View>
                  {v.best.reasons.map(r => <Text key={r} style={s.reason}>• {r}</Text>)}
                </>
              )}
            </View>

            {/* الوضع الحالي */}
            <View style={s.card}>
              <Text style={s.cardTitle}>وضعك الحالي</Text>
              <Text style={s.body}>
                {cur.pci ? `برج ${cur.pci} — ` : ''}{cur.tech === 'NR' ? '5G' : '4G'} {friendlyBand(cur.tech, cur.band)}
              </Text>
              <Text style={s.meta}>
                {[
                  cur.rsrp !== undefined ? `القوة ${Math.round(cur.rsrp)} dBm` : '',
                  cur.sinr !== undefined ? `النقاء ${Math.round(cur.sinr)} dB` : '',
                  cur.combo && cur.carriers > 1 ? `مدموج: ${cur.combo}` : '',
                ].filter(Boolean).join(' · ')}
              </Text>
              <Text style={s.meta}>
                {cur.ping
                  ? `البنق لـ${scan!.region}: ${cur.ping.median} ms · تذبذب ${cur.ping.jitter} ms${cur.ping.loss ? ` · فقد ${cur.ping.loss}٪` : ''}`
                  : `ما قدرنا نقيس البنق لـ${scan!.region}`}
              </Text>
              <Text style={s.meta}>{cur.samples} قراءات · {pingAgo(scan!.at)}</Text>
            </View>

            {/* المقارنة */}
            {v.ranked.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>المقارنة مع وضعك</Text>
                {v.ranked.slice(0, 4).map(r => {
                  const pct = Math.round(r.gain * 100);
                  return (
                    <View key={`${r.c.tech}${r.c.pci}${r.c.arfcn}`} style={s.cmp}>
                      <View style={s.row}>
                        <Text style={s.cmpName}>{candidateName(r.c)}</Text>
                        <Text style={[s.cmpGain, { color: pct >= 8 ? '#13B783' : pct <= -8 ? '#dc2626' : C.muted }]}>
                          {pct > 0 ? '+' : ''}{pct}
                        </Text>
                      </View>
                      <Text style={s.meta}>
                        {[
                          r.c.rsrp !== undefined ? `${Math.round(r.c.rsrp)} dBm` : '',
                          r.c.ping ? `بنق ${r.c.ping.median} ms (${pingAgo(r.c.ping.at)})` : '',
                          r.measured ? 'مقاس' : 'قراءة إشارة',
                          `ظهر ${r.c.samples}/${cur.samples || ROUNDS}`,
                        ].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  );
                })}
                <Text style={s.hint}>الرقم = الفرق عن وضعك الحالي من ١٠٠ (على نفس المقاييس المتوفرة عند الاثنين).</Text>
              </View>
            )}

            {/* أفضل تجميعة جربناها */}
            <View style={s.card}>
              <Text style={s.cardTitle}>تجميعة الترددات</Text>
              <Text style={s.body}>{cur.combo && cur.carriers > 1 ? `الحين مدموج: ${cur.combo}` : 'الحين بدون دمج ترددات'}</Text>
              {combos.length ? (
                <>
                  <Text style={s.meta}>جربناها قبل وكانت أفضل:</Text>
                  {combos.map(t => (
                    <Text key={t.key} style={s.reason}>• {t.label}{t.change !== undefined ? ` (+${Math.round(t.change * 100)}٪)` : ''} — {pingAgo(t.at)}</Text>
                  ))}
                </>
              ) : (
                <Text style={s.meta}>ما عندنا تجربة دمج ناجحة حديثة نحكم منها — نتائج «مختبر الدمج» و«دمج 4G + 5G» تظهر هنا.</Text>
              )}
            </View>

            {(v.missing.length > 0 || scan!.limits.length > 0 || v.excluded.length > 0) && (
              <View style={s.card}>
                <Text style={s.cardTitle}>وش ينقصنا</Text>
                {v.missing.map(m => <Text key={m} style={s.reason}>• {m}</Text>)}
                {scan!.limits.map(m => <Text key={m} style={s.reason}>• {m}</Text>)}
                {v.excluded.slice(0, 4).map(e => (
                  <Text key={`${e.c.tech}${e.c.pci}${e.c.arfcn}`} style={s.reason}>• استبعدنا {candidateName(e.c)}: {e.reason}</Text>
                ))}
              </View>
            )}

            {scan!.canLock && trialTargets().length > 0 && (
              <View style={[s.card, { borderColor: C.violet + '55' }]}>
                <Text style={s.cardTitle}>جرّبها فعلياً</Text>
                <Text style={s.meta}>
                  نثبّت على أفضل {trialTargets().length} بالدور، ونقيس الإشارة والنقاء والبنق وهو عليها — وبعدها نرجّعك لوضعك.
                  التوصية تصير «مقاسة» بدل «متوقعة».
                </Text>
                {trial ? (
                  <>
                    <Text style={s.body}>{trial.name ? `${trial.i} من ${trial.n} · ${trial.name}` : ''}</Text>
                    <Text style={s.meta}>{trial.step}</Text>
                    <Pressable onPress={() => { trialCancel.current = true; }} style={({ pressed }) => [s.sec, pressed && { opacity: 0.8 }]}>
                      <Text style={s.secTxt}>وقّف وارجعني لوضعي</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={runTrial} disabled={busy} style={({ pressed }) => [s.main, { backgroundColor: C.violet }, (pressed || busy) && { opacity: 0.8 }]}>
                    <Text style={s.mainTxt}>جرّب أفضل {trialTargets().length} فعلياً</Text>
                  </Pressable>
                )}
                {!!trialNote && <Text style={s.reason}>{trialNote}</Text>}
                {measured.map(m => (
                  <Text key={m.t.tech + m.t.pci} style={s.meta}>
                    • {m.t.name}: {m.outcome === 'measured'
                      ? [m.rsrp !== undefined ? `${Math.round(m.rsrp)} dBm` : '', m.sinr !== undefined ? `نقاء ${Math.round(m.sinr)}` : '', m.ping ? `بنق ${m.ping.ping}ms` : ''].filter(Boolean).join(' · ')
                      : m.note}
                  </Text>
                ))}
              </View>
            )}

            {scan!.canLock && v.kind === 'switch' && v.best?.measured && !!v.best.c.arfcn && !trial && (
              <Pressable onPress={applyBest} disabled={busy} style={({ pressed }) => [s.main, { backgroundColor: '#13B783' }, (pressed || busy) && { opacity: 0.8 }]}>
                <Text style={s.mainTxt}>ثبّت الأفضل: {candidateName(v.best.c)}</Text>
              </Pressable>
            )}

            {scan!.canLock && (
              <Pressable onPress={() => router.push(`/towers/${id}` as Href)} style={({ pressed }) => [s.sec, pressed && { opacity: 0.8 }]}>
                <Text style={s.secTxt}>افتح صفحة الأبراج</Text>
              </Pressable>
            )}
          </>
        )}

        <Text style={s.note}>
          🛡️ المستشار ما يغيّر شي في الراوتر إلا لما تضغط «جرّب» أو «ثبّت». التجربة ترجّعك لوضعك في الآخر، والتثبيت بالقفل الآمن: يقيس قبل وبعد ويرجّع لو صار أسوأ.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = sheet({
  page: { padding: 16, gap: 14 },
  lead: { color: C.text, fontSize: 22, fontWeight: '900', textAlign: 'right' },
  sub: { color: C.muted, fontSize: 12.5, textAlign: 'right' },
  seg: { flexDirection: 'row-reverse', backgroundColor: tBg('#E1E7F0'), borderRadius: 14, padding: 4, gap: 4 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  segOn: { backgroundColor: C.card },
  segTxt: { color: C.muted, fontWeight: '800', fontSize: 13.5 },
  segTxtOn: { color: C.blue },
  main: {
    flexDirection: 'row-reverse', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.blue, borderRadius: 16, paddingVertical: 15,
  },
  mainTxt: { color: '#fff', fontWeight: '900', fontSize: 15.5 },
  step: { color: C.muted, fontSize: 12.5, textAlign: 'center' },
  err: { color: '#dc2626', fontSize: 13, textAlign: 'right', lineHeight: 20 },
  card: { backgroundColor: C.card, borderRadius: 20, padding: 14, gap: 6, borderWidth: 1.5, borderColor: C.cardBorder },
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: C.text, fontSize: 15.5, fontWeight: '900', textAlign: 'right' },
  body: { color: C.text, fontSize: 14, lineHeight: 22, textAlign: 'right' },
  meta: { color: C.muted, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  reason: { color: C.text, fontSize: 13, lineHeight: 20, textAlign: 'right' },
  hint: { color: C.muted, fontSize: 11, lineHeight: 16, textAlign: 'right', marginTop: 2 },
  chip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  chipTxt: { color: '#fff', fontSize: 11, fontWeight: '900' },
  badge: { alignSelf: 'flex-end', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  badgeTxt: { fontSize: 11.5, fontWeight: '800' },
  cmp: { backgroundColor: tBg('#E9EEF5'), borderRadius: 12, padding: 10, gap: 2 },
  cmpName: { color: C.text, fontSize: 13.5, fontWeight: '800', textAlign: 'right', flex: 1 },
  cmpGain: { fontSize: 15, fontWeight: '900' },
  sec: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5, borderColor: C.blue + '66' },
  secTxt: { color: C.blue, fontWeight: '900', fontSize: 14 },
  note: { color: C.muted, fontSize: 11.5, textAlign: 'right', lineHeight: 18, paddingHorizontal: 4 },
});
