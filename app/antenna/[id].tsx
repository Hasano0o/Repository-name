import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Carrier, CellTower, Signal } from '../../src/drivers/types';
import { adviseAntenna, AntennaAdvice, Need } from '../../src/utils/antenna';
import { C, R, S } from '../../src/ui/theme';

const NEED_COLOR: Record<Need, string> = { yes: C.red, maybe: C.gold, no: C.green };
const NEED_BG: Record<Need, string> = { yes: C.redSoft, maybe: C.goldSoft, no: C.greenSoft };
const NEED_ICON: Record<Need, string> = { yes: '📡', maybe: '🤔', no: '✅' };

export default function AntennaAdvisor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [adv, setAdv] = useState<AntennaAdvice | null>(null);
  const [hasAnt, setHasAnt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);

  const load = useCallback(async (r: SavedRouter) => {
    setError('');
    try {
      const { sig, carriers, cells } = await withSession(r, async d => {
        const sig = d.getSignal ? await d.getSignal() : ({} as Signal);
        const carriers = d.getCarriers ? await d.getCarriers().catch(() => [] as Carrier[]) : [];
        const cells = d.getCells ? await d.getCells().catch(() => [] as CellTower[]) : [];
        return { sig, carriers, cells };
      });
      if (sig.rsrp === undefined) throw new Error('ما قدرنا نقرأ الإشارة من الراوتر.');
      if (alive.current) setAdv(adviseAntenna(sig, carriers, cells));
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive.current) return;
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      try { setHasAnt((await AsyncStorage.getItem(`antenna:${r.id}`)) === '1'); } catch {}
      await load(r);
      if (alive.current) setLoading(false);
    })();
    return () => { alive.current = false; };
  }, [id, load]);

  const toggleAnt = async () => {
    const v = !hasAnt;
    setHasAnt(v);
    if (info) try { await AsyncStorage.setItem(`antenna:${info.id}`, v ? '1' : '0'); } catch {}
  };

  const onRefresh = async () => {
    if (!info) return;
    setRefreshing(true);
    await load(info);
    setRefreshing(false);
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.blue} colors={[C.blue]} />}
      >
        {loading && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={C.blue} />
            <Text style={s.muted}>نحلّل إشارتك...</Text>
          </View>
        )}

        {!!error && <Text style={s.err}>{error}</Text>}

        {adv && (
          <>
            <View style={[s.card, { backgroundColor: NEED_BG[adv.need], borderColor: NEED_COLOR[adv.need] }]}>
              <Text style={s.q}>هل تحتاج أنتنا خارجية؟</Text>
              <Text style={[s.verdict, { color: NEED_COLOR[adv.need] }]}>{NEED_ICON[adv.need]} {adv.headline}</Text>
              {adv.reasons.map((r, i) => <Text key={i} style={s.item}>• {r}</Text>)}
              {!!adv.otherCause && <Text style={[s.item, s.bold]}>💡 {adv.otherCause}</Text>}
            </View>

            <View style={s.card}>
              <Text style={s.title}>{adv.need === 'no' ? 'لو حبيت تركّب أنتنا — هذا المناسب' : adv.type.title}</Text>
              {adv.type.points.map((p, i) => <Text key={i} style={s.item}>• {p}</Text>)}
            </View>

            <View style={s.card}>
              <View style={s.head}>
                <Text style={s.title}>فحص تركيب الأنتنا</Text>
                <Pressable style={[s.toggle, hasAnt && s.toggleOn]} onPress={toggleAnt}>
                  <Text style={[s.toggleText, hasAnt && { color: C.onAccent }]}>{hasAnt ? 'عندي أنتنا ✓' : 'عندي أنتنا؟'}</Text>
                </Pressable>
              </View>
              {hasAnt ? (
                adv.install.length ? adv.install.map((x, i) => (
                  <Text key={i} style={[s.item, { color: x.ok ? C.green : C.red }]}>{x.ok ? '✓' : '✗'} {x.text}</Text>
                )) : <Text style={s.item}>ما لقينا ملاحظات على التركيب.</Text>
              ) : (
                <Text style={s.muted2}>لو ركّبت أنتنا خارجية، فعّل الزر ونفحص لك الكيبلات والتوجيه من بيانات الراوتر.</Text>
              )}
            </View>

            {info && (
              <Pressable style={s.btn} onPress={() => router.push(`/aim/${info.id}` as Href)}>
                <Text style={s.btnText}>🔊 وجّه الأنتنا بوضع الصوت</Text>
              </Pressable>
            )}
            <Text style={s.muted2}>اسحب لتحت عشان تعيد التحليل بعد ما تغيّر مكان أو اتجاه.</Text>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.md },
  center: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  muted: { color: C.sub, fontSize: 13 },
  muted2: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 18 },
  err: { color: C.red, textAlign: 'right' },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  q: { color: C.sub, fontSize: 12.5, textAlign: 'right', fontWeight: '600' },
  verdict: { fontSize: 17, fontWeight: '800', textAlign: 'right', lineHeight: 26 },
  title: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  item: { color: C.text, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  bold: { fontWeight: '700' },
  head: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  toggle: { borderWidth: 1, borderColor: C.blue, borderRadius: R.pill, paddingVertical: 5, paddingHorizontal: 12 },
  toggleOn: { backgroundColor: C.blue },
  toggleText: { color: C.blue, fontWeight: '700', fontSize: 12 },
  btn: { backgroundColor: C.blue, borderRadius: R.md, paddingVertical: 13, alignItems: 'center' },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
});
