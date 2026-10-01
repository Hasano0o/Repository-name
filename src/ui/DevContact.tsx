import { View, Text, Pressable, Linking, Alert, StyleSheet } from 'react-native';
import { Icon, IconName } from './Icon';
import { P } from './Pro';

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
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Text style={s.title}>تواصل مع المطوّر</Text>
        <Text style={s.sub}>اقتراح أو مشكلة؟</Text>
      </View>
      <View style={s.row}>
        {WAYS.map(w => (
          <Pressable key={w.id} onPress={() => open(w.url)} accessibilityLabel={w.label} hitSlop={4}
            style={({ pressed }) => [s.btn, { backgroundColor: w.color }, pressed && { opacity: 0.75, transform: [{ scale: 0.94 }] }]}>
            <Icon name={w.icon} size={19} color="#fff" stroke={2.2} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: P.card, borderColor: P.border, borderWidth: 1, borderRadius: 18,
    paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
  },
  title: { color: P.text, fontWeight: '800', fontSize: 14 },
  sub: { color: P.sub, fontSize: 11.5, marginTop: 2 },
  row: { flexDirection: 'row-reverse', gap: 8 },
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
