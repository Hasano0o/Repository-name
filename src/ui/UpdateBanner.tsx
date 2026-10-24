import { useEffect, useRef, useState } from 'react';
import { AppState, Modal } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import * as Updates from 'expo-updates';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, isDark, tBg, tFg } from './theme';
import { FONT } from './fonts';
import { progress } from './Progress';
import { sheet } from '../i18n';

/**
 * تحديث عن بُعد — التطبيق ينزّل التحديث بالخلفية عند الفتح.
 * لما يجهز: نافذة واضحة في نص الشاشة «حدّث الحين» (ما تطلع وقت عملية شغالة على الراوتر).
 * لو اختار «لاحقاً»: يبقى زر صغير فوق يذكّره.
 */
export function UpdateBanner() {
  const { isUpdatePending, isUpdateAvailable, isDownloading, downloadedUpdate, availableUpdate } = Updates.useUpdates();
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(progress.active());
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    if (isUpdateAvailable && !isUpdatePending && !isDownloading) {
      Updates.fetchUpdateAsync().catch(() => {});
    }
  }, [isUpdateAvailable, isUpdatePending, isDownloading]);

  // نشيك على تحديث جديد كل ما رجع المستخدم للتطبيق (مو بس عند الفتح من الصفر)،
  // وكل ١٠ دقايق وهو مفتوح — عشان يوصل التحديث بدون ما يقفل ويفتح مرتين.
  const lastCheck = useRef(Date.now());
  const leftAt = useRef(0);
  const pendingRef = useRef({ pending: false, silent: false });
  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    const check = (minGap: number) => {
      if (Date.now() - lastCheck.current < minGap) return;
      lastCheck.current = Date.now();
      Updates.checkForUpdateAsync().catch(() => {});
    };
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') { leftAt.current = Date.now(); return; }
      if (st !== 'active') return;
      const away = leftAt.current ? Date.now() - leftAt.current : 0;
      // تحديث صامت نازل وجاهز والمستخدم كان برا ٣٠ ث+ ← نطبّقه على طول (ما فيه عملية شغالة)
      if (pendingRef.current.pending && pendingRef.current.silent && away > 30_000 && !progress.active()) {
        Updates.reloadAsync().catch(() => {});
        return;
      }
      check(45_000);
    });
    const t = setInterval(() => { if (AppState.currentState === 'active') check(9 * 60_000); }, 10 * 60_000);
    return () => { sub.remove(); clearInterval(t); };
  }, []);

  // ما نقاطع عملية شغالة على الراوتر (قفل تردد، تجربة دمج…)
  useEffect(() => {
    if (!isUpdatePending) return;
    const t = setInterval(() => setBusy(progress.active()), 1500);
    return () => clearInterval(t);
  }, [isUpdatePending]);

  // تحديث صامت: ينزل ويتطبّق لحاله أول ما يفتح التطبيق من جديد — بدون نافذة
  const m: any = (downloadedUpdate ?? availableUpdate)?.manifest;
  const silent = !!(m?.extra?.expoClient?.extra?.silentUpdate);
  pendingRef.current = { pending: isUpdatePending, silent };
  if (!Updates.isEnabled || !isUpdatePending || busy || silent) return null;
  const reload = () => Updates.reloadAsync().catch(() => {});

  if (later) {
    return (
      <View style={[s.pillWrap, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={reload} style={({ pressed }) => [s.pill, pressed && { opacity: 0.85 }]}>
          <Text style={s.pillTxt}>⬆️ تحديث جاهز — اضغط للتحديث</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setLater(true)}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <LinearGradient colors={['#2f6bff', '#6a45ec']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.head}>
            <View style={s.ring} />
            <Text style={s.emoji}>🚀</Text>
            <Text style={s.title}>تحديث جديد جاهز</Text>
            <Text style={s.sub}>فيه إصلاحات ومزايا جديدة لـ Bandly</Text>
          </LinearGradient>
          <View style={s.body}>
            <Text style={s.note}>التحديث نزل خلاص — ياخذ ثانيتين والتطبيق يرجع مثل ما هو. راوتراتك وإعداداتك ما تتغير.</Text>
            <Pressable onPress={reload} style={({ pressed }) => [s.btn, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}>
              <Text style={s.btnTxt}>حدّث الحين</Text>
            </Pressable>
            <Pressable onPress={() => setLater(true)} hitSlop={8} style={s.laterBtn}>
              <Text style={s.laterTxt}>لاحقاً</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = sheet({
  backdrop: { flex: 1, backgroundColor: 'rgba(8,12,30,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 400, backgroundColor: C.card, borderRadius: 28, overflow: 'hidden' },
  head: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 20, gap: 4, overflow: 'hidden' },
  ring: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 24, borderColor: 'rgba(255,255,255,0.08)', left: -60, top: -70 },
  emoji: { fontSize: 44, marginBottom: 4 },
  title: { fontFamily: FONT.bold, color: '#ffffff', fontSize: 22, textAlign: 'center' },
  sub: { fontFamily: FONT.medium, color: 'rgba(255,255,255,0.85)', fontSize: 13.5, textAlign: 'center' },
  body: { padding: 18, gap: 12 },
  note: { fontFamily: FONT.regular, color: isDark ? C.sub : '#5b6785', fontSize: 13, lineHeight: 21, textAlign: 'center' },
  btn: { backgroundColor: tBg('#2f6bff'), borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  btnTxt: { fontFamily: FONT.bold, color: tFg('#ffffff'), fontSize: 17 },
  laterBtn: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 12 },
  laterTxt: { fontFamily: FONT.semibold, color: C.sub, fontSize: 13.5 },
  pillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    backgroundColor: tBg('#2f6bff'), borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16,
    shadowColor: '#1b2b5c', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  pillTxt: { fontFamily: FONT.bold, color: tFg('#ffffff'), fontSize: 13 },
});
