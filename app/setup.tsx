/**
 * الدخول بالواي فاي بس — بدون كلمة مرور عند الباب:
 *  • أول ما تنفتح: يدوّر على الراوتر لحاله. مو متصل؟ «أنت مو متصل بواي فاي الراوتر» ويعيد الفحص كل ٥ ثواني.
 *  • لقاه ← «متصل ✓» وأدوات ما تحتاج الراوتر (السرعة، البنق) تشتغل على طول.
 *  • كلمة المرور تنطلب بس لما يبي يشوف الإشارة/الأبراج/الترددات — مرة وحدة وتنحفظ.
 * (الخطوات القديمة تحت باقية:)
 *  ١) يتأكد إنك على واي فاي الراوتر  ٢) يدوّر على الراوتر لحاله (العناوين المشهورة)
 *  ٣) يطلب كلمة المرور بس  ٤) يسجّل الدخول ويحفظ الراوتر  ٥) يفتح لك صفحة الراوتر + «كيف تبدأ»
 * • نفس حماية شاشة الإضافة: عنوان محلي بس، محاولة دخول وحدة، و«المحاولة الأخيرة» لو باقي وحدة.
 * • كلمة المرور تنحفظ مشفّرة على الجهاز (saveRouter) — ما تطلع لأي مكان.
 */
