/**
 * «اشحن رصيدك» (١٦ نوفمبر — فكرة حسن): شحن شريحة الراوتر ببطاقة الشحن من التطبيق + «كم رصيدي؟».
 * الكود يترسل من شريحة الراوتر: USSD لو الدرايفر يدعمه (هواوي)، وإلا SMS للشركة اللي نعرف رقمها الرسمي (STC ← 1500)
 * ونلقط ردها من رسائل الراوتر. الأكواد ومنطقها في src/utils/recharge.ts (عليها اختبارات).
 * رقم البطاقة ما ينحفظ ولا يطلع من الجوال إلا للراوتر نفسه.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { ScrollView, View, Text, TextInput, Pressable } from '../../src/i18n/rn';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { C, tBg, tFg } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { LabelScannerHost, ensureScanner } from '../../src/ui/scanner';
import { ocrAvailable } from '../../modules/bandly-cell/src';
import { sheet } from '../../src/i18n';
import {
  Carrier, CARRIER_NAME, carrierOf, cleanCard, cardOk, idOk, cardFromLines,
  rechargeUssd, balanceUssd, rechargeSms, REPLY_FROM, maskCard,
} from '../../src/utils/recharge';

const CARRIERS: Carrier[] = ['stc', 'zain', 'mobily'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function Recharge() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [carrier, setCarrier] = useState<Carrier | null>(null);
  const [detected, setDetected] = useState(false);
  const [has, setHas] = useState({ ussd: false, sms: false });
  const [card, setCard] = useState('');
  const [nid, setNid] = useState('');
  const [busy, setBusy] = useState('');
  const [reply, setReply] = useState('');
  const [scanning, setScanning] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setErr('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try {
        const res = await withSession(r, async d => {
          const net = d.getNetworkInfo ? await d.getNetworkInfo().catch(() => null) : null;
          const det = !net?.operator && d.getDeviceDetails ? await d.getDeviceDetails().catch(() => null) : null;
          return { op: net?.operator || det?.operator || '', ussd: !!d.ussd, sms: !!d.sendSms && !!d.listSms };
        });
        if (!alive) return;
        const c = carrierOf(res.op);
        if (c) { setCarrier(c); setDetected(true); }
        setHas({ ussd: res.ussd, sms: res.sms });
      } catch (e: any) { if (alive) setErr(e?.message ?? String(e)); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]));

  const c = cleanCard(card);
  const smsRoute = carrier ? rechargeSms(carrier, c) : null;
  const canRecharge = has.ussd || (has.sms && !!smsRoute);

  /** نرسل الرسالة وننتظر رد الشركة في رسائل الراوتر (٦٠ ثانية) */
  const viaSms = async (r: SavedRouter, to: string, text: string, from: RegExp): Promise<string> => {
    return withSession(r, async d => {
      const before = new Set((await d.listSms!('inbox').catch(() => [])).map(m => m.index));
      await d.sendSms!(to, text);
      const end = Date.now() + 60_000;
      while (Date.now() < end) {
        await sleep(4000);
        const fresh = (await d.listSms!('inbox').catch(() => [])).filter(m => !before.has(m.index));
        const hit = fresh.find(m => from.test(m.phone.replace(/^\+?966/, ''))) ?? fresh[0];
        if (hit) return hit.content;
      }
      return 'انرسلت الرسالة ✓ بس رد الشركة ما وصل خلال دقيقة — شيك «الرسائل» بعد شوي.';
    });
  };

  const doRecharge = () => {
    if (!info || !carrier || busy) return;
    if (!cardOk(c)) { Alert.alert('رقم البطاقة', 'اكتب رقم البطاقة كامل (الأرقام اللي تحت الخدش) — عادة ١٢ إلى ١٨ رقم.'); return; }
    if (carrier === 'mobily' && nid && !idOk(cleanCard(nid))) { Alert.alert('رقم الهوية', 'رقم الهوية أو الإقامة ١٠ أرقام ويبدأ بـ 1 أو 2 — أو خلّه فاضي.'); return; }
    const id10 = carrier === 'mobily' && nid ? cleanCard(nid) : undefined;
    const how = has.ussd ? `الكود ${rechargeUssd(carrier, maskCard(c), id10 ? '••••' + id10.slice(-2) : undefined)}` : `رسالة إلى ${smsRoute!.to}`;
    Alert.alert('نشحن الحين؟',
      `بنشحن شريحة الراوتر (${CARRIER_NAME[carrier]}) بالبطاقة ${maskCard(c)}.\nبنرسل ${how} من شريحة الراوتر.`,
      [
        { text: 'لا', style: 'cancel' },
        { text: 'اشحن', onPress: async () => {
          setBusy('نشحن… ننتظر رد الشركة'); setReply('');
          try {
            const rep = has.ussd
              ? await withSession(info, d => d.ussd!(rechargeUssd(carrier, c, id10)))
              : await viaSms(info, smsRoute!.to, smsRoute!.text, REPLY_FROM[carrier]);
            setReply(rep || 'انرسل ✓ — الشركة ما رجّعت نص.');
            setCard('');
          } catch (e: any) {
            setReply('⚠️ ' + (e?.message ?? 'ما وصل رد'));
          } finally { setBusy(''); }
        } },
      ]);
  };

  const doBalance = async () => {
    if (!info || !carrier || busy) return;
    setBusy('نسأل عن الرصيد…'); setReply('');
    try { setReply(await withSession(info, d => d.ussd!(balanceUssd(carrier))) || 'الشركة ما رجّعت نص.'); }
    catch (e: any) { setReply('⚠️ ' + (e?.message ?? 'ما وصل رد')); }
    finally { setBusy(''); }
  };

  const scan = () => { if (ensureScanner()) setScanning(true); };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;
  if (!info) return <View style={s.center}><Text style={s.p}>{err || 'الراوتر غير موجود'}</Text></View>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {!!err && <Text style={s.err}>{err}</Text>}

      <GlassCard title="اشحن رصيدك" icon="💳" tint="#16a34a" collapsible={false}>
        <Text style={s.p}>اشحن شريحة الراوتر ببطاقة شحن — الكود يترسل من الراوتر نفسه، ما تحتاج تطلع الشريحة.</Text>

        <Text style={s.lbl}>شركة الشريحة{detected ? ' ✓' : ''}</Text>
        <View style={s.chips}>
          {CARRIERS.map(x => (
            <Pressable key={x} onPress={() => setCarrier(x)} style={[s.chip, carrier === x && s.chipOn]}>
              <Text style={[s.chipTxt, carrier === x && s.chipTxtOn]}>{CARRIER_NAME[x]}</Text>
            </Pressable>
          ))}
        </View>
        {!carrier && <Text style={s.hint}>ما عرفنا شركة الشريحة من الراوتر — اخترها.</Text>}

        {!canRecharge && carrier ? (
          <Text style={[s.hint, { color: tFg('#b45309') }]}>
            {has.sms ? `راوترك يرسل رسائل بس، و${CARRIER_NAME[carrier]} شحنها بكود USSD — ما نقدر نشحنها من راوترك. اشحن من تطبيق ${CARRIER_NAME[carrier]}.` : `راوترك ما يسمح بإرسال أكواد أو رسائل من الشريحة — اشحن من تطبيق ${CARRIER_NAME[carrier]}.`}
          </Text>
        ) : (
          <>
            <Text style={s.lbl}>رقم البطاقة</Text>
            <TextInput style={s.input} value={card} onChangeText={setCard} placeholder="الأرقام اللي تحت الخدش"
              placeholderTextColor={C.sub} keyboardType="number-pad" autoCorrect={false} maxLength={30} />
            {ocrAvailable() && (
              <Pressable style={[s.btnOutline]} onPress={scan}>
                <Text style={s.btnOutlineTxt}>📷 صوّر البطاقة</Text>
              </Pressable>
            )}
            {carrier === 'mobily' && (
              <>
                <Text style={s.lbl}>رقم الهوية (لو طلبته موبايلي)</Text>
                <TextInput style={s.input} value={nid} onChangeText={setNid} placeholder="اختياري"
                  placeholderTextColor={C.sub} keyboardType="number-pad" autoCorrect={false} maxLength={12} />
              </>
            )}
            <Pressable style={[s.btn, { backgroundColor: tBg('#16a34a') }, (!!busy || !carrier || !c) && s.off]}
              disabled={!!busy || !carrier || !c} onPress={doRecharge}>
              <Text style={s.btnTxt}>اشحن</Text>
            </Pressable>
          </>
        )}

        {has.ussd && !!carrier && (
          <Pressable style={[s.btnOutline, !!busy && s.off]} disabled={!!busy} onPress={doBalance}>
            <Text style={s.btnOutlineTxt}>كم رصيدي؟ ({balanceUssd(carrier)})</Text>
          </Pressable>
        )}

        {!!busy && <View style={s.busy}><ActivityIndicator color={C.blue} /><Text style={s.hint}>{busy}</Text></View>}
        {!!reply && <Text style={s.reply}>{reply}</Text>}
        <Text style={s.hint}>رقم البطاقة ما ينحفظ، ويروح للراوتر بس.</Text>
      </GlassCard>

      <LabelScannerHost visible={scanning} mode="model" onClose={() => setScanning(false)}
        onResult={d => {
          const n = cardFromLines(d.rawLines ?? []);
          if (n) setCard(n);
          else Alert.alert('ما قرينا الرقم', 'قرّب الكاميرا من أرقام البطاقة وخل الإضاءة زينة، أو اكتبه بيدك.');
        }} />
    </ScrollView>
  );
}

