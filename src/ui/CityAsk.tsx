import { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { CITIES, getCity, setCity } from '../services/stats';
import { P } from './Pro';

/**
 * سؤال لمرة وحدة في الرئيسية: وش مدينتك؟ — للإحصائيات بس، واختياري.
 * يختفي بعد ما يختار أو يضغط «لاحقاً».
 */
export function CityAsk() {
  const [city, setC] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [txt, setTxt] = useState('');

  useEffect(() => { getCity().then(setC); }, []);
  if (city === null || city !== '') return null;

  const pick = (v: string) => { setC(v); setCity(v); };

  return (
    <View style={s.box}>
      <View style={s.head}>
        <Pressable onPress={() => pick('-')} hitSlop={8}>
          <Text style={s.later}>لاحقاً</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={s.title}>وش مدينتك؟</Text>
          <Text style={s.sub}>اختياري — يساعدنا نطوّر التطبيق لمنطقتك</Text>
        </View>
      </View>
      {!other ? (
        <View style={s.chips}>
          {CITIES.map(c => (
            <Pressable key={c} onPress={() => pick(c)} style={({ pressed }) => [s.chip, pressed && s.chipOn]}>
              <Text style={s.chipTxt}>{c}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setOther(true)} style={({ pressed }) => [s.chip, s.chipAlt, pressed && s.chipOn]}>
            <Text style={[s.chipTxt, { color: P.blue }]}>مدينة ثانية</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.row}>
          <Pressable
            onPress={() => txt.trim().length >= 2 && pick(txt)}
            style={[s.ok, txt.trim().length < 2 && { opacity: 0.5 }]}
          >
            <Text style={s.okTxt}>تم</Text>
          </Pressable>
          <TextInput
            value={txt} onChangeText={setTxt} placeholder="اكتب اسم مدينتك"
            placeholderTextColor={P.faint} style={s.input} maxLength={30} autoFocus
            textAlign="right" returnKeyType="done"
            onSubmitEditing={() => txt.trim().length >= 2 && pick(txt)}
          />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: P.card, borderColor: P.border, borderWidth: 1, borderRadius: 18, padding: 14, gap: 12 },
  head: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  title: { color: P.text, fontWeight: '800', fontSize: 15 },
  sub: { color: P.sub, fontSize: 11.5, marginTop: 2, textAlign: 'right' },
  later: { color: P.faint, fontSize: 12.5, fontWeight: '700' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, backgroundColor: P.soft },
  chipAlt: { backgroundColor: P.blueSoft },
  chipOn: { opacity: 0.6 },
  chipTxt: { color: P.text, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row-reverse', gap: 8 },
  input: {
    flex: 1, height: 42, borderRadius: 12, backgroundColor: P.soft, color: P.text,
    paddingHorizontal: 12, fontSize: 14,
  },
  ok: { height: 42, paddingHorizontal: 18, borderRadius: 12, backgroundColor: P.blue, alignItems: 'center', justifyContent: 'center' },
  okTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
