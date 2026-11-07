/**
 * «تعزيز اللعب» — ميزات راوترات الألعاب اللي تمشي فعلاً على راوترات 4G/5G:
 *   فحص Bufferbloat · NAT/CGNAT/IPv6 · وضع المباراة (إيقاف مؤقت لأجهزة البيت).
 * المنطق: src/utils/gameNet.ts · التشغيل: src/services/gameBoost.ts
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { selectedRegion, regionUrls, GameRegion } from '../../src/utils/latency';
import {
  BloatResult, BloatGrade, bloatWord, bloatAdvice, MatchDevice, matchTargets, isSelf, normMac,
  MATCH_DURATIONS, matchLeft,
} from '../../src/utils/gameNet';
import { runBloatTest, checkNat, NatReport, startMatch, endMatch, selfLanIp } from '../../src/services/gameBoost';
import { getMatch, StoredMatch } from '../../src/store/matchMode';
import { useLeaveGuard } from '../../src/ui/useLeaveGuard';
import { C, tFg } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { sheet } from '../../src/i18n';

const gradeColor = (g: BloatGrade) => (g === 'A+' || g === 'A' ? C.green : g === 'B' ? '#1f9e63' : g === 'C' ? '#e0a100' : C.red);
const DUR_LABEL: Record<number, string> = { 30: 'نص ساعة', 60: 'ساعة', 90: 'ساعة ونص', 120: 'ساعتين' };
const errMsg = (e: unknown) => String((e as any)?.message ?? e);

export default function GameBoost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [reg, setReg] = useState<GameRegion | null>(null);

  // Bufferbloat
  const [bloat, setBloat] = useState<BloatResult | null>(null);
  const [bloatRun, setBloatRun] = useState(false);
  const [bloatStep, setBloatStep] = useState('');
  const [bloatErr, setBloatErr] = useState('');
  const cancel = useRef(false);
  useLeaveGuard(bloatRun, { what: 'فحص التحميل', onStop: () => { cancel.current = true; } });

  // NAT
  const [nat, setNat] = useState<NatReport | null>(null);
  const [natRun, setNatRun] = useState(false);

  // وضع المباراة
  const [canBlock, setCanBlock] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<MatchDevice[]>([]);
  const [blockedBefore, setBlockedBefore] = useState<string[]>([]);
  const [selfIp, setSelfIp] = useState<string | undefined>();
  const [selfManual, setSelfManual] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [mins, setMins] = useState<number>(60);
  const [match, setMatch] = useState<StoredMatch | null>(null);
  const [matchBusy, setMatchBusy] = useState(false);
  const [devLoading, setDevLoading] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!id) return;
    getRouter(id).then(setInfo).catch(() => {});
    selectedRegion().then(setReg).catch(() => {});
    return () => { cancel.current = true; };
  }, [id]);

  useFocusEffect(useCallback(() => {
    if (!id) return;
    getMatch(id).then(setMatch).catch(() => {});
    const t = setInterval(() => tick(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, [id]));

  const loadDevices = useCallback(async (r: SavedRouter) => {
    setDevLoading(true);
    try {
      const res = await withSession(r, async d => {
        if (!d.blockDevice || !d.getDevices) return null;
        const list = await d.getDevices();
        const blk = d.getBlockedDevices ? await d.getBlockedDevices().catch(() => []) : [];
        return { list, blk };
      }, false);
      if (!res) { setCanBlock(false); return; }
      setCanBlock(true);
      setDevices(res.list);
      setBlockedBefore(res.blk.map(b => normMac(b.mac)));
      if (!selfManual) setSelfIp(await selfLanIp(r.host));
    } catch (e) {
      setCanBlock(null);
      Alert.alert('ما قدرنا نقرأ الأجهزة', errMsg(e));
    } finally {
      setDevLoading(false);
    }
  }, [selfManual]);

  useEffect(() => { if (info && !match) loadDevices(info); }, [info, match]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Bufferbloat ── */
  const runBloat = async () => {
    if (!reg || bloatRun) return;
    cancel.current = false;
    setBloatRun(true); setBloatErr(''); setBloat(null);
    const word = { idle: 'نقيس البنق والخط فاضي', down: 'نضغط التنزيل ونقيس البنق', up: 'نضغط الرفع ونقيس البنق' };
    try {
      const res = await runBloatTest(regionUrls(reg), {
        cancelled: () => cancel.current,
        onStep: (st, ms) => setBloatStep(`${word[st]} · ${ms === null ? 'ما رد' : `${ms}ms`}`),
      });
      setBloat(res);
    } catch (e) {
      if (!cancel.current) setBloatErr(errMsg(e));
    } finally {
      setBloatRun(false); setBloatStep('');
    }
  };

  const askBloat = () => Alert.alert(
    'فحص التحميل',
    'نقيس البنق والخط فاضي، وبعدها وقت تنزيل ورفع قوي (حوالي ٢٥ ثانية).\nيستهلك تقريباً ٣٠–٢٠٠ ميقا من الباقة حسب سرعتك.\nالأفضل ما أحد يستخدم النت وقت الفحص.',
    [{ text: 'إلغاء', style: 'cancel' }, { text: 'ابدأ', onPress: runBloat }],
  );

  /* ── NAT ── */
  const runNat = async () => {
    if (!info || natRun) return;
    setNatRun(true);
    try { setNat(await checkNat(info)); } catch (e) { Alert.alert('ما قدرنا نفحص', errMsg(e)); } finally { setNatRun(false); }
  };

  /* ── وضع المباراة ── */
  const togglePick = (mac: string) => setPicked(p => (p.includes(normMac(mac)) ? p.filter(x => x !== normMac(mac)) : [...p, normMac(mac)]));
  const markSelf = (d: MatchDevice) => {
    if (!d.ip) { Alert.alert('هذا الجهاز بدون آي بي', 'اختار جهاز ثاني أو أعد التحميل'); return; }
    Alert.alert('هذا جوالك؟', `${d.name || d.mac}\n${d.ip}\n\nما بنوقفه أبداً — لو انوقف جوالك التطبيق ما يقدر يرجّع النت.`, [
      { text: 'لا', style: 'cancel' },
      { text: 'إيه، هذا جوالي', onPress: () => { setSelfIp(d.ip); setSelfManual(true); setPicked(p => p.filter(x => x !== normMac(d.mac))); } },
    ]);
  };

  const targets = matchTargets(devices, picked, selfIp, blockedBefore);

  const doStart = async () => {
    if (!info || !targets.length) return;
    setMatchBusy(true);
    try {
      const { ok, failed } = await startMatch(info, targets, mins);
      setMatch(await getMatch(info.id));
      setPicked([]);
      if (!ok.length) Alert.alert('ما انوقف ولا جهاز', 'الراوتر رفض الإيقاف — جرّب من شاشة الأجهزة');
      else Alert.alert('🎮 وضع المباراة شغّال', `وقّفنا ${ok.length} ${ok.length === 1 ? 'جهاز' : 'أجهزة'} لمدة ${mins} دقيقة.${failed.length ? `\nما انوقف: ${failed.map(f => f.name || f.mac).join('، ')}` : ''}\n\nبعد الوقت افتح التطبيق ونرجّعها (يجيك تنبيه).`);
    } catch (e) {
      Alert.alert('ما اشتغل وضع المباراة', errMsg(e));
      setMatch(await getMatch(info.id));
    } finally {
      setMatchBusy(false);
    }
  };

  const askStart = () => {
    if (!targets.length) return;
    Alert.alert(
      'نوقف هالأجهزة؟',
      `${targets.map(t => `• ${t.name || t.mac}`).join('\n')}\n\nينقطع عنها النت ${mins} دقيقة. تقدر ترجّعها قبل بزر «رجّع النت الحين».`,
      [{ text: 'إلغاء', style: 'cancel' }, { text: 'وقّفها', style: 'destructive', onPress: doStart }],
    );
  };

  const doEnd = async () => {
    if (!info) return;
    setMatchBusy(true);
    try {
      const { restored, left } = await endMatch(info);
      setMatch(await getMatch(info.id));
      Alert.alert(left ? '⚠️ ما رجع كل شي' : '✓ رجّعنا النت', left ? `رجع ${restored}، وباقي ${left} — نحاول مرة ثانية لما تفتح التطبيق، أو فك حظرها من شاشة الأجهزة.` : `رجع النت لـ ${restored} ${restored === 1 ? 'جهاز' : 'أجهزة'}.`);
    } catch (e) {
      Alert.alert('ما قدرنا نرجّع', errMsg(e));
    } finally {
      setMatchBusy(false);
    }
  };

  if (!info) return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;

  return (
    <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 30 }]}>
      <Text style={s.lead}>ميزات راوترات الألعاب اللي تمشي فعلاً على خطوط 4G/5G — بدون وعود ما نقدر عليها.</Text>

      {/* ═══ Bufferbloat ═══ */}
      <GlassCard title="هل التحميل يخرّب لعبك؟" icon="🌊" tint={C.cyanSoft} collapsible={false}>
        <Text style={s.hint}>فحص Bufferbloat: كم يرتفع البنق لما أحد في البيت ينزّل أو يرفع. هذا أكثر سبب للاق «فجأة».{reg ? ` · السيرفر: ${reg.name}` : ''}</Text>
        {bloatRun ? (
          <View style={s.live}>
            <ActivityIndicator color={C.blue} />
            <Text style={s.liveTxt}>{bloatStep || 'نجهّز…'}</Text>
            <Pressable onPress={() => { cancel.current = true; }}><Text style={s.link}>وقّف</Text></Pressable>
          </View>
        ) : (
          <Pressable style={s.btn} onPress={askBloat} disabled={!reg}><Text style={s.btnTxt}>{bloat ? 'أعد الفحص' : 'افحص'}</Text></Pressable>
        )}
        {!!bloatErr && <Text style={s.err}>{bloatErr}</Text>}
        {bloat && (
          <>
            <View style={[s.verdict, { borderColor: gradeColor(bloat.grade) }]}>
              <Text style={[s.grade, { color: gradeColor(bloat.grade) }]}>{bloat.grade}</Text>
              <Text style={[s.verdictTitle, { color: gradeColor(bloat.grade) }]}>{bloatWord(bloat.grade)}</Text>
            </View>
            <View style={s.stats}>
              <Stat l="الخط فاضي" v={`${bloat.idle.median}`} u="ms" c={C.text} />
              <Stat l="وقت التنزيل" v={bloat.down.addedMs >= 999 ? '—' : `+${bloat.down.addedMs}`} u={`ms · ${bloat.down.mbps} Mbps`} c={gradeColor(bloat.down.grade)} />
              <Stat l="وقت الرفع" v={bloat.up.addedMs >= 999 ? '—' : `+${bloat.up.addedMs}`} u={`ms · ${bloat.up.mbps} Mbps`} c={gradeColor(bloat.up.grade)} />
            </View>
            {bloatAdvice(bloat).map((l, i) => <Text key={i} style={s.bullet}>• {l}</Text>)}
          </>
        )}
      </GlassCard>

      {/* ═══ NAT ═══ */}
      <GlassCard title="NAT مفتوح؟" icon="🔓" tint={C.violetSoft} collapsible={false}>
        <Text style={s.hint}>نشوف هل شركتك تعطيك آي بي عام ولا مشترك (CGNAT)، وهل IPv6 شغال — عشان تعرف هل فتح المنافذ بيفيدك أصلاً.</Text>
        <Pressable style={s.btn} onPress={runNat} disabled={natRun}>
          {natRun ? <ActivityIndicator color={C.onAccent} /> : <Text style={s.btnTxt}>{nat ? 'أعد الفحص' : 'افحص'}</Text>}
        </Pressable>
        {nat && (
          <>
            <Text style={[s.natTitle, { color: nat.kind === 'public' ? C.green : nat.kind === 'cgnat' ? tFg('#b45309') : C.text }]}>{nat.title}</Text>
            <Text style={s.body}>{nat.detail}</Text>
            {nat.fix.map((l, i) => <Text key={i} style={s.bullet}>• {l}</Text>)}
            {nat.portsHelp && (
              <Pressable onPress={() => router.push(`/control/${info.id}` as Href)}><Text style={s.link}>افتح مركز التحكم (UPnP / DMZ) ‹</Text></Pressable>
            )}
          </>
        )}
      </GlassCard>

      {/* ═══ وضع المباراة ═══ */}
      <GlassCard title="وضع المباراة" icon="🎯" tint={C.greenSoft} collapsible={false}>
        <Text style={s.hint}>يوقف النت مؤقتاً عن الأجهزة اللي تختارها (التلفزيون، الجوالات اللي تحمّل…) وقت اللعب، ويرجعها بعد الوقت.</Text>
        {match ? (
          <>
            <Text style={s.natTitle}>شغّال — باقي {matchLeft(match, Date.now())}</Text>
            {match.devices.map(d => <Text key={d.mac} style={s.bullet}>⏸ {d.name || d.mac}</Text>)}
            {Date.now() >= match.until && <Text style={s.warn}>الوقت خلص — اضغط تحت عشان نرجّعها</Text>}
            <Pressable style={[s.btn, { backgroundColor: C.green }]} onPress={doEnd} disabled={matchBusy}>
              {matchBusy ? <ActivityIndicator color={C.onAccent} /> : <Text style={s.btnTxt}>رجّع النت الحين</Text>}
            </Pressable>
          </>
        ) : canBlock === false ? (
          <Text style={s.warn}>راوترك ما يسمح بإيقاف الأجهزة من التطبيق.</Text>
        ) : devLoading ? (
          <ActivityIndicator color={C.blue} />
        ) : (
          <>
            {!selfIp && devices.length > 0 && (
              <Text style={s.warn}>ما عرفنا جوالك تلقائياً — اضغط «هذا جوالي» على جوالك أول (عشان ما نوقفه بالغلط).</Text>
            )}
            {devices.map(d => {
              const mac = normMac(d.mac);
              const me = isSelf(d, selfIp);
              const pre = blockedBefore.includes(mac) || !!d.blocked;
              const on = picked.includes(mac);
              return (
                <View key={mac} style={[s.dev, on && s.devOn]}>
                  <Pressable style={{ flex: 1 }} disabled={me || pre || !selfIp} onPress={() => togglePick(mac)}>
                    <Text style={s.devName}>{me ? '📱 ' : on ? '⏸ ' : ''}{d.name || 'جهاز بدون اسم'}{me ? ' (جوالك)' : ''}</Text>
                    <Text style={s.devSub}>{d.ip ?? ''} · {mac}{pre ? ' · محظور أصلاً' : ''}</Text>
                  </Pressable>
                  {!selfIp && !pre && <Pressable onPress={() => markSelf(d)}><Text style={s.link}>هذا جوالي</Text></Pressable>}
                  {!!selfIp && !me && !pre && <Text style={[s.check, on && { color: C.green }]}>{on ? '☑' : '☐'}</Text>}
                </View>
              );
            })}
            {!devices.length && <Text style={s.hint}>ما لقينا أجهزة متصلة.</Text>}
            {!!selfIp && devices.length > 0 && (
              <>
                <View style={s.chips}>
                  {MATCH_DURATIONS.map(m => (
                    <Pressable key={m} style={[s.chip, mins === m && s.chipOn]} onPress={() => setMins(m)}>
                      <Text style={[s.chipTxt, mins === m && { color: C.onAccent }]}>{DUR_LABEL[m] ?? `${m} دقيقة`}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={[s.btn, !targets.length && s.dim]} onPress={askStart} disabled={!targets.length || matchBusy}>
                  {matchBusy ? <ActivityIndicator color={C.onAccent} /> : <Text style={s.btnTxt}>{targets.length ? `وقّف ${targets.length} ${targets.length === 1 ? 'جهاز' : 'أجهزة'}` : 'اختار الأجهزة اللي توقفها'}</Text>}
                </Pressable>
              </>
            )}
            <Pressable onPress={() => loadDevices(info)}><Text style={[s.link, { textAlign: 'center' }]}>حدّث القائمة</Text></Pressable>
          </>
        )}
      </GlassCard>

      <Text style={s.note}>بنق سيرفرات الألعاب لكل منطقة تلقاه في مُحسّن الألعاب ← «أي سيرفر أقرب؟».</Text>
    </ScrollView>
  );
}

function Stat({ l, v, u, c }: { l: string; v: string; u: string; c: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statV, { color: c }]}>{v}</Text>
      <Text style={s.statU}>{u}</Text>
      <Text style={s.statL}>{l}</Text>
    </View>
  );
}

