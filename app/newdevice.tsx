/**
 * «راوترك مو مدعوم؟ نضيفه لك» — طلب بسيط يوصل للمبرمج (بوت التطبيق) عشان يتواصل مع المستخدم ويدعم جهازه.
 * • الموديل + الشركة + المدينة + يوزر تليجرام (اختياري) — بموافقة صريحة. ما نطلب رقم جوال (ما نحتاج إفصاح جديد في أبل).
 * • فحص تلقائي للراوتر (اختياري) ينرفق مع الطلب — نفس «استكشاف جهاز» بدون كلمات مرور ولا MAC.
 * • ما فيه أيقونة جديدة: يفتح من «جهاز جديد · غير مدعوم؟» و«راوتري مو موجود» و«راوتري مو مدعوم؟».
 * • «برمج لي جهازي» (١٠ نوفمبر) — **موقوفة** (AUTOPROG_ON = false في services/autoprog.ts): الرسيفر يطابق ملفات الصفحة مع
 *   عائلاتنا (live-server/autoprog.py) ولو طابق نجرّب الدرايفر المقترح على الراوتر. فحص ١٨٥ ملف حقيقي طلّع صفر مرشح
 *   (التطبيق أصلاً يجرّب كل الدرايفرات)، فالشاشة رجعت لنصوصها وطريقها القديم: الطلب والملفات عند المبرمج.
 */
import { collectRouterFiles, sendRouterFiles } from '../src/services/routerDump';
import { ROUTER_HOSTS } from '../src/utils/routerHosts';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, Switch } from 'react-native';
import { View, Text, TextInput, Pressable } from '../src/i18n/rn';
import { router, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runProbe, reportText, fingerprint, fingerprintText } from '../src/utils/probe';
import { readMeta } from '../src/utils/speedtest';
import { detectDriver } from '../src/drivers/registry';
import { LabelScannerHost, ensureScanner } from '../src/ui/scanner';
import { ocrAvailable } from '../modules/bandly-cell/src';
import { sendSupportReport } from '../src/services/errors';
import { AUTOPROG_ON, askVerdict, discoverFeatures, lookupProfile, reportTrial, saveAutoRouter, tryCandidate } from '../src/services/autoprog';
import { NO_VERDICT, TrialResult, Verdict, writeLabels } from '../src/utils/autoprogCore';
import { Icon } from '../src/ui/Icon';
import { C, R, S, tBg, tBd, tFg } from '../src/ui/theme';
import { sheet } from '../src/i18n';

const TELEGRAM = 'https://t.me/hasa_n20';
const OPS = ['stc', 'زين', 'موبايلي', 'سلام', 'غيرها'];
const WANTS = ['الإشارة', 'الترددات', 'تثبيت البرج', 'إعادة التشغيل', 'الأجهزة المتصلة', 'الواي فاي'];
/** سطور الملصق اللي فيها الموديل/النسخة — ونستبعد أي شي فيه كلمة مرور أو رقم تسلسلي/IMEI */
const SECRET = /pass|pwd|key|pin|wpa|كلم|رمز|imei|s\/?n\b|serial|mac\b|ssid/i;
const MODELISH = /model|موديل|type|p\/?n|h\/?w|hardware|version|ver\b|zyxel|tp-?link|huawei|zte|nokia|alcatel|netgear|d-?link|tenda|[a-z]{2,}[- ]?\d{3,}/i;
function modelLines(lines: string[]): string[] {
  return [...new Set(lines.map(l => l.trim()).filter(l => l.length >= 3 && l.length <= 60 && !SECRET.test(l) && MODELISH.test(l)))].slice(0, 8);
}
/** الموديل والفيرموير من صفحة الراوتر نفسها (بدون دخول) — من تقرير الفحص */
function pageInfo(probe: string): string[] {
  const out = new Set<string>();
  // العنوان من الصفحة الرئيسية بس — مو من صفحات الخطأ (404) اللي ترجع من الفحوصات الثانية
  const main = probe.split(/\n--- /).find(sec => sec.startsWith('الصفحة الرئيسية')) ?? '';
  const t = main.match(/<title>([^<]{3,60})<\/title>/i)?.[1]?.trim();
  if (t && !/error|not found|404|forbidden|unauthori/i.test(t)) out.add(`عنوان الصفحة: ${t}`);
  for (const m of probe.matchAll(/"?(wa_inner_version|web_version|hardware_version|SoftwareVersion|HardwareVersion|FirmwareVersion|DeviceName|ModelName|model_name|product_name|devcap_model)"?\s*[:=]\s*"([^"]{3,50})"/gi)) out.add(`${m[1]}: ${m[2]}`);
  return [...out].slice(0, 6);
}
const HOSTS = ROUTER_HOSTS;

