/**
 * الدمج المزدوج — نفس التردد مرتين:
 *   5G: n77+n77 / n78+n78 (الافتراضي)
 *   4G: B3+B3 / B1+B1 / B40+B40 … (?t=lte) — شفناه شغّال حي على ZTE MU5001 (B3 ‎15+20 ميقا)
 * نقفل الـ 5G على باند واحد، ونحمّل شوي عشان البرج يشغّل الدمج، ونعدّ قنوات 5G الشغالة.
 * قناتين من نفس الباند = برجك يدعم الدمج المزدوج (تقريباً ضعف عرض نطاق 5G).
 * بالآخر نرجّع إعدادك مثل ما كان، والتثبيت يصير بأمان (قياس قبل وبعد + رجوع لو أسوأ).
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { reportError } from '../../src/services/errors';
import { withSession } from '../../src/store/sessions';
import { BandConfig, Carrier } from '../../src/drivers/types';
import { snapshot, waitOnline, trialMessage, Snapshot, safeApply, freeRelease } from '../../src/utils/safeLock';
import { trafficBurst } from '../../src/utils/nrprobe';
import { saveProfile } from '../../src/store/profiles';
import { C, R, S, tBg, tBd, tFg } from '../../src/ui/theme';

import { sheet, tr } from '../../src/i18n';
const ACCENT = '#7a51e0';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** الباندات اللي يصير فيها الدمج المزدوج غالباً (عرض نطاق كبير) */
const CANDIDATES = [77, 78, 41];
/** 4G: الترددات اللي المشغّلين بالسعودية عندهم فيها أكثر من قناة غالباً */
const LTE_CANDIDATES = [3, 1, 40, 41, 7, 38, 8, 20, 28];

interface Row {
  band: number;
  status: 'pending' | 'testing' | 'done' | 'failed';
  note?: string;
  /** كم قناة 5G شفنا على هالباند (أقصى قراءة) */
  nrCount?: number;
  bw?: number;
  snap?: Snapshot | null;
}

const MHZ: Record<number, string> = { 77: '3.7 جيجا', 78: '3.5 جيجا', 41: '2.5 جيجا' };
const LTE_MHZ: Record<number, string> = { 3: '1800', 1: '2100', 40: '2300', 41: '2500', 7: '2600', 38: '2600', 8: '900', 20: '800', 28: '700' };

/** نحمّل ونقرأ النواقل كم مرة — الدمج ما يطلع إلا وقت التحميل */
async function readNr(r: SavedRouter, isCancelled: () => boolean, tech: 'NR' | 'LTE' = 'NR'): Promise<Carrier[]> {
  const burst = trafficBurst(10000, 25_000_000, isCancelled).catch(() => 0);
  let best: Carrier[] = [];
  for (let i = 0; i < 3 && !isCancelled(); i++) {
    await sleep(2600);
    const list = await withSession(r, async d => (d.getCarriers ? d.getCarriers() : [])).catch(() => [] as Carrier[]);
    const nr = list.filter(c => c.tech === tech);
    if (nr.length > best.length) best = nr;
  }
  await burst;
  return best;
}