const s = sheet({
  page: { padding: 16, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  lead: { color: C.sub, fontSize: 13, textAlign: 'right', lineHeight: 20 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  body: { color: C.text, fontSize: 13, textAlign: 'right', lineHeight: 20 },
  bullet: { color: C.text, fontSize: 13, textAlign: 'right', lineHeight: 21 },
  warn: { color: tFg('#b45309'), fontSize: 12, textAlign: 'right', lineHeight: 19, backgroundColor: C.amberSoft, borderRadius: 12, padding: 10 },
  err: { color: C.red, fontWeight: '700', textAlign: 'right' },
  link: { color: C.blue, fontWeight: '800', fontSize: 13, textAlign: 'right', paddingVertical: 4 },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 13, alignItems: 'center' },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.45 },
  live: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.blueSoft, borderRadius: 14, padding: 12 },
  liveTxt: { color: C.blue, fontWeight: '700', flex: 1, textAlign: 'right' },
  verdict: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderWidth: 2, borderRadius: 16, padding: 12, backgroundColor: C.card },
  grade: { fontSize: 36, fontWeight: '900', minWidth: 60, textAlign: 'center' },
  verdictTitle: { fontWeight: '900', fontSize: 15, textAlign: 'right', flex: 1 },
  natTitle: { color: C.text, fontWeight: '900', fontSize: 15, textAlign: 'right' },
  stats: { flexDirection: 'row', gap: 6 },
  stat: { flex: 1, alignItems: 'center', backgroundColor: C.rowBg, borderRadius: 14, paddingVertical: 10, borderWidth: 1.5, borderColor: C.cardBorder },
  statV: { fontWeight: '800', fontSize: 18 },
  statU: { color: C.muted, fontSize: 10, textAlign: 'center' },
  statL: { color: C.sub, fontSize: 11, fontWeight: '700', marginTop: 2 },
  dev: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1.5, borderColor: C.cardBorder, padding: 11 },
  devOn: { borderColor: C.green },
  devName: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  devSub: { color: C.muted, fontSize: 11, textAlign: 'right', marginTop: 2 },
  check: { color: C.sub, fontSize: 22 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.rowBg, borderWidth: 1.5, borderColor: C.cardBorder },
  chipOn: { backgroundColor: C.blue, borderColor: C.blue },
  chipTxt: { color: C.text, fontWeight: '700', fontSize: 13 },
  note: { color: C.muted, fontSize: 11, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17 },
});
