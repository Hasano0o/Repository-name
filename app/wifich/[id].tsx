/**
 * قناة الواي فاي — يدوّر على أنظف قناة لواي فاي البيت.
 * الجيران على نفس القناة = تداخل = بنق يتذبذب وسرعة أقل بين الجوال والراوتر.
 * ما نقدر نشوف شبكات الجيران من الآيفون، فنجرّب فعلياً: نغيّر القناة، نقيس البنق
 * بين الجوال والراوتر، ونثبّت الأفضل. لو القناة الحالية هي الأفضل نرجّعها كما كانت.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share, Linking } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useAutoStart } from '../../src/assistant/auto';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { reportError, sendSupportReport, DEV_TELEGRAM } from '../../src/services/errors';
import { withSession } from '../../src/store/sessions';
import { progress } from '../../src/ui/Progress';
import { WifiRadio } from '../../src/drivers/types';
import { DEMO_DRIVER_ID, DemoDriver } from '../../src/drivers/demo';
import { C, tBg, tBd, tFg } from '../../src/ui/theme';

import { sheet } from '../../src/i18n';
const ACCENT = '#2f6bff';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Band = '2.4' | '5';

interface Quality { ms: number; jitter: number; loss: number; score: number }
interface Tried { ch: string; q: Quality | null }

const chLabel = (c: string) => (c === '0' ? 'تلقائي' : c);

/**
 * القنوات اللي نجربها.
 * 2.4: 1/6/11 ما تتداخل مع بعض، و13 مسموحة بالسعودية وغالباً فاضية (أغلب الأجهزة على 1/6/11).
 *      نأخذ بس اللي يسمح فيه الراوتر (هواوي بالسعودية يمنع 1–4 → نكمّل بـ 5 و 9).
 * 5: نتجنب قنوات الرادار (52–144).
 */
function candidates(r: WifiRadio): string[] {
  if (r.band === '2.4') {
    const ok = r.allowed?.length ? r.allowed.filter(c => c !== '0') : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
    const pick = ['1', '6', '11', '13'].filter(c => ok.includes(c));
    for (const c of ['5', '9']) if (pick.length < 3 && ok.includes(c)) pick.push(c);
    return pick.sort((a, b) => Number(a) - Number(b));
  }
  // من القنوات اللي الراوتر يسمح فيها بس (غيرها يرفضه الراوتر)
  if (r.allowed?.length) {
    const ok = r.allowed.filter(c => c !== '0');
    const pref = ['36', '44', '149', '157'].filter(c => ok.includes(c));
    const pick = pref.length >= 3 ? pref : ok.filter(c => Number(c) < 52 || Number(c) > 144).slice(0, 4);
    return pick.length ? pick : ok.slice(0, 4);
  }
  return ['36', '40', '44', '48'];
}
function manualList(r: WifiRadio): string[] {
  if (r.allowed?.length) return r.allowed;
  return r.band === '2.4'
    ? ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']
    : ['0', '36', '40', '44', '48'];
}

