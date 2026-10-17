import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { View, Text, Pressable, TextInput } from '../i18n/rn';
import { P } from './Pro';
import { Icon } from './Icon';
import { pingDaily } from '../services/stats';

import { sheet } from '../i18n';

/* ═══ «وش اللي موقفك؟» ═══
 * يطلع لمن ما أضاف راوتر حقيقي (فاضي أو تجريبي بس). جوابه ينرسل مع الإحصائية اليومية
 * عشان نعرف ليش ناس تفتح التطبيق وتطلع. مرة وحدة بس. */

export const BLOCKER_KEY = 'bandly.blocker';

export type Blocker = 'none' | 'unsupported' | 'howto' | 'browsing';

const OPTS: { id: Blocker; text: string }[] = [
  { id: 'none', text: 'ما عندي راوتر الحين' },
  { id: 'unsupported', text: 'راوتري مو موجود' },
  { id: 'howto', text: 'ما عرفت كيف أضيفه' },
  { id: 'browsing', text: 'أتفرج بس' },
];

export function BlockerAsk({ onAdd, onExplore }: { onAdd: () => void; onExplore: () => void }) {
  const [state, setState] = useState<'loading' | 'ask' | 'note' | 'done' | 'hidden'>('loading');
  const [pick, setPick] = useState<Blocker | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(BLOCKER_KEY).then(v => setState(v ? 'hidden' : 'ask')).catch(() => setState('hidden'));
  }, []);

  const save = async (b: Blocker, n = '') => {
    try { await AsyncStorage.setItem(BLOCKER_KEY, JSON.stringify({ r: b, note: n.trim().slice(0, 40) })); } catch {}
    pingDaily(true);
  };

  const choose = (b: Blocker) => {
    setPick(b);
    if (b === 'unsupported') { setState('note'); return; }
    save(b);
    setState('done');
  };

  if (state === 'loading' || state === 'hidden') return null;

  return (
    <View style={s.box}>
      {state === 'ask' && (
        <>
          <View style={s.head}>
            <View style={s.icon}><Icon name="spark" size={17} color={P.violet} /></View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={s.title}>وش اللي موقفك؟</Text>
              <Text style={s.sub}>سؤال سريع يساعدنا نطوّر التطبيق</Text>
            </View>
          </View>
          <View style={s.grid}>
            {OPTS.map(o => (
              <Pressable key={o.id} onPress={() => choose(o.id)} style={({ pressed }) => [s.opt, pressed && { opacity: 0.7 }]}>
                <Text style={s.optTxt}>{o.text}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {state === 'note' && (
        <>
          <Text style={s.title}>وش نوع راوترك؟</Text>
          <Text style={s.sub}>اكتب الاسم أو الموديل اللي على الملصق — نحاول نضيفه</Text>
          <TextInput
            value={note} onChangeText={setNote} placeholder="مثلاً: TP-Link MR600"
            placeholderTextColor={P.faint} style={s.input} maxLength={40} textAlign="right" autoFocus
          />
          <View style={s.row}>
            <Pressable style={s.btn} onPress={() => { save('unsupported', note); setState('done'); }}>
              <Text style={s.btnTxt}>إرسال</Text>
            </Pressable>
            <Pressable onPress={() => { save('unsupported'); setState('done'); }} hitSlop={8}>
              <Text style={s.skip}>تخطي</Text>
            </Pressable>
          </View>
        </>
      )}

      {state === 'done' && (
        <>
          <Text style={s.title}>شكراً 🙏</Text>
          {pick === 'unsupported' && (
            <>
              <Text style={s.sub}>جرّب «استكشاف جهاز» — يقرأ صفحة راوترك ويرسل لنا بصمته عشان ندعمه</Text>
              <Pressable style={s.btn} onPress={onExplore}><Text style={s.btnTxt}>استكشاف جهاز</Text></Pressable>
            </>
          )}
          {pick === 'howto' && (
            <>
              <Text style={s.sub}>أسهل طريقة: اضغط «إضافة راوتر» ثم «امسح ملصق الراوتر» وصوّر الملصق اللي تحته — نعبّي البيانات لحالها. تأكد إن جوالك متصل بواي فاي الراوتر.</Text>
              <View style={s.row}>
                <Pressable style={s.btn} onPress={onAdd}><Text style={s.btnTxt}>إضافة راوتر</Text></Pressable>
                <Pressable onPress={() => Linking.openURL('https://t.me/NetGuide1_bot?start=fix_add').catch(() => {})} hitSlop={8}>
                  <Text style={[s.skip, { color: P.blue }]}>الخطوات في تليجرام</Text>
                </Pressable>
              </View>
            </>
          )}
          {(pick === 'none' || pick === 'browsing') && (
            <Text style={s.sub}>جرّب «الراوتر التجريبي» وشوف كل المزايا بدون راوتر</Text>
          )}
        </>
      )}
    </View>
  );
}

const s = sheet({
  box: { alignSelf: 'stretch', backgroundColor: P.card, borderColor: P.border, borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 11, backgroundColor: P.violetSoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: P.text, fontWeight: '800', fontSize: 14.5, textAlign: 'right' },
  sub: { color: P.sub, fontSize: 12, lineHeight: 19, textAlign: 'right' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  opt: { flexBasis: '47%', flexGrow: 1, backgroundColor: P.soft, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 8, alignItems: 'center' },
  optTxt: { color: P.text, fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
  input: { height: 44, borderRadius: 12, backgroundColor: P.soft, color: P.text, paddingHorizontal: 12, fontSize: 14 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14 },
  btn: { alignSelf: 'flex-end', backgroundColor: P.blue, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 18 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  skip: { color: P.faint, fontWeight: '700', fontSize: 12.5 },
});
