/**
 * دخولية «مُحسّن الألعاب» (١٧ نوفمبر — طلب حسن): شاشة كاملة ثانيتين تقريباً مع موسيقى ألعاب قصيرة،
 * وبعدها تختفي وتبان إعدادات الألعاب.
 * - الموسيقى أصلية من تأليفنا (assets/sounds/game-intro.m4a) — تحترم زر الصامت في الآيفون وما توقف موسيقى العضو.
 * - ضغطة على الشاشة = تخطي. زر 🔊/🔇 يحفظ اختيار الصوت (bandly.gameIntroSound).
 * - الحركة متزامنة مع الموسيقى (٤ ثواني): صعود (0–1.3ث) ← نغمات (0.6–1.95ث) ← الضربة (2ث) ← «يلّا نلعب» ← تختفي (3.5ث).
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sheet } from '../i18n';

const SOUND_KEY = 'bandly.gameIntroSound';
const MUSIC = require('../../assets/sounds/game-intro.m4a');
const HIT_MS = 2000;
const OUT_AT = 3500;

export function GameIntro({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [sound, setSound] = useState(true);
  const [ready, setReady] = useState(false);
  const player = useRef<AudioPlayer | null>(null);
  const finished = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const fade = useRef(new Animated.Value(1)).current;
  const icon = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const title = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;

  const finish = (fast = false) => {
    if (finished.current) return;
    finished.current = true;
    timers.current.forEach(clearTimeout);
    if (fast) { try { player.current?.pause(); } catch {} }
    Animated.timing(fade, { toValue: 0, duration: fast ? 180 : 380, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone());
  };

  useEffect(() => {
    let alive = true;
    // الصوت: نقرأ الاختيار المحفوظ ونشغّل على طول (الافتراضي شغّال)
    AsyncStorage.getItem(SOUND_KEY).then(async v => {
      if (!alive) return;
      if (v === 'off') { setSound(false); return; }
      try {
        await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
        if (!alive || finished.current) return;
        const p = createAudioPlayer(MUSIC);
        p.volume = 0.8;
        player.current = p;
        p.play();
      } catch {}
    }).catch(() => {});

    Animated.parallel([
      // الأيقونة تكبر مع الصعود
      Animated.timing(icon, { toValue: 1, duration: 1300, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
      Animated.loop(Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])),
      // العنوان مع النغمات
      Animated.sequence([
        Animated.delay(800),
        Animated.timing(title, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.timing(bar, { toValue: 1, duration: HIT_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      // الضربة: وميض + موجة تطلع من الأيقونة
      Animated.sequence([
        Animated.delay(HIT_MS),
        Animated.parallel([
          Animated.sequence([
            Animated.timing(flash, { toValue: 1, duration: 70, useNativeDriver: true }),
            Animated.timing(flash, { toValue: 0, duration: 380, useNativeDriver: true }),
          ]),
          Animated.timing(ring, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]),
      ]),
    ]).start();

    timers.current.push(setTimeout(() => setReady(true), HIT_MS));
    timers.current.push(setTimeout(() => finish(false), OUT_AT));
    return () => {
      alive = false;
      timers.current.forEach(clearTimeout);
      // نخلي ذيل الموسيقى يكمل بعد ما تختفي الدخولية، وبعدها نحرر المشغّل
      const p = player.current;
      if (p) setTimeout(() => { try { p.remove(); } catch {} }, 2500);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    AsyncStorage.setItem(SOUND_KEY, next ? 'on' : 'off').catch(() => {});
    if (!next) { try { player.current?.pause(); } catch {} }
  };

  const iconScale = icon.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const glowOp = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const ringOp = ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.8, 0] });
  const titleY = title.interpolate({ inputRange: [0, 1], outputRange: [26, 0] });
  const barW = bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, zIndex: 50, elevation: 50 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => finish(true)} accessibilityLabel="تخطي">
        <LinearGradient colors={['#1a1147', '#120c33', '#070b1d']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={s.bg}>
          <View style={s.center}>
            <Animated.View style={[s.ring, { opacity: ringOp, transform: [{ scale: ringScale }] }]} />
            <Animated.View style={[s.glow, { opacity: glowOp, transform: [{ scale: glowScale }] }]} />
            <Animated.View style={{ transform: [{ scale: iconScale }], opacity: icon }}>
              <LinearGradient colors={['#a67cff', '#5b2be0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.iconBox}>
                <Text style={s.iconTxt}>🎮</Text>
              </LinearGradient>
            </Animated.View>

            <Animated.View style={{ alignItems: 'center', gap: 6, opacity: title, transform: [{ translateY: titleY }] }}>
              <Text style={s.title}>مُحسّن الألعاب</Text>
              <Text style={[s.sub, ready && s.subReady]}>{ready ? 'يلّا نلعب 🔥' : 'نجهّز لك أقل بنق…'}</Text>
            </Animated.View>

            <View style={s.track}>
              <Animated.View style={[s.fill, { width: barW }]}>
                <LinearGradient colors={['#22d3ee', '#a67cff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={StyleSheet.absoluteFill} />
              </Animated.View>
            </View>
          </View>

          <Text style={[s.skip, { bottom: insets.bottom + 28 }]}>اضغط للتخطي</Text>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#c4b5fd', opacity: Animated.multiply(flash, 0.35) }]} />
        </LinearGradient>
      </Pressable>

      <Pressable onPress={toggleSound} hitSlop={12} style={[s.sound, { top: insets.top + 14 }]} accessibilityLabel={sound ? 'اكتم الصوت' : 'شغّل الصوت'}>
        <Text style={s.soundTxt}>{sound ? '🔊' : '🔇'}</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = sheet({
  bg: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 22, width: '100%', paddingHorizontal: 40 },
  glow: { position: 'absolute', top: -14, width: 150, height: 150, borderRadius: 75, backgroundColor: '#7c3aed' },
  ring: { position: 'absolute', top: 4, width: 114, height: 114, borderRadius: 57, borderWidth: 3, borderColor: '#c4b5fd' },
  iconBox: {
    width: 122, height: 122, borderRadius: 34, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
  },
  iconTxt: { fontSize: 62 },
  title: { color: '#fff', fontWeight: '900', fontSize: 30, textAlign: 'center' },
  sub: { color: '#c4b5fd', fontWeight: '700', fontSize: 15, textAlign: 'center' },
  subReady: { color: '#67e8f9', fontWeight: '900', fontSize: 17 },
  track: { width: '70%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', flexDirection: 'row-reverse' },
  fill: { height: 6, borderRadius: 3, overflow: 'hidden' },
  skip: { position: 'absolute', color: 'rgba(255,255,255,0.45)', fontSize: 12.5, fontWeight: '700' },
  sound: {
    position: 'absolute', left: 16, width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  soundTxt: { fontSize: 19 },
});
