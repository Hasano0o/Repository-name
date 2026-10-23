/**
 * مساعد Bandly — بالصوت (المايك) أو الكتابة أو الأزرار.
 * • يفهم الطلب ويفتح الشاشة المطلوبة على طول، والشاشة تبدأ المطلوب لحالها (?auto=1).
 *   اللي يقطع النت (الترددات/الأبراج/الألعاب) يعرض تأكيده المعتاد أول — والمساعد نفسه ما يكتب على الراوتر.
 * • حالته (شغّال / موقف مؤقتاً / موقف بالكامل) محفوظة على الجهاز ومنفصلة عن الراوتر.
 *   «موقف بالكامل» ما يرجع إلا لما يضغط المستخدم «شغّل المساعد» — حتى بعد إغلاق التطبيق.
 * • المايك يظهر بس في النسخ اللي فيها مكتبة السماع (البناء الجديد) — الصوت ما يتسجل ولا يطلع من الجوال.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { ScrollView, View, Text, TextInput, Pressable } from '../../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { Icon, IconName } from '../../src/ui/Icon';
import { C, R, S, tBg, tBd, tFg } from '../../src/ui/theme';
import { sheet } from '../../src/i18n';
import {
  ACTIONS, ActionId, AssistantMode, MODE_LABEL, QUICK, cleanName, extractName, matchIntent, pauseFor, pauseLeft,
} from '../../src/assistant/core';
import { useAssistantState, loadName, saveName } from '../../src/assistant/store';
import { runAction, Reply } from '../../src/assistant/run';
import { voiceAvailable, startListening, stopListening, abortListening, speak, stopSpeaking } from '../../src/assistant/voice';

type Msg =
  | { id: number; from: 'me'; text: string }
  | ({ id: number; from: 'bot' } & Reply);

const MODE_ICON: Record<AssistantMode, IconName> = { enabled: 'check', paused: 'clock', disabled: 'power' };
const MODE_COLOR: Record<AssistantMode, string> = { enabled: '#12a07a', paused: '#d97706', disabled: '#64748b' };

const PAUSES: { label: string; mins: number | null }[] = [
  { label: '١٥ دقيقة', mins: 15 },
  { label: '٣٠ دقيقة', mins: 30 },
  { label: 'ساعة', mins: 60 },
  { label: 'لين أرجّعه', mins: null },
];

let seq = 0;
const nid = () => ++seq;

export default function AssistantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { state, mode, now, update } = useAssistantState();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  /** ننتظر اسمه؟ (أول مرة بس) */
  const [askName, setAskName] = useState(false);
  const [showPause, setShowPause] = useState(false);
  /** المايك: idle / يسمع (ومعه النص المؤقت) */
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const hasVoice = voiceAvailable();
  const scroll = useRef<ScrollView>(null);
  const alive = useRef(true);
  const started = useRef(false);

  useEffect(() => () => { alive.current = false; abortListening(); stopSpeaking(); }, []);

  // طلع من الشاشة (فتح أداة) ← نوقف السماع
  // (الكلام نخليه يكمّل — «أفتح لك…» تنقال وهو يفتح الشاشة)
  useFocusEffect(useCallback(() => () => { abortListening(); setListening(false); setHeard(''); }, []));

  // وقف المساعد (مؤقت/كامل) ← المايك يتقفل فوراً
  useEffect(() => {
    if (mode && mode !== 'enabled') { abortListening(); stopSpeaking(); setListening(false); setHeard(''); }
  }, [mode]);

  const bot = useCallback((r: Reply) => setMsgs(m => [...m, { id: nid(), from: 'bot', ...r }]), []);

  // ═══ البداية: الراوتر + الترحيب ═══
  useEffect(() => {
    getRouter(id).then(r => { if (alive.current) setInfo(r); });
  }, [id]);

  useEffect(() => {
    if (mode !== 'enabled' || started.current) return;
    started.current = true;
    loadName().then(({ name: n, asked }) => {
      if (!alive.current) return;
      setName(n);
      if (n) bot({ text: `هلا ${n} 👋 وش تبي نسوي اليوم؟`, chips: QUICK });
      else if (!asked) {
        setAskName(true);
        bot({ text: 'أهلاً بك في Bandly! وش اسمك؟ خلّني أساعدك تضبط اتصالك.\n(الاسم ينحفظ على جوالك بس — وتقدر تتخطى)' });
      } else bot({ text: 'هلا! وش تبي نسوي اليوم؟', chips: QUICK });
    });
  }, [mode, bot]);

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [msgs.length, busy]);

  // ═══ الاسم ═══
  const takeName = async (raw: string | null) => {
    setAskName(false);
    const n = raw ? (extractName(raw) ?? cleanName(raw)) : null;
    try {
      await saveName(n);
    } catch {
      bot({ text: 'ما قدرت أحفظ الاسم على الجهاز — عادي، نكمّل بدونه.', tone: 'warn' });
    }
    setName(n);
    bot({ text: n ? `تشرفنا يا ${n}! وش تبي نسوي؟` : 'تمام، نكمّل بدون اسم. وش تبي نسوي؟', chips: QUICK });
  };

  const forgetName = () => Alert.alert('اسمك', name ? `محفوظ: ${name}` : 'ما فيه اسم محفوظ', [
    { text: 'رجوع', style: 'cancel' },
    { text: 'غيّره', onPress: () => { setAskName(true); bot({ text: 'وش اسمك؟' }); } },
    ...(name ? [{ text: 'احذفه', style: 'destructive' as const, onPress: async () => {
      try { await saveName(null); setName(null); bot({ text: 'حذفت اسمك من الجهاز.' }); } catch { bot({ text: 'ما قدرت أحذفه — جرّب مرة ثانية.', tone: 'warn' }); }
    } }] : []),
  ]);

  // ═══ تنفيذ إجراء ═══
  const open = (route: string, auto?: boolean) => {
    if (!info) return;
    if (route === 'router') { router.canGoBack() ? router.back() : router.replace(`/router/${info.id}` as Href); return; }
    router.push(`/${route}/${info.id}${auto ? '?auto=1' : ''}` as Href);
  };

  const run = async (aid: ActionId, said?: string, voice = false) => {
    if (busy || mode !== 'enabled') return;
    setMsgs(m => [...m, { id: nid(), from: 'me', text: said ?? ACTIONS[aid].label }]);
    if (!info) { bot({ text: 'ما لقيت بيانات الراوتر — ارجع واختره من الرئيسية.', tone: 'warn' }); return; }
    setBusy(true);
    try {
      const r = await runAction(aid, info);
      if (!alive.current) return;
      bot(r);
      if (voice) speak(r.text);
      // الطلب يفتح شاشة ← نفتحها على طول (والشاشة تبدأ لحالها لو auto)
      if (r.go && r.open) {
        const { route, auto } = r.open;
        setTimeout(() => { if (alive.current) open(route, auto); }, voice ? 900 : 450);
      }
    } catch (e: any) {
      if (alive.current) bot({ text: `صار خطأ وما كمّلت: ${String(e?.message ?? e).slice(0, 120)}`, tone: 'warn' });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  /** نفس المسار للكتابة والصوت */
  const handle = (raw: string, voice = false) => {
    const t = raw.trim();
    if (!t || busy || mode !== 'enabled') return;
    if (askName) { setMsgs(m => [...m, { id: nid(), from: 'me', text: t }]); takeName(t); return; }
    // «اسمي …» تغيّر الاسم — «أنا …» لا (عشان «أنا أبي أقل بنق» ما تنحسب اسم)
    const n = /^(اسمي|إسمي|سمني|ناديني|نادني)\s/.test(t) ? extractName(t) : null;
    if (n) { setMsgs(m => [...m, { id: nid(), from: 'me', text: t }]); takeName(t); return; }
    const hit = matchIntent(t);
    if (!hit) {
      setMsgs(m => [...m, { id: nid(), from: 'me', text: t }]);
      const r: Reply = { text: 'ما فهمت عليك تماماً. قل مثلاً: «أفضل تردد» أو «أفضل برج» أو «افحص إشارتي».', chips: ['check_signal', 'best_band', 'best_tower', 'open_ping', 'help'] };
      bot(r);
      if (voice) speak(r.text);
      return;
    }
    run(hit.action, t, voice);
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  const send = () => { const t = input; setInput(''); handle(t); };

  // ═══ المايك ═══
  const mic = async () => {
    if (mode !== 'enabled' || busy) return;
    if (listening) { stopListening(); return; }
    setHeard('');
    setListening(true);
    const ok = await startListening({
      onPartial: t => alive.current && setHeard(t),
      onFinal: t => { if (!alive.current) return; setHeard(''); setListening(false); handleRef.current(t, true); },
      onError: msg => { if (alive.current) bot({ text: msg, tone: 'warn' }); },
      onEnd: () => { if (alive.current) { setListening(false); setHeard(''); } },
    });
    if (!ok && alive.current) setListening(false);
  };

  // ═══ التحكم بالحالة ═══
  const setMode = async (next: Parameters<typeof update>[0], done: string) => {
    try {
      await update(next);
      setShowPause(false);
      if (next.mode === 'enabled') { started.current = false; setMsgs([]); }
    } catch {
      Alert.alert('ما انحفظ', `ما قدرت أحفظ الحالة على الجهاز، فما ${done}. جرّب مرة ثانية.`);
    }
  };
  const stopAll = () => Alert.alert('إيقاف المساعد بالكامل',
    'المساعد يوقف ويبقى موقف حتى لو قفلت التطبيق أو أعدت تشغيل الجوال — لين تضغط «شغّل المساعد» بنفسك.\n\nباقي Bandly يشتغل عادي، وبيانات الراوتر ما تنلمس.',
    [{ text: 'إلغاء', style: 'cancel' }, { text: 'أوقفه', style: 'destructive', onPress: () => setMode({ mode: 'disabled', pausedUntil: null }, 'وقفته') }]);

  if (!state || !mode) {
    return <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={C.blue} /></LinearGradient>;
  }

  const off = mode !== 'enabled';

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        {/* ═══ الترويسة: الحالة بنص وأيقونة (مو لون بس) ═══ */}
        <View style={s.head}>
          <View style={s.headRow}>
            <View style={[s.avatar, { backgroundColor: tBg('#2f6bff1f'), borderColor: tBd('#2f6bff40') }]}>
              <Icon name="spark" size={20} color={tFg('#2f6bff')} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>مساعد Bandly</Text>
              <View style={[s.status, { backgroundColor: tBg(MODE_COLOR[mode] + '1a') }]} accessibilityLabel={`حالة المساعد: ${MODE_LABEL[mode]}`}>
                <Icon name={MODE_ICON[mode]} size={13} color={tFg(MODE_COLOR[mode])} stroke={2.4} />
                <Text style={[s.statusTxt, { color: tFg(MODE_COLOR[mode]) }]}>
                  {MODE_LABEL[mode]}{mode === 'paused' ? ` · ${pauseLeft(state, now)}` : ''}
                </Text>
              </View>
            </View>
            {mode === 'enabled' && (
              <Pressable onPress={forgetName} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="اسمك">
                <Icon name="user" size={18} color={C.sub} />
              </Pressable>
            )}
          </View>

          <View style={s.ctrlRow}>
            {mode === 'enabled' ? (
              <>
                <Pressable style={s.ctrl} onPress={() => setShowPause(v => !v)} accessibilityRole="button">
                  <Icon name="clock" size={15} color={C.text} /><Text style={s.ctrlTxt}>إيقاف مؤقت</Text>
                </Pressable>
                <Pressable style={s.ctrl} onPress={stopAll} accessibilityRole="button">
                  <Icon name="power" size={15} color={C.red} /><Text style={[s.ctrlTxt, { color: C.red }]}>إيقاف كامل</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={[s.ctrl, s.ctrlOn]} onPress={() => setMode({ mode: 'enabled', pausedUntil: null }, 'شغّلته')} accessibilityRole="button">
                <Icon name="power" size={15} color={C.onAccent} />
                <Text style={[s.ctrlTxt, { color: C.onAccent }]}>{mode === 'paused' ? 'كمّل الحين' : 'شغّل المساعد'}</Text>
              </Pressable>
            )}
          </View>

          {showPause && mode === 'enabled' && (
            <View style={s.pauseRow}>
              {PAUSES.map(p => (
                <Pressable key={p.label} style={s.chip} onPress={() => setMode(pauseFor(p.mins), 'وقفته')}>
                  <Text style={s.chipTxt}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {off ? (
          <View style={s.offBox}>
            <Icon name={MODE_ICON[mode]} size={34} color={C.muted} />
            <Text style={s.offTitle}>{mode === 'paused' ? 'المساعد موقف مؤقتاً' : 'المساعد موقف بالكامل'}</Text>
            <Text style={s.offBody}>
              {mode === 'paused'
                ? 'ما يبدأ أي محادثة وهو موقف. يرجع لحاله لما يخلص الوقت وأنت داخل التطبيق، أو اضغط «كمّل الحين».'
                : 'ما يرجع إلا لما تضغط «شغّل المساعد». باقي Bandly يشتغل عادي.'}
            </Text>
          </View>
        ) : (
          <>
            <ScrollView ref={scroll} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
              {msgs.map(m => m.from === 'me' ? (
                <View key={m.id} style={[s.bubble, s.me]}><Text style={s.meTxt}>{m.text}</Text></View>
              ) : (
                <View key={m.id} style={{ gap: 8 }}>
                  <View style={[s.bubble, s.bot, m.tone === 'warn' && s.warn, m.tone === 'danger' && s.danger]}>
                    <Text style={s.botTxt}>{m.text}</Text>
                  </View>
                  {m.open && (
                    <Pressable style={s.openBtn} onPress={() => open(m.open!.route, m.open!.auto)} accessibilityRole="button">
                      <Text style={s.openTxt}>افتح «{m.open.screen}»</Text>
                      <Icon name="chevron" size={15} color={C.blue} />
                    </Pressable>
                  )}
                  {!!m.chips?.length && (
                    <View style={s.chips}>
                      {m.chips.map(c => (
                        <Pressable key={c} style={s.chip} onPress={() => run(c)} disabled={busy}>
                          <Text style={s.chipTxt}>{ACTIONS[c].label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              ))}
              {listening && (
                <View style={[s.bubble, s.me, s.heard]}>
                  <Text style={s.meTxt}>{heard || 'أسمعك… تكلّم'}</Text>
                </View>
              )}
              {busy && (
                <View style={[s.bubble, s.bot, s.typing]}>
                  <ActivityIndicator size="small" color={C.blue} />
                  <Text style={s.botTxt}>أشيك...</Text>
                </View>
              )}
            </ScrollView>

            <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              {askName && (
                <Pressable style={s.skip} onPress={() => { setMsgs(m => [...m, { id: nid(), from: 'me', text: 'تخطّى' }]); takeName(null); }}>
                  <Text style={s.skipTxt}>تخطّى</Text>
                </Pressable>
              )}
              <TextInput
                style={s.input}
                value={input}
                onChangeText={setInput}
                placeholder={askName ? 'اكتب اسمك' : hasVoice ? 'تكلّم بالمايك أو اكتب…' : 'اكتب طلبك… مثل: أفضل تردد'}
                placeholderTextColor={C.muted}
                onSubmitEditing={send}
                returnKeyType="send"
                editable={!busy}
                maxLength={askName ? 24 : 200}
              />
              {hasVoice && !askName && !input.trim() ? (
                <Pressable style={[s.send, listening && s.micOn, busy && { opacity: 0.4 }]} onPress={mic} disabled={busy}
                  accessibilityRole="button" accessibilityLabel={listening ? 'وقّف السماع' : 'تكلّم'}>
                  <Icon name={listening ? 'mic-off' : 'mic'} size={20} color={C.onAccent} />
                </Pressable>
              ) : (
                <Pressable style={[s.send, (!input.trim() || busy) && { opacity: 0.4 }]} onPress={send} disabled={!input.trim() || busy}
                  accessibilityRole="button" accessibilityLabel="أرسل">
                  <Icon name="send" size={18} color={C.onAccent} />
                </Pressable>
              )}
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const s = sheet({
  head: { padding: S.lg, paddingBottom: S.md, gap: S.md, borderBottomWidth: 1, borderColor: C.lineSoft },
  headRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  status: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, alignSelf: 'flex-end', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginTop: 4 },
  statusTxt: { fontWeight: '700', fontSize: 12 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.rowBg },
  ctrlRow: { flexDirection: 'row-reverse', gap: 8 },
  ctrl: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.sm, paddingVertical: 10 },
  ctrlOn: { backgroundColor: C.blue, borderColor: C.blue },
  ctrlTxt: { color: C.text, fontWeight: '700', fontSize: 13 },
  pauseRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  offBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl, gap: 10 },
  offTitle: { color: C.text, fontWeight: '800', fontSize: 16, textAlign: 'center' },
  offBody: { color: C.sub, fontSize: 13.5, lineHeight: 22, textAlign: 'center' },
  list: { padding: S.lg, gap: 12 },
  bubble: { maxWidth: '88%', borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10 },
  me: { alignSelf: 'flex-start', backgroundColor: C.blue, borderBottomLeftRadius: 6 },
  meTxt: { color: C.onAccent, fontSize: 14.5, lineHeight: 22, textAlign: 'right' },
  bot: { alignSelf: 'flex-end', backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderBottomRightRadius: 6 },
  warn: { borderColor: C.gold, backgroundColor: C.goldSoft },
  danger: { borderColor: C.red, backgroundColor: C.redSoft },
  botTxt: { color: C.text, fontSize: 14.5, lineHeight: 23, textAlign: 'right' },
  typing: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  openBtn: { alignSelf: 'flex-end', flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: C.blueSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  openTxt: { color: C.blue, fontWeight: '800', fontSize: 13 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' },
  chip: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  chipTxt: { color: C.text, fontWeight: '700', fontSize: 13 },
  bar: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingHorizontal: S.md, paddingTop: 10, borderTopWidth: 1, borderColor: C.lineSoft, backgroundColor: C.card },
  input: { flex: 1, minHeight: 44, borderRadius: 22, paddingHorizontal: 16, backgroundColor: C.rowBg, color: C.text, fontSize: 15, textAlign: 'right' },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: C.red },
  heard: { opacity: 0.75 },
  skip: { paddingHorizontal: 10, paddingVertical: 8 },
  skipTxt: { color: C.sub, fontWeight: '700', fontSize: 13 },
});
