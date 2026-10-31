/**
 * أدوات الراوتر: الأنتنا الداخلية/الخارجية · رصيد الباقة (USSD) · بنق من الراوتر نفسه.
 * هواوي + FiberHome الجديد (الأنتنا بس — أوضاعه من الدرايفر: ant.options).
 * كل قسم يظهر بس لو الدرايفر يدعمه.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { ScrollView, View, Text, TextInput, Pressable } from '../../src/i18n/rn';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession, routerWrite } from '../../src/store/sessions';
import { AntennaInfo, RouterPingResult } from '../../src/drivers/types';
import { C, tBg, tFg } from '../../src/ui/theme';
import { GlassCard } from '../../src/ui/GlassCard';
import { sheet } from '../../src/i18n';

const MODES: { v: number; label: string; sub: string }[] = [
  { v: 3, label: 'تلقائي', sub: 'الراوتر يختار' },
  { v: 0, label: 'داخلية', sub: 'بدون أنتنا خارجية' },
  { v: 1, label: 'خارجية', sub: 'المنفذين' },
  { v: 2, label: 'خارجية ١', sub: 'منفذ واحد' },
];
const modeName = (m?: number) => MODES.find(x => x.v === m)?.label ?? 'غير معروف';
const USSD_KEY = (id: string) => `bandly.ussd.${id}`;

export default function HuaweiTools() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ant, setAnt] = useState<AntennaInfo | null>(null);
  const [antBusy, setAntBusy] = useState(false);
  const [code, setCode] = useState('');
  const [ussdBusy, setUssdBusy] = useState(false);
  const [ussdReply, setUssdReply] = useState('');
  const [pingHost, setPingHost] = useState('8.8.8.8');
  const [pingBusy, setPingBusy] = useState(false);
  const [ping, setPing] = useState<RouterPingResult | null>(null);
  const [pingErr, setPingErr] = useState('');
  const [has, setHas] = useState({ ussd: false, ping: false });

  const load = useCallback(async (r: SavedRouter) => {
    const [a, h] = await withSession(r, async d => [d.getAntenna ? await d.getAntenna() : null, { ussd: !!d.ussd, ping: !!d.routerPing }] as const);
    setAnt(a);
    setHas(h);
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setErr('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try { const c = await AsyncStorage.getItem(USSD_KEY(r.id)); if (c) setCode(c); } catch {}
      try { await load(r); } catch (e: any) { if (alive) setErr(e?.message ?? String(e)); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, load]));

  const changeAnt = (m: number) => {
    if (!info || !ant || antBusy || ant.mode === m) return;
    Alert.alert('تغيير الأنتنا', `بنحوّل الراوتر على «${modeName(m)}». ممكن النت يتقطع ثواني.\n\nلو اخترت «خارجية» وما فيه أنتنا موصّلة، الإشارة بتضعف — رجّعها «تلقائي».`, [
      { text: 'لا', style: 'cancel' },
      { text: 'غيّر', onPress: async () => {
        setAntBusy(true);
        try {
          await routerWrite(info, d => d.setAntenna!(m), { label: 'تغيير الأنتنا' });
          await new Promise(r => setTimeout(r, 2500));
          await load(info);
        } catch (e: any) {
          Alert.alert('ما تغيّر', 'الراوتر رفض التغيير — غالباً موديلك يقرا الأنتنا بس وما يسمح بتبديلها.\n\n' + (e?.message ?? ''));
        } finally { setAntBusy(false); }
      } },
    ]);
  };

  const sendUssd = async () => {
    if (!info || ussdBusy) return;
    const c = code.trim();
    if (!/^[*#0-9]{2,30}$/.test(c)) { Alert.alert('الكود', 'اكتب كود مثل *xxx# (أرقام و * و # بس)'); return; }
    setUssdBusy(true); setUssdReply('');
    try {
      try { await AsyncStorage.setItem(USSD_KEY(info.id), c); } catch {}
      const rep = await withSession(info, d => d.ussd!(c));
      setUssdReply(rep);
    } catch (e: any) {
      setUssdReply('⚠️ ' + (e?.message ?? 'ما وصل رد'));
    } finally { setUssdBusy(false); }
  };

  const runPing = async () => {
    if (!info || pingBusy) return;
    const h = pingHost.trim();
    if (!/^[a-z0-9.\-]{3,80}$/i.test(h)) { setPingErr('اكتب عنوان صحيح مثل 8.8.8.8'); return; }
    setPingBusy(true); setPing(null); setPingErr('');
    try { setPing(await withSession(info, d => d.routerPing!(h))); }
    catch (e: any) { setPingErr(e?.message ?? 'ما قدرنا'); }
    finally { setPingBusy(false); }
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.blue} /></View>;
  if (!info || (info.driverId !== 'huawei-lte' && info.driverId !== 'fiberhome')) {
    return <View style={s.center}><Text style={s.p}>{err || 'هذي الأدوات لراوترات هواوي و FiberHome بس.'}</Text></View>;
  }
  const modes = ant?.options ?? MODES;
  const nameOf = (m?: number) => { const o = modes.find(x => x.v === m); return o ? (o.sub && ant?.options ? `${o.label} (${o.sub})` : o.label) : 'غير معروف'; };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      {!!err && <Text style={s.err}>{err}</Text>}

      <GlassCard title="الأنتنا" icon="📡" tint="#f97316" collapsible={false}>
        {!ant ? (
          <Text style={s.p}>موديلك ما يعطي معلومات الأنتنا.</Text>
        ) : (
          <>
            <Text style={s.p}>
              الراوتر شغّال على: <Text style={s.strong}>{nameOf(ant.mode)}</Text>
            </Text>
            <Text style={s.hint}>ركّبت أنتنا خارجية؟ تأكد إنها على «خارجية» أو «تلقائي» — بعض الراوترات تبقى على الداخلية وكأن الأنتنا مو موجودة.</Text>
            {ant.canSet && (
              <View style={s.modes}>
                {modes.map(m => {
                  const on = ant.mode === m.v;
                  return (
                    <Pressable key={m.v} style={[s.mode, on && s.modeOn]} disabled={antBusy} onPress={() => changeAnt(m.v)}>
                      <Text style={[s.modeTxt, on && s.modeTxtOn]}>{m.label}</Text>
                      <Text style={[s.modeSub, on && s.modeTxtOn]}>{m.sub}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {antBusy && <ActivityIndicator color={C.blue} style={{ marginTop: 8 }} />}
            {ant.raw.length > 0 && (
              <Text style={s.raw}>{ant.raw.map(([k, v]) => `${k}: ${v}`).join('  ·  ')}</Text>
            )}
          </>
        )}
      </GlassCard>

      {has.ussd && (
      <GlassCard title="رصيد الباقة" icon="💳" tint="#16a34a" collapsible={false}>
        <Text style={s.p}>اكتب كود الاستعلام (USSD) حق شركتك — يترسل من شريحة الراوتر ويطلع الرد هنا.</Text>
        <TextInput
          style={s.input}
          value={code}
          onChangeText={setCode}
          placeholder="*xxx#"
          placeholderTextColor={C.sub}
          keyboardType="phone-pad"
          autoCorrect={false}
        />
        <Pressable style={[s.btn, { backgroundColor: tBg('#16a34a') }, ussdBusy && s.off]} disabled={ussdBusy} onPress={sendUssd}>
          {ussdBusy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>أرسل</Text>}
        </Pressable>
        {!!ussdReply && <Text style={s.reply}>{ussdReply}</Text>}
        <Text style={s.hint}>نحفظ آخر كود على جوالك بس. الرد ما يطلع من الجوال.</Text>
      </GlassCard>
      )}

      {has.ping && (
      <GlassCard title="بنق من الراوتر نفسه" icon="📶" tint="#2f6bff" collapsible={false}>
        <Text style={s.p}>الراوتر يقيس البنق بنفسه — بدون الواي فاي. لو هنا منخفض وفي اللعبة عالي ← المشكلة من الواي فاي مو من الشبكة.</Text>
        <TextInput style={s.input} value={pingHost} onChangeText={setPingHost} autoCapitalize="none" autoCorrect={false} />
        <Pressable style={[s.btn, { backgroundColor: tBg('#2f6bff') }, pingBusy && s.off]} disabled={pingBusy} onPress={runPing}>
          {pingBusy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>قِس</Text>}
        </Pressable>
        {!!pingErr && <Text style={s.err}>{pingErr}</Text>}
        {ping && (
          <>
            <Text style={[s.big, { color: ping.ok ? tFg('#16a34a') : tFg('#dc2626') }]}>
              {ping.ms !== undefined ? `${Math.round(ping.ms)} ms` : ping.ok ? 'وصل ✓' : 'ما وصل'}
            </Text>
            {ping.raw.length > 0 && <Text style={s.raw}>{ping.raw.map(([k, v]) => `${k}: ${v}`).join('  ·  ')}</Text>}
          </>
        )}
      </GlassCard>
      )}
    </ScrollView>
  );
}

const s = sheet({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.bg },
  p: { color: C.text, fontSize: 14, lineHeight: 22, textAlign: 'right' },
  strong: { fontWeight: '900', color: C.text },
  hint: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right', marginTop: 8 },
  err: { color: tFg('#dc2626'), fontSize: 13, textAlign: 'right', marginTop: 6 },
  raw: { color: C.sub, fontSize: 11, textAlign: 'right', marginTop: 10, writingDirection: 'ltr' },
  modes: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  mode: { flexBasis: '47%', flexGrow: 1, borderRadius: 14, borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: C.rowBg, paddingVertical: 10, alignItems: 'center' },
  modeOn: { backgroundColor: tBg('#f97316'), borderColor: tBg('#f97316') },
  modeTxt: { color: C.text, fontWeight: '800', fontSize: 14 },
  modeSub: { color: C.sub, fontSize: 11.5, marginTop: 2 },
  modeTxtOn: { color: '#fff' },
  input: { borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: C.rowBg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 16, textAlign: 'center', marginTop: 10 },
  btn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  off: { opacity: 0.6 },
  reply: { color: C.text, fontSize: 14, lineHeight: 22, textAlign: 'right', marginTop: 12, backgroundColor: C.rowBg, borderRadius: 12, padding: 12 },
  big: { fontSize: 28, fontWeight: '900', textAlign: 'center', marginTop: 12 },
});
