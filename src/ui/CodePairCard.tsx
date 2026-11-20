/**
 * دخول برمز من شاشة الجهاز (driver.codePair) — أول استخدام: أداة MONDO على Inseego 8800L (٢١ نوفمبر).
 * تطلع في صفحة الراوتر بس لو codePair.needed() = true. بعد الرمز الصحيح ← onDone (نعيد تحميل الصفحة عشان تبان الأدوات).
 */
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { View, Text, TextInput, Pressable } from '../i18n/rn';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { GlassCard } from './GlassCard';
import { C, tBg, tFg } from './theme';
import { FONT } from './fonts';
import { sheet } from '../i18n';

const toLatin = (s: string) => s.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');

export function CodePairCard({ r, title, hint, onDone }: { r: SavedRouter; title: string; hint: string; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  const submit = async () => {
    const c = toLatin(code);
    if (c.length !== 8) { setMsg('الرمز ٨ أرقام'); return; }
    setBusy(true); setMsg('');
    try {
      await withSession(r, async d => {
        if (!d.codePair) throw new Error('الراوتر ما يطلب رمز');
        await d.codePair.submit(c);
      }, false);
      setOk(true); setMsg('✓ تم — الأدوات صارت شغالة');
      setTimeout(onDone, 800);
    } catch (e: any) {
      setMsg(String(e?.message ?? e).slice(0, 200));
    } finally { setBusy(false); }
  };

  return (
    <GlassCard title={title} collapsible={false}>
      <View style={s.card}>
      <Text style={s.hint}>{hint}</Text>
      <View style={s.row}>
        <TextInput
          value={code}
          onChangeText={t => { setCode(toLatin(t).slice(0, 8)); setMsg(''); }}
          placeholder="12345678"
          placeholderTextColor={C.sub}
          keyboardType="number-pad"
          maxLength={8}
          style={s.input}
          editable={!busy && !ok}
          onSubmitEditing={submit}
        />
        <Pressable onPress={submit} disabled={busy || ok} style={[s.btn, (busy || ok) && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>دخول</Text>}
        </Pressable>
      </View>
      {!!msg && <Text style={[s.msg, { color: ok ? tFg('#138a36') : tFg('#b3261e') }]}>{msg}</Text>}
      </View>
    </GlassCard>
  );
}

const s = sheet({
  card: { gap: 8 },
  hint: { color: C.sub, fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: tBg('#f3f6fb'), borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 22, letterSpacing: 4, textAlign: 'center', color: C.text, fontFamily: FONT.numSemi,
  },
  btn: { backgroundColor: '#5b3df5', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, minWidth: 80, alignItems: 'center' },
  btnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  msg: { fontSize: 12.5, textAlign: 'right' },
});
