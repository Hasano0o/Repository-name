/**
 * شاشة «وطننا عزنا وعزنا بوحدتنا» — تطلع كل ما ينفتح التطبيق (إقلاع جديد) مثل تطبيق النهدي:
 * خلفية خضراء + الشهادة والسيف (assets/images/saudi-emblem.png — أبيض بخلفية شفافة)
 * ← السطر الأول يطلع ← «و عزنا بوحدتنا» تنزلق من اليسار ← تختفي الشاشة لحالها (~٣ ثواني).
 * ضغطة عليها تقفلها على طول. للإيقاف: SAUDI_INTRO_ON = false.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { FONT } from './fonts';

export const SAUDI_INTRO_ON = true;

const GREEN = '#015331'; // نفس أخضر الفيديو
const EMBLEM = require('../../assets/images/saudi-emblem.png'); // 773×557
const RATIO = 557 / 773;

export function SaudiIntro() {
  const [show, setShow] = useState(SAUDI_INTRO_ON);
  const { width } = useWindowDimensions();
  const emblem = useRef(new Animated.Value(0)).current;
  const line1 = useRef(new Animated.Value(0)).current;
  const line2 = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const closing = useRef(false);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(fade, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => setShow(false));
  };

  useEffect(() => {
    if (!show) return;
    const ease = Easing.out(Easing.cubic);
    Animated.sequence([
      Animated.timing(emblem, { toValue: 1, duration: 500, easing: ease, useNativeDriver: true }),
      Animated.timing(line1, { toValue: 1, duration: 400, easing: ease, useNativeDriver: true }),
      Animated.timing(line2, { toValue: 1, duration: 550, easing: ease, useNativeDriver: true }),
      Animated.delay(1300),
    ]).start(({ finished }) => { if (finished) close(); });
    const safety = setTimeout(close, 5000); // لو الحركة علّقت لأي سبب
    return () => clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!show) return null;
  const w = Math.min(width * 0.72, 420);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, st.wrap, { opacity: fade }]}>
      <StatusBar style="light" />
      <Pressable style={st.inner} onPress={close} accessibilityRole="button" accessibilityLabel="وطننا عزنا وعزنا بوحدتنا">
        <Animated.Image
          source={EMBLEM}
          resizeMode="contain"
          style={{
            width: w, height: w * RATIO, marginBottom: 56,
            opacity: emblem,
            transform: [{ scale: emblem.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          }}
        />
        <Animated.Text style={[st.txt, {
          opacity: line1,
          transform: [{ translateY: line1.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        }]}>وطننا عزنا</Animated.Text>
        {/* «و عزنا» تطلع مع السطر الأول، و«بوحدتنا» تنزلق بعدها */}
        <Animated.View style={[st.row, { opacity: line1 }]}>
          <Text style={st.txt}>و عزنا </Text>
          <Animated.Text style={[st.txt, {
            opacity: line2,
            transform: [{ translateX: line2.interpolate({ inputRange: [0, 1], outputRange: [-70, 0] }) }],
          }]}>بوحدتنا</Animated.Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { backgroundColor: GREEN, zIndex: 9999, elevation: 9999 },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  txt: { color: '#fff', fontFamily: FONT.bold, fontSize: 44, lineHeight: 66, textAlign: 'center' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center' },
});

