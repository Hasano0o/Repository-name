/**
 * شريط تحت البنر: «فنيين قريبين» + «فني أنتينا؟ سجّل معنا» (يفتح البوت على صفحة التسجيل)
 */
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { BOT_TECH_SIGNUP } from '../services/techs';
import { FONT } from './fonts';
import { tBd, tBg, tFg } from './theme';

/** دبوس موقع وفوقه موجات إشارة */
function NearIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
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
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
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
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18l-6-6 6-6" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function TechStrip() {
  return (
    <View style={s.row}>
      <Pressable style={({ pressed }) => [s.flex, pressed && s.pressed]} onPress={() => router.push('/techs' as Href)}>
        <LinearGradient colors={['#1d4ed8', '#0ea5e9']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={s.card}>
          <View style={s.glow} />
          <View style={s.topRow}>
            <View style={s.iconGlass}><NearIcon /></View>
            <Chevron color="rgba(255,255,255,0.85)" />
          </View>
          <View style={s.txt}>
            <Text style={s.title} numberOfLines={1}>فنيين قريبين</Text>
            <Text style={s.sub} numberOfLines={1}>تركيب وتوجيه الأنتينا</Text>
          </View>
        </LinearGradient>
      </Pressable>

      <Pressable style={({ pressed }) => [s.flex, s.alt, pressed && s.pressed]} onPress={() => Linking.openURL(BOT_TECH_SIGNUP).catch(() => {})}>
        <View style={s.topRow}>
          <LinearGradient colors={['#fb923c', '#ea580c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.iconTile}>
            <JoinIcon />
          </LinearGradient>
          <Chevron color={tFg('#ea580c')} />
        </View>
        <View style={s.txt}>
          <Text style={[s.title, s.altTitle]} numberOfLines={1}>فني أنتينا؟</Text>
          <Text style={[s.sub, s.altSub]} numberOfLines={1}>سجّل واستقبل عملاء</Text>
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row-reverse', gap: 10, marginTop: 6 },
  flex: { flex: 1, borderRadius: 20, overflow: 'hidden' },
  pressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
  card: { gap: 12, padding: 14, minHeight: 112 },
  topRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  glow: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.10)', left: -40, top: -50 },
  iconGlass: {
    width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  iconTile: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  alt: {
    gap: 12, padding: 14, minHeight: 112,
    backgroundColor: tBg('#fffaf5'), borderWidth: 1.5, borderColor: tBd('#fed7aa'),
  },
  txt: { gap: 2 },
  title: { fontFamily: FONT.bold, color: '#ffffff', fontSize: 16.5, textAlign: 'right', letterSpacing: -0.2 },
  sub: { fontFamily: FONT.medium, color: 'rgba(255,255,255,0.86)', fontSize: 12, textAlign: 'right' },
  altTitle: { color: tFg('#7c2d12') },
  altSub: { color: tFg('#c2410c') },
});
