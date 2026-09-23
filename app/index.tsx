import { useCallback, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { router, useFocusEffect, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SavedRouter, listRouters } from '../src/store/routers';
import { withSession } from '../src/store/sessions';
import { Signal } from '../src/drivers/types';
import { C, R, S, T } from '../src/ui/theme';
import { Icon } from '../src/ui/Icon';
import { SkeletonRouterCard, EmptyState } from '../src/ui/States';
import { LEVEL_COLOR, LEVEL_LABEL, overallLevel, parseBands, signalScore } from '../src/utils/signal';
import { fmtTime } from '../src/utils/format';

interface Status {
  loading: boolean;
  online?: boolean;
  signal?: Signal | null;
  operator?: string;
  at?: number;
  error?: string;
  prevRsrp?: number;
}

function gradeLevel(level: string): { label: string; color: string } {
  const lvl = LEVEL_LABEL[level as keyof typeof LEVEL_LABEL] ?? '—';
  const col = LEVEL_COLOR[level as keyof typeof LEVEL_COLOR] ?? C.muted;
  return { label: lvl, color: col };
}

function Gauge({ score, color, size = 56 }: { score: number; color: string; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const CC = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, score));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={cx} cy={cy} r={r} stroke={C.track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={cx} cy={cy} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${CC * v} ${CC}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
      <Text style={{ color, fontSize: 13, fontWeight: '900', letterSpacing: -0.3 }}>
        {Math.round(v * 100)}
      </Text>
    </View>
  );
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
      setStatus(s => {
        const prev = s[r.id]?.signal?.rsrp;
        return {
          ...s,
          [r.id]: {
            loading: false,
            signal: sig,
            online: net?.connected ?? true,
            operator: net?.operator,
            at: Date.now(),
            prevRsrp: prev,
          },
        };
      });
    } catch (e: any) {
      if (!alive.current) return;
      setStatus(s => ({
        ...s,
        [r.id]: { loading: false, error: e?.message ?? 'تعذر الاتصال', at: Date.now() },
      }));
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

  const onlineCount = items.filter(it => {
    const st = status[it.id];
    if (!st || st.error) return false;
    return st.online !== false;
  }).length;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
        ListHeaderComponent={
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>راوتراتي</Text>
              <Text style={s.headerSub}>
                {items.length === 1
                  ? 'راوتر واحد'
                  : `${items.length} راوترات${onlineCount > 0 ? ` · ${onlineCount} متصل` : ''}`}
              </Text>
            </View>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.blue}
            colors={[C.blue]}
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
          const lteBands = parseBands(sig?.band);
          const nrBandsRaw = sig?.nrBand ? [`n${String(sig.nrBand).replace(/^n/i, '')}`] : [];
          const uniq = [...new Set([...lteBands, ...nrBandsRaw])].slice(0, 4);
          const down = st?.error ? false : st?.online ?? undefined;
          const score = sig ? signalScore({ rsrp: sig.rsrp, sinr: sig.sinr }) : 0;
          const delta = sig?.rsrp !== undefined && st?.prevRsrp !== undefined
            ? sig.rsrp - st.prevRsrp
            : undefined;

          return (
            <Pressable
              style={({ pressed }) => [
                s.card,
                pressed && { opacity: 0.85, transform: [{ scale: 0.995 }] },
              ]}
              onPress={() => router.push(`/router/${item.id}` as Href)}
            >
              <View style={[s.accent, { backgroundColor: st?.error ? C.red : color }]} />

              <View style={s.head}>
                <View style={[s.iconWrap, { backgroundColor: st?.error ? C.redSoft : color + '15' }]}>
                  <Icon name="tower" size={22} color={st?.error ? C.red : color} />
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
                  <View
                    style={[
                      s.dot,
                      { backgroundColor: down === false ? C.red : down ? C.green : C.muted },
                    ]}
                  />
                )}
              </View>

              {st?.error ? (
                <View style={s.errBox}>
                  <Text style={s.errTxt} numberOfLines={2}>{st.error}</Text>
                  <Pressable hitSlop={8} onPress={() => probe(item)} style={s.retryBtn}>
                    <Text style={s.retryTxt}>إعادة</Text>
                  </Pressable>
                </View>
              ) : sig ? (
                <>
                  <View style={s.mainRow}>
                    <View style={s.gaugeWrap}>
                      <Gauge score={score} color={color} size={56} />
                    </View>
                    <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 4 }}>
                        <Text style={[s.rsrpBig, { color }]}>{sig.rsrp ?? '—'}</Text>
                        <Text style={s.rsrpUnit}>dBm</Text>
                      </View>
                      <Text style={s.rsrpLabel}>RSRP</Text>
                      {delta !== undefined && Math.abs(delta) >= 1 && (
                        <Text style={[s.deltaTxt, { color: delta > 0 ? C.green : C.red }]}>
                          {delta > 0 ? `↑ +${Math.round(delta)}` : `↓ ${Math.round(delta)}`} dB
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={s.statsRow}>
                    <View style={s.statCell}>
                      <Text style={s.statVal}>{sig.sinr ?? '—'}</Text>
                      <Text style={s.statLbl}>SINR</Text>
                    </View>
                    <View style={s.statSep} />
                    <View style={s.statCell}>
                      <Text style={s.statVal}>{sig.rsrq ?? '—'}</Text>
                      <Text style={s.statLbl}>RSRQ</Text>
                    </View>
                    <View style={s.statSep} />
                    <View style={s.statCell}>
                      <Text style={[s.statVal, { color }]}>{g.label}</Text>
                      <Text style={s.statLbl}>التقييم</Text>
                    </View>
                  </View>

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
                      {!!st?.at && <Text style={s.time}>{fmtTime(st.at)}</Text>}
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
      <Pressable
        style={[s.fab, { bottom: insets.bottom + 16 }]}
        onPress={add}
      >
        <Icon name="tower" size={22} color="#fff" />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  list: { padding: 14, gap: 12, paddingTop: 6 },

  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 10,
  },
  headerTitle: {
    color: C.text,
    fontSize: 26,
    fontWeight: '900',
    textAlign: 'right',
    letterSpacing: -0.5,
  },
  headerSub: { color: C.sub, fontSize: 13, textAlign: 'right', marginTop: 2 },

  card: {
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    overflow: 'hidden',
    shadowColor: C.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  accent: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 5,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
  },

  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: C.text, fontSize: 17, fontWeight: '900', textAlign: 'right' },
  sub: { color: C.sub, fontSize: 12.5, textAlign: 'right', marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  mainRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 4,
  },
  gaugeWrap: { alignItems: 'center', justifyContent: 'center' },
  rsrpBig: { fontSize: 34, fontWeight: '900', letterSpacing: -1, lineHeight: 38 },
  rsrpUnit: { color: C.muted, fontSize: 12, fontWeight: '800' },
  rsrpLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  deltaTxt: { fontSize: 11.5, fontWeight: '800' },

  statsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: C.rowBg,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statSep: { width: 1, height: 24, backgroundColor: C.line },
  statVal: { color: C.text, fontSize: 15, fontWeight: '800' },
  statLbl: { color: C.muted, fontSize: 10.5, fontWeight: '700' },

  bandRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: C.lineSoft,
    paddingTop: 10,
  },
  bandChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  bandChipLte: { backgroundColor: C.blueSoft },
  bandChipNr: { backgroundColor: C.violetSoft },
  bandTxt: { color: C.blue, fontSize: 12, fontWeight: '800' },
  time: { color: C.muted, fontSize: 10.5 },

  errBox: {
    backgroundColor: C.redSoft,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  errTxt: {
    color: C.red,
    fontSize: 12.5,
    textAlign: 'right',
    flex: 1,
    lineHeight: 18,
  },
  retryBtn: {
    backgroundColor: C.red,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
  },
  retryTxt: { color: '#fff', fontSize: 12.5, fontWeight: '800' },

  skeleton: { height: 60, borderRadius: 14, backgroundColor: C.rowBg },

  fab: {
    position: 'absolute',
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.blue,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.blue,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },

  btn: {
    backgroundColor: C.blue,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 22,
  },
  btnText: {
    color: C.onAccent,
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },
  link: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 14 },
  linkTxt: { color: C.violet, fontWeight: '700', fontSize: 13 },
});