async function answers(host: string, ms = 2000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { await fetch(`http://${host}/`, { signal: ctrl.signal }); return true; } catch { return false; } finally { clearTimeout(t); }
}

export default function NewDeviceScreen() {
  const insets = useSafeAreaInsets();
  const [model, setModel] = useState('');
  const [op, setOp] = useState('');
  const [city, setCity] = useState('');
  const [tg, setTg] = useState('');
  const [scan, setScan] = useState(true);
  const [label, setLabel] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const canOcr = Platform.OS === 'android' && ocrAvailable();
  const [tester, setTester] = useState(false);
  const [laptop, setLaptop] = useState(false);
  const [wants, setWants] = useState<string[]>([]);
  const toggleWant = (w: string) => setWants(x => (x.includes(w) ? x.filter(y => y !== w) : [...x, w]));
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState(false);
  // ═══ «برمج لي جهازي»: برمجة مقترحة من الرسيفر نجرّبها على الراوتر ═══
  /** requested = الطلب والملفات وصلت المبرمج قبل (جاية من مطابقة الملفات) · false = من البصمة، ما انرسل شي لسا */
  const [cand, setCand] = useState<{ v: Verdict; host: string; requested: boolean } | null>(null);
  const [tUser, setTUser] = useState('admin');
  const [tPass, setTPass] = useState('');
  const [tBusy, setTBusy] = useState(false);
  const [tMsg, setTMsg] = useState('');
  const tries = useRef(0);
  const lastTrial = useRef<TrialResult | null>(null);
  /** بعد ما انضاف: نتيجة اكتشاف الميزات (وش لقينا في راوتره ووش انفتح من أوامر التغيير) */
  const [feat, setFeat] = useState<{ id: string; found: string[]; missing: string[]; writes: string[]; note: string } | null>(null);
  const [tStep, setTStep] = useState('');

  const canSend = !!model.trim() && agree && !busy;

  /** ما اشتغلت البرمجة المقترحة (أو العضو ما يبي يجرّب) ← النتيجة للرسيفر، والجهاز يروح للمبرمج بالطريق العادي */
  const toDeveloper = async (c: { v: Verdict; host: string; requested: boolean }) => {
    await reportTrial(c.v, lastTrial.current ?? { ok: false, stage: 'skipped', err: 'العضو ما جرّب', got: [] }).catch(() => {});
    setCand(null);
    if (c.requested) setSent(true);
    else await send(true);
  };

  const runCand = async () => {
    const c = cand;
    if (!c || tBusy || !tPass) return;
    setTBusy(true); setTMsg('');
    try {
      const user = tUser.trim() || 'admin';
      const res = await tryCandidate(c.v, c.host, user, tPass);
      lastTrial.current = res; tries.current++;
      if (res.ok) {
        const saved = await saveAutoRouter(c.v, model.trim(), c.host, user, tPass);
        reportTrial(c.v, res).catch(() => {});
        // ═══ اكتشاف الميزات: نجرّب كل قراءة على راوتره (قراءة بس) — اللي يرد ينفتح، واللي ما يرد ينخفي ═══
        setTStep('أكتشف ميزات راوترك…');
        let found: string[] = [], missing: string[] = [], note = '';
        try {
          const rep = await discoverFeatures(saved, (d, t) => setTStep(`أكتشف ميزات راوترك… ${d}/${t}`));
          found = rep.found; missing = rep.missing;
          if (rep.aborted) note = 'الاتصال بالراوتر انقطع وقت الاكتشاف — أعده من صفحة الراوتر.';
        } catch (e) { note = `ما كمل الاكتشاف (${String((e as any)?.message ?? e).slice(0, 80)}) — أعده من صفحة الراوتر.`; }
        setTStep('');
        setCand(null);
        setFeat({ id: saved.id, found, missing, writes: writeLabels(c.v.writes), note });
        return;
      }
      if (res.stage === 'password' && tries.current < 2) {
        setTMsg(`ما دخلنا: ${res.err}\nتأكد من اسم المستخدم وكلمة مرور صفحة الراوتر (على الملصق تحته) وجرّب مرة ثانية.`);
        return;
      }
      // مو بسبب الكلمة، أو محاولتين ← نوقف (ما نقفل دخول الراوتر على العضو) ونحوّله للمبرمج
      Alert.alert('حوّلنا جهازك للمبرمج', `${res.stage === 'signal' ? 'دخلنا راوترك بس ما قرينا الإشارة' : 'ما قدرنا ندخل راوترك بالبرمجة الجاهزة'}: ${res.err}\n\nما تغيّر شي في راوترك. تفاصيله توصل المبرمج ويضيفه بالدور.`);
      await toDeveloper(c);
    } catch (e) {
      setTMsg(String((e as any)?.message ?? e).slice(0, 140));
    } finally { setTBusy(false); }
  };

  const send = async (skipAuto = false) => {
    if (!canSend) return;
    let probe = '';
    let found: string | undefined;
    if (scan) {
      setBusy('أدوّر على راوترك…');
      found = (await Promise.all(HOSTS.map(async h => ((await answers(h)) ? h : null)))).find(Boolean) as string | undefined;
      if (found) {
        // الراوتر مدعوم أصلاً؟ (المستخدم ما عرف يضيفه) — نقوله بدل ما يرسل طلب على الفاضي
        setBusy('أتعرّف على راوترك…');
        const d = await detectDriver(found).catch(() => null);
        let known = d && (d as any).id !== 'unknown' ? (d as any).name as string : null;
        if (known && d?.identify) {
          // اسم الموديل الحقيقي من الراوتر نفسه — الملصق/العلبة أحياناً باسم ثاني (تقرير: «FiberHome LG6851F» وهو Huawei H155-381)
          try { (d as any).host = found; const m = await d.identify(); if (m?.label && /\d/.test(m.label)) known = m.label; } catch {}
        }
        if (known) {
          setBusy('');
          const go = await new Promise<'setup' | 'send' | 'cancel'>(res => Alert.alert('راوترك مدعوم أصلاً ✓',
            `الراوتر اللي متصل فيه هو ${known} — يشتغل مع Bandly وما يحتاج طلب.\n\nلو اسمه على العلبة أو الملصق غير كذا، عادي: الشركة تبيعه باسمها والراوتر من الداخل ${known}.\n\nلو تقصد راوتر ثاني، اتصل بواي فايه أول وارجع هنا.`,
            [
              { text: 'رجوع', style: 'cancel', onPress: () => res('cancel') },
              { text: 'أرسل على كل حال', onPress: () => res('send') },
              { text: 'دخّلني الحين', onPress: () => res('setup') },
            ]));
          if (go === 'setup') { router.replace('/setup' as Href); return; }
          if (go === 'cancel') return;
        }
        setBusy('أفحص الراوتر (دقيقة تقريباً)…');
        try {
          const rep = await runProbe(found, (d, t) => setBusy(`أفحص الراوتر… ${d}/${t}`));
          probe = reportText(rep, model.trim(), `الشركة: ${op || '—'} · المدينة: ${city || '—'}`);
        } catch { probe = `(الفحص ما كمل على ${found})`; }
      } else probe = '(ما لقينا راوتر على الشبكة — المستخدم مو متصل بواي فاي الراوتر)';
    }
    // ═══ تلقائي: الشركة من الإنترنت + بصمة الراوتر ═══
    setBusy('أجمع تفاصيل الاتصال…');
    const [meta, fp] = await Promise.all([
      readMeta().catch(() => ({} as { isp?: string; server?: string })),
      scan && found ? fingerprint(found).catch(() => null) : Promise.resolve(null),
    ]);
    const netLines = [
      meta.isp ? `الشركة (من الإنترنت): ${meta.isp}` : 'الإنترنت: ما وصلنا (الراوتر بدون نت أو الجوال على بيانات ثانية)',
      found ? `عنوان الراوتر: ${found}` : 'ما لقينا راوتر على الواي فاي',
      ...(fp ? fingerprintText(fp) : []),
    ];
    // ═══ «برمج لي جهازي»: صفحة راوترك تبرمجت عند عضو قبل؟ ← نجرّب مباشرة، بدون رفع ملفات ولا انتظار ═══
    if (AUTOPROG_ON && !skipAuto && found && fp) {
      setBusy('أشوف لو راوترك تبرمج قبل…');
      const k = await lookupProfile(fp, model.trim()).catch(() => NO_VERDICT);
      if (k.status === 'known') { setBusy(''); setCand({ v: k, host: found, requested: false }); return; }
    }
    setBusy('أرسل الطلب…');
    const contact = `💬 تليجرام: ${tg.trim() ? '@' + tg.trim().replace(/^@/, '') : 'بيتواصل بنفسه على @hasa_n20'}`;
    const text = [
      '🆕 طلب إضافة جهاز جديد',
      `• الموديل: ${model.trim()}`,
      `• الشركة: ${op || '—'}`,
      `• المدينة: ${city.trim() || '—'}`,
      `• ${contact}`,
      `• يبي: ${wants.length ? wants.join('، ') : '—'}`,
      `• ${tester ? '✅ مستعد يجرّب التحديثات' : '— ما أكّد إنه يجرّب'} · ${laptop ? '💻 عنده لابتوب' : 'بدون لابتوب'}`,
      ...(label.length ? ['', '📷 من الملصق:', ...label.map(l => `  ${l}`)] : Platform.OS === 'ios' ? ['', '📷 الملصق: بيرسل صورته على تليجرام'] : []),
      ...(probe && pageInfo(probe).length ? ['', '🧾 من صفحة الراوتر:', ...pageInfo(probe).map(l => `  ${l}`)] : []),
      '', '🔎 تلقائي من الاتصال:', ...netLines.map(l => `  ${l}`),
      '',
      probe || '(بدون فحص)',
    ].join('\n');
    const ok = await sendSupportReport('newdevice', text, { driverName: model.trim() });
    // ملفات صفحة الراوتر كاملة (HTML + JS) — نعرف منها الدخول والروابط من أول طلب
    // قبل: أي خطأ هنا ينبلع بصمت (تقرير ٢٦ أكتوبر: U30 Pro — الطلب وصل والـ zip ما وصل وما أحد درى)
    let dumpNote = '';
    let auto: Verdict = NO_VERDICT;
    if (ok && scan && found) {
      try {
        setBusy('أجمع ملفات صفحة الراوتر — لا تطلع من الشاشة…');
        const { files, skipped } = await collectRouterFiles(found, n => setBusy(`أجمع ملفات صفحة الراوتر… ${n} — لا تطلع من الشاشة`));
        if (files.length) {
          setBusy(`أرسل ${files.length} ملف — لا تطلع من الشاشة…`);
          const r = await sendRouterFiles(files, { model: model.trim(), host: found, skipped });
          if (!r.ok || r.failed.length) {
            dumpNote = r.ok ? `وصل ${r.sent} ملف وما وصل ${r.failed.length}` : `ما وصلت الملفات (رد السيرفر ${r.status ?? '—'})`;
            await sendSupportReport('newdevice-dump', `📦 ملفات الصفحة: ${dumpNote}
• الموديل: ${model.trim()}
• جمعنا ${files.length} ملف
${r.failed.slice(0, 20).map(f => `  ✗ ${f}`).join('\n')}`, { driverName: model.trim() }).catch(() => false);
          }
          // الملفات وصلت ← الرسيفر يطابقها مع العائلات اللي ندعمها (ثواني)
          if (AUTOPROG_ON && r.ok && !skipAuto) {
            setBusy('أطابق ملفات راوترك مع الأجهزة اللي ندعمها…');
            auto = await askVerdict(model.trim(), found, fp).catch(() => NO_VERDICT);
          }
        } else {
          dumpNote = 'ما قدرنا نجمع ملفات الصفحة';
          await sendSupportReport('newdevice-dump', `📦 ${dumpNote} — الموديل: ${model.trim()} · ${found}`, { driverName: model.trim() }).catch(() => false);
        }
      } catch (e) {
        dumpNote = 'تعطّل جمع الملفات';
        await sendSupportReport('newdevice-dump', `📦 ${dumpNote}: ${String((e as any)?.message ?? e).slice(0, 120)} — ${model.trim()}`, { driverName: model.trim() }).catch(() => false);
      }
    }
    setBusy('');
    if (ok && found && auto.status === 'match') setCand({ v: auto, host: found, requested: true });
    else if (ok) setSent(true);
    else Alert.alert('ما وصل', 'تأكد إن النت شغّال وجرّب مرة ثانية — أو كلّمنا على تليجرام مباشرة.', [
      { text: 'رجوع', style: 'cancel' },
      { text: 'افتح تليجرام', onPress: () => Linking.openURL(TELEGRAM).catch(() => {}) },
    ]);
  };

  if (feat) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.hero}>
          <View style={s.doneIcon}><Icon name="check" size={34} color={tFg('#12b76a')} stroke={3} /></View>
          <Text style={s.title}>تبرمج راوترك ✓</Text>
          <Text style={s.sub}>هذي الميزات اللي لقيناها في راوترك وانضافت لك:</Text>
        </View>
        <View style={s.card}>
          <Text style={s.lbl}>القراءات</Text>
          <Text style={s.featLine}>✓ الإشارة{feat.found.length ? ' · ' + feat.found.join(' · ') : ''}</Text>
          {!!feat.missing.length && <Text style={[s.rowSub, { color: C.muted }]}>مو موجودة في راوترك: {feat.missing.join(' · ')}</Text>}
          <Text style={s.lbl}>التغيير</Text>
          {feat.writes.length
            ? <Text style={s.featLine}>✓ {feat.writes.join(' · ')}</Text>
            : <Text style={s.rowSub}>ما لقينا في صفحة راوترك أوامر تغيير نعرفها — قراءة بس للحين، والمبرمج يضيفها لموديلك.</Text>}
          <Text style={s.rowSub}>نفتح بس الأوامر الموجودة في صفحة راوترك نفسها، وقبل أي تغيير التطبيق يحفظ إعدادك ويرجّعه لو النت طاح. تثبيت البرج ما ينفتح تلقائي.</Text>
          {!!feat.note && <Text style={[s.rowSub, { color: tFg('#b45309') }]}>{feat.note}</Text>}
        </View>
        <Pressable style={[s.btn, { backgroundColor: '#12b76a' }]} onPress={() => router.replace(`/router/${feat.id}` as Href)} accessibilityRole="button">
          <Icon name="check" size={17} color={C.onAccent} /><Text style={s.btnTxt}>افتح راوترك</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (cand) {
    return (
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          <View style={s.hero}>
            <View style={[s.heroIcon, { backgroundColor: tBg('#12b76a1a') }]}><Icon name="check" size={30} color={tFg('#12b76a')} stroke={3} /></View>
            <Text style={s.title}>لقينا لراوترك برمجة جاهزة</Text>
            <Text style={s.sub}>{cand.v.status === 'known'
              ? `صفحة راوترك نفس صفحة راوتر اشتغل عند عضو قبلك (عائلة ${cand.v.label}).`
              : `ملفات صفحة راوترك تطابق عائلة ${cand.v.label}.`}{'\n'}نجرّبها الحين على راوترك: دخول وقراءة الإشارة بس — ما نغيّر أي إعداد.</Text>
          </View>
          <View style={s.card}>
            <Text style={s.lbl}>اسم المستخدم</Text>
            <TextInput style={[s.input, { textAlign: 'left' }]} value={tUser} onChangeText={setTUser} autoCapitalize="none" autoCorrect={false} maxLength={40} />
            <Text style={s.lbl}>كلمة مرور صفحة الراوتر</Text>
            <TextInput style={[s.input, { textAlign: 'left' }]} value={tPass} onChangeText={setTPass} secureTextEntry autoCapitalize="none" autoCorrect={false}
              placeholder="مكتوبة على الملصق تحت الراوتر" placeholderTextColor={C.muted} maxLength={64} />
            <Text style={s.rowSub}>الكلمة تبقى في جوالك — ما تنرسل لنا. لو اشتغل، نكتشف ميزات راوترك (قراءات بس — ما نغيّر شي) ونضيفها لك، ونفتح أوامر التغيير الموجودة في صفحة راوترك نفسها.</Text>
            {!!tMsg && <Text style={[s.rowSub, { color: tFg('#e5484d') }]}>{tMsg}</Text>}
          </View>
          <Pressable style={[s.btn, { backgroundColor: '#12b76a' }, (!tPass || tBusy) && { opacity: 0.45 }]} disabled={!tPass || tBusy} onPress={runCand} accessibilityRole="button">
            {tBusy ? <ActivityIndicator color={C.onAccent} /> : <Icon name="check" size={17} color={C.onAccent} />}
            <Text style={s.btnTxt}>{tBusy ? (tStep || 'أجرّب على راوترك…') : 'جرّب الحين'}</Text>
          </Pressable>
          <Pressable disabled={tBusy} onPress={() => toDeveloper(cand)} style={s.link}>
            <Text style={[s.linkTxt, { color: C.muted }]}>{cand.requested ? 'تخطَّ — طلبي عند المبرمج' : 'تخطَّ وأرسل الطلب للمبرمج'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (sent) {
    return (
      <View style={[s.page, s.center, { flex: 1, backgroundColor: C.bg }]}>
        <View style={[s.doneIcon]}><Icon name="check" size={34} color={tFg('#12b76a')} stroke={3} /></View>
        <Text style={s.title}>وصل طلبك ✓</Text>
        <Text style={s.sub}>{'جهازك انضاف لقائمة الانتظار. نضيف الأجهزة حسب عدد الطلبات، ونعلن في القروب أول ما يجهز جهازك 🌹'}{'\n'}ولما يجهز يوصلك تحديث للتطبيق بدون ما تسوي شي.</Text>
        <Pressable style={[s.btn, { backgroundColor: '#2a9fd8' }]} onPress={() => Linking.openURL(TELEGRAM).catch(() => {})}>
          <Icon name="send" size={17} color={C.onAccent} /><Text style={s.btnTxt}>كلّمنا على تليجرام</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} style={s.link}><Text style={s.linkTxt}>رجوع</Text></Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <View style={s.heroIcon}><Icon name="compass" size={30} color={tFg('#ea580c')} /></View>
          <Text style={s.title}>راوترك مو مدعوم؟ نضيفه لك</Text>
          <Text style={s.sub}>عبّي هالبيانات ونضيف جهازك للتطبيق — بالأولوية حسب عدد اللي طلبوا نفس الجهاز</Text>
        </View>

        <View style={s.card}>
          <Text style={s.lbl}>نوع الراوتر أو الموديل</Text>
          <TextInput style={s.input} value={model} onChangeText={setModel} placeholder="مكتوب على الملصق، مثل: TP-Link MR600" placeholderTextColor={C.muted} />
          {canOcr ? (
            <Pressable onPress={() => ensureScanner() && setScanning(true)} style={s.scanBtn} accessibilityRole="button">
              <Icon name="camera" size={16} color={tFg('#ea580c')} />
              <Text style={s.scanTxt}>{label.length ? 'صوّر الملصق مرة ثانية' : 'صوّر الملصق — نقرأ الموديل لحالنا'}</Text>
            </Pressable>
          ) : (
            <Text style={s.rowSub}>📷 بعد الإرسال، أرسل صورة الملصق اللي تحت الراوتر على تليجرام — تساعد كثير.</Text>
          )}
          {!!label.length && (
            <View style={s.labelBox}>
              <Text style={s.rowSub}>قرينا من الملصق (بدون كلمات المرور):</Text>
              {label.map(l => <Text key={l} style={s.labelLine}>{l}</Text>)}
            </View>
          )}
          <LabelScannerHost visible={scanning} mode="model" onClose={() => setScanning(false)}
            onResult={d => { const ls = modelLines(d.rawLines ?? []); setLabel(ls); if (!model.trim() && ls[0]) setModel(ls[0]); }} />

          <Text style={s.lbl}>الشركة</Text>
          <View style={s.chips}>
            {OPS.map(o => (
              <Pressable key={o} onPress={() => setOp(o)} style={[s.chip, op === o && s.chipOn]}>
                <Text style={[s.chipTxt, op === o && { color: C.onAccent }]}>{o}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.lbl}>مدينتك (اختياري)</Text>
          <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="مثل: شرورة" placeholderTextColor={C.muted} maxLength={30} />
        </View>

        <View style={s.card}>
          <Text style={s.lbl}>يوزرك في تليجرام (اختياري)</Text>
          <TextInput style={[s.input, { textAlign: 'left' }]} value={tg} onChangeText={setTg} placeholder="@username" placeholderTextColor={C.muted} autoCapitalize="none" maxLength={40} />
          <Text style={s.rowSub}>عشان المبرمج يكلّمك — أو تكلّمه أنت بعد الإرسال.</Text>
        </View>

        <View style={s.card}>
          <Text style={s.lbl}>وش تبي يشتغل في راوترك؟</Text>
          <View style={s.chips}>
            {WANTS.map(w => (
              <Pressable key={w} onPress={() => toggleWant(w)} style={[s.chip, wants.includes(w) && s.chipOn]}>
                <Text style={[s.chipTxt, wants.includes(w) && { color: C.onAccent }]}>{w}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[s.row, s.rowLine]}>
            <Switch value={tester} onValueChange={setTester} trackColor={{ true: '#ea580c', false: C.track }} thumbColor={C.onAccent} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>مستعد أجرّب معكم</Text>
              <Text style={s.rowSub}>نرسل لك تحديث تجريبي وتقول لنا وش اشتغل — بدونه صعب ندعم راوترك</Text>
            </View>
          </View>
          <View style={[s.row, s.rowLine]}>
            <Switch value={laptop} onValueChange={setLaptop} trackColor={{ true: '#ea580c', false: C.track }} thumbColor={C.onAccent} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>عندي لابتوب</Text>
              <Text style={s.rowSub}>ممكن نطلب منك تسجّل صفحة الراوتر من المتصفح (نشرح لك خطوة خطوة)</Text>
            </View>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.row}>
            <Switch value={scan} onValueChange={setScan} trackColor={{ true: '#ea580c', false: C.track }} thumbColor={C.onAccent} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>أرفق فحص الراوتر</Text>
              <Text style={s.rowSub}>يساعد المبرمج يضيفه أسرع — لازم تكون على واي فاي الراوتر. ما نرفع كلمات المرور ولا أجهزتك.</Text>
            </View>
          </View>
          <View style={[s.row, s.rowLine]}>
            <Switch value={agree} onValueChange={setAgree} trackColor={{ true: '#ea580c', false: C.track }} thumbColor={C.onAccent} />
            <Text style={[s.rowSub, { flex: 1 }]}>موافق أرسل هالبيانات للمبرمج عشان يتواصل معي — وما تنحفظ في التطبيق.</Text>
          </View>
        </View>

        <Pressable style={[s.btn, !canSend && { opacity: 0.45 }]} disabled={!canSend} onPress={() => send()} accessibilityRole="button">
          {busy ? <ActivityIndicator color={C.onAccent} /> : <Icon name="send" size={17} color={C.onAccent} />}
          <Text style={s.btnTxt}>{busy || 'أرسل الطلب'}</Text>
        </Pressable>

        <Pressable onPress={() => Linking.openURL(TELEGRAM).catch(() => {})} style={s.link}>
          <Text style={s.linkTxt}>أو كلّمنا على تليجرام مباشرة</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/probe' as Href)} style={s.link}>
          <Text style={[s.linkTxt, { color: C.muted, fontSize: 12.5 }]}>أدوات الاستكشاف المتقدمة (للخبراء)</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = sheet({
  page: { padding: S.lg, gap: S.md },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 6 },
  heroIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: tBg('#ea580c1a'), alignItems: 'center', justifyContent: 'center' },
  scanBtn: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: tBd('#ea580c88'), backgroundColor: tBg('#ea580c0f'), borderRadius: 14, paddingVertical: 11 },
  scanTxt: { color: tFg('#c2410c'), fontWeight: '800', fontSize: 13.5 },
  labelBox: { backgroundColor: C.rowBg, borderRadius: 12, padding: 10, gap: 2 },
  labelLine: { color: C.text, fontSize: 13, fontWeight: '700', textAlign: 'left' },
  featLine: { color: C.text, fontSize: 14, fontWeight: '700', textAlign: 'right', lineHeight: 23 },
  doneIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: tBg('#12b76a1a'), alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  sub: { color: C.sub, fontSize: 13.5, textAlign: 'center', lineHeight: 21 },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: 14, gap: 8 },
  lbl: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right', marginTop: 2 },
  input: { backgroundColor: C.rowBg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: '#ea580c', borderColor: '#ea580c' },
  chipTxt: { color: C.text, fontWeight: '700', fontSize: 13.5 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  rowLine: { borderTopWidth: 1, borderColor: C.lineSoft, paddingTop: 10 },
  rowTitle: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  rowSub: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  btn: { alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ea580c', borderRadius: 16, paddingVertical: 15 },
  btnTxt: { color: C.onAccent, fontWeight: '900', fontSize: 16 },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkTxt: { color: tFg('#2a9fd8'), fontWeight: '800', fontSize: 14 },
});
