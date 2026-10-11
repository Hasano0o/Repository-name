/**
 * فنيين قريبين منك — دليل الفنيين المعتمدين (يسجّلون من البوت ويوافق عليهم المالك).
 * مدينة المستخدم أول، وبعدها باقي المدن. تواصل واتساب أو اتصال مباشر.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, StyleSheet, Linking, RefreshControl, Modal, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchTechs, sameCity, waNumber, BOT_TECH_SIGNUP, Tech, requestTech } from '../src/services/techs';
import { getCity } from '../src/services/stats';
import { P, shadow } from '../src/ui/Pro';
import { C, tBd, tBg, tFg } from '../src/ui/theme';

const NEEDS = ['تركيب أنتينا', 'توجيه الأنتينا', 'تمديد كيبل', 'فحص الإشارة'];

const AV = [['#38bdf8', '#2563eb'], ['#a78bfa', '#6d28d9'], ['#34d399', '#047857'], ['#fb923c', '#c2410c'], ['#f472b6', '#be185d']] as const;

function Stars({ r, n }: { r: number | null; n: number }) {
  if (!n || r == null) return <Text style={s.newTag}>جديد</Text>;
  return <Text style={s.stars}>★ {r.toFixed(1)} <Text style={s.starsN}>({n})</Text></Text>;
}

function TechCard({ t, i }: { t: Tech; i: number }) {
  const wa = waNumber(t.phone);
  const msg = encodeURIComponent('السلام عليكم، تواصلت معك من تطبيق Bandly بخصوص تركيب/توجيه أنتينا');
  return (
    <View style={[s.card, shadow]}>
      <View style={s.top}>
        <LinearGradient colors={AV[i % AV.length] as unknown as [string, string]} style={s.av}>
          <Text style={s.avTxt}>{(t.name || '؟').trim()[0]}</Text>
        </LinearGradient>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>{t.name}</Text>
            <Stars r={t.rating} n={t.rating_n} />
          </View>
          <Text style={s.city} numberOfLines={1}>📍 {t.city}{t.areas ? ` · ${t.areas}` : ''}</Text>
        </View>
      </View>
      {!!t.note && <Text style={s.note} numberOfLines={3}>{t.note}</Text>}
      {!!t.years && <Text style={s.years}>🧰 خبرة {t.years}</Text>}
      <View style={s.actions}>
        {wa && (
          <Pressable style={({ pressed }) => [s.waBtn, pressed && { opacity: 0.85 }]} onPress={() => Linking.openURL(`https://wa.me/${wa}?text=${msg}`).catch(() => {})}>
            <Text style={s.waTxt}>واتساب</Text>
          </Pressable>
        )}
        {!!t.phone && (
          <Pressable style={({ pressed }) => [s.callBtn, pressed && { opacity: 0.85 }]} onPress={() => Linking.openURL(`tel:${t.phone.replace(/\s/g, '')}`).catch(() => {})}>
            <Text style={s.callTxt}>اتصال</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function Techs() {
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Tech[] | null>(null);
  const [city, setCityState] = useState('');
  const [filter, setFilter] = useState<string>('');
  const [err, setErr] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<{ city: string; phone: string; name: string; needs: string[]; note: string } | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!form) return;
    const phone = form.phone.replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[^\d+]/g, '');
    if (!form.city.trim()) { Alert.alert('المدينة', 'اكتب مدينتك عشان يوصل الطلب لفنيينها.'); return; }
    if (!/^(\+?966|0)?5\d{8}$/.test(phone)) { Alert.alert('رقم الجوال', 'اكتب رقم جوال صحيح عشان الفني يتواصل معك.'); return; }
    setSending(true);
    try {
      const n = await requestTech({ city: form.city.trim(), phone, name: form.name.trim(), note: [...form.needs, form.note.trim()].filter(Boolean).join(' · ') });
      setForm(null);
      Alert.alert('✓ وصل طلبك', n
        ? `انرسل لـ ${n} ${n === 1 ? 'فني' : 'فنيين'} في ${form.city.trim()} — بيتواصلون معك على جوالك.`
        : `ما فيه فنيين مسجلين في ${form.city.trim()} للحين، بس وصل طلبك لفريق Bandly وبنحاول نوفّر لك فني.`);
    } catch (e: any) {
      Alert.alert('ما انرسل', e?.message ?? 'جرّب بعد شوي');
    } finally {
      setSending(false);
    }
  };

  const load = useCallback(async () => {
    setErr(false);
    try { setList(await fetchTechs()); } catch { setErr(true); setList([]); }
  }, []);

  useEffect(() => {
    getCity().then(c => { const v = c && c !== '-' ? c : ''; setCityState(v); setFilter(v); });
    load();
  }, [load]);

  const cities = useMemo(() => {
    const set: string[] = [];
    for (const t of list ?? []) { const c = (t.city || '').split(/[-–،,]/)[0].trim(); if (c && !set.some(x => sameCity(x, c))) set.push(c); }
    return set;
  }, [list]);

  const shown = (list ?? []).filter(t => !filter || sameCity(t.city, filter));
  const others = filter ? (list ?? []).filter(t => !sameCity(t.city, filter)) : [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <LinearGradient colors={['#0c4a6e', '#1d4ed8']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.hero}>
          <View style={s.ring} />
          <Text style={s.heroTitle}>فنيين قريبين منك</Text>
          <Text style={s.heroSub}>فنيين أنتينا معتمدين من Bandly — تركيب، توجيه، وتقوية الإشارة. تواصل معهم مباشرة.</Text>
        </LinearGradient>

        <Pressable onPress={() => setForm({ city: filter || city, phone: '', name: '', needs: [], note: '' })}
          style={({ pressed }) => [s.reqCard, pressed && { opacity: 0.9 }]}>
          <LinearGradient colors={['#12b76a', '#047857']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.reqIcon}>
            <Text style={{ fontSize: 22 }}>📨</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={s.reqTitle}>ما تبي تدوّر؟ أرسل طلب</Text>
            <Text style={s.reqSub}>يوصل لكل فنيين {filter || city || 'مدينتك'} ويتواصلون معك</Text>
          </View>
        </Pressable>

        {cities.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.filters}>
            <Pressable style={[s.fchip, !filter && s.fchipOn]} onPress={() => setFilter('')}>
              <Text style={[s.fchipTxt, !filter && s.fchipTxtOn]}>كل المدن</Text>
            </Pressable>
            {cities.map(c => {
              const on = !!filter && sameCity(filter, c);
              return (
                <Pressable key={c} style={[s.fchip, on && s.fchipOn]} onPress={() => setFilter(c)}>
                  <Text style={[s.fchipTxt, on && s.fchipTxtOn]}>{c}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {list === null ? (
          <ActivityIndicator color={P.blue} style={{ marginTop: 30 }} />
        ) : err ? (
          <View style={s.empty}><Text style={s.emptyTitle}>ما قدرنا نحمّل القائمة</Text><Text style={s.emptySub}>تأكد من النت واسحب الصفحة لتحت.</Text></View>
        ) : (
          <>
            {!!filter && <Text style={s.group}>في {filter} ({shown.length})</Text>}
            {shown.length ? shown.map((t, i) => <TechCard key={t.name + t.phone} t={t} i={i} />) : (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>{filter ? `ما فيه فنيين في ${filter} للحين` : 'ما فيه فنيين للحين'}</Text>
                <Text style={s.emptySub}>تعرف فني شاطر؟ خلّه يسجّل من الزر تحت.</Text>
              </View>
            )}
            {others.length > 0 && (
              <>
                <Text style={s.group}>مدن ثانية</Text>
                {others.map((t, i) => <TechCard key={t.name + t.phone} t={t} i={i + shown.length} />)}
              </>
            )}
          </>
        )}

        <Pressable style={({ pressed }) => [s.join, pressed && { opacity: 0.85 }]} onPress={() => Linking.openURL(BOT_TECH_SIGNUP).catch(() => {})}>
          <Text style={s.joinEmoji}>🛠️</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.joinTitle}>أنت فني أنتينا؟</Text>
            <Text style={s.joinSub}>سجّل من البوت — اسمك يطلع لعملاء مدينتك هنا، وتاخذ مفتاح «الفني عن بُعد».</Text>
          </View>
        </Pressable>
        {!city && <Text style={s.hint}>💡 اختر مدينتك من الإعدادات عشان نرتّب لك الفنيين الأقرب.</Text>}
      </ScrollView>

      <Modal visible={!!form} transparent animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={s.backdrop} onPress={() => setForm(null)} />
          {form && (
            <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={s.grip} />
              <Text style={s.sheetTitle}>طلب فني</Text>
              <Text style={s.sheetSub}>يوصل للفنيين المعتمدين في مدينتك ويتواصلون معك مباشرة.</Text>

              <Text style={s.label}>وش تحتاج؟</Text>
              <View style={s.needs}>
                {NEEDS.map(n => {
                  const on = form.needs.includes(n);
                  return (
                    <Pressable key={n} style={[s.need, on && s.needOn]}
                      onPress={() => setForm({ ...form, needs: on ? form.needs.filter(x => x !== n) : [...form.needs, n] })}>
                      <Text style={[s.needTxt, on && s.needTxtOn]}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.label}>المدينة</Text>
              <TextInput value={form.city} onChangeText={v => setForm({ ...form, city: v })} placeholder="مثال: شرورة" placeholderTextColor={P.faint} style={s.input} />
              <Text style={s.label}>رقم جوالك (واتساب)</Text>
              <TextInput value={form.phone} onChangeText={v => setForm({ ...form, phone: v })} placeholder="05xxxxxxxx" placeholderTextColor={P.faint}
                keyboardType="phone-pad" style={[s.input, { textAlign: 'left', writingDirection: 'ltr' }]} />
              <Text style={s.label}>اسمك وملاحظة <Text style={{ color: P.faint, fontWeight: '600' }}>(اختياري)</Text></Text>
              <TextInput value={form.name} onChangeText={v => setForm({ ...form, name: v })} placeholder="الاسم" placeholderTextColor={P.faint} style={s.input} />
              <TextInput value={form.note} onChangeText={v => setForm({ ...form, note: v })} placeholder="مثلاً: الحي، نوع الراوتر، أفضل وقت للتواصل" placeholderTextColor={P.faint}
                style={[s.input, { marginTop: 8, minHeight: 64, textAlignVertical: 'top', paddingTop: 10 }]} multiline />

              <Pressable onPress={send} disabled={sending} style={({ pressed }) => [s.sendBtn, (pressed || sending) && { opacity: 0.85 }]}>
                {sending ? <ActivityIndicator color="#fff" /> : <Text style={s.sendTxt}>أرسل الطلب</Text>}
              </Pressable>
              <Text style={s.privacy}>🔒 رقمك يوصل لفنيين مدينتك بس، عشان يتواصلون معك.</Text>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  hero: { borderRadius: 26, padding: 20, overflow: 'hidden', gap: 6 },
  ring: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 24, borderColor: 'rgba(255,255,255,0.07)', left: -60, top: -50 },
  heroTitle: { color: '#ffffff', fontSize: 24, fontWeight: '900', textAlign: 'right' },
  heroSub: { color: '#dbeafe', fontSize: 13.5, lineHeight: 21, textAlign: 'right' },
  filters: { flexDirection: 'row-reverse', gap: 8, paddingVertical: 2 },
  fchip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.cardBorder },
  fchipOn: { backgroundColor: tBg('#2563eb'), borderColor: tBd('#2563eb') },
  fchipTxt: { color: C.text, fontSize: 13, fontWeight: '800' },
  fchipTxtOn: { color: tFg('#ffffff') },
  group: { color: P.sub, fontSize: 13, fontWeight: '900', textAlign: 'right', marginTop: 4 },
  card: { backgroundColor: C.card, borderRadius: 22, padding: 14, gap: 8, borderWidth: 1, borderColor: C.cardBorder },
  top: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  av: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: '#ffffff', fontSize: 21, fontWeight: '900' },
  nameRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  name: { color: C.text, fontSize: 16, fontWeight: '900', textAlign: 'right', flexShrink: 1 },
  stars: { color: tFg('#b45309'), fontSize: 13, fontWeight: '900' },
  starsN: { color: P.faint, fontSize: 11.5, fontWeight: '700' },
  newTag: { color: tFg('#0f7a52'), backgroundColor: tBg('#e7f8ef'), fontSize: 11, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  city: { color: P.sub, fontSize: 12.5, textAlign: 'right' },
  note: { color: C.text, fontSize: 13, lineHeight: 20, textAlign: 'right' },
  years: { color: P.sub, fontSize: 12, textAlign: 'right' },
  actions: { flexDirection: 'row-reverse', gap: 8, marginTop: 2 },
  waBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 14, backgroundColor: tBg('#12b76a') },
  waTxt: { color: tFg('#ffffff'), fontSize: 14.5, fontWeight: '900' },
  callBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 14, backgroundColor: tBg('#e8efff') },
  callTxt: { color: tFg('#1d4ed8'), fontSize: 14.5, fontWeight: '900' },
  empty: { backgroundColor: C.card, borderRadius: 20, padding: 20, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.cardBorder },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  emptySub: { color: P.sub, fontSize: 13, textAlign: 'center' },
  join: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, backgroundColor: tBg('#fff7ed'), borderRadius: 20, padding: 16, borderWidth: 1.5, borderColor: tBd('#fed7aa'), marginTop: 6 },
  joinEmoji: { fontSize: 28 },
  joinTitle: { color: tFg('#9a3412'), fontSize: 15.5, fontWeight: '900', textAlign: 'right' },
  joinSub: { color: tFg('#c2410c'), fontSize: 12.5, lineHeight: 19, textAlign: 'right', marginTop: 2 },
  hint: { color: P.faint, fontSize: 12, textAlign: 'center' },
  reqCard: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 20, padding: 14, borderWidth: 1.5, borderColor: tBd('#a7f3d0') },
  reqIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  reqTitle: { color: C.text, fontSize: 15.5, fontWeight: '900', textAlign: 'right' },
  reqSub: { color: P.sub, fontSize: 12.5, textAlign: 'right', marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(8,12,30,0.45)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, gap: 4 },
  grip: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: C.cardBorder, marginBottom: 6 },
  sheetTitle: { color: C.text, fontSize: 19, fontWeight: '900', textAlign: 'right' },
  sheetSub: { color: P.sub, fontSize: 13, textAlign: 'right' },
  label: { color: C.text, fontSize: 13.5, fontWeight: '900', textAlign: 'right', marginTop: 12, marginBottom: 6 },
  needs: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  need: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.rowBg, borderWidth: 1.5, borderColor: C.cardBorder },
  needOn: { backgroundColor: tBg('#047857'), borderColor: tBd('#047857') },
  needTxt: { color: C.text, fontSize: 13, fontWeight: '800' },
  needTxtOn: { color: tFg('#ffffff') },
  input: { backgroundColor: C.rowBg, borderRadius: 14, paddingHorizontal: 12, minHeight: 46, color: C.text, fontSize: 15, textAlign: 'right' },
  sendBtn: { marginTop: 16, backgroundColor: tBg('#047857'), borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  sendTxt: { color: tFg('#ffffff'), fontSize: 16, fontWeight: '900' },
  privacy: { color: P.faint, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
