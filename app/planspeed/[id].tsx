/**
 * «سرعتك مقابل باقتك» (عدّة الألياف — حسن ٢٣ نوفمبر): بدون دخول الراوتر.
 * العضو يختار سرعة باقته ← نقيس الواي فاي (الجوال↔الراوتر) + اختبار سرعة كامل ← النسبة من الباقة + السبب:
 * الواي فاي / حد الجوال / الشركة — ومع الشركة زر «انسخ تقرير للدعم».
 * id = راوتر مضاف، أو none (من «إضافة راوتر» ← ما أبي أدخل الراوتر).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share } from 'react-native';
import { ScrollView, View, Text, Pressable, TextInput } from '../../src/i18n/rn';
import { router, useLocalSearchParams, Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { runSpeedTest, SpeedProgress } from '../../src/utils/speedtest';
import { measureWifi } from '../../src/utils/latency';
import { findGateway } from '../../src/services/gateway';
import { judgePlan, complaintText, PLAN_CHOICES, PlanCheck, PlanCheckLog, WifiRead } from '../../src/utils/fiberKit';
import { copyText } from '../../src/utils/clipboard';
import { Icon } from '../../src/ui/Icon';
import { C, R, S, tBg, tBd } from '../../src/ui/theme';
import { FONT } from '../../src/ui/fonts';
import { sheet } from '../../src/i18n';

const VERDICT_COL: Record<PlanCheck['verdict'], string> = {
  ok: '#12b76a', wifi: '#f79009', phone: '#2f6bff', isp: '#e5484d', unknown: '#70799b',
};
const PHASE_TXT: Record<string, string> = {
  wifi: 'نقيس الواي فاي بينك وبين الراوتر…', meta: 'نجهّز…', ping: 'نقيس البنق…', download: 'نقيس التنزيل…', upload: 'نقيس الرفع…', done: 'خلص ✓',
};

interface Res { check: PlanCheck; down: number; up: number; ping: number; wifi: WifiRead | null }

export default function PlanSpeed() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rid = String(id || 'none');
  const PLAN_KEY = `bandly.fiberPlan.${rid}`;
  const LOG_KEY = `bandly.planChecks.${rid}`;
  const [plan, setPlan] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [log, setLog] = useState<PlanCheckLog[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [live, setLive] = useState<number | undefined>();
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState('');
  const alive = useRef(true);
  const cancel = useRef(false);

  useEffect(() => {
    alive.current = true;
    AsyncStorage.multiGet([PLAN_KEY, LOG_KEY]).then(([[, p], [, l]]) => {
      if (!alive.current) return;
      const n = Number(p);
      if (n > 0) setPlan(n);
      try { if (l) setLog(JSON.parse(l)); } catch {}
    }).catch(() => {});
    return () => { alive.current = false; cancel.current = true; };
  }, [PLAN_KEY, LOG_KEY]);

  const choose = (n: number) => {
    setPlan(n);
    AsyncStorage.setItem(PLAN_KEY, String(n)).catch(() => {});
  };
  const applyCustom = () => {
    const n = Math.round(Number(custom.replace(/[^\d]/g, '')));
    if (!(n >= 1 && n <= 10000)) { Alert.alert('رقم غير صحيح', 'اكتب سرعة باقتك بالميقا، مثل 200'); return; }
    choose(n); setCustom('');
  };

  const run = useCallback(async () => {
    if (running || !plan) return;
    cancel.current = false;
    setRunning(true); setErr(''); setRes(null); setLive(undefined);
    try {
      // ١) الواي فاي — قبل اختبار السرعة عشان التحميل ما يأثر عليه
      setPhase('wifi');
      const host = await findGateway(rid);
      let wifi: WifiRead | null = null;
      if (host) {
        const w = await measureWifi(host, 10).catch(() => null);
        if (w && w.samples > 0) wifi = { median: w.median, jitter: w.jitter, lossPct: w.lossPct, samples: w.samples };
      }
      if (cancel.current) return;
      // ٢) السرعة
      const r = await runSpeedTest((p: SpeedProgress) => {
        if (!alive.current) return;
        setPhase(p.phase);
        if (p.phase === 'download' || p.phase === 'upload') setLive(p.mbps);
      }, () => cancel.current || !alive.current);
      const check = judgePlan(plan, r.downloadMbps, wifi);
      if (!alive.current) return;
      setRes({ check, down: r.downloadMbps, up: r.uploadMbps, ping: r.pingMs, wifi });
      const entry: PlanCheckLog = { at: Date.now(), plan, down: r.downloadMbps, up: r.uploadMbps, ping: r.pingMs, wifiMs: wifi?.median, verdict: check.verdict };
      const next = [entry, ...log].slice(0, 20);
      setLog(next);
      AsyncStorage.setItem(LOG_KEY, JSON.stringify(next)).catch(() => {});
      if (rid !== 'none') AsyncStorage.setItem(`bandly.lastSpeed.${rid}`, JSON.stringify({ down: r.downloadMbps, up: r.uploadMbps, ping: Math.round(r.pingMs), at: Date.now() })).catch(() => {});
    } catch (e: any) {
      if (alive.current) setErr(e?.message ?? 'فشل الفحص');
    } finally {
      if (alive.current) { setRunning(false); setPhase(''); }
    }
  }, [running, plan, rid, log, LOG_KEY]);

  const report = async (share: boolean) => {
    if (!plan) return;
    const text = complaintText(plan, log.filter(l => l.plan === plan));
    if (share) { Share.share({ message: text }).catch(() => {}); return; }
    const ok = await copyText(text);
    Alert.alert(ok ? 'انسخ ✓' : 'ما قدرنا ننسخ', ok ? 'التقرير في الحافظة — الصقه في محادثة دعم الشركة' : 'استخدم زر المشاركة بداله');
  };

  const pct = res?.check.pct ?? 0;
  const col = res ? VERDICT_COL[res.check.verdict] : C.blue;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
      {/* الباقة */}
      <View style={s.card}>
        <View style={s.head}>
          <View style={[s.hIcon, { backgroundColor: '#0d9488' }]}><Icon name="speed" size={18} color="#ffffff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>كم سرعة باقتك؟</Text>
            <Text style={s.sub}>اللي مكتوبة في عقد الألياف (ميقا)</Text>
          </View>
        </View>
        <View style={s.chips}>
          {PLAN_CHOICES.map(n => (
            <Pressable key={n} onPress={() => choose(n)} disabled={running}
              style={[s.chip, plan === n && s.chipOn]}>
              <Text style={[s.chipTxt, plan === n && s.chipTxtOn]}>{n >= 1000 ? '1 جيجا' : `${n}`}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.customRow}>
          <TextInput value={custom} onChangeText={setCustom} keyboardType="number-pad" placeholder="سرعة ثانية…"
            placeholderTextColor={C.muted} style={s.input} onSubmitEditing={applyCustom} />
          <Pressable onPress={applyCustom} style={s.smallBtn}><Text style={s.smallBtnTxt}>اعتمد</Text></Pressable>
        </View>
        {!!plan && !PLAN_CHOICES.includes(plan) && <Text style={s.sub}>{`باقتك: ${plan} ميقا`}</Text>}
      </View>

      {/* الزر */}
      <Pressable onPress={run} disabled={running || !plan} style={({ pressed }) => [{ opacity: !plan ? 0.5 : pressed ? 0.85 : 1 }]}>
        <LinearGradient colors={['#0d9488', '#2f6bff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.btn}>
          {running ? <ActivityIndicator color="#ffffff" /> : <Icon name="speed" size={18} color="#ffffff" />}
          <Text style={s.btnTxt}>{running ? (PHASE_TXT[phase] ?? 'نفحص…') : !plan ? 'اختار باقتك أول' : res ? 'افحص مرة ثانية' : 'افحص سرعتي مقابل باقتي'}</Text>
        </LinearGradient>
      </Pressable>
      {running && live !== undefined && (
        <Text style={s.live}>{`${live >= 100 ? live.toFixed(0) : live.toFixed(1)} Mbps`}</Text>
      )}
      {!!err && <Text style={[s.sub, { color: '#e5484d', textAlign: 'center' }]}>{err}</Text>}

      {/* النتيجة */}
      {res && plan && (
        <View style={[s.card, { borderColor: tBd(col + '66') }]}>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text style={[s.pct, { color: col }]}>{`${pct}٪`}</Text>
            <Text style={s.sub}>{`من سرعة باقتك (${plan} ميقا)`}</Text>
          </View>
          <View style={{ direction: 'ltr', gap: 4 }}>
            <View style={s.bar}>
              <View style={{ width: `${Math.min(100, pct)}%`, backgroundColor: col, borderRadius: 99 }} />
            </View>
            <View style={[s.mark, { left: '80%' }]} />
          </View>
          <View style={s.tiles}>
            <Tile lbl="التنزيل" val={`${res.down >= 100 ? res.down.toFixed(0) : res.down.toFixed(1)}`} unit="Mbps" />
            <Tile lbl="الرفع" val={`${res.up >= 100 ? res.up.toFixed(0) : res.up.toFixed(1)}`} unit="Mbps" />
            <Tile lbl="البنق" val={`${Math.round(res.ping)}`} unit="ms" />
            <Tile lbl="الواي فاي" val={res.wifi ? `${Math.round(res.wifi.median)}` : '—'} unit={res.wifi ? 'ms' : ''} />
          </View>
          <View style={[s.verdict, { backgroundColor: tBg(col + '14') }]}>
            <Text style={[s.vTitle, { color: col }]}>{res.check.title}</Text>
            <Text style={s.vWhy}>{res.check.why}</Text>
            {res.check.steps.map((t, i) => (
              <View key={i} style={s.step}>
                <Text style={[s.stepDot, { color: col }]}>•</Text>
                <Text style={s.stepTxt}>{t}</Text>
              </View>
            ))}
          </View>
          {res.check.verdict === 'wifi' && (
            <Pressable onPress={() => router.push(`/rooms/${rid}` as Href)} style={s.linkBtn}>
              <Icon name="wifi" size={16} color={C.blue} />
              <Text style={s.linkTxt}>افحص الواي فاي بالغرف</Text>
            </Pressable>
          )}
          {(res.check.verdict === 'isp' || res.check.verdict === 'unknown') && (
            <View style={s.row2}>
              <Pressable onPress={() => report(false)} style={[s.linkBtn, { flex: 1 }]}>
                <Icon name="report" size={16} color={C.blue} />
                <Text style={s.linkTxt}>انسخ تقرير للشركة</Text>
              </Pressable>
              <Pressable onPress={() => report(true)} style={[s.linkBtn, { flex: 1 }]}>
                <Icon name="share" size={16} color={C.blue} />
                <Text style={s.linkTxt}>أرسله</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* السجل */}
      {log.length > 0 && (
        <View style={s.card}>
          <Text style={s.title}>آخر الفحوصات</Text>
          {log.slice(0, 6).map((l, i) => {
            const p = Math.round((l.down / l.plan) * 100);
            const d = new Date(l.at);
            return (
              <View key={i} style={s.logRow}>
                <Text style={[s.logPct, { color: VERDICT_COL[l.verdict] }]}>{`${p}٪`}</Text>
                <Text style={s.logTxt} numberOfLines={1}>{`${Math.round(l.down)} من ${l.plan} ميقا`}</Text>
                <Text style={s.logDate}>{`${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`}</Text>
              </View>
            );
          })}
        </View>
      )}

      <Text style={s.note}>الفحص يقيس من جوالك على الواي فاي. يستهلك تقريباً ١٠٠–٥٠٠ ميقا حسب سرعتك.</Text>
    </ScrollView>
  );
}

function Tile({ lbl, val, unit }: { lbl: string; val: string; unit: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileLbl}>{lbl}</Text>
      <Text style={s.tileVal}>{val} <Text style={s.tileUnit}>{unit}</Text></Text>
    </View>
  );
}

const s = sheet({
  card: {
    backgroundColor: C.card, borderRadius: R.lg, padding: 14, gap: 12, borderWidth: 1, borderColor: tBd('#ffffff'),
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  hIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 11.5, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { flexGrow: 1, minWidth: 52, paddingHorizontal: 6, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  chipOn: { backgroundColor: '#0d9488', borderColor: '#0d9488' },
  chipTxt: { color: C.text, fontSize: 14, fontFamily: FONT.numSemi },
  chipTxtOn: { color: '#ffffff' },
  customRow: { flexDirection: 'row-reverse', gap: 8 },
  input: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.rowBg, paddingHorizontal: 12, color: C.text, textAlign: 'right' },
  smallBtn: { height: 40, paddingHorizontal: 16, borderRadius: 12, backgroundColor: tBg('#e3f6f1'), alignItems: 'center', justifyContent: 'center' },
  smallBtnTxt: { color: '#0d9488', fontSize: 13.5, fontWeight: '900' },
  btn: { height: 50, borderRadius: 16, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnTxt: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  live: { color: C.text, fontSize: 26, fontFamily: FONT.numHeavy, textAlign: 'center' },
  pct: { fontSize: 44, lineHeight: 52, fontFamily: FONT.numHeavy },
  bar: { height: 10, borderRadius: 99, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row' },
  mark: { position: 'absolute', top: -3, width: 2, height: 16, backgroundColor: C.text, opacity: 0.5, borderRadius: 1 },
  tiles: { flexDirection: 'row-reverse', gap: 6 },
  tile: { flex: 1, backgroundColor: C.rowBg, borderRadius: 12, paddingVertical: 8, alignItems: 'center', gap: 2 },
  tileLbl: { color: C.sub, fontSize: 10.5, fontWeight: '700' },
  tileVal: { color: C.text, fontSize: 16, fontFamily: FONT.numHeavy },
  tileUnit: { color: C.sub, fontSize: 9.5, fontFamily: FONT.numSemi },
  verdict: { borderRadius: 14, padding: 12, gap: 6 },
  vTitle: { fontSize: 15, fontWeight: '900', textAlign: 'right' },
  vWhy: { color: C.text, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  step: { flexDirection: 'row-reverse', gap: 6 },
  stepDot: { fontSize: 14, fontWeight: '900', lineHeight: 19 },
  stepTxt: { flex: 1, color: C.text, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  row2: { flexDirection: 'row-reverse', gap: 8 },
  linkBtn: { height: 42, borderRadius: 12, borderWidth: 1, borderColor: tBd('#bdd9fd'), backgroundColor: tBg('#eef4ff'), flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  linkTxt: { color: C.blue, fontSize: 13, fontWeight: '900' },
  logRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 4 },
  logPct: { width: 52, fontSize: 15, fontFamily: FONT.numHeavy, textAlign: 'right' },
  logTxt: { flex: 1, color: C.text, fontSize: 12.5, textAlign: 'right' },
  logDate: { color: C.muted, fontSize: 11, fontFamily: FONT.num },
  note: { color: C.muted, fontSize: 11, textAlign: 'center', lineHeight: 17 },
});
