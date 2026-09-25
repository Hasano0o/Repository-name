import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Share, ActivityIndicator, Switch } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { GlassCard } from '../src/ui/GlassCard';
import { C } from '../src/ui/theme';
import { isLanHost } from '../src/utils/host';
import {
  runProbe, reportText, ProbeReport, probeFields, ZTE_CANDIDATES, FieldHit,
  harvestCommands, signalish, Harvest,
  deepCommandHarvest, DeepHarvest,
} from '../src/utils/probe';
import { guessApiStyle } from '../src/store/discovery';
import { ZteDriver } from '../src/drivers/zte';

export default function ProbeScreen() {
  const params = useLocalSearchParams<{ host?: string }>();
  const [host, setHost] = useState(params.host || '192.168.0.1');
  const [model, setModel] = useState('');
  const [notes, setNotes] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0, label: '' });
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState('');
  const [hits, setHits] = useState<FieldHit[] | null>(null);
  const [harv, setHarv] = useState<Harvest | null>(null);
  const [deepH, setDeepH] = useState<DeepHarvest | null>(null);
  const [deepApi, setDeepApi] = useState<string>('');

  const harvest = async () => {
    if (!isLanHost(host)) { setErr('العنوان لازم يكون داخل شبكتك المحلية'); return; }
    setErr(''); setHarv(null); setBusy(true);
    try {
      const h = await harvestCommands(host.trim(), (done, total, label) => setProg({ done, total, label }));
      setHarv(h);
    } catch (e: any) {
      setErr(e?.message || 'تعذر سحب الأوامر');
    } finally { setBusy(false); }
  };

  const deepHarvested = async () => {
    if (!harv) return;
    setErr(''); setHits(null); setBusy(true);
    try {
      const drv = new ZteDriver();
      await drv.login(host.trim(), '', pw);
      const list = signalish(harv.cmds).slice(0, 300);
      const h = await probeFields(f => drv.rawFields(f), list, 20,
        (done, total) => setProg({ done, total, label: 'فحص الأوامر المستخرجة' }));
      setHits(h);
    } catch (e: any) {
      setErr(e?.message || 'تعذر الفحص');
    } finally { setBusy(false); }
  };

  const shareHarvest = async () => {
    if (!harv) return;
    const txt = [
      '=== أوامر واجهة الراوتر ===',
      'ملفات: ' + harv.scripts.join(' | '),
      '',
      'goformId (' + harv.goforms.length + '):',
      harv.goforms.join(', '),
      '',
      'أوامر لها علاقة بالإشارة (' + signalish(harv.cmds).length + '):',
      signalish(harv.cmds).join(', '),
    ].join('\n');
    try { await Share.share({ message: txt }); } catch {}
  };

  const deepAll = async () => {
    if (!isLanHost(host)) { setErr('العنوان لازم يكون داخل شبكتك المحلية'); return; }
    setErr(''); setDeepH(null); setDeepApi(''); setBusy(true);
    try {
      const h = await deepCommandHarvest(host.trim(), (done, total, label) => setProg({ done, total, label }));
      setDeepH(h);
      setDeepApi(guessApiStyle({ paths: h.strings.paths, commands: h.cmds, goforms: h.goforms }));
    } catch (e: any) {
      setErr(e?.message || 'تعذر الحصاد العميق');
    } finally { setBusy(false); }
  };

  const shareDeep = async () => {
    if (!deepH) return;
    const txt = [
      '=== حصاد عميق شامل ===',
      'apiStyle المقترح: ' + (deepApi || 'غير معروف'),
      '',
      'ملفات مقروءة (' + deepH.scripts.length + '):',
      deepH.scripts.slice(0, 20).join('\n'),
      '',
      'chunks (' + deepH.chunkUrls.length + '):',
      deepH.chunkUrls.slice(0, 20).join('\n'),
      '',
      'source maps (' + deepH.sourceMaps.length + '):',
      deepH.sourceMaps.slice(0, 10).join('\n'),
      '',
      'goformId (' + deepH.goforms.length + '):',
      deepH.goforms.join(', '),
      '',
      'أوامر (' + deepH.cmds.length + '):',
      deepH.cmds.slice(0, 80).join(', '),
      '',
      'حقول/سلاسل إشارة (' + deepH.strings.signal.length + '):',
      deepH.strings.signal.slice(0, 80).join(', '),
      '',
      'مسارات (' + deepH.strings.paths.length + '):',
      deepH.strings.paths.slice(0, 60).join('\n'),
    ].join('\n');
    try { await Share.share({ message: txt }); } catch {}
  };

  const deep = async () => {
    if (!isLanHost(host)) { setErr('العنوان لازم يكون داخل شبكتك المحلية'); return; }
    setErr(''); setHits(null); setBusy(true);
    try {
      const drv = new ZteDriver();
      await drv.login(host.trim(), '', pw);
      const h = await probeFields(
        f => drv.rawFields(f),
        ZTE_CANDIDATES, 20,
        (done, total) => setProg({ done, total, label: 'فحص الحقول' }),
      );
      setHits(h);
    } catch (e: any) {
      setErr(e?.message || 'تعذر الفحص العميق');
    } finally { setBusy(false); }
  };

  const shareHits = async () => {
    if (!hits) return;
    const txt = '=== حقول ZTE الفعّالة ===\n' + hits.map(h => h.key + ' = ' + h.value).join('\n');
    try { await Share.share({ message: txt }); } catch {}
  };

  const start = async () => {
    if (!isLanHost(host)) { setErr('العنوان لازم يكون داخل شبكتك المحلية'); return; }
    setErr(''); setReport(null); setBusy(true);
    try {
      const r = await runProbe(host.trim(), (done, total, label) => setProg({ done, total, label }));
      setReport(r);
    } catch (e: any) {
      setErr(e?.message || 'تعذر الفحص');
    } finally { setBusy(false); }
  };

  const share = async () => {
    if (!report) return;
    try { await Share.share({ message: reportText(report, model, notes) }); } catch {}
  };

  const ok = (n: number | 'ERR') => typeof n === 'number' && n < 400;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      <GlassCard title="ساعدنا ندعم راوترك" icon="🧭" tint={C.violet} collapsible={false}>
        <Text style={s.p}>
          التطبيق بيجرب عناوين معروفة داخل راوترك ويسجّل شكل الردود، عشان نقدر نضيف دعم كامل لموديلك.
        </Text>
        <View style={s.bullets}>
          <Text style={s.li}>• ما نرفع كلمة مرور الراوتر ولا الواي فاي</Text>
          <Text style={s.li}>• ما نرفع رقم الجوال ولا الرسائل ولا IMEI</Text>
          <Text style={s.li}>• عناوين الأجهزة المتصلة (MAC) تنحذف تلقائياً</Text>
          <Text style={s.li}>• التقرير يطلع لك قدامك قبل ما ترسله — تقرأه وأنت تقرر</Text>
        </View>
        <View style={s.agreeRow}>
          <Switch value={agree} onValueChange={setAgree} trackColor={{ true: C.violet, false: C.track }} thumbColor={C.onAccent} />
          <Text style={s.agreeTxt}>موافق، ابدأ الاستكشاف</Text>
        </View>
      </GlassCard>

      <GlassCard title="بيانات الجهاز" icon="📋" tint={C.blue} collapsible={false}>
        <Text style={s.lbl}>عنوان الراوتر</Text>
        <TextInput style={s.input} value={host} onChangeText={setHost} autoCapitalize="none" keyboardType="url" placeholder="192.168.0.1" placeholderTextColor={C.muted} />
        <Text style={s.lbl}>الموديل (اختياري)</Text>
        <TextInput style={s.input} value={model} onChangeText={setModel} placeholder="مثال: ZTE MU5001" placeholderTextColor={C.muted} />
        <Text style={s.lbl}>ملاحظات (اختياري)</Text>
        <TextInput style={[s.input, s.multi]} value={notes} onChangeText={setNotes} multiline placeholder="مثال: الشركة موبايلي، الجهاز 5G" placeholderTextColor={C.muted} />
        <Pressable style={[s.btn, (!agree || busy) && s.btnOff]} disabled={!agree || busy} onPress={start}>
          {busy ? <ActivityIndicator color={C.onAccent} /> : <Text style={s.btnTxt}>ابدأ الاستكشاف</Text>}
        </Pressable>
        {busy && prog.total > 0 && (<Text style={s.prog}>{prog.done}/{prog.total} — {prog.label}</Text>)}
        {!!err && <Text style={s.err}>{err}</Text>}
      </GlassCard>

      <GlassCard title="فحص عميق (ZTE)" icon="🔬" tint={C.gold} collapsible={false}>
        <Text style={s.p}>يسجّل الدخول ويكشف أسماء الحقول اللي يدعمها راوترك فعلاً.</Text>
        <Text style={s.lbl}>كلمة مرور الراوتر</Text>
        <TextInput style={s.input} value={pw} onChangeText={setPw} secureTextEntry placeholder="••••••••" placeholderTextColor={C.muted} />
        <Pressable style={[s.btn, (!pw || busy) && s.btnOff]} disabled={!pw || busy} onPress={deep}>
          {busy ? <ActivityIndicator color={C.onAccent} /> : <Text style={s.btnTxt}>ابدأ الفحص العميق</Text>}
        </Pressable>
        {hits && (
          <View style={{ marginTop: 10 }}>
            <Text style={s.rowTitle}>طلع {hits.length} حقل فعّال</Text>
            {hits.map((h, i2) => (
              <View key={i2} style={s.row}>
                <View style={[s.dot, { backgroundColor: C.green }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{h.key}</Text>
                  <Text style={s.rowSub}>{h.value}</Text>
                </View>
              </View>
            ))}
            <Pressable style={s.btn} onPress={shareHits}><Text style={s.btnTxt}>أرسل قائمة الحقول</Text></Pressable>
          </View>
        )}
      </GlassCard>

      <GlassCard title="سحب أوامر الواجهة" icon="🧬" tint={C.blue} collapsible={false}>
        <Text style={s.p}>يقرأ ملفات واجهة الراوتر ويستخرج أسماء الأوامر الحقيقية اللي يستخدمها.</Text>
        <Pressable style={[s.btn, busy && s.btnOff]} disabled={busy} onPress={harvest}>
          {busy ? <ActivityIndicator color={C.onAccent} /> : <Text style={s.btnTxt}>اسحب الأوامر</Text>}
        </Pressable>
        {harv && (
          <View style={{ marginTop: 10 }}>
            <Text style={s.rowTitle}>{harv.cmds.length} أمر · منها {signalish(harv.cmds).length} للإشارة · {harv.goforms.length} goformId</Text>
            <Text style={s.rowSub}>{signalish(harv.cmds).slice(0, 40).join('، ')}</Text>
            <Pressable style={[s.btn, (!pw || busy) && s.btnOff]} disabled={!pw || busy} onPress={deepHarvested}>
              <Text style={s.btnTxt}>جرّبها على الراوتر</Text>
            </Pressable>
            <Pressable style={s.btn} onPress={shareHarvest}><Text style={s.btnTxt}>أرسل قائمة الأوامر</Text></Pressable>
          </View>
        )}
      </GlassCard>

      <GlassCard title="حصاد عميق شامل" icon="🛰️" tint={C.violet} collapsible={false}>
        <Text style={s.p}>
          يقرأ كل ملفات JS الظاهرة، يمشي على webpack chunks، ويجرّب source maps — ويجمع أوامر ومسارات وسلاسل إشارة منظّفة.
        </Text>
        <Pressable style={[s.btn, busy && s.btnOff]} disabled={busy} onPress={deepAll}>
          {busy ? <ActivityIndicator color={C.onAccent} /> : <Text style={s.btnTxt}>ابدأ الحصاد العميق</Text>}
        </Pressable>
        {deepH && (
          <View style={{ marginTop: 12, gap: 8 }}>
            <View style={s.statRow}>
              <View style={s.statBox}>
                <Text style={s.statNum}>{deepH.scripts.length}</Text>
                <Text style={s.statLbl}>ملفات</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statNum}>{deepH.chunkUrls.length}</Text>
                <Text style={s.statLbl}>chunks</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statNum}>{deepH.sourceMaps.length}</Text>
                <Text style={s.statLbl}>source maps</Text>
              </View>
            </View>
            <View style={s.statRow}>
              <View style={s.statBox}>
                <Text style={s.statNum}>{deepH.cmds.length}</Text>
                <Text style={s.statLbl}>أوامر</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statNum}>{deepH.goforms.length}</Text>
                <Text style={s.statLbl}>goformId</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statNum}>{deepH.strings.signal.length}</Text>
                <Text style={s.statLbl}>حقول إشارة</Text>
              </View>
            </View>
            <View style={s.apiRow}>
              <Text style={s.apiLbl}>apiStyle المقترح</Text>
              <Text style={s.apiVal}>{deepApi || 'غير معروف'}</Text>
            </View>
            {deepH.strings.signal.length > 0 && (
              <View>
                <Text style={s.sectionTitle}>أبرز حقول الإشارة</Text>
                <Text style={s.sectionBody}>
                  {deepH.strings.signal.slice(0, 60).join('، ')}
                </Text>
              </View>
            )}
            {deepH.chunkUrls.length > 0 && (
              <View>
                <Text style={s.sectionTitle}>chunks مكتشفة</Text>
                <Text style={s.sectionBody}>
                  {deepH.chunkUrls.slice(0, 12).join('\n')}
                </Text>
              </View>
            )}
            {deepH.sourceMaps.length > 0 && (
              <View>
                <Text style={s.sectionTitle}>source maps متاحة</Text>
                <Text style={s.sectionBody}>
                  {deepH.sourceMaps.slice(0, 8).join('\n')}
                </Text>
              </View>
            )}
            <Pressable style={s.btn} onPress={shareDeep}><Text style={s.btnTxt}>أرسل التقرير الكامل</Text></Pressable>
            <Text style={s.note}>
              يُحفظ في الذاكرة المحلية تلقائياً — البصمة ونمط الـ API فقط، بدون أي بيانات حساسة.
            </Text>
          </View>
        )}
      </GlassCard>

      {report && (
        <GlassCard title="النتيجة" icon="🧪" tint={C.green} collapsible={false}>
          <View style={s.guessRow}>
            <Text style={s.guessLbl}>التخمين</Text>
            <Text style={s.guessVal}>{report.guess}</Text>
          </View>
          {report.hints.map((h, i) => <Text key={i} style={s.hint}>! {h}</Text>)}
          {report.steps.map((st, i) => (
            <View key={i} style={s.row}>
              <View style={[s.dot, { backgroundColor: ok(st.status) && st.size > 0 ? C.green : C.track }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{st.label}</Text>
                <Text style={s.rowSub}>{String(st.status)} · {st.ms}ms · {st.size} حرف{st.title ? ' · ' + st.title : ''}</Text>
              </View>
            </View>
          ))}
          <Pressable style={s.btn} onPress={share}><Text style={s.btnTxt}>أرسل التقرير</Text></Pressable>
          <Text style={s.note}>يفتح لك قائمة المشاركة — أرسله لنفسك بتيليجرام أو لأي مكان تحب.</Text>
        </GlassCard>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 14, gap: 12, paddingBottom: 40 },
  p: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  bullets: { marginTop: 8, gap: 4 },
  li: { color: C.text, fontSize: 12.5, textAlign: 'right' },
  agreeRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 12 },
  agreeTxt: { color: C.text, fontWeight: '700', fontSize: 13.5 },
  lbl: { color: C.sub, fontSize: 12, marginTop: 10, marginBottom: 4, textAlign: 'right' },
  input: {
    backgroundColor: C.rowBg, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder,
    paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14, textAlign: 'right',
  },
  multi: { minHeight: 64, textAlignVertical: 'top' },
  btn: { backgroundColor: C.violet, borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  btnOff: { opacity: 0.45 },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 15 },
  prog: { color: C.sub, fontSize: 12, textAlign: 'center', marginTop: 8 },
  err: { color: C.red, fontSize: 12.5, textAlign: 'center', marginTop: 8 },
  guessRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  guessLbl: { color: C.sub, fontSize: 12.5 },
  guessVal: { color: C.text, fontWeight: '800', fontSize: 15 },
  hint: { color: C.gold, fontSize: 12, textAlign: 'right', marginBottom: 6 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: C.cardBorder },
  dot: { width: 9, height: 9, borderRadius: 5 },
  rowTitle: { color: C.text, fontWeight: '700', fontSize: 13, textAlign: 'right' },
  rowSub: { color: C.muted, fontSize: 11, textAlign: 'right' },
  note: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 8 },
  statRow: { flexDirection: 'row-reverse', gap: 8 },
  statBox: { flex: 1, backgroundColor: C.rowBg, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, paddingVertical: 8, alignItems: 'center' },
  statNum: { color: C.text, fontWeight: '800', fontSize: 18 },
  statLbl: { color: C.muted, fontSize: 11, marginTop: 2 },
  apiRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.rowBg, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 12, paddingVertical: 10 },
  apiLbl: { color: C.sub, fontSize: 12.5 },
  apiVal: { color: C.violet, fontWeight: '800', fontSize: 14 },
  sectionTitle: { color: C.text, fontWeight: '800', fontSize: 12.5, textAlign: 'right', marginTop: 6, marginBottom: 4 },
  sectionBody: { color: C.sub, fontSize: 11.5, textAlign: 'right', lineHeight: 18 },
});