const s = sheet({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.bg },
  p: { color: C.text, fontSize: 14, lineHeight: 22, textAlign: 'right' },
  lbl: { color: C.text, fontSize: 13.5, fontWeight: '800', textAlign: 'right', marginTop: 14 },
  hint: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right', marginTop: 8 },
  err: { color: tFg('#dc2626'), fontSize: 13, textAlign: 'right', marginTop: 6 },
  chips: { flexDirection: 'row-reverse', gap: 8, marginTop: 8 },
  chip: { flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: C.rowBg, paddingVertical: 10, alignItems: 'center' },
  chipOn: { backgroundColor: tBg('#16a34a'), borderColor: tBg('#16a34a') },
  chipTxt: { color: C.text, fontWeight: '800', fontSize: 14 },
  chipTxtOn: { color: '#fff' },
  input: { borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: C.rowBg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 17, textAlign: 'center', marginTop: 8, letterSpacing: 1 },
  btn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnOutline: { borderRadius: 14, paddingVertical: 11, alignItems: 'center', marginTop: 10, borderWidth: 1.5, borderColor: tBg('#16a34a') },
  btnOutlineTxt: { color: tFg('#16a34a'), fontWeight: '800', fontSize: 14 },
  off: { opacity: 0.55 },
  busy: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 12, justifyContent: 'center' },
  reply: { color: C.text, fontSize: 14, lineHeight: 22, textAlign: 'right', marginTop: 12, backgroundColor: C.rowBg, borderRadius: 12, padding: 12 },
});
