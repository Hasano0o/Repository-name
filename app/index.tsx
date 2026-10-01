import { useCallback, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, StyleSheet, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SavedRouter, listRouters, getPassword, deleteRouter } from '../src/store/routers';
import { withSession } from '../src/store/sessions';
import { Signal } from '../src/drivers/types';
import { Icon } from '../src/ui/Icon';
import { SkeletonRouterCard, EmptyState } from '../src/ui/States';
import { overallLevel, parseBands, parseNrBands } from '../src/utils/signal';
import {
  P, shadow, Hero, GlassBtn, Val, QBar, Chip, PrimaryBtn,
  lvlColor, lvlSoft, lvlLabel, ratioOf, RANGE,
} from '../src/ui/Pro';

import { tBd, tBg, tFg, THEME_PREF, ThemePref, setThemePref } from '../src/ui/theme';
import { UpdateStatus } from '../src/ui/UpdateStatus';
import { DevContact } from '../src/ui/DevContact';
interface Status {
  loading: boolean;
  online?: boolean;
  signal?: Signal | null;
  operator?: string;
  at?: number;
  error?: string;
  hasPw?: boolean;
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
      <View style={[s.list, { paddingTop: insets.top + 12, flex: 1, backgroundColor: P.bg }]}>
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
        <PrimaryBtn text="إضافة راوتر" icon="plus" onPress={add} style={{ alignSelf: 'stretch' }} />
        <Pressable style={s.link} onPress={explore}>
          <Icon name="compass" size={16} color={P.violet} />
          <Text style={s.linkTxt}>استكشاف جهاز غير مدعوم</Text>
        </Pressable>
      </EmptyState>
    );
  }

  // ملخص الترويسة
  const statuses = items.map(i => status[i.id]);
  const onlineCount = statuses.filter(x => x && !x.loading && !x.error && x.online !== false).length;
  const anyLoading = statuses.some(x => !x || x.loading);
  const rsrps = statuses.map(x => x?.signal?.rsrp).filter((v): v is number => v !== undefined);
  const bestRsrp = rsrps.length ? Math.max(...rsrps) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: P.bg }}>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={[s.list, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <Hero style={{ marginBottom: 4 }}>
            <View style={s.heroTop}>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={s.hello}>Bandly</Text>
                <Text style={s.heroTitle}>راوتراتي</Text>
              </View>
              <GlassBtn icon="compass" onPress={explore} />
              <Pressable onPress={add} style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.85 }]}>
                <Text style={s.addTxt}>إضافة</Text>
                <Icon name="plus" size={16} color={P.blue} stroke={2.6} />
              </Pressable>
            </View>

            <View style={s.stats}>
              <View style={s.stat}>
                <Text style={s.statVal}>{items.length}</Text>
                <Text style={s.statLbl}>{items.length === 1 ? 'راوتر' : 'راوترات'}</Text>
              </View>
              <View style={s.statSep} />
              <View style={s.stat}>
                {anyLoading && onlineCount === 0
                  ? <ActivityIndicator size="small" color={tFg('#fff')} style={{ height: 26 }} />
                  : <Text style={s.statVal}>{onlineCount}</Text>}
                <Text style={s.statLbl}>متصل الآن</Text>
              </View>
              <View style={s.statSep} />
              <View style={s.stat}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={s.statVal}>{bestRsrp ?? '—'}</Text>
                  {bestRsrp !== undefined && <Text style={s.statUnit}> dBm</Text>}
                </View>
                <Text style={s.statLbl}>أقوى إشارة</Text>
              </View>
            </View>
          </Hero>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={P.blue} colors={[P.blue]} />
        }
        ListFooterComponent={
          <View style={{ gap: 12 }}>
          <Pressable style={({ pressed }) => [s.tech, pressed && { opacity: 0.85 }]} onPress={() => router.push('/tech' as Href)}>
            <View style={s.flip}><Icon name="chevron" size={16} color={tFg('#fff')} /></View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={s.techTitle}>وضع الفني</Text>
              <Text style={s.techSub}>تابع إشارة عميل حيّة ووجّهه عن بُعد</Text>
            </View>
            <View style={s.techIcon}><Icon name="aim" size={20} color={tFg('#fff')} /></View>
          </Pressable>
          <Pressable style={({ pressed }) => [s.explore, pressed && { opacity: 0.8 }]} onPress={explore}>
            <View style={s.flip}><Icon name="chevron" size={16} color={P.violet} /></View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={s.exploreTitle}>استكشاف جهاز غير مدعوم</Text>
              <Text style={s.exploreSub}>راوترك ما ظهر؟ خلّ التطبيق يتعرّف عليه</Text>
            </View>
            <View style={s.exploreIcon}>
              <Icon name="compass" size={20} color={P.violet} />
            </View>
          </Pressable>
          <ThemePicker />
          <UpdateStatus />
          <DevContact />
          </View>
        }
        renderItem={({ item }) => {
          const st = status[item.id];
          const sig = st?.signal;
          const level = overallLevel(sig);
          const color = lvlColor(level);
          const down = st?.error ? false : st?.online ?? undefined;
          const band = [...parseBands(sig?.band), ...parseNrBands(sig?.nrBand)];
          const hasNr = sig?.nrRsrp !== undefined || !!sig?.nrBand;
          const hasPw = st?.hasPw !== false;
          const loading = !!st?.loading;

          const stTxt = loading ? 'نفحص…' : down === false ? 'غير متصل' : down ? 'متصل' : '—';
          const stCol = loading ? P.sub : down === false ? P.red : down ? P.green : P.sub;
          const stBg = loading ? P.soft : down === false ? P.redSoft : down ? P.greenSoft : P.soft;

          return (
            <View style={s.card}>
              {/* ─── الرأس ─── */}
              <Pressable onPress={() => open(item.id)} style={s.row}>
                <LinearGradient
                  colors={sig ? [color, color + 'AA'] : [P.heroA, P.heroB]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={s.avatar}
                >
                  <Icon name="tower" size={22} color={tFg('#fff')} stroke={2.1} />
                </LinearGradient>
                <View style={{ flex: 1, alignItems: 'flex-end', gap: 5 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                    <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                    <View style={[s.state, { backgroundColor: stBg }]}>
                      <View style={[s.stateDot, { backgroundColor: stCol }]} />
                      <Text style={[s.stateTxt, { color: stCol }]}>{stTxt}</Text>
                    </View>
                  </View>
                  <View style={s.metaRow}>
                    <View style={s.meta}>
                      <Text style={s.metaTxt}>{item.host}</Text>
                      <Icon name="wifi" size={12} color={P.sub} stroke={2.2} />
                    </View>
                    <View style={s.meta}>
                      <Text style={s.metaTxt}>{item.username}</Text>
                      <Icon name="user" size={12} color={P.sub} stroke={2.2} />
                    </View>
                    {!!st?.operator && (
                      <View style={s.meta}>
                        <Text style={s.metaTxt} numberOfLines={1}>{st.operator}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={s.flip}><Icon name="chevron" size={18} color={P.faint} /></View>
              </Pressable>

              {/* ─── شريط الإشارة ─── */}
              {sig ? (
                <View style={[s.signal, { backgroundColor: lvlSoft(level) }]}>
                  <View style={s.sigTop}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      <Text style={[s.sigLevel, { color }]}>الإشارة: {lvlLabel(level)}</Text>
                      {band.slice(0, 2).map(b => (
                        <Chip key={b} text={b}
                          color={b.startsWith('n') ? P.violet : P.blue}
                          bg={b.startsWith('n') ? P.violetSoft : P.blueSoft} />
                      ))}
                      {hasNr && !band.some(b => b.startsWith('n')) && <Chip text="5G" color={P.violet} bg={P.violetSoft} />}
                    </View>
                    <Val v={sig.rsrp} unit="dBm" size={17} color={color} />
                  </View>
                  <QBar ratio={ratioOf(sig.rsrp, RANGE.rsrp)} color={color} track="rgba(255,255,255,0.8)" />
                </View>
              ) : st?.error ? (
                <View style={[s.signal, { backgroundColor: P.redSoft }]}>
                  <Text style={[s.sigLevel, { color: P.red, textAlign: 'right' }]} numberOfLines={2}>
                    تعذّر الوصول للراوتر — تأكد إنك على شبكته
                  </Text>
                </View>
              ) : loading ? (
                <View style={[s.signal, { backgroundColor: P.soft }]}>
                  <Text style={[s.sigLevel, { color: P.sub, textAlign: 'right' }]}>نقرأ الإشارة…</Text>
                  <QBar ratio={0.15} color={P.faint} />
                </View>
              ) : null}

              {/* ─── كلمة المرور + الأزرار ─── */}
              <View style={s.btnRow}>
                <PrimaryBtn
                  small
                  style={{ flex: 1 }}
                  text={hasPw ? (loading ? 'يتصل…' : 'دخول للراوتر') : 'إضافة بيانات الدخول'}
                  icon={hasPw ? 'login' : 'lock'}
                  busy={loading}
                  disabled={loading}
                  colors={hasPw ? [P.heroA, P.heroB] : [P.amber, tBg('#f97316')]}
                  onPress={() => (hasPw ? open(item.id) : edit(item.id))}
                />
                <Pressable style={s.iconBtn} onPress={() => edit(item.id)} hitSlop={4}>
                  <Icon name="settings" size={18} color={P.sub} />
                </Pressable>
                <Pressable style={[s.iconBtn, s.delBtn]} onPress={() => onDelete(item)} hitSlop={4}>
                  <Icon name="trash" size={18} color={P.red} />
                </Pressable>
              </View>
              {hasPw && (
                <View style={s.pwRow}>
                  <Text style={s.pwTxt}>كلمة المرور محفوظة بأمان على جهازك</Text>
                  <Icon name="lock" size={11} color={P.faint} stroke={2.2} />
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const THEMES: { id: ThemePref; label: string; icon: string }[] = [
  { id: 'light', label: 'فاتح', icon: '☀️' },
  { id: 'dark', label: 'داكن', icon: '🌙' },
  { id: 'system', label: 'حسب الجوال', icon: '📱' },
];

function ThemePicker() {
  const pick = (t: ThemePref) => {
    if (t === THEME_PREF) return;
    Alert.alert('المظهر', 'التطبيق بيعيد التشغيل عشان يطبّق الألوان الجديدة.', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'طبّق', onPress: () => { setThemePref(t); } },
    ]);
  };
  return (
    <View style={s.theme}>
      <Text style={s.themeTitle}>المظهر</Text>
      <View style={s.themeRow}>
        {THEMES.map(t => {
          const on = t.id === THEME_PREF;
          return (
            <Pressable key={t.id} onPress={() => pick(t.id)} style={[s.themeOpt, on && s.themeOn]}>
              <Text style={s.themeIcon}>{t.icon}</Text>
              <Text style={[s.themeTxt, on && { color: P.blue }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  theme: { backgroundColor: P.card, borderColor: P.border, borderWidth: 1, borderRadius: 18, padding: 12, gap: 10 },
  themeTitle: { color: P.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  themeRow: { flexDirection: 'row-reverse', gap: 8 },
  themeOpt: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: 14, backgroundColor: P.soft, borderWidth: 1.5, borderColor: P.soft },
  themeOn: { borderColor: P.blue, backgroundColor: P.blueSoft },
  themeIcon: { fontSize: 18 },
  themeTxt: { color: P.sub, fontWeight: '800', fontSize: 12 },
  list: { padding: 16, gap: 14 },
  flip: { transform: [{ scaleX: -1 }] },

  heroTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  hello: { color: tFg('rgba(255,255,255,0.75)'), fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  heroTitle: { color: tFg('#fff'), fontSize: 28, fontWeight: '800', textAlign: 'right', marginTop: -2 },
  addBtn: {
    height: 40, borderRadius: 14, backgroundColor: tBg('#fff'), paddingHorizontal: 14,
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
  },
  addTxt: { color: P.blue, fontSize: 14, fontWeight: '800' },

  stats: {
    flexDirection: 'row-reverse', marginTop: 18, backgroundColor: tBg('rgba(255,255,255,0.14)'),
    borderRadius: 18, paddingVertical: 12, borderWidth: 1, borderColor: tBd('rgba(255,255,255,0.18)'),
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statSep: { width: 1, backgroundColor: tBg('rgba(255,255,255,0.22)'), marginVertical: 4 },
  statVal: { color: tFg('#fff'), fontSize: 20, fontWeight: '800', lineHeight: 26 },
  statUnit: { color: tFg('rgba(255,255,255,0.8)'), fontSize: 10.5, fontWeight: '700' },
  statLbl: { color: tFg('rgba(255,255,255,0.8)'), fontSize: 11, fontWeight: '600' },

  card: { backgroundColor: P.card, borderRadius: 24, padding: 14, gap: 12, borderWidth: 1, borderColor: P.border, ...shadow },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  name: { color: P.text, fontSize: 17, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
  state: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  stateDot: { width: 7, height: 7, borderRadius: 4 },
  stateTxt: { fontSize: 11, fontWeight: '800' },
  metaRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  meta: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: P.soft, borderRadius: 14, paddingHorizontal: 7, paddingVertical: 3 },
  metaTxt: { color: P.sub, fontSize: 11.5, fontWeight: '700' },

  signal: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  sigTop: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  sigLevel: { fontSize: 12.5, fontWeight: '800' },

  btnRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 46, height: 46, borderRadius: 15, backgroundColor: P.soft,
    borderWidth: 1, borderColor: P.border, alignItems: 'center', justifyContent: 'center',
  },
  delBtn: { backgroundColor: P.redSoft, borderColor: tBd('#ffdde2') },
  pwRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: -4 },
  pwTxt: { color: P.faint, fontSize: 10.5, fontWeight: '600' },

  tech: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginTop: 4,
    borderRadius: 20, padding: 14, backgroundColor: tBg('#0ea5c6'),
  },
  techIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: tBg('rgba(255,255,255,0.2)'), alignItems: 'center', justifyContent: 'center' },
  techTitle: { color: tFg('#fff'), fontSize: 14.5, fontWeight: '800' },
  techSub: { color: tFg('rgba(255,255,255,0.85)'), fontSize: 11.5, marginTop: 1 },
  explore: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
    borderRadius: 20, padding: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: tBd('#cfc3fb'),
    backgroundColor: tBg('#faf8ff'),
  },
  exploreIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: P.violetSoft, alignItems: 'center', justifyContent: 'center' },
  exploreTitle: { color: P.violet, fontSize: 14, fontWeight: '800' },
  exploreSub: { color: P.sub, fontSize: 11.5, marginTop: 1 },

  link: { flexDirection: 'row-reverse', alignSelf: 'center', alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 14 },
  linkTxt: { color: P.violet, fontWeight: '700', fontSize: 13 },
});
