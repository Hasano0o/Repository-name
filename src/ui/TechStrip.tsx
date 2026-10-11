/**
 * شريط تحت البنر: «فنيين قريبين منك» + «فني أنتينا؟ سجّل معنا» (يفتح البوت على صفحة التسجيل)
 */
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BOT_TECH_SIGNUP } from '../services/techs';
import { tBd, tBg, tFg } from './theme';

export function TechStrip() {
  return (
    <View style={s.row}>
      <Pressable style={({ pressed }) => [s.flex, pressed && { opacity: 0.85 }]} onPress={() => router.push('/techs' as Href)}>
        <LinearGradient colors={['#0ea5e9', '#2563eb']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.main}>
          <Text style={s.emoji}>👷</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.mainTitle}>فنيين قريبين</Text>
            <Text style={s.mainSub}>تركيب أنتينا وتوجيه</Text>
          </View>
        </LinearGradient>
      </Pressable>
      <Pressable style={({ pressed }) => [s.flex, s.alt, pressed && { opacity: 0.85 }]} onPress={() => Linking.openURL(BOT_TECH_SIGNUP).catch(() => {})}>
        <Text style={s.emoji}>🛠️</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.altTitle}>فني أنتينا؟</Text>
          <Text style={s.altSub}>سجّل معنا</Text>
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row-reverse', gap: 10, marginTop: 4 },
  flex: { flex: 1, borderRadius: 18, overflow: 'hidden' },
  main: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 14, minHeight: 64 },
  alt: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 14, minHeight: 64,
    backgroundColor: tBg('#fff7ed'), borderWidth: 1.5, borderColor: tBd('#fed7aa'),
  },
  emoji: { fontSize: 24 },
  mainTitle: { color: '#ffffff', fontSize: 14.5, fontWeight: '900', textAlign: 'right' },
  mainSub: { color: '#e0f2fe', fontSize: 11.5, fontWeight: '700', textAlign: 'right', marginTop: 1 },
  altTitle: { color: tFg('#9a3412'), fontSize: 14.5, fontWeight: '900', textAlign: 'right' },
  altSub: { color: tFg('#c2410c'), fontSize: 11.5, fontWeight: '700', textAlign: 'right', marginTop: 1 },
});
