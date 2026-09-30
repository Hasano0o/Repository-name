/** تقييم الفني بعد ما يخلص العميل الجلسة — النجوم تطلع في دليل الفنيين */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, TextInput, ActivityIndicator } from 'react-native';
import { Icon } from './Icon';
import { P } from './Pro';
import { rateSession } from '../services/live';

import { tBg, tFg } from './theme';
export interface RateTarget { code: string; token: string; names: string[] }
const WORDS = ['', 'سيئ', 'مقبول', 'جيد', 'ممتاز', 'رهيب 🔥'];

export function RateTech({ target, onClose }: { target: RateTarget | null; onClose: () => void }) {
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const close = () => { setStars(0); setNote(''); setDone(false); onClose(); };
  const send = async () => {
    if (!target || !stars || busy) return;
    setBusy(true);
    await rateSession(target.code, target.token, stars, note.trim());
    setBusy(false);
    setDone(true);
    setTimeout(close, 1400);
  };
  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={r.dim}>
        <View style={r.box}>
          {done ? (
            <>
              <Text style={r.big}>💙</Text>
              <Text style={r.title}>شكراً لتقييمك</Text>
            </>
          ) : (
            <>
              <Text style={r.title}>كيف كانت خدمة {target?.names.join('، ') || 'الفني'}؟</Text>
              <Text style={r.sub}>تقييمك يساعد غيرك يختار فني ممتاز</Text>
              <View style={r.stars}>
                {[1, 2, 3, 4, 5].map(i => (
                  <Pressable key={i} onPress={() => setStars(i)} hitSlop={4}>
                    <Icon name="star" size={40} color={i <= stars ? tFg('#f5b301') : P.faint} stroke={i <= stars ? 2.6 : 1.8} />
                  </Pressable>
                ))}
              </View>
              <Text style={r.word}>{WORDS[stars]}</Text>
              <TextInput value={note} onChangeText={setNote} placeholder="كلمة للفني (اختياري)" placeholderTextColor={P.faint}
                style={r.in} maxLength={200} />
              <Pressable onPress={send} disabled={!stars || busy} style={[r.ok, (!stars || busy) && { opacity: 0.45 }]}>
                {busy ? <ActivityIndicator color={tFg('#fff')} /> : <Text style={r.okTxt}>أرسل التقييم</Text>}
              </Pressable>
              <Pressable onPress={close} style={{ padding: 12 }}><Text style={r.skip}>تخطّي</Text></Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const r = StyleSheet.create({
  dim: { flex: 1, backgroundColor: tBg('rgba(8,15,40,0.55)'), justifyContent: 'center', padding: 24 },
  box: { backgroundColor: P.card, borderRadius: 26, padding: 22, alignItems: 'center' },
  big: { fontSize: 44 },
  title: { color: P.text, fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  sub: { color: P.sub, fontSize: 12.5, textAlign: 'center', marginTop: 4 },
  stars: { flexDirection: 'row', gap: 6, marginTop: 16 },
  word: { color: tFg('#b07d00'), fontSize: 14, fontWeight: '800', height: 22, marginTop: 6 },
  in: { alignSelf: 'stretch', marginTop: 10, backgroundColor: P.soft, borderWidth: 1.5, borderColor: P.border, borderRadius: 14, fontSize: 14, paddingVertical: 11, paddingHorizontal: 12, color: P.text, textAlign: 'right' },
  ok: { alignSelf: 'stretch', marginTop: 12, backgroundColor: P.blue, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  okTxt: { color: tFg('#fff'), fontSize: 15.5, fontWeight: '800' },
  skip: { color: P.sub, fontSize: 13.5, fontWeight: '700' },
});