export default function NrDual() {
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  const LTE = t === 'lte';
  const TECH: 'NR' | 'LTE' = LTE ? 'LTE' : 'NR';
  const P = LTE ? 'B' : 'n';
  const NAME = LTE ? 'دمج 4G المزدوج' : 'دمج 5G المزدوج';
  const G = LTE ? '4G' : '5G';
  const freq = (b: number) => (LTE ? (LTE_MHZ[b] ? `${LTE_MHZ[b]} ميقا` : '') : MHZ[b] ?? '');
  /** نقفل على تردد واحد للتقنية المختارة، ونخلي الثانية مثل ما هي */
  const lockTo = (c: BandConfig, b: number) => (d: any) => (LTE ? d.setBand!([b], c.nrLocked) : d.setBand!(c.locked, [b]));
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [cfg, setCfg] = useState<BandConfig | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [nowNr, setNowNr] = useState<Carrier[] | null>(null);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasCarriers, setHasCarriers] = useState(true);
  const [pick, setPick] = useState<number | null>(null);
  const [manual, setManual] = useState<{ band: number; count: number; bw?: number } | null>(null);
  const cancel = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try {
        const { c, car, canCar } = await withSession(r, async d => ({
          c: d.getBandConfig ? await d.getBandConfig() : null,
          car: d.getCarriers ? await d.getCarriers().catch(() => [] as Carrier[]) : [],
          canCar: !!d.getCarriers,
        }));
        if (!c) throw new Error('راوترك ما يدعم تثبيت الترددات.');
        if (!mounted.current) return;
        setCfg(c);
        setHasCarriers(canCar);
        setNowNr(car.filter(x => x.tech === TECH));
        // الباند اللي شغال الحين أول، وبعدها الباقي
        const live = car.filter(x => x.tech === TECH).map(x => x.band);
        const list = (LTE ? LTE_CANDIDATES.filter(b => c.supported.includes(b)).slice(0, 4) : CANDIDATES.filter(b => c.nrSupported.includes(b)))
          .sort((a, b) => (live.includes(b) ? 1 : 0) - (live.includes(a) ? 1 : 0));
        setRows(list.map(band => ({ band, status: 'pending' })));
      } catch (e: any) {
        if (mounted.current) setError(e?.message ?? String(e));
      reportError('nrdual', e, info);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; cancel.current = true; };
  }, [id]);

  const start = () => {
    if (!info || !cfg || !rows.length) return;
    Alert.alert(
      NAME,
      `بنجرب ${rows.map(r => P + r.band).join(' و ')}: نقفل الـ ${G} على كل واحد ونشوف هل برجك يشغّل قناتين منه.\n\n` +
      `⏱ ~${rows.length} دقيقة · 📶 ينقطع الاتصال لحظات · 📊 ~30 ميقا لكل تجربة\n\nبالآخر نرجّع إعدادك مثل ما كان.`,
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'ابدأ', onPress: run }],
    );
  };

  const run = async () => {
    if (!info || !cfg) return;
    cancel.current = false;
    setRunning(true); setFinished(false); setError('');
    const list: Row[] = rows.map(r => ({ band: r.band, status: 'pending' }));
    setRows([...list]);
    const upd = (i: number, p: Partial<Row>) => {
      list[i] = { ...list[i], ...p };
      if (mounted.current) setRows([...list]);
    };
    try {
      for (let i = 0; i < list.length; i++) {
        if (cancel.current) break;
        const b = list[i].band;
        upd(i, { status: 'testing', note: `نقفل الـ ${G} على ${P}${b}...` });
        try {
          await withSession(info, lockTo(cfg, b), false);
          // بعض الراوترات تقبل الطلب وما تقفل الـ 5G فعلاً — نتأكد
          const after = await withSession(info, d => (d.getBandConfig ? d.getBandConfig() : Promise.resolve(null)), false).catch(() => null);
          if (after && !(LTE ? after.locked : after.nrLocked).includes(b)) {
            upd(i, { status: 'failed', note: `راوترك ما يسمح بقفل ${G} على تردد معيّن` });
            break;
          }
          upd(i, { note: 'ننتظر الاتصال...' });
          const ok = await waitOnline(info, 40000, () => cancel.current);
          if (cancel.current) { upd(i, { status: 'pending', note: undefined }); break; }
          if (!ok) { upd(i, { status: 'failed', note: 'ما اتصل على هالتردد' }); continue; }
          upd(i, { note: 'نحمّل شوي عشان البرج يشغّل الدمج...' });
          const nr = await readNr(info, () => cancel.current, TECH);
          const same = nr.filter(c => c.band === b);
          const bw = same.reduce((a, c) => a + (c.bandwidth ?? 0), 0);
          const snap = await snapshot(info, !LTE, 2);
          upd(i, {
            status: 'done', nrCount: same.length, bw: bw || undefined, snap,
            note: same.length >= 2 ? undefined : same.length === 1 ? 'قناة وحدة بس' : `ما مسك ${G} على هالتردد`,
          });
        } catch (e: any) {
          upd(i, { status: 'failed', note: e?.message ?? 'خطأ' });
        }
      }
    } finally {
      setStatus('نرجّع إعدادك...');
      try { await withSession(info, d => d.setBand!(cfg.locked, cfg.nrLocked), false); } catch {}
      // لو ما رجع (بعض راوترات ZTE تعلق بعد القفل) نفك كل شي عشان يلقط أقوى برج
      const back = await waitOnline(info, 45000, () => false);
      if (!back) await freeRelease(info, st => { if (mounted.current) setStatus(st); }).catch(() => false);
      if (mounted.current) { setRunning(false); setFinished(true); setStatus(''); }
    }
  };

  const dual = rows.filter(r => r.status === 'done' && (r.nrCount ?? 0) >= 2)
    .sort((a, b) => (b.bw ?? 0) - (a.bw ?? 0) || (b.snap?.cap ?? 0) - (a.snap?.cap ?? 0));
  const best = dual[0];
  // مزدوج = نفس التردد مرتين (B3+B3) — مو أي ناقلين مختلفين
  const dupBand = (nowNr ?? []).map(c => c.band).find((b, i, arr) => arr.indexOf(b) !== i);
  const nowDual = dupBand !== undefined;

  const apply = () => {
    if (!info || !cfg || !best) return;
    const label = `دمج ${G} مزدوج ${P}${best.band}+${P}${best.band}`;
    Alert.alert('ثبّت ' + label, 'نثبّته بأمان: نقيس قبل وبعد، ولو ما صار أفضل نرجّع إعدادك.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'ثبّت', onPress: async () => {
          setRunning(true);
          try {
            const res = await safeApply({
              r: info,
              key: `${LTE ? 'ltedual' : 'nrdual'}:${best.band}`,
              label,
              withNr: !LTE,
              apply: lockTo(cfg, best.band),
              revert: d => d.setBand!(cfg.locked, cfg.nrLocked),
              onStatus: st => { if (mounted.current) setStatus(st); },
            });
            if (res.kept) {
              await saveProfile({ routerId: info.id, name: label, bands: LTE ? [best.band] : cfg.locked, nrBands: LTE ? cfg.nrLocked : [best.band], mode: cfg.mode }).catch(() => {});
            }
            const m = trialMessage(res, label);
            Alert.alert(m.title, m.body);
          } catch (e: any) {
            setError(e?.message ?? String(e));
            reportError('nrdual', e, info);
          } finally {
            if (mounted.current) { setRunning(false); setStatus(''); }
          }
        },
      },
    ]);
  };

  /** يدوي: المستخدم يختار التردد ونقفل عليه ونخليه (بدون رجوع تلقائي) */
  const manualLock = () => {
    if (!info || !cfg || pick === null) return;
    const b = pick;
    Alert.alert(
      `قفل الـ ${G} على ${P}${b}`,
      `نقفل الـ ${G} على هالتردد ونخليه مثبّت — ينقطع الاتصال لحظات.\nتقدر ترجع لإعدادك القديم بزر «رجّع إعدادي».`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ثبّت', onPress: async () => {
            cancel.current = false;
            setRunning(true); setError(''); setManual(null);
            try {
              setStatus(`نقفل الـ ${G} على ${P}${b}...`);
              await withSession(info, lockTo(cfg, b), false);
              const after = await withSession(info, d => (d.getBandConfig ? d.getBandConfig() : Promise.resolve(null)), false).catch(() => null);
              if (after && !(LTE ? after.locked : after.nrLocked).includes(b)) throw new Error(`راوترك ما يسمح بقفل ${G} على تردد معيّن`);
              setStatus('ننتظر الاتصال...');
              const ok = await waitOnline(info, 40000, () => cancel.current);
              if (!ok) throw new Error('ما اتصل على هالتردد — اضغط «رجّع إعدادي»');
              setStatus('نحمّل شوي ونشوف هل البرج شغّل الدمج...');
              const nr = (await readNr(info, () => cancel.current, TECH)).filter(c => c.band === b);
              const bw = nr.reduce((a, c) => a + (c.bandwidth ?? 0), 0);
              if (mounted.current) setManual({ band: b, count: nr.length, bw: bw || undefined });
              await saveProfile({ routerId: info.id, name: `${G} مقفل ${P}${b}`, bands: LTE ? [b] : cfg.locked, nrBands: LTE ? cfg.nrLocked : [b], mode: cfg.mode }).catch(() => {});
            } catch (e: any) {
              if (mounted.current) setError(e?.message ?? String(e));
              reportError('nrdual', e, info);
            } finally {
              if (mounted.current) { setRunning(false); setStatus(''); }
            }
          },
        },
      ],
    );
  };

  const manualRevert = async () => {
    if (!info || !cfg) return;
    setRunning(true); setError('');
    try {
      setStatus('نرجّع إعدادك...');
      await withSession(info, d => d.setBand!(cfg.locked, cfg.nrLocked), false);
      const back = await waitOnline(info, 45000, () => false);
      if (!back) await freeRelease(info, st => { if (mounted.current) setStatus(st); }).catch(() => false);
      if (mounted.current) setManual(null);
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? String(e));
      reportError('nrdual', e, info);
    } finally {
      if (mounted.current) { setRunning(false); setStatus(''); }
    }
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: tr(NAME) }} />
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.card}>
          <Text style={s.title}>⚡ {NAME}</Text>
          <Text style={s.body}>
            {LTE
              ? 'بعض الأبراج عندها قناتين 4G على نفس التردد (مثل B3+B3). لو الراوتر مسكهم مع بعض، يزيد عرض النطاق وتزيد السرعة. هنا نجرب كل تردد لحاله ونقول لك وين برجك يشغّل الدمج.'
              : 'بعض الأبراج عندها قناتين 5G على نفس التردد (مثل n78+n78). لو الراوتر مسكهم مع بعض، يتضاعف عرض نطاق الـ 5G وتقريباً تتضاعف سرعته. هنا نجرب ونقول لك هل برجك يدعمه.'}
          </Text>

          {loading ? <ActivityIndicator color={ACCENT} /> : (
            <>
              {nowNr && (
                <View style={[s.nowBox, nowDual ? s.nowOk : null]}>
                  <Text style={[s.nowTxt, nowDual && { color: tFg('#0f7a52') }]}>
                    {nowDual
                      ? `✓ شغال الحين: ${P}${dupBand}+${P}${dupBand}`
                      : nowNr.length > 1
                        ? `الحين: ${nowNr.map(c => P + c.band).join(' + ')} — دمج عادي، مو مزدوج`
                        : nowNr.length === 1
                        ? `الحين: قناة ${G} وحدة (${P}${nowNr[0].band})`
                        : `الحين ما فيه ${G} شغال — التجربة تصحّيه بتحميل قصير`}
                  </Text>
                </View>
              )}
              {!hasCarriers && (
                <Text style={s.warn}>راوترك ما يكشف تفاصيل القنوات، فما نقدر نتأكد من الدمج المزدوج.</Text>
              )}
              {!rows.length && hasCarriers && (
                <Text style={s.warn}>{LTE ? 'راوترك ما يدعم ترددات 4G اللي يصير فيها الدمج المزدوج عادةً.' : 'راوترك ما يدعم n77 ولا n78 ولا n41 — الدمج المزدوج يحتاج واحد منها.'}</Text>
              )}
              {rows.length > 0 && <Text style={s.warn}>⏱ ~دقيقة لكل تردد · 📶 ينقطع الاتصال لحظات · 📊 ~30 ميقا لكل تجربة</Text>}
            </>
          )}

          {!loading && rows.length > 0 && hasCarriers && (
            <Pressable
              style={[s.btn, running && { backgroundColor: C.red }]}
              onPress={running ? () => { cancel.current = true; } : start}
            >
              <Text style={s.btnText}>{running ? '⏹ إيقاف (ونرجّع إعدادك)' : finished ? '🔁 أعد التجربة' : '▶ ابدأ التجربة'}</Text>
            </Pressable>
          )}
          {!!status && <Text style={s.statusText}>{status}</Text>}
          {!!error && <Text style={s.err}>{error}</Text>}
        </View>

        {!loading && rows.length > 0 && hasCarriers && (
          <View style={s.card}>
            <Text style={s.title}>✋ يدوي — اختر بنفسك</Text>
            <Text style={s.body}>{`تعرف تردد برجك؟ اختره ونقفل الـ ${G} عليه ونخليه مثبّت، ونقول لك هل شغّل الدمج.`}</Text>
            <View style={s.chips}>
              {rows.map(r => {
                const on = pick === r.band;
                return (
                  <Pressable key={r.band} disabled={running} onPress={() => setPick(r.band)}
                    style={[s.chip, on && { backgroundColor: ACCENT, borderColor: ACCENT }]}>
                    <Text style={[s.chipTxt, on && { color: '#fff' }]}>{P}{r.band}</Text>
                    <Text style={[s.chipSub, on && { color: '#e9e2ff' }]}>{freq(r.band)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable style={[s.btn, (pick === null || running) && { opacity: 0.5 }]} disabled={pick === null || running} onPress={manualLock}>
              <Text style={s.btnText}>{pick === null ? 'اختر التردد أول' : `🔒 ثبّت على ${P}${pick}`}</Text>
            </Pressable>
            {manual && (
              <View style={[s.nowBox, manual.count >= 2 && s.nowOk]}>
                <Text style={[s.nowTxt, manual.count >= 2 && { color: tFg('#0f7a52') }]}>
                  {manual.count >= 2
                    ? `✓ الدمج شغال: ${P}${manual.band}+${P}${manual.band}${manual.bw ? ` (${Math.round(manual.bw)} MHz)` : ''}`
                    : manual.count === 1
                      ? `مقفل على ${P}${manual.band} — قناة وحدة بس حالياً`
                      : `مقفل على ${P}${manual.band} — ما مسك ${G} عليه`}
                </Text>
                <Text style={s.note}>انحفظ في «الملفات». لو ما عجبك:</Text>
              </View>
            )}
            {manual && (
              <Pressable style={s.btnGhost} disabled={running} onPress={manualRevert}>
                <Text style={s.btnGhostTxt}>↩︎ رجّع إعدادي</Text>
              </Pressable>
            )}
          </View>
        )}

        {rows.map(r => {
          const ok = r.status === 'done' && (r.nrCount ?? 0) >= 2;
          return (
            <View key={r.band} style={[s.row, ok && { borderColor: tBd('#7fd4b8'), backgroundColor: tBg('#ecfaf4') }]}>
              <View style={s.rowHead}>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.rowName}>{P}{r.band} + {P}{r.band}</Text>
                  <Text style={s.rowSub}>{freq(r.band)}</Text>
                </View>
                {r.status === 'testing'
                  ? <ActivityIndicator size="small" color={ACCENT} />
                  : r.status === 'done'
                    ? <Text style={[s.badge, ok ? s.badgeOk : s.badgeNo]}>{ok ? '✓ مدعوم' : '✗ مو مدعوم'}</Text>
                    : r.status === 'failed'
                      ? <Text style={[s.badge, s.badgeNo]}>✗</Text>
                      : <Text style={s.rowSub}>—</Text>}
              </View>
              {r.status === 'done' && (
                <Text style={s.rowLine}>
                  {(r.nrCount ?? 0)} {(r.nrCount ?? 0) === 1 ? 'قناة' : 'قنوات'} {G}
                  {r.bw ? ` · ${Math.round(r.bw)} MHz` : ''}
                  {r.snap?.sinr !== undefined ? ` · SINR ${Math.round(r.snap.sinr)}` : ''}
                </Text>
              )}
              {!!r.note && <Text style={s.rowNote}>{r.note}</Text>}
            </View>
          );
        })}

        {finished && (
          <View style={[s.card, { borderColor: best ? tBd('#7fd4b8') : C.cardBorder }]}>
            {best ? (
              <>
                <Text style={[s.verdict, { color: tFg('#0f7a52') }]}>
                  🎉 برجك يدعم {P}{best.band}+{P}{best.band}{best.bw ? ` (${Math.round(best.bw)} MHz)` : ''}
                </Text>
                <Pressable style={[s.btn, { backgroundColor: tFg('#12a07a') }]} onPress={apply} disabled={running}>
                  <Text style={s.btnText}>ثبّته بأمان</Text>
                </Pressable>
                <Text style={s.note}>ينحفظ في «الملفات» عشان ترجع له بضغطة.</Text>
              </>
            ) : (
              <>
                <Text style={s.verdict}>برجك ما شغّل الدمج المزدوج حالياً.</Text>
                <Text style={s.note}>
                  هذا يعتمد على البرج نفسه وكم قناة {G} مشغّلة فيه — مو على راوترك. جرّب في وقت ثاني، أو بعد ما توجّه الراوتر لبرج ثاني.
                </Text>
              </>
            )}
            <Text style={s.note}>رجّعنا إعدادك مثل ما كان.</Text>
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: S.md },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  body: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  nowBox: { backgroundColor: tBg('#f1f4fb'), borderColor: tBd('#d8e0f0'), borderWidth: 1.5, borderRadius: 12, padding: 10 },
  nowOk: { backgroundColor: tBg('#ecfaf4'), borderColor: tBd('#b9e6d6') },
  nowTxt: { color: C.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  warn: { color: tFg('#b45309'), fontSize: 12, textAlign: 'right', fontWeight: '700', lineHeight: 18 },
  btn: { backgroundColor: ACCENT, borderRadius: R.md, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  statusText: { color: ACCENT, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  err: { color: C.red, fontSize: 12.5, textAlign: 'right' },
  row: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.md, padding: S.md, gap: 4 },
  rowHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  rowName: { color: C.text, fontWeight: '800', fontSize: 15 },
  rowSub: { color: C.muted, fontSize: 11.5, fontWeight: '600' },
  badge: { fontSize: 12, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  badgeOk: { color: tFg('#0f7a52'), backgroundColor: tBg('#dafcee') },
  badgeNo: { color: tFg('#8a5a00'), backgroundColor: tBg('#fff3dc') },
  rowLine: { color: C.sub, fontSize: 12, textAlign: 'right' },
  rowNote: { color: C.muted, fontSize: 12, textAlign: 'right' },
  verdict: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right', lineHeight: 23 },
  note: { color: C.muted, fontSize: 11.5, textAlign: 'right', lineHeight: 18 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center', backgroundColor: C.card },
  chipTxt: { color: C.text, fontWeight: '800', fontSize: 15 },
  chipSub: { color: C.muted, fontSize: 10.5, fontWeight: '600' },
  btnGhost: { borderWidth: 1.5, borderColor: ACCENT, borderRadius: R.md, paddingVertical: 11, alignItems: 'center' },
  btnGhostTxt: { color: ACCENT, fontWeight: '800', fontSize: 14 },
});
