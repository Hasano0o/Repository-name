import { useEffect, useMemo, useState } from 'react';
import { Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { View, Text, Pressable, TextInput, ScrollView } from '../i18n/rn';
import { CITIES, getCity, setCity } from '../services/stats';
import { P } from './Pro';
import { Icon } from './Icon';

import { sheet } from '../i18n';
/**
 * سؤال لمرة وحدة في الرئيسية: وش مدينتك؟ — للإحصائيات بس، واختياري.
 * سطر واحد مضغوط، والاختيار من قائمة منبثقة فيها بحث (بدل ما تعبّي المدن الشاشة).
 * يختفي بعد ما يختار أو يضغط «لاحقاً».
 */
export function CityAsk() {
  const [city, setC] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => { getCity().then(setC); }, []);

  const list = useMemo(() => {
    const t = q.trim();
    return t ? CITIES.filter(c => c.includes(t)) : CITIES;
  }, [q]);

  if (city === null || city !== '') return null;

  const pick = (v: string) => { setOpen(false); setC(v); setCity(v); };
  const typed = q.trim();
  const canTyped = typed.length >= 2 && !CITIES.includes(typed);

  return (
    <View style={s.box}>
      <View style={s.icon}><Icon name="pin" size={18} color={P.blue} stroke={2.2} /></View>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Text style={s.title}>وش مدينتك؟</Text>
        <Text style={s.sub} numberOfLines={1}>اختياري — يساعدنا نطوّر التطبيق لمنطقتك</Text>
      </View>
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [s.pickBtn, pressed && { opacity: 0.8 }]}>
        <Text style={s.pickTxt}>اختر</Text>
      </Pressable>
      <Pressable onPress={() => pick('-')} hitSlop={8}>
        <Text style={s.later}>لاحقاً</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
          <View style={s.sheet}>
            <View style={s.grab} />
            <Text style={s.sheetTitle}>اختر مدينتك</Text>
            <View style={s.search}>
              <Icon name="pin" size={16} color={P.sub} />
              <TextInput
                value={q} onChangeText={setQ} placeholder="ابحث أو اكتب اسم مدينتك"
                placeholderTextColor={P.faint} style={s.input} maxLength={30}
                textAlign="right" returnKeyType="done"
                onSubmitEditing={() => canTyped && pick(typed)}
              />
            </View>
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {canTyped && (
                <Pressable onPress={() => pick(typed)} style={({ pressed }) => [s.row, s.rowAdd, pressed && { opacity: 0.7 }]}>
                  <Text style={[s.rowTxt, { color: P.blue }]}>اختر «{typed}»</Text>
                </Pressable>
              )}
              {list.map(c => (
                <Pressable key={c} onPress={() => pick(c)} style={({ pressed }) => [s.row, pressed && { backgroundColor: P.soft }]}>
                  <Text style={s.rowTxt}>{c}</Text>
                </Pressable>
              ))}
              {!list.length && !canTyped && <Text style={s.empty}>اكتب اسم مدينتك كامل</Text>}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = sheet({
  box: {
    backgroundColor: P.card, borderColor: P.border, borderWidth: 1, borderRadius: 18,
    paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
  },
  icon: { width: 34, height: 34, borderRadius: 11, backgroundColor: P.blueSoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: P.text, fontWeight: '800', fontSize: 14 },
  sub: { color: P.sub, fontSize: 11, marginTop: 1, textAlign: 'right' },
  pickBtn: { backgroundColor: P.blue, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  pickTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  later: { color: P.faint, fontSize: 12, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: { backgroundColor: P.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 34, gap: 10 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: P.border },
  sheetTitle: { color: P.text, fontWeight: '800', fontSize: 16, textAlign: 'right' },
  search: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: P.soft, borderRadius: 12, paddingHorizontal: 12 },
  input: { flex: 1, height: 44, color: P.text, fontSize: 14 },
  row: { paddingVertical: 13, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: P.soft },
  rowAdd: { backgroundColor: P.blueSoft, borderRadius: 10, borderBottomWidth: 0, marginBottom: 4 },
  rowTxt: { color: P.text, fontSize: 15, fontWeight: '700', textAlign: 'right' },
  empty: { color: P.sub, textAlign: 'center', paddingVertical: 20 },
});
