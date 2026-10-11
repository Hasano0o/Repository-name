/**
 * اختيار اللغة: سطر في أسفل الرئيسية + بطاقة تطلع مرة وحدة لو لغة الجوال مو عربي.
 */
import { useState } from 'react';
import { View, Text, Pressable } from '../i18n/rn';
import { sheet, LANG, LANG_PICKED, Lang, setLang, deviceIsArabic, EN_MODE } from '../i18n';
import { Icon } from './Icon';
import { P } from './Pro';

const OPTS: { id: Lang; label: string }[] = [
  { id: 'ar', label: 'عربي' },
  { id: 'en', label: 'English' },
];

export function LangPicker() {
  // نبدّل مباشرة (التطبيق يعيد التشغيل باللغة الجديدة)
  const pick = (l: Lang) => { if (l !== LANG) setLang(l); };
  return (
    <View style={s.box}>
      <View style={s.icon}><Icon name="globe" size={19} color={P.blue} stroke={2.1} /></View>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Text style={s.title}>{EN_MODE ? 'Language' : 'اللغة'}</Text>
        <Text style={s.sub}>{EN_MODE ? 'English' : 'العربية'}</Text>
      </View>
      <View style={s.row}>
        {OPTS.map(o => {
          const on = o.id === LANG;
          return (
            <Pressable key={o.id} onPress={() => pick(o.id)} hitSlop={4}
              style={({ pressed }) => [s.opt, on && s.on, pressed && { opacity: 0.75 }]}>
              <Text style={[s.optTxt, on && { color: P.blue }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** رابط صغير يبدّل للغة الثانية (للشاشة الفاضية) */
export function LangLink() {
  const other: Lang = LANG === 'en' ? 'ar' : 'en';
  return (
    <Pressable onPress={() => setLang(other)} hitSlop={6} style={({ pressed }) => [s.link, pressed && { opacity: 0.7 }]}>
      <Icon name="globe" size={15} color={P.sub} stroke={2.1} />
      <Text style={s.linkTxt}>{other === 'en' ? 'English' : 'العربية'}</Text>
    </Pressable>
  );
}

/** بطاقة مرة وحدة: لغة الجوال مو عربي وما اختار لغة قبل */
export function LangAsk() {
  const [hide, setHide] = useState(LANG_PICKED !== null || deviceIsArabic());
  if (hide) return null;
  const choose = (l: Lang) => { setHide(true); setLang(l); };
  return (
    <View style={s.ask}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={s.icon}><Icon name="globe" size={19} color={P.blue} stroke={2.1} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { textAlign: 'left' }]}>Use Bandly in English?</Text>
          <Text style={[s.sub, { textAlign: 'left' }]}>You can change it anytime from the bottom of this page.</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => choose('en')} style={({ pressed }) => [s.askBtn, s.askMain, pressed && { opacity: 0.85 }]}>
          <Text style={s.askMainTxt}>English</Text>
        </Pressable>
        <Pressable onPress={() => choose('ar')} style={({ pressed }) => [s.askBtn, pressed && { opacity: 0.85 }]}>
          <Text style={s.askTxt}>عربي</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = sheet({
  box: {
    backgroundColor: P.card, borderColor: P.border, borderWidth: 1.5, borderRadius: 18,
    paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
  },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: P.blueSoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: P.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  sub: { color: P.sub, fontSize: 11.5, marginTop: 2, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', gap: 6 },
  opt: { paddingHorizontal: 12, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: P.soft, borderWidth: 1.5, borderColor: P.soft },
  on: { borderColor: P.blue, backgroundColor: P.blueSoft },
  optTxt: { color: P.sub, fontWeight: '800', fontSize: 13 },
  link: { flexDirection: 'row-reverse', alignSelf: 'center', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12 },
  linkTxt: { color: P.sub, fontWeight: '700', fontSize: 13 },
  ask: { backgroundColor: P.card, borderColor: P.blue, borderWidth: 1.5, borderRadius: 18, padding: 14, gap: 12 },
  askBtn: { flex: 1, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: P.soft },
  askMain: { backgroundColor: P.blue },
  askMainTxt: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
  askTxt: { color: P.text, fontWeight: '800', fontSize: 14 },
});
