/**
 * شريط تحت البنر: «فنيين قريبين» + «فني أنتينا؟ سجّل معنا» (يفتح البوت على صفحة التسجيل)
 */
import type { ReactNode } from 'react';
import { Linking, } from 'react-native';
import { Pressable, Text, View } from '../i18n/rn';
import { router, Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { BOT_TECH_SIGNUP } from '../services/techs';
import { FONT } from './fonts';
import { C, tBd, tBg } from './theme';

import { sheet, EN_MODE } from '../i18n';
/** دبوس موقع وفوقه موجات إشارة */
function NearIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M12 22s-6.5-5.6-6.5-10.6a6.5 6.5 0 0 1 13 0C18.5 16.4 12 22 12 22z" fill="#ffffff" />
      <Circle cx={12} cy={11.3} r={2.4} fill="#2563eb" />
      <Path d="M16.6 3.2a8 8 0 0 1 3.3 3.6" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M18.8 1.2a11 11 0 0 1 4 5" stroke="#ffffff" strokeWidth={1.6} strokeLinecap="round" opacity={0.6} />
    </Svg>
  );
}

/** مفتاح ربط وعليه علامة + */
function JoinIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.4-3.4a6 6 0 0 1-7.9 7.9l-6.3 6.3a2.1 2.1 0 0 1-3-3l6.3-6.3a6 6 0 0 1 7.9-7.9z"
        stroke="#ffffff" strokeWidth={2} strokeLinejoin="round" fill="rgba(255,255,255,0.18)"
      />
      <Circle cx={18.5} cy={18.5} r={4.6} fill="#ffffff" />
      <Path d="M18.5 16.4v4.2M16.4 18.5h4.2" stroke="#ea580c" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function Chevron({ color }: { color: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
      <Path d={EN_MODE ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** بطاقة مدمجة: أيقونة يمين · عنوان وسطر · سهم صغير يسار */
function Tile({ title, sub, colors, tint, border, icon, onPress }: {
  title: string; sub: string; colors: [string, string]; tint: string; border: string; icon: ReactNode; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.tile, { borderColor: border }, pressed && s.pressed]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>{icon}</LinearGradient>
      <View style={s.txt}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        <Text style={s.sub} numberOfLines={1}>{sub}</Text>
      </View>
      <View style={[s.chev, { backgroundColor: tint }]}><Chevron color={colors[1]} /></View>
    </Pressable>
  );
}

export function TechStrip() {
  return (
    <View style={s.row}>
      <Tile title="فنيين قريبين" sub="تركيب وتوجيه" colors={['#3b82f6', '#1d4ed8']}
        tint={tBg('#e8efff')} border={tBd('#c7d7fe')} icon={<NearIcon />} onPress={() => router.push('/techs' as Href)} />
      <Tile title="فني أنتينا؟" sub="سجّل معنا" colors={['#fb923c', '#ea580c']}
        tint={tBg('#fff1e6')} border={tBd('#fed7aa')} icon={<JoinIcon />} onPress={() => Linking.openURL(BOT_TECH_SIGNUP).catch(() => {})} />
    </View>
  );
}

const s = sheet({
  row: { flexDirection: 'row-reverse', gap: 10, marginTop: 6 },
  tile: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 10,
    borderRadius: 18, backgroundColor: C.card, borderWidth: 1.5,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txt: { flex: 1, gap: 1 },
  title: { fontFamily: FONT.bold, color: C.text, fontSize: 14.5, textAlign: 'right' },
  sub: { fontFamily: FONT.medium, color: '#6b7796', fontSize: 11, textAlign: 'right' },
  chev: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