import { ROUTER_HOSTS } from '../src/utils/routerHosts';
import { useEffect, useRef, useState, ReactNode } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, ScrollView } from 'react-native';
import { View, Text, TextInput, Pressable } from '../src/i18n/rn';
import { router, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { detectDriver } from '../src/drivers/registry';
import type { RouterDriver } from '../src/drivers/types';
import { listRouters, saveRouter, updateRouter, SavedRouter } from '../src/store/routers';
import { dropSession } from '../src/store/sessions';
import { addDemoRouter } from '../src/drivers/demo';
import { measureLatency, gameScore, scoreWord, selectedRegion } from '../src/utils/latency';
import { Icon, IconName } from '../src/ui/Icon';
import { C, R, S, tBg, tBd, tFg } from '../src/ui/theme';
import { sheet } from '../src/i18n';
import { reportError } from '../src/services/errors';

/** العناوين المشهورة: هواوي · ZTE/تي بي لينك · أغلب الراوترات · بعض ZTE وزين · شاومي */
const HOSTS = ROUTER_HOSTS;

type Step = 'wifi' | 'search' | 'notfound' | 'hub' | 'password' | 'login' | 'done';

/** فيه جهاز يرد على هالعنوان؟ (أي رد HTTP يكفي) — سريع، عشان ما ننتظر مهلة كل نوع راوتر على عنوان ميت.
 *  نرجّع كمان كم أخذ وهل انقطع بالمهلة: لو كل العناوين «فشلت فوراً» في الآيفون = غالباً «الشبكة المحلية» مقفولة لـ Bandly */
interface Probe { host: string; ok: boolean; ms: number; timedOut: boolean }
async function probe(host: string, ms = 2500): Promise<Probe> {
  const ctrl = new AbortController();
  const t0 = Date.now();
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  try { await fetch(`http://${host}/`, { signal: ctrl.signal }); return { host, ok: true, ms: Date.now() - t0, timedOut: false }; }
  catch { return { host, ok: false, ms: Date.now() - t0, timedOut }; }
  finally { clearTimeout(t); }
}
const answers = async (host: string, ms = 2000) => (await probe(host, ms)).ok;

/** ليش ما لقينا الراوتر:
 *  unknown = جهاز ردّ بس ما عرفنا نوعه (مو «مو متصل»!) · perm = آيفون والكل فشل فوراً (الشبكة المحلية مقفولة) · none = ولا رد */
type Miss = { why: 'unknown' | 'perm' | 'none'; hosts: string[] };

function Bubble({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <View style={[s.bubble, tone === 'ok' && s.ok, tone === 'warn' && s.warn]}>
      {children}
    </View>
  );
}

function Big({ icon, color, title, sub, onPress, disabled }: { icon: IconName; color: string; title: string; sub?: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => [s.big, { borderColor: tBd(color + '55'), backgroundColor: tBg(color + '10') }, (pressed || disabled) && { opacity: 0.6 }]}>
      <View style={[s.bigIcon, { backgroundColor: tBg(color + '22') }]}><Icon name={icon} size={20} color={tFg(color)} stroke={2.2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[s.bigTitle, { color: tFg(color) }]}>{title}</Text>
        {!!sub && <Text style={s.bigSub}>{sub}</Text>}
      </View>
    </Pressable>
  );
}

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('search');
  const [ping, setPing] = useState<{ ms: number; word: string; region: string } | null>(null);
  const [pinging, setPinging] = useState(false);
  const [status, setStatus] = useState('');
  const [found, setFound] = useState<{ host: string; d: RouterDriver; model?: string } | null>(null);
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [miss, setMiss] = useState<Miss>({ why: 'none', hosts: [] });
  const reported = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // ═══ ٢) ندوّر على الراوتر ═══
  const search = async () => {
    setStep('search'); setErr('');
    setStatus('أدوّر على راوترك…');
    // كل العناوين مع بعض (ثانيتين) ← بعدها نتعرّف على النوع بس في اللي ردّ
    const probes = await Promise.all(HOSTS.map(h => probe(h)));
    const alive2 = probes.filter(p => p.ok).map(p => p.host);
    let unsupported = false;
    for (const h of alive2) {
      if (!alive.current) return;
      setStatus(`لقيت جهاز على ${h} — أتعرّف عليه…`);
      try {
        const d = await detectDriver(h);
        if (d && (d as any).id !== 'unknown') {
          const prof = d.identify ? await d.identify().catch(() => null) : null;
          if (alive.current) { setFound({ host: h, d, model: prof?.label }); setStep('hub'); }
          return;
        }
        if (d) unsupported = true;
      } catch {}
    }
    if (!alive.current) return;
    // الكل فشل بسرعة (بدون ما ينتظر المهلة) — في الآيفون هذا شكل «الشبكة المحلية» المقفولة
    const fast = probes.every(p => !p.ok && !p.timedOut && p.ms < 1200);
    const m: Miss = alive2.length ? { why: 'unknown', hosts: alive2 } : { why: Platform.OS === 'ios' && fast ? 'perm' : 'none', hosts: [] };
    setMiss(m);
    setErr(unsupported && !alive2.length ? 'لقيت راوتر، بس نوعه للحين مو مدعوم بالكامل — جرّب «راوتري مو مدعوم؟» تحت ونضيفه.' : '');
    setStep('notfound');
    // تقرير مرة وحدة: وش ردّ ووش ما ردّ (عناوين وأوقات بس — بدون أي بيانات شخصية)
    if (!reported.current) {
      reported.current = true;
      const slow = probes.filter(p => p.timedOut).length;
      reportError('setup', `ما لقينا الراوتر: ${m.why} · ردّ: ${alive2.join(',') || 'ولا واحد'} · مهلة ${slow}/${probes.length} · فشل سريع ${fast ? 'كله' : 'لا'}`);
    }
  };

  // ═══ ٤) الدخول والحفظ ═══
  const login = async (lastTry = false) => {
    if (!found || !pw) return;
    setStep('login'); setErr('');
    const { host, d } = found;
    const user = 'admin';
    try {
      setStatus('أسجّل الدخول عنك…');
      await d.login(host, user, pw, { fresh: true, lastTry });
    } catch (e: any) {
      if (!alive.current) return;
      const msg = String(e?.message ?? e);
      if (e?.code === 'LAST_TRY' && !lastTry) {
        Alert.alert(e?.left === 1 ? 'باقي محاولة أخيرة' : 'نجرّب الدخول؟',
          `${e?.left === 1 ? 'الراوتر يسمح بمحاولة دخول وحدة قبل ما يقفل.' : msg}\n\nتأكد إن الكلمة صحيحة حرف حرف. لو طلعت غلط، الراوتر يقفل الدخول دقايق وبعدها يرجع طبيعي.`,
          [
            { text: 'أراجع الكلمة', style: 'cancel', onPress: () => setStep('password') },
            { text: 'جرّب الحين', onPress: () => login(true) },
          ]);
        return;
      }
      setErr(/كلمة المرور|108006|108002|غلط/.test(msg)
        ? 'كلمة المرور ما ضبطت. تأكد منها من الملصق (حروف كبيرة وصغيرة تفرق، و0 غير O).'
        : msg);
      setStep('password');
      return;
    }
    try {
      setStatus('أحفظ راوترك…');
      const dAny = d as unknown as { id?: string; name?: string };
      const payload = { name: found.model || dAny.name || 'راوتري', host, username: user, driverId: dAny.id ?? 'unknown', driverName: found.model || dAny.name || 'راوتر' };
      const all = await listRouters().catch(() => [] as SavedRouter[]);
      const norm = (x: string) => x.trim().toLowerCase();
      const dup = all.find(x => x.driverId === payload.driverId && norm(x.host) === norm(host));
      let saved: SavedRouter | null;
      if (dup) { dropSession(dup.id); saved = (await updateRouter(dup.id, payload, pw)) ?? (await saveRouter(payload, pw)); }
      else saved = await saveRouter(payload, pw);
      if (!alive.current) return;
      setStep('done');
      setTimeout(() => router.replace({ pathname: '/router/[id]', params: { id: saved!.id, welcome: '1' } }), 700);
    } catch (e: any) {
      if (alive.current) { setErr(String(e?.message ?? e)); setStep('password'); }
    }
  };

  // أول ما تنفتح: ندوّر لحالنا
  useEffect(() => { search(); /* eslint-disable-next-line */ }, []);
  // مو متصل؟ نعيد الفحص كل ٥ ثواني — أول ما يتصل بالواي فاي يكمّل لحاله
  useEffect(() => {
    // جهاز يرد بس ما عرفناه: إعادة البحث ما تفيد (ونفس النتيجة تتكرر) — ننتظر المستخدم يختار
    if (step !== 'notfound' || miss.why === 'unknown') return;
    const t = setInterval(async () => {
      const any = (await Promise.all(HOSTS.map(h => answers(h, 1500)))).some(Boolean);
      if (any && alive.current) search();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [step, miss.why]);

  const quickPing = async () => {
    setPinging(true);
    try {
      const [r, reg] = await Promise.all([measureLatency(8), selectedRegion()]);
      if (alive.current) setPing(r.samples ? { ms: Math.round(r.median), word: scoreWord(gameScore(r)), region: reg.name } : { ms: 0, word: 'ما وصلنا للسيرفر — النت شغّال؟', region: reg.name });
    } finally { if (alive.current) setPinging(false); }
  };

  const demo = async () => {
    const id = await addDemoRouter();
    router.replace({ pathname: '/router/[id]', params: { id } });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <View style={s.heroIcon}><Icon name="spark" size={30} color={tFg('#2f6bff')} /></View>
          <Text style={s.heroTitle}>أهلاً بك في Bandly 👋</Text>
          <Text style={s.heroSub}>اتصل بواي فاي الراوتر — وبس</Text>
        </View>

        {/* الخطوات بالأرقام — اللي خلص أخضر */}
        <View style={s.steps}>
          {[
            { n: '١', t: 'الواي فاي', on: !!found },
            { n: '٢', t: 'جاهز', on: !!found },
            { n: '٣', t: 'الأرقام (اختياري)', on: step === 'done' },
          ].map(x => (
            <View key={x.n} style={s.stepItem}>
              <View style={[s.stepDot, x.on && s.stepOn]}>
                {x.on ? <Icon name="check" size={14} color={C.onAccent} stroke={3} /> : <Text style={s.stepN}>{x.n}</Text>}
              </View>
              <Text style={[s.stepT, x.on && { color: C.text }]}>{x.t}</Text>
            </View>
          ))}
        </View>

        {step === 'wifi' && (
          <>
            <Bubble><Text style={s.txt}>أول شي: جوالك لازم يكون متصل بـ<Text style={s.bold}>واي فاي الراوتر</Text> (مو بيانات الجوال).</Text></Bubble>
            <Big icon="wifi" color="#12b76a" title="إيه، متصل" sub="أدوّر على الراوتر لحالي" onPress={search} />
            <Big icon="phone" color="#2f6bff" title="لا، كيف أتصل؟" sub="أشرح لك"
              onPress={() => Alert.alert('اتصل بواي فاي الراوتر',
                '١) افتح «الإعدادات» في جوالك ← «واي فاي».\n٢) اختر اسم شبكة راوترك — مكتوب على الملصق تحت الراوتر (جنب SSID أو WLAN).\n٣) اكتب كلمة سر الواي فاي اللي على الملصق.\n٤) ارجع لـ Bandly واضغط «إيه، متصل».')} />
          </>
        )}

        {(step === 'search' || step === 'login') && (
          <Bubble>
            <View style={s.row}><ActivityIndicator color={C.blue} /><Text style={s.txt}>{status}</Text></View>
          </Bubble>
        )}

        {step === 'notfound' && (
          <>
            {!!err && <Bubble tone="warn"><Text style={s.txt}>{err}</Text></Bubble>}
            {miss.why === 'unknown' ? (
              <View style={s.offline}>
                <Icon name="compass" size={34} color={tFg('#d97706')} />
                <Text style={[s.offTitle, { color: tFg('#b45309') }]}>لقيت جهاز بس ما عرفت نوعه</Text>
                <Text style={s.offSub}>أنت متصل ✓ — فيه جهاز يرد على {miss.hosts.join(' و ')}، بس Bandly ما تعرّف عليه للحين. أرسله لنا من «راوتري مو مدعوم؟» ونضيفه، أو أدخل بياناته بنفسك.</Text>
              </View>
            ) : (
              <View style={s.offline}>
                <Icon name="wifi" size={34} color={C.red} />
                <Text style={s.offTitle}>{miss.why === 'perm' ? 'Bandly ما يقدر يوصل لراوترك' : 'ما لقيت راوترك'}</Text>
                <Text style={s.offSub}>{miss.why === 'perm'
                  ? 'غالباً صلاحية «الشبكة المحلية» مقفولة لـ Bandly في الآيفون — فعّلها من الزر تحت وارجع، أكمّل لحالي.'
                  : 'تأكد إن جوالك متصل بواي فاي الراوتر (مو بيانات الجوال) — وأنا أكمّل لحالي أول ما يرد.'}</Text>
                <View style={s.row}><ActivityIndicator size="small" color={C.sub} /><Text style={s.offWait}>أنتظرك…</Text></View>
              </View>
            )}
            {Platform.OS === 'ios' && miss.why !== 'unknown' && (
              <Big icon="settings" color={miss.why === 'perm' ? '#e5484d' : '#0e7d93'} title="فعّل «الشبكة المحلية» لـ Bandly"
                sub="الإعدادات ← Bandly ← الشبكة المحلية (Local Network) ← شغّلها"
                onPress={() => Linking.openSettings().catch(() => {})} />
            )}
            <Big icon="phone" color="#12b76a" title="كيف أتصل بالواي فاي؟" sub="خطوة بخطوة"
              onPress={() => Alert.alert('اتصل بواي فاي الراوتر',
                '١) افتح «الإعدادات» في جوالك ← «واي فاي».\n٢) اختر اسم شبكة راوترك — مكتوب على الملصق تحت الراوتر (جنب SSID أو WLAN).\n٣) اكتب كلمة سر الواي فاي اللي على الملصق.\n٤) ارجع لـ Bandly — أكمّل لحالي.')} />
            <Big icon="refresh" color="#2f6bff" title="جرّب الحين" onPress={search} />
            <Big icon="settings" color="#7c5cff" title="أدخل البيانات بنفسي" sub="لو عنوان راوترك غير المعتاد" onPress={() => router.replace('/add-router' as Href)} />
            <Big icon="compass" color="#64748b" title="راوتري مو مدعوم؟" sub="استكشاف جهاز" onPress={() => router.replace('/newdevice' as Href)} />
            <Pressable onPress={demo} style={s.link}><Text style={s.linkTxt}>جرّب بدون راوتر · Demo</Text></Pressable>
          </>
        )}

        {step === 'hub' && found && (
          <>
            <View style={s.online}>
              <Icon name="check" size={30} color={tFg('#12b76a')} stroke={3} />
              <Text style={s.onTitle}>متصل براوترك ✓</Text>
              <Text style={s.offSub}>{found.model ?? (found.d as any).name ?? 'راوتر'} · {found.host}</Text>
            </View>

            <Text style={s.section}>تقدر تبدأ على طول</Text>
            <Big icon="speed" color="#12b76a" title="اختبر السرعة" sub="تنزيل ورفع وبنق" onPress={() => router.push('/speed/guest' as Href)} />
            <Big icon="game" color="#ec4899" title={pinging ? 'أقيس…' : 'كم البنق للألعاب؟'} sub={ping ? `${ping.ms ? `${ping.ms}ms لسيرفرات ${ping.region} · ` : ''}${ping.word}` : 'قياس سريع'} onPress={quickPing} disabled={pinging} />

            <Text style={s.section}>تبي تشوف إشارتك وأبراجك وترددك؟</Text>
            <Big icon="antenna" color="#2f6bff" title="افتح كل الأدوات" sub="الراوتر يطلب كلمة المرور مرة وحدة بس — بعدها ما نسألك" onPress={() => setStep('password')} />
            <Pressable onPress={demo} style={s.link}><Text style={s.linkTxt}>أشوف الأدوات بالتجريبي أول</Text></Pressable>
          </>
        )}

        {step === 'password' && found && (
          <>
            <Bubble tone="ok"><Text style={s.txt}>✓ متصل براوترك: <Text style={s.bold}>{found.model ?? (found.d as any).name ?? 'راوتر'}</Text></Text></Bubble>
            <Bubble>
              <Text style={s.txt}>راوترك يحمي الأرقام بكلمة مرور — اكتبها <Text style={s.bold}>مرة وحدة بس</Text> وتنحفظ على جوالك.{'\n'}{'\n'}تلقاها على الملصق تحت الراوتر — جنب كلمة <Text style={s.bold}>Password</Text> أو «كلمة المرور» (مو كلمة الواي فاي إلا لو ما فيه غيرها).</Text>
            </Bubble>
            {!!err && <Bubble tone="warn"><Text style={s.txt}>{err}</Text></Bubble>}
            <View style={s.pwRow}>
              <TextInput
                value={pw} onChangeText={t => { setPw(t); setErr(''); }}
                placeholder="كلمة مرور الراوتر" placeholderTextColor={C.muted}
                secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
                style={s.pw} returnKeyType="go" onSubmitEditing={() => login()} autoFocus
              />
              <Pressable onPress={() => setShow(v => !v)} style={s.eye} accessibilityLabel={show ? 'إخفاء' : 'إظهار'}>
                <Icon name={show ? 'eye-off' : 'eye'} size={20} color={C.sub} />
              </Pressable>
            </View>
            <Big icon="login" color="#2f6bff" title="دخّلني" onPress={() => login()} disabled={!pw} />
            {Platform.OS !== 'web' && (
              <Big icon="camera" color="#12b76a" title="صوّر الملصق بدالي" sub="أقرأ الكلمة من الصورة" onPress={() => router.replace('/add-router?scan=1' as Href)} />
            )}
          </>
        )}

        {step === 'done' && (
          <Bubble tone="ok"><Text style={[s.txt, s.bold]}>✓ دخلت! أفتح لك راوترك…</Text></Bubble>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: 12 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  heroIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: tBg('#2f6bff1a'), alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: C.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  heroSub: { color: C.sub, fontSize: 14, textAlign: 'center' },
  steps: { flexDirection: 'row-reverse', justifyContent: 'center', gap: 22, paddingVertical: 4 },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.track, alignItems: 'center', justifyContent: 'center' },
  stepOn: { backgroundColor: '#12b76a' },
  stepN: { color: C.sub, fontWeight: '900', fontSize: 14 },
  stepT: { color: C.muted, fontSize: 12, fontWeight: '700' },
  bubble: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.md, padding: 14 },
  ok: { borderColor: '#12b76a66', backgroundColor: tBg('#12b76a10') },
  warn: { borderColor: C.gold, backgroundColor: C.goldSoft },
  txt: { color: C.text, fontSize: 15, lineHeight: 24, textAlign: 'right' },
  bold: { fontWeight: '900' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  big: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: R.md, padding: 14 },
  bigIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bigTitle: { fontSize: 16, fontWeight: '900', textAlign: 'right' },
  bigSub: { color: C.sub, fontSize: 12.5, textAlign: 'right', marginTop: 2 },
  pwRow: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: C.card, borderColor: C.blue, borderWidth: 1.5, borderRadius: R.md, paddingHorizontal: 12 },
  pw: { flex: 1, color: C.text, fontSize: 18, paddingVertical: 14, textAlign: 'left', fontWeight: '700' },
  eye: { padding: 8 },
  link: { alignItems: 'center', paddingVertical: 10 },
  offline: { alignItems: 'center', gap: 6, paddingVertical: 18, paddingHorizontal: 12, borderRadius: R.lg, borderWidth: 1.5, borderColor: tBd('#e5484d55'), backgroundColor: tBg('#e5484d0f') },
  online: { alignItems: 'center', gap: 6, paddingVertical: 18, borderRadius: R.lg, borderWidth: 1.5, borderColor: tBd('#12b76a66'), backgroundColor: tBg('#12b76a12') },
  offTitle: { color: C.red, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  onTitle: { color: tFg('#0f9a5f'), fontSize: 19, fontWeight: '900', textAlign: 'center' },
  offSub: { color: C.sub, fontSize: 13.5, textAlign: 'center', lineHeight: 21 },
  offWait: { color: C.sub, fontSize: 12.5 },
  section: { color: C.sub, fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: 6 },
  linkTxt: { color: C.blue, fontWeight: '800', fontSize: 14 },
});
