import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { ApnProfile, DnsConfig } from '../../src/drivers/types';
import { C, R, S, T } from '../../src/ui/theme';
import { MetricCard, Section } from '../../src/ui/Cards';
import { Icon } from '../../src/ui/Icon';
import { Skeleton, ErrorCard } from '../../src/ui/States';

const AUTH: { value: string; label: string }[] = [
  { value: '0', label: 'بدون' },
  { value: '1', label: 'PAP' },
  { value: '2', label: 'CHAP' },
  { value: '3', label: 'تلقائي' },
];

const PRESETS: { name: string; p: string; s: string; note: string }[] = [
  { name: 'Cloudflare', p: '1.1.1.1', s: '1.0.0.1', note: 'الأسرع عادةً' },
  { name: 'Google', p: '8.8.8.8', s: '8.8.4.4', note: 'الأكثر استقراراً' },
  { name: 'Quad9', p: '9.9.9.9', s: '149.112.112.112', note: 'يحجب المواقع الخبيثة' },
];

const isIp = (v: string) =>
  /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(v.trim()) &&
  v.trim().split('.').every(n => +n >= 0 && +n <= 255);

export default function NetworkSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const [apnOk, setApnOk] = useState(false);
  const [dnsOk, setDnsOk] = useState(false);
  const [profiles, setProfiles] = useState<ApnProfile[]>([]);
  const [dns, setDns] = useState<DnsConfig | null>(null);

  const [apn, setApn] = useState('');
  const [pname, setPname] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [auth, setAuth] = useState('0');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (r: SavedRouter) => {
    setError('');
    try {
      const res = await withSession(r, async d => ({
        apnOk: !!d.getApnProfiles,
        dnsOk: !!d.getDns,
        profiles: d.getApnProfiles ? await d.getApnProfiles().catch(() => [] as ApnProfile[]) : [],
        dns: d.getDns ? await d.getDns().catch(() => null) : null,
      }));
      if (!alive.current) return;
      setApnOk(res.apnOk);
      setDnsOk(res.dnsOk);
      setProfiles(res.profiles);
      setDns(res.dns);
      const cur = res.profiles.find(x => x.current) ?? res.profiles[0];
      if (cur) {
        setApn(cur.apn); setPname(cur.name);
        setUser(cur.username ?? ''); setPass(''); setAuth(cur.authMode ?? '0');
      }
      if (res.dns?.manual) { setP1(res.dns.primary ?? ''); setP2(res.dns.secondary ?? ''); }
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      await load(r);
      if (alive.current) setLoading(false);
    })();
  }, [id, load]);

  const current = profiles.find(x => x.current) ?? profiles[0];
  const dirtyApn = !!current && (apn.trim() !== current.apn || pname.trim() !== current.name ||
    user.trim() !== (current.username ?? '') || pass.length > 0 || auth !== (current.authMode ?? '0'));

  const saveApn = () => {
    if (!info || !current) return;
    const a = apn.trim();
    if (!a) { Alert.alert('ناقص', 'اكتب اسم APN'); return; }
    Alert.alert(
      'تغيير APN',
      `بنغيّر ملف الاتصال إلى "${a}".\n\nسيُقطع الإنترنت لحظات حتى يعيد الراوتر الاتصال. إذا كان APN غلط ما بيتصل — ترجع تعدّله من نفس الشاشة لأن اتصالك بالراوتر عبر الواي فاي ما ينقطع.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حفظ', onPress: async () => {
            setBusy('apn'); setError('');
            try {
              await withSession(info, d => d.setApn!({
                index: current.index, name: pname.trim() || a, apn: a,
                username: user.trim(), password: pass, authMode: auth,
              }), false);
              await new Promise(r => setTimeout(r, 2500));
              await load(info);
              if (alive.current) { setPass(''); Alert.alert('تم', 'انحفظ APN الجديد'); }
            } catch (e: any) {
              if (alive.current) setError(e?.message ?? String(e));
            } finally {
              if (alive.current) setBusy('');
            }
          },
        },
      ],
    );
  };

  const pickProfile = (p: ApnProfile) => {
    if (!info || p.current || busy) return;
    Alert.alert('تبديل ملف الاتصال', `بنخلي "${p.name}" هو الملف النشط. الإنترنت بينقطع لحظات.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تبديل', onPress: async () => {
          setBusy('apn'); setError('');
          try {
            await withSession(info, d => d.selectApn!(p.index), false);
            await new Promise(r => setTimeout(r, 2500));
            await load(info);
          } catch (e: any) {
            if (alive.current) setError(e?.message ?? String(e));
          } finally {
            if (alive.current) setBusy('');
          }
        },
      },
    ]);
  };

  const applyDns = (manual: boolean, a = p1, b = p2) => {
    if (!info) return;
    if (manual && !isIp(a)) { Alert.alert('عنوان غير صحيح', 'اكتب عنوان DNS رئيسي صحيح مثل 1.1.1.1'); return; }
    if (manual && b.trim() && !isIp(b)) { Alert.alert('عنوان غير صحيح', 'العنوان الاحتياطي غير صحيح'); return; }
    Alert.alert(
      manual ? 'تغيير DNS' : 'رجوع للتلقائي',
      manual
        ? `بنخلي أجهزتك تستخدم ${a}${b.trim() ? ' و' + b.trim() : ''}.\n\nيصير مفعولها لما يعيد كل جهاز الاتصال بالواي فاي.`
        : 'بنرجّع الراوتر يوزّع DNS الخاص بالمشغّل.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: manual ? 'تطبيق' : 'رجوع', onPress: async () => {
            setBusy('dns'); setError('');
            try {
              await withSession(info, d => d.setDns!({
                manual, primary: a.trim(), secondary: b.trim() || undefined,
              }), false);
              await load(info);
              if (alive.current) Alert.alert('تم', manual ? 'انحفظ DNS الجديد' : 'رجعنا للتلقائي');
            } catch (e: any) {
              if (alive.current) setError(e?.message ?? String(e));
            } finally {
              if (alive.current) setBusy('');
            }
          },
        },
      ],
    );
  };

  const locked = !!busy;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {loading && (
          <View style={{ gap: S.lg }}>
            <Skeleton h={30} radius={R.md} />
            <Skeleton h={150} radius={R.lg} />
            <Skeleton h={120} radius={R.lg} />
          </View>
        )}

        {!!error && (
          <ErrorCard message={error} onRetry={info ? () => load(info) : undefined} retrying={locked} />
        )}

        {!loading && !apnOk && !dnsOk && (
          <MetricCard>
            <Text style={s.title}>غير مدعوم</Text>
            <Text style={s.hint}>
              راوترك ما يدعم تغيير APN ولا DNS من التطبيق. هذي الخصائص متاحة حالياً على أجهزة هواوي.
            </Text>
          </MetricCard>
        )}

        {/* ───── APN ───── */}
        {!loading && apnOk && (
          <Section title="ملف الاتصال (APN)" icon="tower">
            <MetricCard>
              <Text style={s.hint}>
                APN هو بوابة الاتصال بالمشغّل. بعض المشغّلين عندهم أكثر من بوابة وتختلف سرعتها.
                لا تغيّره إلا إذا تعرف القيمة الصحيحة من مشغّلك.
              </Text>

              {profiles.length > 1 && (
                <View style={{ gap: 6 }}>
                  {profiles.map(p => (
                    <Pressable
                      key={p.index}
                      style={[s.row, p.current && s.rowOn]}
                      onPress={() => pickProfile(p)}
                      disabled={locked}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.rowName}>{p.name}</Text>
                        <Text style={s.rowSub}>{p.apn || '—'}</Text>
                      </View>
                      {p.current
                        ? <View style={s.tag}><Text style={s.tagTxt}>النشط</Text></View>
                        : <Icon name="chevron" size={15} color={C.muted} />}
                    </Pressable>
                  ))}
                </View>
              )}

              {current?.readOnly ? (
                <Text style={s.warn}>هذا الملف محمي من التعديل في الراوتر — تقدر تبدّل لملف آخر فقط.</Text>
              ) : (
                <>
                  <Field label="اسم الملف" value={pname} onChange={setPname} placeholder="مثال: زين انترنت" />
                  <Field label="APN" value={apn} onChange={setApn} placeholder="مثال: zain" autoCap="none" />
                  <Field label="اسم المستخدم (اختياري)" value={user} onChange={setUser} autoCap="none" />
                  <Field label="كلمة المرور (اختياري)" value={pass} onChange={setPass} secure />

                  <Text style={s.label}>نوع التحقق</Text>
                  <View style={s.wrap}>
                    {AUTH.map(a => (
                      <Pressable
                        key={a.value}
                        style={[s.chip, auth === a.value && s.chipOn]}
                        onPress={() => !locked && setAuth(a.value)}
                      >
                        <Text style={[s.chipTxt, auth === a.value && { color: C.onAccent }]}>{a.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Pressable
                    style={[s.primary, (!dirtyApn || locked) && s.off]}
                    onPress={saveApn}
                    disabled={!dirtyApn || locked}
                  >
                    {busy === 'apn'
                      ? <ActivityIndicator color={C.onAccent} />
                      : <Text style={s.primaryTxt}>حفظ APN</Text>}
                  </Pressable>
                </>
              )}
            </MetricCard>
          </Section>
        )}

        {/* ───── DNS ───── */}
        {!loading && dnsOk && (
          <Section title="خوادم DNS" icon="speed">
            <MetricCard>
              <View style={s.state}>
                <View style={[s.dot, { backgroundColor: dns?.manual ? C.blue : C.muted }]} />
                <Text style={s.stateTxt}>
                  {dns?.manual
                    ? `يدوي — ${dns.primary ?? '—'}${dns.secondary ? ' · ' + dns.secondary : ''}`
                    : 'تلقائي (من المشغّل)'}
                </Text>
              </View>

              <Text style={s.hint}>
                DNS يترجم أسماء المواقع لعناوين. خادم أسرع يقصّر زمن فتح الصفحات وأحياناً يحسّن الاستجابة في الألعاب —
                لكنه ما يزيد سرعة التحميل نفسها.
              </Text>

              <View style={{ gap: 6 }}>
                {PRESETS.map(pr => {
                  const on = dns?.manual && dns.primary === pr.p;
                  return (
                    <Pressable
                      key={pr.name}
                      style={[s.row, on && s.rowOn]}
                      onPress={() => { setP1(pr.p); setP2(pr.s); applyDns(true, pr.p, pr.s); }}
                      disabled={locked}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.rowName}>{pr.name}</Text>
                        <Text style={s.rowSub}>{pr.p} · {pr.s}</Text>
                      </View>
                      {on
                        ? <View style={s.tag}><Text style={s.tagTxt}>مُفعّل</Text></View>
                        : <Text style={s.rowNote}>{pr.note}</Text>}
                    </Pressable>
                  );
                })}
              </View>

              <Text style={s.label}>أو يدوي</Text>
              <Field label="الرئيسي" value={p1} onChange={setP1} placeholder="1.1.1.1" numeric />
              <Field label="الاحتياطي (اختياري)" value={p2} onChange={setP2} placeholder="1.0.0.1" numeric />

              <View style={s.btnRow}>
                <Pressable
                  style={[s.ghost, (!dns?.manual || locked) && s.off]}
                  onPress={() => applyDns(false)}
                  disabled={!dns?.manual || locked}
                >
                  <Text style={s.ghostTxt}>رجوع للتلقائي</Text>
                </Pressable>
                <Pressable
                  style={[s.primary, locked && s.off]}
                  onPress={() => applyDns(true)}
                  disabled={locked}
                >
                  {busy === 'dns'
                    ? <ActivityIndicator color={C.onAccent} />
                    : <Text style={s.primaryTxt}>تطبيق</Text>}
                </Pressable>
              </View>

              <Text style={s.warn}>
                بعد التغيير، افصل جوالك عن الواي فاي وأعد الاتصال عشان ياخذ الخادم الجديد.
              </Text>
            </MetricCard>
          </Section>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

function Field({
  label, value, onChange, placeholder, secure, numeric, autoCap,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; secure?: boolean; numeric?: boolean; autoCap?: 'none' | 'sentences';
}) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        secureTextEntry={secure}
        keyboardType={numeric ? 'numbers-and-punctuation' : 'default'}
        autoCapitalize={autoCap ?? 'none'}
        autoCorrect={false}
        textAlign="left"
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.xl },
  title: { color: C.text, fontWeight: '800', fontSize: T.h2, textAlign: 'right' },
  hint: { color: C.muted, fontSize: T.label, textAlign: 'right', lineHeight: 19 },
  warn: { color: C.gold, fontSize: T.label, textAlign: 'right', lineHeight: 18, fontWeight: '700' },
  label: { color: C.sub, fontSize: T.label, textAlign: 'right', fontWeight: '700' },
  input: {
    backgroundColor: C.rowBg, borderRadius: R.md, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: S.md, paddingVertical: 11, color: C.text, fontSize: T.body + 1,
  },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: S.sm,
    backgroundColor: C.rowBg, borderRadius: R.md, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: S.md, paddingVertical: 10,
  },
  rowOn: { borderColor: C.blue, backgroundColor: C.blueSoft },
  rowName: { color: C.text, fontWeight: '800', fontSize: T.body + 0.5, textAlign: 'right' },
  rowSub: { color: C.sub, fontSize: T.label, textAlign: 'right', marginTop: 1 },
  rowNote: { color: C.muted, fontSize: T.tiny + 0.5 },
  tag: { backgroundColor: C.blue, borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 3 },
  tagTxt: { color: C.onAccent, fontWeight: '800', fontSize: T.tiny },
  state: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stateTxt: { color: C.text, fontWeight: '800', fontSize: T.body + 0.5, textAlign: 'right', flexShrink: 1 },
  wrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1, borderColor: C.line, backgroundColor: C.rowBg,
    borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: 7,
  },
  chipOn: { backgroundColor: C.blue, borderColor: C.blue },
  chipTxt: { color: C.text, fontWeight: '700', fontSize: T.label },
  btnRow: { flexDirection: 'row', gap: S.sm },
  primary: {
    flex: 1, backgroundColor: C.blue, borderRadius: R.md, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryTxt: { color: C.onAccent, fontWeight: '800', fontSize: T.body + 1 },
  ghost: { flex: 1, borderWidth: 1, borderColor: C.blue, borderRadius: R.md, paddingVertical: 12, alignItems: 'center' },
  ghostTxt: { color: C.blue, fontWeight: '800', fontSize: T.body + 0.5 },
  off: { opacity: 0.4 },
});
