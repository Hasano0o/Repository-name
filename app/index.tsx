import { useCallback, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, StyleSheet, Alert,
} from 'react-native';
import { router, useFocusEffect, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SavedRouter, listRouters, getPassword, deleteRouter } from '../src/store/routers';
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
  hasPw?: boolean;
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
    let hasPw = false;
    try { hasPw = !!(await getPassword(r.id)); } catch {}
    try {
      const [sig, net] = await withSession(r, async d => Promise.all([
        d.getSignal ? d.getSignal().catch(() => null) : Promise.resolve(null),
        d.getNetworkInfo ? d.getNetworkInfo().catch(() => null) : Promise.resolve(null),
      ]));
      if (!alive.current) return;
      setStatus(s => ({
        ...s,
        [r.id]: {
          loading: false,
          signal: sig,
          online: net?.connected ?? true,
          operator: net?.operator,
          at: Date.now(),
          hasPw,
        },
      }));
    } catch (e: any) {
      if (!alive.current) return;
      setStatus(s => ({
        ...s,
        [r.id]: { loading: false, error: e?.message ?? 'تعذر الاتصال', at: Date.now(), hasPw },
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
  const open = (id: string) => router.push(`/router/${id}` as Href);
  const edit = (id: string) => router.push(`/add-router?id=${id}` as Href);
  const onDelete = (r: SavedRouter) => {
    Alert.alert(
      'حذف الراوتر',
      `تبي تحذف "${r.name}" من التطبيق؟\n\nكلمة المرور المُحفوظة راح تنحذف أيضاً.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteRouter(r.id);
              setItems(prev => prev.filter(x => x.id !== r.id));
              setStatus(prev => {
                const next = { ...prev };
                delete next[r.id];
                return next;
              });
            } catch (e: any) {
              Alert.alert('خطأ', e?.message ?? 'تعذر الحذف');
            }
          },
        },
      ],
    );
  };

  if (!loaded) {
    return (
      <View style={[s.list, { paddingTop: insets.top + S.md }]}>
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
        contentContainerStyle={[s.list, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 90 }]}
        ListHeaderComponent={
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>راوتراتي</Text>
              <Text style={s.headerSub}>
                {items.length === 1
                  ? 'راوتر واحد'
                  : `${items.length} راوترات`}
              </Text>
            </View>
            <Pressable style={s.headerExplore} onPress={explore}>
              <Text style={s.headerExploreTxt}>🧭</Text>
            </Pressable>
            <Pressable style={s.headerAdd} onPress={add}>
              <Text style={s.headerAddTxt}>+ إضافة</Text>
            </Pressable>
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
          <Pressable style={s.footerExplore} onPress={explore}>
            <Text style={s.footerExploreTxt}>🧭 استكشاف جهاز غير مدعوم</Text>
          </Pressable>
        }
        renderItem={({ item }) => {
          const st = status[item.id];
          const sig = st?.signal;
          const level = overallLevel(sig);
          const color = gradeLevel(level).color;
          const down = st?.error ? false : st?.online ?? undefined;
          const bandList = parseBands(sig?.band).slice(0, 1);
          const hasPw = st?.hasPw !== false;

          return (
            <View style={s.card}>
              {/* ─── السطر العلوي ─── */}
              <Pressable onPress={() => open(item.id)} style={s.row}>
                <View style={[s.icon, { backgroundColor: color + '18' }]}>
                  <Icon name="tower" size={18} color={color} />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                    {st?.loading && <ActivityIndicator size="small" color={C.muted} />}
                    {!st?.loading && (
                      <View
                        style={[
                          s.dot,
                          { backgroundColor: down === false ? C.red : down ? C.green : C.muted },
                        ]}
                      />
                    )}
                    <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                  </View>
                  <Text style={s.subline} numberOfLines={1}>
                    <Text style={s.ip}>{item.host}</Text>
                    <Text style={s.dotSep}>  ·  </Text>
                    <Text style={s.user}>👤 {item.username}</Text>
                  </Text>
                </View>
                <Icon name="chevron" size={16} color={C.muted} />
              </Pressable>

              {/* ─── سطر كلمة المرور + الإشارة ─── */}
              <View style={s.metaRow}>
                {hasPw ? (
                  <View style={s.pwChip}>
                    <Text style={s.pwChipTxt}>🔒 ••••••••</Text>
                  </View>
                ) : (
                  <View style={[s.pwChip, { backgroundColor: C.redSoft }]}>
                    <Text style={[s.pwChipTxt, { color: C.red }]}>⚠ بلا كلمة مرور</Text>
                  </View>
                )}
                {sig && (
                  <View style={s.sigChip}>
                    <Text style={[s.sigChipTxt, { color }]}>
                      {sig.rsrp ?? '—'} dBm
                    </Text>
                    {bandList[0] && (
                      <>
                        <Text style={s.dotSep}>  ·  </Text>
                        <Text style={s.bandTxt}>{bandList[0]}</Text>
                      </>
                    )}
                  </View>
                )}
              </View>

              {/* ─── أزرار ─── */}
              <View style={s.btnRow}>
                <Pressable
                  style={[s.primaryBtn, !hasPw && s.primaryBtnDisabled]}
                  onPress={() => (hasPw ? open(item.id) : edit(item.id))}
                  disabled={!!st?.loading}
                >
                  {st?.loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={s.primaryBtnTxt}>
                      {hasPw ? '🔓 دخول' : '🔑 إضافة بيانات'}
                    </Text>
                  )}
                </Pressable>
                <Pressable style={s.iconBtn} onPress={() => edit(item.id)}>
                  <Icon name="settings" size={16} color={C.sub} />
                </Pressable>
                <Pressable style={s.deleteBtn} onPress={() => onDelete(item)}>
                  <Icon name="trash" size={16} color={C.red} />
                </Pressable>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  list: { padding: 12, gap: 10, paddingTop: 8 },

  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 10,
  },
  headerTitle: {
    color: C.text,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'right',
    letterSpacing: -0.3,
  },
  headerSub: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 1 },
  headerExplore: {
    width: 36, height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  headerExploreTxt: { fontSize: 18 },
  footerExplore: {
    alignSelf: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  footerExploreTxt: { color: C.violet, fontWeight: '700', fontSize: 13 },
  headerAdd: {
    backgroundColor: C.blue,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  headerAddTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },

  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: C.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  subline: {
    marginTop: 3,
    fontSize: 12,
    color: C.sub,
    textAlign: 'right',
  },
  ip: { color: C.sub, fontSize: 12, fontWeight: '600' },
  user: { color: C.sub, fontSize: 12, fontWeight: '600' },
  dotSep: { color: C.muted, fontSize: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },

  metaRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pwChip: {
    backgroundColor: C.rowBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pwChipTxt: { color: C.sub, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  sigChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 2,
  },
  sigChipTxt: { fontSize: 12, fontWeight: '800' },
  bandTxt: { color: C.blue, fontSize: 11.5, fontWeight: '800' },

  btnRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: C.lineSoft,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: C.blue,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { backgroundColor: C.muted },
  primaryBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.redSoft,
    backgroundColor: C.redSoft,
    alignItems: 'center',
    justifyContent: 'center',
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
