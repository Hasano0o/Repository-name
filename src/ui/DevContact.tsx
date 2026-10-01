import { View, Text, Pressable, Linking, Alert, StyleSheet } from 'react-native';
import { Icon, IconName } from './Icon';
import { P } from './Pro';
import { tFg } from './theme';

/** معلومات تواصل صاحب التطبيق — تُعرض أسفل الرئيسية مع المظهر ونسخة التطبيق */
const PHONE = '0562294460';
const PHONE_INTL = '966562294460';
const EMAIL = 'ko.1416@hotmail.com';
const TELEGRAM = 'hasa_n20';

const WAYS: { id: string; label: string; icon: IconName; color: string; url: string }[] = [
  { id: 'wa', label: 'واتساب', icon: 'sms', color: '#25a35a', url: `https://wa.me/${PHONE_INTL}` },
  { id: 'tg', label: 'تليجرام', icon: 'send', color: '#2a9fd8', url: `https://t.me/${TELEGRAM}` },
  { id: 'call', label: 'اتصال', icon: 'call', color: '#2f6bff', url: `tel:${PHONE}` },
  { id: 'mail', label: 'إيميل', icon: 'mail', color: '#e07a3a', url: `mailto:${EMAIL}?subject=${encodeURIComponent('Bandly')}` },
];

const open = (url: string) =>
  Linking.openURL(url).catch(() => Alert.alert('ما قدرنا نفتحه', `تواصل معنا على ${PHONE} أو ${EMAIL}`));

export function DevContact() {
  return (
    <View style={s.box}>
      <View style={s.head}>
        <Text style={s.title}>تواصل مع المطوّر</Text>
        <Text style={s.sub}>اقتراح، مشكلة، أو تبي مساعدة؟</Text>
      </View>
      <View style={s.row}>
        {WAYS.map(w => (
          <Pressable key={w.id} onPress={() => open(w.url)}
            style={({ pressed }) => [s.opt, pressed && { opacity: 0.7 }]}>
            <View style={[s.icon, { backgroundColor: tFg(w.color) + '1f' }]}>
              <Icon name={w.icon} size={18} color={tFg(w.color)} stroke={2.1} />
            </View>
            <Text style={s.lbl}>{w.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.foot}>{PHONE}  ·  {EMAIL}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: P.card, borderColor: P.border, borderWidth: 1, borderRadius: 18, padding: 12, gap: 10 },
  head: { alignItems: 'flex-end', gap: 2 },
  title: { color: P.text, fontWeight: '800', fontSize: 14 },
  sub: { color: P.sub, fontSize: 11.5 },
  row: { flexDirection: 'row-reverse', gap: 8 },
  opt: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 14, backgroundColor: P.soft },
  icon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lbl: { color: P.text, fontWeight: '800', fontSize: 12 },
  foot: { color: P.faint, fontSize: 11, textAlign: 'center', writingDirection: 'ltr' },
});
