import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { router, useFocusEffect, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SavedRouter, listRouters } from '../src/store/routers';
import { withSession } from '../src/store/sessions';
import { Signal } from '../src/drivers/types';
import { C, R, S, T } from '../src/ui/theme';
import { Icon } from '../src/ui/Icon';
import { SkeletonRouterCard, EmptyState } from '../src/ui/States';
import { LEVEL_COLOR, LEVEL_LABEL, overallLevel, parseBands } from '../src/utils/signal';
import { fmtTime } from '../src/utils/format';

interface Status {
  loading: boolean;
  online?: boolean;
  signal?: Signal | null;
  operator?: string;
  at?: number;
  error?: string;
}

export default function RoutersList() {
  const [items, setItems] = useState<SavedRouter[]>([]);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();
  const alive = useRef(true);

  const probe = useCallback(async (r: SavedRouter) => {
    setStatus(s => ({ ...s, [r.id]: { ...(s[r.id] ?? {}), loading: true } }));
    try {
      const [sig, net] = await withSession(r, async d => Promise.all([
        d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
        d.getNetworkInfo ? d.getNetworkInfo().catch(() => null) : Promise.resolve(null),
      ]));
      if (!alive.current) return;
      setStatus(s => ({
        ...s,
        [r.id]: { loading: false, signal: sig, online: net?.connected ?? true, operator: net?.operator, at: Date.now() },
      }));
    } catch (e: any) {
      if (!alive.current) return;
      setStatus(s => ({ ...s, [r.id]: { loading: false, error: e?.message ?? 'تعذر الاتصال', at: Date.now() } }));
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const rs = await listRouters();
      if (!alive.current) return;
      setItems(rs);
      setLoaded(true);
      await Promise.all(rs.slice(0, 6).map(probe));
    } catch {
      if (alive.current) setLoaded(true);
    }
  }, [probe]);

  useFocusEffect(useCallback(() => {
    alive.current = true;
    loadAll();
    return () => { alive.current = false; };
  }, [loadAll]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    if (alive.current) setRefreshing(false);
  }, [loadAll]);

  const add = () => router.push('/add-router' as Href);
  const explore = () => router.push('/probe' as Href);

  // التحميل الأول — هياكل بدل الفراغ
  if (!loaded) {
    return (
      <View style={[s.list, { paddingTop: S.md }]}>
        <SkeletonRouterCard />
        <SkeletonRouterCard />
        <SkeletonRouterCard />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="tower"
        title="أضف أول راوتر"
        text="خلّ التطبيق يتصل براوترك ويعرض لك الإشارة والسرعة والأبراج والترددات مباشرة."
      >
        <Pressable style={s.btn} onPress={add}>
          <Text style={s.btnText}>+ إضافة راوتر</Text>
        </Pressable>
        <Pressable style={s.link} onPress={explore}>
          <Text style={s.linkTxt}>🧭 استكشاف جهاز غير مدعوم</Text>
        </Pressable>
      </EmptyState>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.blue}
            colors={[C.blue]}
            title="نحدّث..."
            titleColor={C.muted}
          />
        }
        ListFooterComponent={
          <Pressable style={s.link} onPress={explore}>
            <Text style={s.linkTxt}>🧭 استكشاف جهاز غير مدعوم</Text>
          </Pressable>
        }
        renderItem={({ item }) => {
          const st = status[item.id];
          const sig = st?.signal;
          const level = overallLevel(sig);
          const color = LEVEL_COLOR[level];
          const bands = [
            ...parseBands(sig?.band),
            ...parseBands(sig?.nrBand ? 'n' + String(sig.nrBand).replace(/^n/i, '') : undefined),
          ];
          const uniq = [...new Set(bands)].slice(0, 3);
          const down = st?.error ? false : st?.online ?? undefined;

          return (
            <Pressable style={s.item} onPress={() => router.push(`/router/${item.id}` as Href)}>
              <View style={s.itemTop}>
                <View style={[s.itemIcon, { backgroundColor: st?.error ? C.redSoft : C.blueSoft }]}>
                  <Icon name="tower" size={20} color={st?.error ? C.red : C.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemName}>{item.name}</Text>
                  <Text style={s.itemSub}>
                    {st?.operator || item.driverName}{sig?.network ? '  ·  ' + sig.network : ''}
                  </Text>
                </View>
                {st?.loading ? (
                  <ActivityIndicator color={C.muted} />
                ) : (
                  <View style={[s.dot, { backgroundColor: down === false ? C.red : down ? C.green : C.muted }]} />
                )}
              </View>

              {st?.error ? (
                <View style={s.errBox}>
                  <Text style={s.itemErr}>{st.error}</Text>
                  <Pressable hitSlop={8} onPress={() => probe(item)}>
                    <Text style={s.itemRetry}>إعادة المحاولة</Text>
                  </Pressable>
                </View>
              ) : sig ? (
                <View style={s.itemBody}>
                  <View style={s.stat}>
                    <Text style={[s.statVal, { color }]}>{sig.rsrp ?? '—'}</Text>
                    <Text style={s.statLbl}>RSRP</Text>
                  </View>
                  <View style={s.statSep} />
                  <View style={s.stat}>
                    <Text style={s.statVal}>{sig.sinr ?? '—'}</Text>
                    <Text style={s.statLbl}>SINR</Text>
                  </View>
                  <View style={s.statSep} />
                  <View style={[s.stat, { flex: 1.4 }]}>
                    <View style={s.chips}>
                      {uniq.length === 0 && <Text style={s.statVal}>—</Text>}
                      {uniq.map(b => (
                        <View key={b} style={[s.chip, b.startsWith('n') && { backgroundColor: C.violetSoft }]}>
                          <Text style={[s.chipTxt, b.startsWith('n') && { color: C.violet }]}>{b}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={s.statLbl}>{LEVEL_LABEL[level]}</Text>
                  </View>
                </View>
              ) : (
                <View style={s.skeleton} />
              )}

              {!!st?.at && !st.loading && (
                <Text style={s.itemTime}>آخر تحديث {fmtTime(st.at)}</Text>
              )}
            </Pressable>
          );
        }}
      />
      <Pressable style={[s.btn, s.fab, { bottom: insets.bottom + 16 }]} onPress={add}>
        <Text style={s.btnText}>+ إضافة راوتر</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  list: { padding: 14, gap: 10 },
  item: {
    backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line,
    padding: 13, gap: 10,
  },
  itemTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 11 },
  itemIcon: { width: 42, height: 42, borderRadius: R.md, alignItems: 'center', justifyContent: 'center' },
  itemName: { color: C.text, fontSize: T.h2, fontWeight: '800', textAlign: 'right' },
  itemSub: { color: C.sub, fontSize: T.label, textAlign: 'right', marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 999 },
  itemBody: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    backgroundColor: C.rowBg, borderRadius: R.md, paddingVertical: 9, paddingHorizontal: 11,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { color: C.text, fontSize: 15, fontWeight: '800' },
  statLbl: { color: C.muted, fontSize: T.tiny },
  statSep: { width: 1, height: 24, backgroundColor: C.line },
  chips: { flexDirection: 'row-reverse', gap: 4, flexWrap: 'wrap', justifyContent: 'center' },
  chip: { backgroundColor: C.blueSoft, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  chipTxt: { color: C.blue, fontSize: T.tiny + 0.5, fontWeight: '800' },
  skeleton: { height: 46, borderRadius: R.md, backgroundColor: C.rowBg },
  errBox: {
    backgroundColor: C.redSoft, borderRadius: R.md, paddingVertical: 9, paddingHorizontal: 11,
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: S.sm,
  },
  itemErr: { color: C.red, fontSize: T.label, textAlign: 'right', flexShrink: 1 },
  itemRetry: { color: C.blue, fontSize: T.label, fontWeight: '800' },
  itemTime: { color: C.muted, fontSize: T.tiny, textAlign: 'left' },
  btn: { backgroundColor: C.blue, borderRadius: R.md, paddingVertical: 13, paddingHorizontal: 22 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 15, textAlign: 'center' },
  fab: { position: 'absolute', alignSelf: 'center' },
  link: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 14 },
  linkTxt: { color: C.violet, fontWeight: '700', fontSize: 13 },
});