/** بنق واحد من الجوال للراوتر (عبر الواي فاي) */
async function lanPing(r: SavedRouter, band: Band, demo: DemoDriver | null): Promise<number | null> {
  if (demo) { await sleep(60); return demo.demoLanPing(band); }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  const t0 = Date.now();
  try {
    await fetch(`http://${r.host}/favicon.ico?_=${t0}`, { signal: ctrl.signal, cache: 'no-store' } as any);
    return Date.now() - t0;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function measure(r: SavedRouter, band: Band, demo: DemoDriver | null, n = 24): Promise<Quality | null> {
  const xs: number[] = [];
  let lost = 0;
  for (let i = 0; i < n; i++) {
    const v = await lanPing(r, band, demo);
    if (v === null) lost++; else xs.push(v);
    await sleep(120);
  }
  if (xs.length < n / 3) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const ms = sorted[Math.floor(sorted.length / 2)];
  let j = 0;
  for (let i = 1; i < xs.length; i++) j += Math.abs(xs[i] - xs[i - 1]);
  const jitter = xs.length > 1 ? Math.round(j / (xs.length - 1)) : 0;
  const loss = Math.round((lost / n) * 100);
  return { ms, jitter, loss, score: ms + jitter * 1.5 + loss * 4 };
}

/** ننتظر الواي فاي يرجع بعد تغيير القناة (الجوال يفصل ويرجع يتصل) */
async function waitWifi(r: SavedRouter, band: Band, demo: DemoDriver | null, cancelled: () => boolean) {
  const deadline = Date.now() + 120000; // بعض الجوالات (أندرويد خصوصاً) تتأخر ترجع للواي فاي بعد تغيير القناة
  let ok = 0;
  await sleep(demo ? 1500 : 6000);
  while (Date.now() < deadline && !cancelled()) {
    ok = (await lanPing(r, band, demo)) !== null ? ok + 1 : 0;
    if (ok >= 3) { await sleep(demo ? 500 : 4000); return true; }
    await sleep(1000);
  }
  return false;
}

export default function WifiChannel() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [radios, setRadios] = useState<WifiRadio[] | null>(null);
  const [band, setBand] = useState<Band>('2.4');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState<Tried[]>([]);
  const [verdict, setVerdict] = useState<{ good: boolean; text: string } | null>(null);
  const [onWifi, setOnWifi] = useState<boolean | null>(null);
  const mounted = useRef(true);
  const demoRef = useRef<DemoDriver | null>(null);

  const load = async (r: SavedRouter) => {
    const list = await withSession(r, async d => {
      if (r.driverId === DEMO_DRIVER_ID) demoRef.current = d as DemoDriver;
      return d.getWifiRadios ? d.getWifiRadios() : [];
    }, false).catch(() => [] as WifiRadio[]);
    if (!mounted.current) return list;
    setRadios(list);
    return list;
  };

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try {
        const list = await load(r);
        if (list.length && mounted.current) setBand(list.some(x => x.band === '5') ? '5' : list[0].band);
        const p = await lanPing(r, '2.4', demoRef.current);
        if (mounted.current) setOnWifi(p !== null);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, [id]);

  const radio = radios?.find(x => x.band === band) ?? null;

  const readChannel = async (r: SavedRouter, b: Band) => {
    const list = await withSession(r, d => d.getWifiRadios!(), false).catch(() => null);
    return list?.find(x => x.band === b)?.channel ?? null;
  };

  /** نغيّر ونتأكد إن الراوتر طبّقها فعلاً */
  const apply = async (r: SavedRouter, b: Band, ch: string, cancelled: () => boolean) => {
    await withSession(r, d => d.setWifiChannel!(b, ch), false).catch(e => {
      // الطلب ممكن ينقطع لأن الواي فاي نفسه طفى وهو يطبّق — نحكم بالقراءة بعدها
      if (!/network|abort|timeout|مهلة|ما رد/i.test(String(e?.message ?? e))) throw e;
    });
    const back = await waitWifi(r, b, demoRef.current, cancelled);
    if (!back) throw new Error('الواي فاي ما رجع خلال دقيقتين. افتح إعدادات الواي فاي في جوالك واتصل بشبكة الراوتر يدوي — القناة تغيّرت والجوال أحياناً ما يرجع لحاله.');
    const now = await readChannel(r, b);
    if (now !== null && now !== ch) throw new Error(`الراوتر ما قبل تغيير القناة (باقي على ${chLabel(now)}).`);
  };

  const smart = () => {
    if (!info || !radio) return;
    Alert.alert('دوّر على أنظف قناة',
      `بنجرّب ${candidates(radio).length} قنوات على شبكة الـ${band} ونقيس البنق بين جوالك والراوتر في كل وحدة، وبعدها نثبّت الأفضل.\n\n• الواي فاي بينقطع ثواني مع كل تجربة\n• خلّ جوالك متصل على شبكة الـ${band} وقريب من مكانك المعتاد\n• تاخذ تقريباً ${candidates(radio).length + 1} دقائق`,
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'يلا', onPress: () => runSmart(info, radio) }]);
  };

  const runSmart = async (r: SavedRouter, rad: WifiRadio) => {
    const b = rad.band;
    const orig = rad.channel;
    const list = candidates(rad).filter(c => c !== orig);
    const cancelled = () => !mounted.current;
    setBusy(true); setError(''); setVerdict(null); setTried([]);
    const steps = ['نقيس القناة الحالية', ...list.map(c => `نجرّب قناة ${c}`), 'نثبّت الأفضل'];
    const t = progress.start('ندوّر على أنظف قناة', steps, 35 + list.length * 40);
    const res: Tried[] = [];
    let current = orig;
    try {
      t.note(`القناة الحالية: ${chLabel(orig)}`);
      const base = await measure(r, b, demoRef.current);
      if (!base) throw new Error(`ما قدرنا نوصل للراوتر من جوالك. تأكد إنك متصل على واي فاي الراوتر (شبكة الـ${b}).`);
      res.push({ ch: orig, q: base });
      setTried([...res]);
      for (let i = 0; i < list.length && !cancelled(); i++) {
        t.step(i + 1);
        t.note('نغيّر القناة — الواي فاي بينقطع ثواني');
        try {
          await apply(r, b, list[i], cancelled);
        } catch (e: any) {
          // الراوتر رفض هالقناة بالذات (مو مسموحة عنده) — نتخطاها ونكمّل الباقي بدل ما نوقف التجربة
          if (!/9003|ما قبل/.test(String(e?.message ?? e))) throw e;
          t.note(`قناة ${list[i]} مو مسموحة في راوترك — نتخطاها`);
          continue;
        }
        current = list[i];
        t.note('نقيس...');
        res.push({ ch: list[i], q: await measure(r, b, demoRef.current) });
        setTried([...res]);
      }
      t.step(list.length + 1);
      const ok = res.filter(x => x.q) as { ch: string; q: Quality }[];
      const best = ok.reduce((a, x) => (x.q.score < a.q.score ? x : a), ok[0]);
      const gain = Math.round((1 - best.q.score / base.score) * 100);
      const keep = best.ch !== orig && gain >= 15;
      const target = keep ? best.ch : orig;
      if (current !== target) {
        t.note(keep ? `نثبّت قناة ${target}` : 'نرجّع قناتك الأصلية');
        await apply(r, b, target, cancelled);
      }
      if (mounted.current) {
        setVerdict(keep
          ? { good: true, text: `ثبّتنا قناة ${best.ch} بدل ${chLabel(orig)} — الاتصال بين جوالك والراوتر أنظف بحوالي ${gain}٪ (بنق ${best.q.ms} مللي، تذبذب ${best.q.jitter}).` }
          : { good: false, text: `قناتك الحالية (${chLabel(orig)}) هي الأفضل أو الفرق بسيط — رجّعناها مثل ما كانت. لو النت بطيء فالمشكلة غالباً في الإشارة مو في الواي فاي.` });
        await load(r);
      }
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? String(e));
      reportError('wifich', e, info);
      if (current !== orig) await withSession(r, d => d.setWifiChannel!(b, orig), false).catch(() => {});
    } finally {
      t.end();
      if (mounted.current) setBusy(false);
    }
  };

  const manual = (ch: string) => {
    if (!info || !radio || ch === radio.channel) return;
    Alert.alert(`قناة ${chLabel(ch)}`, `بنغيّر قناة شبكة الـ${band} إلى ${chLabel(ch)}. الواي فاي بينقطع ثواني ويرجع.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'غيّر', onPress: async () => {
          setBusy(true); setError(''); setVerdict(null);
          const t = progress.start('نغيّر قناة الواي فاي', ['نطبّق', 'ننتظر الواي فاي يرجع', 'نقيس'], 40);
          try {
            await apply(info, band, ch, () => !mounted.current);
            t.step(2);
            const q = await measure(info, band, demoRef.current, 16);
            if (mounted.current && q) setVerdict({ good: true, text: `صرت على قناة ${chLabel(ch)} — بنق ${q.ms} مللي، تذبذب ${q.jitter}${q.loss ? `، فقد ${q.loss}٪` : ''}.` });
            await load(info);
          } catch (e: any) {
            if (mounted.current) setError(e?.message ?? String(e));
      reportError('wifich', e, info);
          } finally {
            t.end();
            if (mounted.current) setBusy(false);
          }
        },
      },
    ]);
  };

  const [sendingDbg, setSendingDbg] = useState(false);
  const sendDebug = async () => {
    if (!info || sendingDbg) return;
    setSendingDbg(true);
    const txt = await withSession(info, async d => (d.wifiDebug ? d.wifiDebug() : 'غير مدعوم'), false).catch(e => String(e?.message ?? e));
    const full = `Bandly — قناة الواي فاي\nالراوتر: ${info.driverName}\n${error ? `الخطأ: ${error}\n` : ''}\n${txt}`;
    const ok = await sendSupportReport('wifich', full, info);
    setSendingDbg(false);
    if (ok) Alert.alert('✓ وصلت التفاصيل', 'وصلت للمطوّر مباشرة. بنشوفها ونضيف دعم راوترك في تحديث قريب.');
    else Share.share({ message: full }).catch(() => {});
  };
  const DevButtons = ({ top = 0 }: { top?: number }) => (
    <View style={[s.devRow, { marginTop: top }]}>
      <Pressable onPress={sendDebug} disabled={sendingDbg} style={[s.ghost, { flex: 1 }]}>
        {sendingDbg ? <ActivityIndicator color={C.text} /> : <Text style={s.ghostTxt}>📎 أرسل التفاصيل للمطوّر</Text>}
      </Pressable>
      <Pressable onPress={() => Linking.openURL(DEV_TELEGRAM).catch(() => {})} style={[s.tgBtn]}>
        <Text style={s.tgTxt}>💬 تلغرام</Text>
      </Pressable>
    </View>
  );

  const best = tried.filter(x => x.q).reduce<Tried | null>((a, x) => (!a || x.q!.score < a.q!.score ? x : a), null);
  const worst = Math.max(1, ...tried.map(x => x.q?.score ?? 0));

  // فتحها المساعد («أفضل قناة») ← نفس تأكيد «دوّر على أنظف قناة»، أو نوضح ليش ما يصير
  useAutoStart(!loading && !!info && radios !== null && !busy, () => {
    if (!radio) { Alert.alert('أفضل قناة', 'ما قدرنا نقرأ قنوات الواي فاي من راوترك.'); return; }
    if (!radio.writable) { Alert.alert('أفضل قناة', 'راوترك ما يسمح بتغيير قناة الواي فاي من التطبيق — تقدر تشوف القناة الحالية هنا.'); return; }
    smart();
  });

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.hero}>
          <Text style={s.heroTitle}>قناة الواي فاي</Text>
          <Text style={s.heroSub}>
            لو جيرانك على نفس قناتك، الإشارات تتزاحم: بنق يتذبذب وسرعة أقل بين جوالك والراوتر — حتى لو الشبكة قوية.
            نجرّب القنوات ونثبّت الأنظف.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={ACCENT} style={{ marginTop: 30 }} />
        ) : !radios?.length ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>ما قدرنا نقرأ قناة الواي فاي من راوترك</Text>
            <Text style={s.cardSub}>بعض الموديلات تخفي هالإعداد. أرسل لنا التفاصيل ونضيف دعم راوترك.</Text>
            <DevButtons />
          </View>
        ) : (
          <>
            {onWifi === false && (
              <View style={s.warn}>
                <Text style={s.warnTxt}>جوالك مو متصل على واي فاي الراوتر — اتصل عليه أول عشان نقدر نقيس.</Text>
              </View>
            )}

            {radios.length > 1 && (
              <View style={s.seg}>
                {(['5', '2.4'] as Band[]).filter(b => radios.some(x => x.band === b)).map(b => (
                  <Pressable key={b} disabled={busy} onPress={() => { setBand(b); setTried([]); setVerdict(null); setError(''); }}
                    style={[s.segBtn, band === b && s.segOn]}>
                    <Text style={[s.segTxt, band === b && s.segTxtOn]}>{b === '5' ? '5 GHz' : '2.4 GHz'}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {radio && (
              <View style={s.card}>
                <View style={s.rowBetween}>
                  <Text style={s.cardTitle}>شبكة الـ{band === '5' ? '5 GHz' : '2.4 GHz'}</Text>
                  <View style={s.chChip}><Text style={s.chChipTxt}>القناة: {chLabel(radio.channel)}</Text></View>
                </View>
                <Text style={s.cardSub}>
                  {band === '5'
                    ? 'أسرع وأقل زحمة، بس مداها أقصر. اسمها غالباً فيه 5G.'
                    : 'توصل أبعد وتعدّي الجدران، بس زحمتها أكثر. أفضل قنواتها 1 أو 6 أو 11.'}
                  {'\n'}جوالك لازم يكون متصل على هالشبكة نفسها وقت التجربة.
                </Text>

                {radio.writable ? (
                  <Pressable disabled={busy} onPress={smart} style={({ pressed }) => [s.primary, (pressed || busy) && { opacity: 0.8 }]}>
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryTxt}>🔍 دوّر على أنظف قناة</Text>}
                  </Pressable>
                ) : (
                  <Text style={s.note}>راوترك ما يسمح نغيّر قناة هذي الشبكة من التطبيق.</Text>
                )}
              </View>
            )}

            {!!error && (
              <View style={s.err}>
                <Text style={s.errTxt}>{error}</Text>
                {/قبل/.test(error) && (
                  <DevButtons top={8} />
                )}
              </View>
            )}

            {verdict && (
              <View style={[s.verdict, !verdict.good && s.verdictNeutral]}>
                <Text style={[s.verdictTxt, !verdict.good && { color: tFg('#1e3a8a') }]}>{verdict.good ? '✓ ' : 'ℹ️ '}{verdict.text}</Text>
              </View>
            )}

            {tried.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>نتيجة التجربة</Text>
                {tried.map(x => (
                  <View key={x.ch} style={s.res}>
                    <View style={s.rowBetween}>
                      <Text style={s.resCh}>قناة {chLabel(x.ch)}{x.ch === radio?.channel && !busy ? ' (الحالية)' : ''}{best?.ch === x.ch ? '  🏆' : ''}</Text>
                      <Text style={s.resVal}>{x.q ? `${x.q.ms} مللي · تذبذب ${x.q.jitter}${x.q.loss ? ` · فقد ${x.q.loss}٪` : ''}` : 'ما قدرنا نقيس'}</Text>
                    </View>
                    <View style={s.bar}>
                      <View style={[s.barFill, {
                        width: `${x.q ? Math.max(8, 100 - (x.q.score / worst) * 80) : 4}%`,
                        backgroundColor: best?.ch === x.ch ? tBg('#16a34a') : tBg('#94a3b8'),
                      }]} />
                    </View>
                  </View>
                ))}
                <Text style={s.note}>الشريط الأطول = اتصال أنظف (بنق وتذبذب أقل).</Text>
              </View>
            )}

            {radio?.writable && (
              <View style={s.card}>
                <Text style={s.cardTitle}>أو اختر قناة بنفسك</Text>
                <View style={s.chips}>
                  {manualList(radio).map(c => (
                    <Pressable key={c} disabled={busy} onPress={() => manual(c)}
                      style={[s.chip, c === radio.channel && s.chipOn]}>
                      <Text style={[s.chipTxt, c === radio.channel && s.chipTxtOn]}>{chLabel(c)}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <View style={s.info}>
              <Text style={s.infoTxt}>
                💡 هالميزة تحسّن الاتصال داخل البيت (بين الجهاز والراوتر). لو المشكلة في سرعة الشركة نفسها، استخدم تثبيت البرج والتردد.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = sheet({
  page: { padding: 16, gap: 14 },
  hero: { backgroundColor: tBg('#eef3ff'), borderRadius: 22, padding: 16, borderWidth: 1.5, borderColor: tBd('#cddbff'), gap: 6 },
  heroTitle: { color: tFg('#1d3f9e'), fontSize: 20, fontWeight: '900', textAlign: 'right' },
  heroSub: { color: C.text, fontSize: 13.5, lineHeight: 22, textAlign: 'right' },
  card: { backgroundColor: C.card, borderRadius: 22, padding: 16, gap: 10, borderWidth: 1.5, borderColor: C.cardBorder },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  cardSub: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  rowBetween: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chChip: { backgroundColor: tBg('#2f6bff'), borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  chChipTxt: { color: tFg('#fff'), fontSize: 13, fontWeight: '800' },
  primary: { alignItems: 'center', justifyContent: 'center', backgroundColor: tBg(ACCENT), borderRadius: 16, paddingVertical: 14, marginTop: 4 },
  primaryTxt: { color: tFg('#fff'), fontSize: 15.5, fontWeight: '800' },
  ghost: { alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: C.rowBg, borderWidth: 1.5, borderColor: C.cardBorder },
  devRow: { flexDirection: 'row-reverse', gap: 8 },
  tgBtn: { paddingHorizontal: 16, justifyContent: 'center', borderRadius: 14, backgroundColor: tBg('#229ED9') },
  tgTxt: { color: tFg('#ffffff'), fontSize: 14, fontWeight: '800' },
  ghostTxt: { color: C.text, fontSize: 14, fontWeight: '700' },
  seg: { flexDirection: 'row-reverse', backgroundColor: C.rowBg, borderRadius: 16, padding: 4, gap: 4 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 },
  segOn: { backgroundColor: tBg('#ffffff'), borderWidth: 1, borderColor: tBd('#cddbff') },
  segTxt: { color: C.sub, fontSize: 14, fontWeight: '800' },
  segTxtOn: { color: tFg('#1d3f9e') },
  warn: { backgroundColor: tBg('#fff7ed'), borderRadius: 14, padding: 12, borderWidth: 1, borderColor: tBd('#fed7aa') },
  warnTxt: { color: tFg('#9a3412'), fontSize: 13, lineHeight: 20, textAlign: 'right' },
  err: { backgroundColor: tBg('#fff1f2'), borderRadius: 14, padding: 12, borderWidth: 1, borderColor: tBd('#fecdd3') },
  errTxt: { color: tFg('#be123c'), fontSize: 13.5, lineHeight: 21, textAlign: 'right' },
  verdict: { backgroundColor: tBg('#ecfdf5'), borderRadius: 16, padding: 14, borderWidth: 1.5, borderColor: tBd('#a7f3d0') },
  verdictNeutral: { backgroundColor: tBg('#eef3ff'), borderColor: tBd('#cddbff') },
  verdictTxt: { color: tFg('#065f46'), fontSize: 14, lineHeight: 22, fontWeight: '700', textAlign: 'right' },
  res: { gap: 6, paddingVertical: 4 },
  resCh: { color: C.text, fontSize: 14, fontWeight: '800' },
  resVal: { color: C.sub, fontSize: 12.5, fontWeight: '700' },
  bar: { height: 8, borderRadius: 4, backgroundColor: C.rowBg, overflow: 'hidden', flexDirection: 'row-reverse' },
  barFill: { height: 8, borderRadius: 4 },
  note: { color: C.sub, fontSize: 12, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 50, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: C.rowBg, borderWidth: 1.5, borderColor: C.cardBorder },
  chipOn: { backgroundColor: tBg('#2f6bff'), borderColor: tBd('#2f6bff') },
  chipTxt: { color: C.text, fontSize: 14, fontWeight: '800' },
  chipTxtOn: { color: tFg('#fff') },
  info: { backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.cardBorder },
  infoTxt: { color: C.sub, fontSize: 12.5, lineHeight: 20, textAlign: 'right' },
});
