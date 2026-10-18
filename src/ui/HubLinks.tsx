import { router, Href } from 'expo-router';
import { View, Text, Pressable } from '../i18n/rn';
import { C, tBg, tFg } from './theme';
import { Icon, IconName } from './Icon';
import { sheet } from '../i18n';

/** بطاقات صغيرة أعلى الشاشة توديك للأدوات القريبة منها — بدل ما تكون كل أداة زر لحالها في صفحة الراوتر */
export function HubLinks({ links }: { links: { icon: IconName; color: string; title: string; sub: string; to: string }[] }) {
  return (
    <View style={s.row}>
      {links.map(l => (
        <Pressable key={l.to} onPress={() => router.push(l.to as Href)}
          style={({ pressed }) => [s.card, { borderColor: tFg(l.color) + '40' }, pressed && { opacity: 0.8 }]}>
          <View style={[s.icon, { backgroundColor: tBg(l.color + '1f') }]}><Icon name={l.icon} size={17} color={tFg(l.color)} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{l.title}</Text>
            <Text style={s.sub} numberOfLines={1}>{l.sub}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const s = sheet({
  row: { flexDirection: 'row-reverse', gap: 8 },
  card: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: C.card,
    borderRadius: 16, borderWidth: 1.5, paddingVertical: 10, paddingHorizontal: 10,
  },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 11, textAlign: 'right', marginTop: 1 },
});
