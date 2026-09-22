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

function gradeLevel(level: string): { label: string; color: string } {
  const lvl = LEVEL_LABEL[level as keyof typeof LEVEL_LABEL] ?? '—';
  const col = LEVEL_COLOR[level as keyof typeof LEVEL_COLOR] ?? C.muted;
  return { label: lvl, color: col };
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
          const g = gradeLevel(level);
          const color = g.color;

          // جمع الباندات
          const lteBands = parseBands(sig?.band);
          const nrBandsRaw = sig?.nrBand ? [`n${String(sig.nrBand).replace(/^n/i, '')}`] : [];
          const uniq = [...new Set([...lteBands, ...nrBandsRaw])].slice(0, 4);

          const down = st?.error ? false : st?.online ?? undefined;
          const dotColor = down === false ? C.red : down ? C.green : C.muted;

          return (
            <Pressable
              style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
              onPress={() => router.push(`/router/${item.id}` as Href)}
            >
              {/* شريط جانبي بلون الحالة */}
              <View style={[s.accent, { backgroundColor: st?.error ? C.red : color }]} />

              {/* ═══ الرأس: أيقونة + اسم + حالة ═══ */}
              <View style={s.head}>
                <View style={[s.icon, { backgroundColor: st?.error ? C.redSoft : C.blueSoft }]}>
                  <Icon name="tower" size={22} color={st?.error ? C.red : C.blue} />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.sub} numberOfLines={1}>
                    {st?.operator || item.driverName}
                    {sig?.network ? '  ·  ' + sig.network : ''}
                  </Text>
                </View>
                {st?.loading ? (
                  <ActivityIndicator color={C.muted} size="small" />
                ) : (
                  <View style={[s.dot, { backgroundColor: dotColor }]} />
                )}
              </View>

              {/* ═══ الخطأ ═══ */}
              {st?.error ? (
                <View style={s.errBox}>
                  <Text style={s.errTxt} numberOfLines={2}>{st.error}</Text>
                  <Pressable hitSlop={8} onPress={() => probe(item)}>
                    <Text style={s.retryTxt}>إعادة</Text>
                  </Pressable>
                </View>
              ) : sig ? (
                <>
                  {/* ═══ صف القيم: RSRP كبير + SINR ═══ */}
                  <View style={s.metrics}>
                    <View style={s.metricBig}>
                      <Text style={[s.metricVal, { color }]}>
                        {sig.rsrp ?? '—'}
                      </Text>
                      <Text style={s.metricUnit}>dBm</Text>
                    </View>
                    <View style={s.metricSmall}>
                      <Text style={s.metricSmallVal}>{sig.sinr ?? '—'}</Text>
                      <Text style={s.metricSmallLbl}>SINR</Text>
                    </View>
                    <View style={s.metricSmall}>
                      <Text style={s.metricSmallVal}>{sig.rsrq ?? '—'}</Text>
                      <Text style={s.metricSmallLbl}>RSRQ</Text>
                    </View>
                    <View style={[s.gradeChip, { backgroundColor: color + '22' }]}>
                      <Text style={[s.gradeTxt, { color }]}>{g.label}</Text>
                    </View>
                  </View>

                  {/* ═══ الباندات في سطر منفصل ═══ */}
                  {uniq.length > 0 && (
                    <View style={s.bandRow}>
                      {uniq.map(b => {
                        const isNr = b.startsWith('n');
                        return (
                          <View
                            key={b}
                            style={[s.bandChip, isNr ? s.bandChipNr : s.bandChipLte]}
                          >
                            <Text style={[s.bandTxt, isNr && { color: C.violet }]}>{b}</Text>
                          </View>
                        );
                      })}
                      <View style={{ flex: 1 }} />
                      {!!st?.at && (
                        <Text style={s.time}>قبل {fmtTime(st.at)}</Text>
                      )}
                    </View>
                  )}
                </>
              ) : (
                <View style={s.skeleton} />
              )}
            </Pressable>
          );
        }}
      />

      <Pressable style={[s.fab, { bottom: insets.bottom + 16 }]} onPress={add}>
        <Text style={s.fabTxt}>+ إضافة راوتر</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  list: { padding: 14, gap: 12 },

  // ═══ البطاقة ═══
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    paddingRight: 18,
    gap: 12,
    overflow: 'hidden',
    shadowColor: C.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  accent: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
  },

  // ═══ الرأس ═══
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: C.text, fontSize: 17, fontWeight: '800', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 12.5, textAlign: 'right', marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  // ═══ صف القيم ═══
  metrics: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  metricBig: {
    flexDirection: 'row-reverse',
    alignItems: 'baseline',
    gap: 3,
  },
  metricVal: { fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  metricUnit: { color: C.muted, fontSize: 11, fontWeight: '700' },

  metricSmall: { alignItems: 'center', minWidth: 40 },
  metricSmallVal: { color: C.text, fontSize: 15, fontWeight: '800' },
  metricSmallLbl: { color: C.muted, fontSize: 10.5, marginTop: 1 },

  gradeChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    marginRight: 'auto',
  },
  gradeTxt: { fontWeight: '800', fontSize: 12 },

  // ═══ الباندات ═══
  bandRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: C.lineSoft,
    paddingTop: 10,
  },
  bandChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  bandChipLte: { backgroundColor: C.blueSoft, borderColor: 'transparent' },
  bandChipNr: { backgroundColor: C.violetSoft, borderColor: 'transparent' },
  bandTxt: { color: C.blue, fontSize: 12, fontWeight: '800' },
  time: { color: C.muted, fontSize: 10.5 },

  // ═══ خطأ ═══
  errBox: {
    backgroundColor: C.redSoft,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  errTxt: { color: C.red, fontSize: 12.5, textAlign: 'right', flex: 1 },
  retryTxt: { color: C.blue, fontSize: 12.5, fontWeight: '800' },

  skeleton: { height: 60, borderRadius: 14, backgroundColor: C.rowBg },

  // ═══ FAB ═══
  fab: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: C.blue,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 28,
    shadowColor: C.blue,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  fabTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },

  // ═══ أزرار عامة ═══
  btn: { backgroundColor: C.blue, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 22 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 15, textAlign: 'center' },
  link: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 14 },
  linkTxt: { color: C.violet, fontWeight: '700', fontSize: 13 },
});
