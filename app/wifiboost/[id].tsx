/**
 * «سرّع واي فايك» (حسن ٢٣ نوفمبر — للألياف وأي راوتر): فحص بضغطة ← وش اللي يبطّئ الواي فاي ← الحل.
 * يشتغل بدون دخول (البنق للراوتر + قوة الواي فاي من الجوال لو أندرويد فيه البناء الجديد)،
 * ولو الراوتر مضاف ويدعم: قنواته وشبكاته ← تصليح بضغطة (شغّل 5 جيجا · افصل الشبكتين · أنظف قناة).
 * قِس السرعة قبل وبعد عشان العضو يشوف الفرق. المنطق: src/utils/wifiBoost.ts
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { router, useLocalSearchParams, Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { measureWifi } from '../../src/utils/latency';
import { quickDownload } from '../../src/utils/speedtest';
import { findGateway } from '../../src/services/gateway';
import { readWifi } from '../../modules/bandly-cell/src';
import { boostCheck, BoostInput, BoostItem, BoostFix, BOOST_TIPS, splitName } from '../../src/utils/wifiBoost';
import { Icon } from '../../src/ui/Icon';
import { C, R, S, tBg, tBd } from '../../src/ui/theme';
import { sheet } from '../../src/i18n';

const LV_COL = { ok: '#12b76a', warn: '#f79009', bad: '#e5484d' } as const;
const errMsg = (e: unknown) => String((e as any)?.message ?? e);
const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

export default function WifiBoost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rid = String(id || 'none');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [items, setItems] = useState<BoostItem[] | null>(null);
  const [input, setInput] = useState<BoostInput | null>(null);
  const [fixing, setFixing] = useState<BoostFix | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [speedBusy, setSpeedBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const check = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      setStep('ندوّر على الراوتر…');
      const host = await findGateway(rid);
      setStep('نقيس الواي فاي…');
      const w = host ? await measureWifi(host, 10).catch(() => null) : null;
      const ph = readWifi();
      const plan = Number(await AsyncStorage.getItem(`bandly.fiberPlan.${rid}`).catch(() => null)) || undefined;
      const inp: BoostInput = {
        lan: w && w.samples > 0 ? { median: w.median, jitter: w.jitter, lossPct: w.lossPct, samples: w.samples } : null,
        phone: ph?.connected ? { rssi: ph.rssi, frequency: ph.frequency, linkSpeed: ph.linkSpeed } : null,
        plan,
      };
      // إعدادات الراوتر لو مضاف (قراءة بس)
      const r = rid !== 'none' ? await getRouter(rid).catch(() => null) : null;
      if (r) {
        setStep('نقرأ إعدادات الواي فاي من الراوتر…');
        const got = await withSession(r, async d => {
          const [radios, ex] = await Promise.all([
            d.getWifiRadios ? d.getWifiRadios().catch(() => null) : Promise.resolve(null),
            d.getExtras ? d.getExtras().catch(() => null) : Promise.resolve(null),
          ]);
          return { radios, ex, can: { channel: !!d.setWifiChannel, rename: !!d.setWifiNames, bandOn: !!d.setBandOn } };
        }, false).catch(() => null);
        if (got) {
          if (got.radios?.length) inp.radios = got.radios.map(x => ({ band: x.band, channel: x.channel }));
          if (got.ex?.bands?.length) inp.bands = got.ex.bands;
          if (got.ex?.wifiNets?.length) inp.nets = got.ex.wifiNets.map(n => ({ index: n.index, band: n.band, name: n.name }));
          inp.can = got.can;
        }
      }
      if (!alive.current) return;
      setInput(inp);
      setItems(boostCheck(inp));
      if (!host && !inp.phone) Alert.alert('ما لقينا الراوتر', 'تأكد إن جوالك متصل بواي فاي البيت (مو بيانات الجوال) وأعد الفحص.');
    } finally {
      if (alive.current) { setBusy(false); setStep(''); }
    }
  }, [busy, rid]);

  // يبدأ الفحص لحاله أول ما تنفتح الشاشة
  const first = useRef(false);
  useEffect(() => { if (!first.current) { first.current = true; check(); } }, [check]);

  const speed = async () => {
    if (speedBusy) return;
    setSpeedBusy(true);
    try {
      const d = await quickDownload(6000);
      if (!alive.current) return;
      if (before === null) setBefore(d.mbps); else setAfter(d.mbps);
    } catch (e) {
      Alert.alert('فشل القياس', errMsg(e));
    } finally {
      if (alive.current) setSpeedBusy(false);
    }
  };

  const doFix = async (fx: BoostFix) => {
    if (fx === 'channel') { if (rid !== 'none') router.push(`/wifich/${rid}` as Href); return; }
    if (fx === 'rooms') { router.push(`/rooms/${rid}` as Href); return; }
    if (fx === 'connect5') {
      if (Platform.OS === 'android') Linking.sendIntent('android.settings.WIFI_SETTINGS').catch(() => Linking.openSettings());
      else Alert.alert('اتصل بشبكة 5 جيجا', 'افتح الإعدادات ← Wi‑Fi واختار شبكة 5 جيجا (غالباً في اسمها 5G).');
      return;
    }
    if (fx === 'closer') { Alert.alert('قرّب من الراوتر', 'جرّب جنب الراوتر وأعد الفحص — لو تحسّن، فالمشكلة المسافة. ارفع الراوتر ووسّطه في البيت.'); return; }
    if (fx === 'reboot') { Alert.alert('أعد تشغيل الراوتر', 'كثير مرات يختار قناة أنظف لحاله بعد إعادة التشغيل. بعدها أعد الفحص.'); return; }
    const r = rid !== 'none' ? await getRouter(rid).catch(() => null) : null;
    if (!r) return;
    const run = async (fn: () => Promise<void>, done: string) => {
      setFixing(fx);
      try {
        await fn();
        Alert.alert('تم ✓', done);
        check();
      } catch (e) {
        Alert.alert('ما تغيّر شي', errMsg(e));
      } finally {
        if (alive.current) setFixing(null);
      }
    };
    if (fx === 'enable5') {
      Alert.alert('نشغّل 5 جيجا؟', 'الراوتر بيفعّل شبكة 5 جيجا. ممكن ينقطع الواي فاي ثواني.', [
        { text: 'لا', style: 'cancel' },
        { text: 'شغّلها', onPress: () => run(() => withSession(r, d => d.setBandOn!('5', true), false), 'شبكة 5 جيجا اشتغلت — اتصل فيها من إعدادات الواي فاي.') },
      ]);
      return;
    }
    if (fx === 'split') {
      const n5 = input?.nets?.find(n => n.band === '5');
      if (!n5) return;
      const nm = splitName(n5.name);
      Alert.alert('نفصل الشبكتين؟', `شبكة 5 جيجا بيصير اسمها «${nm}» بنفس كلمة المرور. كل الأجهزة اللي عليها بتنفصل وتحتاج تتصل فيها من جديد.`, [
        { text: 'لا', style: 'cancel' },
        { text: 'افصلها', onPress: () => run(() => withSession(r, d => d.setWifiNames!([{ index: n5.index, name: nm }]), false), `اتصل الحين بـ «${nm}» بنفس كلمة المرور.`) },
      ]);
    }
  };

  const bad = items?.filter(x => x.level !== 'ok').length ?? 0;
  const gain = before && after ? Math.round(((after - before) / Math.max(1, before)) * 100) : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, paddingBottom: 40, gap: 12 }}>
      {/* الملخص */}
      <LinearGradient colors={['#2f6bff', '#6a4cff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.hero}>
        <View style={s.heroIcon}><Icon name="wifi" size={24} color="#ffffff" /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.heroTitle}>{busy ? 'نفحص الواي فاي…' : items === null ? 'سرّع واي فايك' : !items.length ? 'ما قدرنا نفحص الواي فاي' : bad ? `لقينا ${bad} أشياء تبطّئ الواي فاي` : 'الواي فاي عندك تمام 👌'}</Text>
          <Text style={s.heroSub}>{busy ? step : items !== null && !items.length ? 'تأكد إن جوالك على واي فاي البيت واضغط «أعد الفحص»' : 'نفحص وش يبطّئ الواي فاي في بيتك ونصلّحه'}</Text>
        </View>
        {busy && <ActivityIndicator color="#ffffff" />}
      </LinearGradient>

      {/* قبل وبعد */}
      <View style={s.card}>
        <Text style={s.title}>السرعة قبل وبعد</Text>
        <View style={s.tiles}>
          <View style={s.tile}><Text style={s.tileLbl}>قبل</Text><Text style={s.tileVal}>{before !== null ? fmt(before) : '—'}</Text><Text style={s.tileUnit}>Mbps</Text></View>
          <View style={s.tile}><Text style={s.tileLbl}>بعد</Text><Text style={s.tileVal}>{after !== null ? fmt(after) : '—'}</Text><Text style={s.tileUnit}>Mbps</Text></View>
        </View>
        {gain !== null && (
          <Text style={[s.gain, { color: gain > 5 ? '#12b76a' : C.sub }]}>{gain > 5 ? `أسرع بـ ${gain}٪ 🎉` : 'نفس السرعة تقريباً'}</Text>
        )}
        <Pressable onPress={speed} disabled={speedBusy} style={s.linkBtn}>
          {speedBusy ? <ActivityIndicator size="small" color={C.blue} /> : <Icon name="speed" size={16} color={C.blue} />}
          <Text style={s.linkTxt}>{before === null ? 'قِس السرعة الحين (قبل)' : 'قِس بعد التصليح'}</Text>
        </Pressable>
      </View>

      {/* النتائج */}
      {items?.map(it => (
        <View key={it.key} style={[s.card, s.item, { borderColor: tBd(LV_COL[it.level] + '55') }]}>
          <View style={s.itemHead}>
            <View style={[s.dot, { backgroundColor: LV_COL[it.level] }]} />
            <Text style={[s.itemTitle, { color: it.level === 'ok' ? C.text : LV_COL[it.level] }]}>{it.title}</Text>
          </View>
          <Text style={s.itemWhy}>{it.why}</Text>
          {!!it.fix && it.level !== 'ok' && (it.fix !== 'channel' || rid !== 'none') && (
            <Pressable onPress={() => doFix(it.fix!)} disabled={!!fixing}
              style={[s.fixBtn, { backgroundColor: tBg(LV_COL[it.level] + '18'), borderColor: tBd(LV_COL[it.level] + '66') }]}>
              {fixing === it.fix ? <ActivityIndicator size="small" color={LV_COL[it.level]} /> : <Icon name="spark" size={15} color={LV_COL[it.level]} />}
              <Text style={[s.fixTxt, { color: LV_COL[it.level] }]}>{it.fixLabel ?? 'وش أسوي؟'}</Text>
            </Pressable>
          )}
        </View>
      ))}
      {items !== null && rid === 'none' && (
        <Text style={s.note}>تبي نصلّح بضغطة (قناة الواي فاي، شبكة 5 جيجا)؟ أضف راوترك في Bandly بكلمة الملصق.</Text>
      )}

      {/* نصائح ثابتة */}
      {items !== null && (
        <View style={[s.card, { backgroundColor: tBg('#eef4ff'), borderColor: tBd('#bdd9fd') }]}>
          <View style={s.itemHead}>
            <Icon name="bulb" size={18} color={C.blue} />
            <Text style={s.title}>وبعد</Text>
          </View>
          {BOOST_TIPS.map((t, i) => (
            <View key={i} style={s.step}>
              <Text style={[s.stepDot, { color: C.blue }]}>•</Text>
              <Text style={s.stepTxt}>{t}</Text>
            </View>
          ))}
        </View>
      )}

      {items !== null && (
        <Pressable onPress={check} disabled={busy} style={s.linkBtn}>
          <Icon name="refresh" size={16} color={C.blue} />
          <Text style={s.linkTxt}>أعد الفحص</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const s = sheet({
  hero: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderRadius: R.lg, padding: 16 },
  heroIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#ffffff26', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: '#ffffff', fontSize: 16, fontWeight: '900', textAlign: 'right' },
  heroSub: { color: '#ffffffd9', fontSize: 12, textAlign: 'right' },
  card: {
    backgroundColor: C.card, borderRadius: R.lg, padding: 14, gap: 10, borderWidth: 1, borderColor: tBd('#ffffff'),
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  title: { color: C.text, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  tiles: { flexDirection: 'row-reverse', gap: 8 },
  tile: { flex: 1, backgroundColor: C.rowBg, borderRadius: 12, paddingVertical: 8, alignItems: 'center' },
  tileLbl: { color: C.sub, fontSize: 11, fontWeight: '700' },
  tileVal: { color: C.text, fontSize: 22, fontWeight: '900' },
  tileUnit: { color: C.sub, fontSize: 10, fontWeight: '700' },
  gain: { fontSize: 14, fontWeight: '900', textAlign: 'center' },
  item: { gap: 6 },
  itemHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  itemTitle: { flex: 1, fontSize: 14.5, fontWeight: '900', textAlign: 'right' },
  itemWhy: { color: C.text, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  fixBtn: { height: 40, borderRadius: 12, borderWidth: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  fixTxt: { fontSize: 13.5, fontWeight: '900' },
  linkBtn: { height: 42, borderRadius: 12, borderWidth: 1, borderColor: tBd('#bdd9fd'), backgroundColor: tBg('#eef4ff'), flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  linkTxt: { color: C.blue, fontSize: 13, fontWeight: '900' },
  step: { flexDirection: 'row-reverse', gap: 6 },
  stepDot: { fontSize: 14, fontWeight: '900', lineHeight: 19 },
  stepTxt: { flex: 1, color: C.text, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  note: { color: C.muted, fontSize: 11.5, textAlign: 'center', lineHeight: 17 },
});
