import { useEffect, ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle, DimensionValue } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { C, R, S, T } from './theme';
import { Icon, IconName } from './Icon';

/** مستطيل نابض — يحل محل الفراغ أثناء التحميل */
export function Skeleton({ w = '100%', h = 14, radius = R.sm, style }: {
  w?: DimensionValue; h?: number; radius?: number; style?: ViewStyle;
}) {
  const o = useSharedValue(0.45);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[{ width: w, height: h, borderRadius: radius, backgroundColor: C.track }, anim, style]}
    />
  );
}

/** هيكل بطاقة راوتر في القائمة */
export function SkeletonRouterCard() {
  return (
    <View style={s.card}>
      <View style={s.row}>
        <Skeleton w={42} h={42} radius={R.md} />
        <View style={{ flex: 1, alignItems: 'flex-end', gap: 6 }}>
          <Skeleton w={110} h={13} />
          <Skeleton w={70} h={10} />
        </View>
        <Skeleton w={9} h={9} radius={999} />
      </View>
      <Skeleton h={46} radius={R.md} />
    </View>
  );
}

/** هيكل شاشة تفاصيل — دائرة وأرقام ومربعات */
export function SkeletonDetail() {
  return (
    <View style={{ gap: S.lg }}>
      <View style={[s.card, { alignItems: 'center', gap: S.md }]}>
        <Skeleton w={130} h={130} radius={999} />
        <Skeleton w={160} h={13} />
        <Skeleton w={210} h={10} />
      </View>
      <View style={s.tiles}>
        {[0, 1, 2, 3].map(i => <Skeleton key={i} w={'47%'} h={62} radius={R.lg} />)}
      </View>
    </View>
  );
}

/** بطاقة خطأ موحّدة مع زر إعادة المحاولة */
export function ErrorCard({
  message, onRetry, retrying, hint, tone = 'error',
}: {
  message: string; onRetry?: () => void; retrying?: boolean; hint?: string;
  tone?: 'error' | 'offline';
}) {
  const offline = tone === 'offline';
  const color = offline ? C.gold : C.red;
  const soft = offline ? C.goldSoft : C.redSoft;
  const icon: IconName = offline ? 'tower' : 'bulb';
  return (
    <View style={[s.card, { backgroundColor: soft, borderColor: soft, gap: S.sm }]}>
      <View style={s.errHead}>
        <View style={[s.errIcon, { backgroundColor: C.card }]}>
          <Icon name={icon} size={17} color={color} />
        </View>
        <Text style={[s.errTitle, { color }]} numberOfLines={2}>
          {offline ? 'ما وصلنا للراوتر' : 'صار خطأ'}
        </Text>
      </View>
      <Text style={s.errBody}>{message}</Text>
      {!!hint && <Text style={s.errHint}>{hint}</Text>}
      {!!onRetry && (
        <Pressable style={[s.retry, { backgroundColor: color }, retrying && { opacity: 0.5 }]} onPress={onRetry} disabled={retrying}>
          <Icon name="refresh" size={14} color={C.onAccent} />
          <Text style={s.retryTxt}>{retrying ? 'نحاول...' : 'إعادة المحاولة'}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** حالة انقطاع الاتصال بالراوتر — مع خطوات عملية */
export function OfflineCard({ name, onRetry, retrying }: { name?: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <ErrorCard
      tone="offline"
      message={`ما قدرنا نوصل${name ? ` لـ${name}` : ' للراوتر'}. تأكد أن جوالك متصل بشبكة الراوتر نفسها (واي فاي مو بيانات الجوال).`}
      hint="لو الراوتر شغّال ومتصل، جرّب تحدّث الصفحة بعد ثوانٍ."
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}

/** حالة فاضية عامة */
export function EmptyState({ icon, title, text, children }: {
  icon: IconName; title: string; text: string; children?: ReactNode;
}) {
  return (
    <View style={s.empty}>
      <View style={s.glow}><Icon name={icon} size={40} color={C.blue} /></View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line,
    padding: 13, gap: S.sm,
  },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 11 },
  tiles: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: S.sm },
  errHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: S.sm },
  errIcon: { width: 32, height: 32, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center' },
  errTitle: { fontWeight: '800', fontSize: T.body + 1, textAlign: 'right', flexShrink: 1 },
  errBody: { color: C.text, fontSize: T.label + 0.5, textAlign: 'right', lineHeight: 20 },
  errHint: { color: C.sub, fontSize: T.label, textAlign: 'right', lineHeight: 18 },
  retry: {
    alignSelf: 'flex-end', borderRadius: R.md, paddingHorizontal: S.lg, paddingVertical: 9,
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
  },
  retryTxt: { color: C.onAccent, fontWeight: '800', fontSize: T.label + 0.5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: S.md },
  glow: {
    width: 104, height: 104, borderRadius: 52, backgroundColor: C.blueSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: S.sm,
  },
  emptyTitle: { color: C.text, fontSize: T.h1, fontWeight: '800' },
  emptyText: { color: C.sub, textAlign: 'center', lineHeight: 22, fontSize: T.body },
});
