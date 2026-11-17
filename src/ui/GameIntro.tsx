/**
 * دخولية «مُحسّن الألعاب» (١٧ نوفمبر — طلب حسن): شاشة كاملة مع موسيقى ألعاب قصيرة،
 * وبعد الضربة تطلع «وش بتلعب اليوم؟» — بلاطات الألعاب الأشهر بالسعودية (src/utils/games.ts).
 * - الموسيقى أصلية من تأليفنا (assets/sounds/game-intro.m4a) — تحترم زر الصامت في الآيفون وما توقف موسيقى العضو.
 * - قبل الاختيار: ضغطة على الشاشة = نروح للاختيار على طول. زر 🔊/🔇 يحفظ اختيار الصوت (bandly.gameIntroSound).
 * - الحركة متزامنة مع الموسيقى: صعود (0–1.3ث) ← نغمات (0.6–1.95ث) ← الضربة (2ث) ← «يلّا نلعب» ← الأيقونة تطلع فوق وتنزل البلاطات (2.6ث).
 * - pickOnly: من زر «غيّر لعبتك» — بدون موسيقى ولا انتظار، على الاختيار مباشرة.
 * - onDone(id): اللعبة اللي اختارها (أو undefined لو تخطى).
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sheet } from '../i18n';
import { GAMES, GameDef, gameById } from '../utils/games';

const SOUND_KEY = 'bandly.gameIntroSound';
const MUSIC = require('../../assets/sounds/game-intro.m4a');
const HIT_MS = 2000;
const PICK_AT = 2600;

export function GameIntro({ onDone, current, pickOnly }: {
  onDone: (game?: string) => void;
  /** اللعبة المحفوظة — تطلع مختارة + زر «كمّل بـ…» */
  current?: string | null;
  pickOnly?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const [sound, setSound] = useState(true);
  const [ready, setReady] = useState(!!pickOnly);
  const [picking, setPicking] = useState(!!pickOnly);
  const [sel, setSel] = useState<string | null>(current ?? null);
  const [pickH, setPickH] = useState(0);
  const player = useRef<AudioPlayer | null>(null);
  const finished = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const fade = useRef(new Animated.Value(pickOnly ? 0 : 1)).current;
  const icon = useRef(new Animated.Value(pickOnly ? 1 : 0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const title = useRef(new Animated.Value(pickOnly ? 1 : 0)).current;
  const bar = useRef(new Animated.Value(pickOnly ? 1 : 0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const pick = useRef(new Animated.Value(pickOnly ? 1 : 0)).current;
  const tiles = useRef(GAMES.map(() => new Animated.Value(pickOnly ? 1 : 0))).current;

  const saved = gameById(current);
  // اللعبة المحفوظة توصل بعد ما تنفتح الدخولية (قراءة التخزين) — نعلّم بلاطتها لو ما اختار شي للحين
  const touched = useRef(false);
  useEffect(() => { if (!touched.current && current) setSel(current); }, [current]);

  const finish = (game?: string, fast = false) => {
    if (finished.current) return;
    finished.current = true;
    timers.current.forEach(clearTimeout);
    if (fast) { try { player.current?.pause(); } catch {} }
    Animated.timing(fade, { toValue: 0, duration: fast ? 200 : 380, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone(game));
  };

  const showPicker = () => {
    if (picking || finished.current) return;
    timers.current.forEach(clearTimeout);
    setReady(true);
    setPicking(true);
    Animated.timing(pick, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.stagger(55, tiles.map(t => Animated.spring(t, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }))).start();
  };

  useEffect(() => {
    let alive = true;
    if (pickOnly) {
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      return () => { alive = false; };
    }
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
      Animated.timing(icon, { toValue: 1, duration: 1300, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
      Animated.loop(Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])),
      Animated.sequence([
        Animated.delay(800),
        Animated.timing(title, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.timing(bar, { toValue: 1, duration: HIT_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
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
    timers.current.push(setTimeout(showPicker, PICK_AT));
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

  const choose = (g: GameDef) => {
    if (finished.current) return;
    touched.current = true;
    setSel(g.id);
    timers.current.push(setTimeout(() => finish(g.id), 260));
  };

  // الأيقونة والعنوان يطلعون فوق ويصغرون، عشان تاخذ البلاطات مكانها تحت
  const heroH = 250;
  const room = H - pickH - insets.bottom - 24;
  const heroTarget = Math.max(insets.top + 70, insets.top + (room - insets.top) / 2);
  const shift = pickH ? heroTarget - H / 2 : -H * 0.26;
  const smallScale = Math.min(0.72, Math.max(0.5, (room - insets.top - 40) / heroH));

  const iconScale = icon.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const glowOp = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const ringOp = ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.8, 0] });
  const titleY = title.interpolate({ inputRange: [0, 1], outputRange: [26, 0] });
  const heroY = pick.interpolate({ inputRange: [0, 1], outputRange: [0, shift] });
  const heroS = pick.interpolate({ inputRange: [0, 1], outputRange: [1, smallScale] });
  const barOp = pick.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' });
  const barW = bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const pickY = pick.interpolate({ inputRange: [0, 1], outputRange: [60, 0] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, zIndex: 50, elevation: 50 }]}>
      <LinearGradient colors={['#1a1147', '#120c33', '#070b1d']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={s.bg}>
        <Pressable style={StyleSheet.absoluteFill} onPress={showPicker} disabled={picking} accessibilityLabel="تخطي" />

        <Animated.View pointerEvents="none" style={[s.center, { transform: [{ translateY: heroY }, { scale: heroS }] }]}>
          <Animated.View style={[s.ring, { opacity: ringOp, transform: [{ scale: ringScale }] }]} />
          <Animated.View style={[s.glow, { opacity: glowOp, transform: [{ scale: glowScale }] }]} />
          <Animated.View style={{ transform: [{ scale: iconScale }], opacity: icon }}>
            <LinearGradient colors={['#a67cff', '#5b2be0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.iconBox}>
              <Text style={s.iconTxt}>🎮</Text>
            </LinearGradient>
          </Animated.View>

          <Animated.View style={{ alignItems: 'center', gap: 6, opacity: title, transform: [{ translateY: titleY }] }}>
            <Text style={s.title}>مُحسّن الألعاب</Text>
            <Text style={[s.sub, ready && s.subReady]}>{picking ? 'وش بتلعب اليوم؟' : ready ? 'يلّا نلعب 🔥' : 'نجهّز لك أقل بنق…'}</Text>
          </Animated.View>

          <Animated.View style={[s.track, { opacity: barOp }]}>
            <Animated.View style={[s.fill, { width: barW }]}>
              <LinearGradient colors={['#22d3ee', '#a67cff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
          </Animated.View>
        </Animated.View>

        {!picking && <Text style={[s.skip, { bottom: insets.bottom + 28 }]}>اضغط للتخطي</Text>}

        <Animated.View
          pointerEvents={picking ? 'box-none' : 'none'}
          onLayout={e => setPickH(e.nativeEvent.layout.height)}
          style={[s.picker, { paddingBottom: insets.bottom + 16, opacity: pick, transform: [{ translateY: pickY }] }]}
        >
          <Text style={s.pickHint}>نرتّب لك السيرفرات والنصايح حسب لعبتك</Text>
          <View style={s.grid}>
            {GAMES.map((g, i) => {
              const on = sel === g.id;
              const t = tiles[i];
              return (
                <Animated.View
                  key={g.id}
                  style={[s.cell, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}
                >
                  <Pressable
                    onPress={() => choose(g)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [s.tileWrap, on && { shadowColor: g.colors[0], shadowOpacity: 0.8 }, pressed && s.pressed]}
                  >
                    <LinearGradient colors={g.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.tile, on && s.tileOn]}>
                      <View style={s.emojiBox}><Text style={s.emoji}>{g.emoji}</Text></View>
                      <Text style={s.gName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{g.name}</Text>
                      <Text style={s.gKind} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{g.kind}</Text>
                      {on && <View style={s.check}><Text style={[s.checkTxt, { color: g.colors[1] }]}>✓</Text></View>}
                    </LinearGradient>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>

          {saved ? (
            <Pressable onPress={() => finish(saved.id)} style={({ pressed }) => [pressed && s.pressed]}>
              <LinearGradient colors={['#a67cff', '#5b2be0']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.go}>
                <Text style={s.goTxt}>كمّل بـ {saved.name} ▶</Text>
              </LinearGradient>
            </Pressable>
          ) : null}
          <Pressable onPress={() => finish(undefined)} hitSlop={10}>
            <Text style={s.later}>{saved ? 'رجوع' : 'بعدين'}</Text>
          </Pressable>
        </Animated.View>

        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#c4b5fd', opacity: Animated.multiply(flash, 0.35) }]} />
      </LinearGradient>

      {!pickOnly && (
        <Pressable onPress={toggleSound} hitSlop={12} style={[s.sound, { top: insets.top + 14 }]} accessibilityLabel={sound ? 'اكتم الصوت' : 'شغّل الصوت'}>
          <Text style={s.soundTxt}>{sound ? '🔊' : '🔇'}</Text>
        </Pressable>
      )}
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
  subReady: { color: '#67e8f9', fontWeight: '900', fontSize: 19 },
  track: { width: '70%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', flexDirection: 'row-reverse' },
  fill: { height: 6, borderRadius: 3, overflow: 'hidden' },
  skip: { position: 'absolute', color: 'rgba(255,255,255,0.45)', fontSize: 12.5, fontWeight: '700' },
  picker: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, gap: 12 },
  pickHint: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', rowGap: 10 },
  cell: { width: '33.333%', paddingHorizontal: 5 },
  tileWrap: { borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  tile: {
    height: 104, borderRadius: 20, padding: 10, alignItems: 'center', justifyContent: 'center', gap: 3,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)', overflow: 'hidden',
  },
  tileOn: { borderWidth: 3, borderColor: '#fff' },
  emojiBox: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  emoji: { fontSize: 21 },
  gName: { color: '#fff', fontWeight: '900', fontSize: 13.5, textAlign: 'center', lineHeight: 17 },
  gKind: { color: 'rgba(255,255,255,0.82)', fontWeight: '700', fontSize: 10.5, textAlign: 'center' },
  check: {
    position: 'absolute', top: 7, left: 7, width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  checkTxt: { fontSize: 12, fontWeight: '900' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  go: { borderRadius: 18, paddingVertical: 15, alignItems: 'center', marginHorizontal: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' },
  goTxt: { color: '#fff', fontWeight: '900', fontSize: 16 },
  later: { color: 'rgba(255,255,255,0.55)', fontWeight: '800', fontSize: 13.5, textAlign: 'center', paddingVertical: 4 },
  sound: {
    position: 'absolute', left: 16, width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  soundTxt: { fontSize: 19 },
});
