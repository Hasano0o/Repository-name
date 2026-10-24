import { useCallback, useRef, useState } from 'react';
import { FlatList, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { View, Text, Pressable } from '../src/i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SavedRouter, listRouters, getPassword, deleteRouter } from '../src/store/routers';
import { withSession } from '../src/store/sessions';
import { Signal } from '../src/drivers/types';
import { Icon, IconName } from '../src/ui/Icon';
import { SkeletonRouterCard, EmptyState } from '../src/ui/States';
import { overallLevel, parseBands, parseNrBands, isNoService, signalScore, scoreLevel, LEVEL_LABEL } from '../src/utils/signal';
import {
  P, shadow, PrimaryBtn,
  lvlColor,
} from '../src/ui/Pro';

import { tBd, tBg, tFg, isDark } from '../src/ui/theme';
import { desktop } from '../src/desktop/bridge';
import { CityAsk } from '../src/ui/CityAsk';
import { BlockerAsk } from '../src/ui/BlockerAsk';
import { WhatsNew } from '../src/ui/WhatsNew';
import { LangAsk, LangLink } from '../src/ui/LangPicker';
import { HomeFooter } from '../src/ui/HomeFooter';
import { HomeHeader, HeaderChip, HeaderTone } from '../src/ui/HomeHeader';
import { hostLabel } from '../src/drivers/device';
import { addDemoRouter } from '../src/drivers/demo';
import { sheet } from '../src/i18n';
import { Platform } from 'react-native';
interface Status {
  loading: boolean;
  online?: boolean;
  signal?: Signal | null;
  operator?: string;
  mode?: string;
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
    // «هذا الجهاز» و«الراوتر التجريبي» ما لهم كلمة مرور أصلاً
    if (r.driverId === 'device' || r.driverId === 'demo') hasPw = true;
    else try { hasPw = !!(await getPassword(r.id)); } catch {}
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
          mode: net?.mode,
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
  // المستخدم الجديد: نفتح الكاميرا على الملصق ونسجّل الدخول عنه
  const canScanLabel = Platform.OS !== 'web' && !desktop;
  const addByLabel = () => router.push('/add-router?scan=1' as Href);
  const guided = () => router.push('/setup' as Href);
  const explore = () => router.push('/probe' as Href);
  const demo = async () => {
    const id = await addDemoRouter();
    router.push({ pathname: '/router/[id]', params: { id } });
  };
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
        title="أهلاً بك في Bandly 👋"
        text="اتصل بواي فاي الراوتر واضغط «ابدأ» — نلقى راوترك لحالنا، وتقدر تختبر السرعة والبنق على طول."
      >
        <LangAsk />
        {/* أسهل شي للي ما يعرف: المساعد يدوّر على الراوتر ويطلب كلمة المرور بس */}
        <Pressable onPress={guided} accessibilityRole="button"
          style={({ pressed }) => [s.helpBtn, pressed && { opacity: 0.8 }]}>
          <Text style={s.helpTitle}>🚀 ابدأ</Text>
          <Text style={s.helpSub}>اتصل بواي فاي الراوتر وبس — بدون كلمة مرور</Text>
        </Pressable>
        {canScanLabel ? (
          <>
            <Pressable style={s.demoBtn} onPress={addByLabel} accessibilityRole="button">
              <Text style={s.demoTxt}>📷 {Platform.OS === 'ios' ? 'صوّر رمز الملصق' : 'صوّر ملصق الراوتر'}</Text>
              <Text style={s.demoSub}>{Platform.OS === 'ios' ? 'نقرأ الواي فاي من الرمز' : 'نقرأ العنوان وكلمة المرور ونسجّل الدخول عنك'}</Text>
            </Pressable>
            {/* بديل التصوير — بطاقة واضحة بنفس شكل «جرّب بدون راوتر» عشان ما تنفهم غلط */}
            <Pressable style={s.demoBtn} onPress={add} accessibilityRole="button">
              <Text style={s.demoTxt}>✍️ أدخل كلمة المرور بنفسك</Text>
              <Text style={s.demoSub}>ما فيه ملصق أو الكاميرا ما قرأته؟ اكتب عنوان الراوتر وكلمة المرور يدوياً</Text>
            </Pressable>
          </>
        ) : (
          <PrimaryBtn text="إضافة راوتر" icon="plus" onPress={add} style={{ alignSelf: 'stretch' }} />
        )}
        <Pressable style={s.demoBtn} onPress={demo}>
          <Text style={s.demoTxt}>جرّب بدون راوتر · Demo</Text>
          <Text style={s.demoSub}>راوتر تجريبي تشوف فيه كل المزايا · Try without a router</Text>
        </Pressable>
        <Pressable style={s.link} onPress={explore}>
          <Icon name="compass" size={16} color={P.violet} />
          <Text style={s.linkTxt}>استكشاف جهاز غير مدعوم</Text>
        </Pressable>
        <BlockerAsk onAdd={add} onExplore={explore} onHelp={guided} />
        {desktop?.openTech && (
          // الويندوز: الفني غالباً ما عنده راوتر مضاف — نعطيه وضع الفني من البداية
          <Pressable style={s.link} onPress={() => desktop?.openTech?.()}>
            <Icon name="aim" size={16} color={P.blue} />
            <Text style={[s.linkTxt, { color: P.blue }]}>أنا فني — وضع الفني</Text>
          </Pressable>
        )}
        <LangLink />
      </EmptyState>
    );
  }

  // ملخص الترويسة: دائرة جودة أفضل راوتر + الحالة
  const statuses = items.map(i => status[i.id]);
  const anyLoading = statuses.some(x => !x || x.loading);
  const down = statuses.filter(x => x && !x.loading && !x.error && isNoService(x.signal, x.online, x.mode)).length;
  const live = statuses.filter(x => x?.signal && !x.error && !isNoService(x.signal, x.online, x.mode));
  const best = live.reduce<Status | undefined>((b, x) => (!b || signalScore(x.signal) > signalScore(b.signal) ? x : b), undefined);
  const header = (() => {
    const chips: HeaderChip[] = [];
    if (best?.signal) {
      const sig = best.signal;
      const score = signalScore(sig);
      const nr = sig.nrRsrp !== undefined || !!sig.nrBand;
      const bands = [...parseBands(sig.band), ...parseNrBands(sig.nrBand)].slice(0, 3);
      if (best.operator) chips.push({ text: best.operator });
      chips.push({ text: nr ? '5G' : '4G', tone: 'violet' });
      if (bands.length) chips.push({ text: bands.join(' + ') });
      if (items.length > 1) chips.push({ text: `${live.length} من ${items.length} متصل`, tone: 'green' });
      if (down) chips.push({ text: `${down} بلا شبكة`, tone: 'red' });
      const lvl = scoreLevel(score);
      return { score, tone: lvl as HeaderTone, loading: false, lead: 'اتصالك', word: LEVEL_LABEL[lvl], chips };
    }
    if (down) return { score: 0, tone: 'down' as HeaderTone, loading: false, lead: 'الراوتر', word: 'بلا شبكة', chips: [{ text: 'الأبراج منقطعة', tone: 'red' as const }] };
    if (anyLoading) return { score: 0, tone: 'unknown' as HeaderTone, loading: true, lead: '', word: 'نقرأ الإشارة…', chips };
    return { score: 0, tone: 'unknown' as HeaderTone, loading: false, lead: '', word: 'تعذّر الوصول للراوتر', chips: [{ text: 'تأكد إنك على شبكته' }] };
  })();

  return (
    <View style={{ flex: 1, backgroundColor: P.bg }}>
      <WhatsNew />
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={[s.list, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
          <HomeHeader {...header} onAdd={add} onExplore={explore} />
          <LangAsk />
          <CityAsk />
          {items.every(i => i.driverId === 'demo') && <BlockerAsk onAdd={add} onExplore={explore} />}
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={P.blue} colors={[P.blue]} />
        }
        ListFooterComponent={<HomeFooter onExplore={explore} />}
        renderItem={({ item }) => {
          const st = status[item.id];
          const sig = st?.signal;
          const level = overallLevel(sig);
          const color = lvlColor(level);
          const band = [...parseBands(sig?.band), ...parseNrBands(sig?.nrBand)];
          const hasNr = sig?.nrRsrp !== undefined || !!sig?.nrBand;
          const hasPw = st?.hasPw !== false;
          const loading = !!st?.loading;


          // بطاقة مختصرة: الترويسة فوق فيها الدرجة والترددات، وصفحة الراوتر فيها القراءات كاملة —
          // هنا بس: مين الراوتر + حالته بسطر + الإعدادات. البطاقة كلها تنضغط وتفتح الراوتر.
          const noService = !st?.error && !loading && isNoService(sig, st?.online, st?.mode);
          const tone = loading && !sig ? P.sub : st?.error || noService ? P.red : sig ? color : P.sub;
          const tech = noService ? undefined : hasNr ? '5G' : sig ? (sig.network?.match(/\b[2-5]G\b/)?.[0] ?? '4G') : undefined;
          const line = st?.error ? 'تعذّر الوصول — تأكد إنك على واي فاي الراوتر'
            : noService ? 'بلا شبكة — اضغط ورجّع الإشارة'
            : sig ? ['متصل', tech, band.slice(0, 3).join(' + ')].filter(Boolean).join(' · ')
            : loading ? 'نقرأ الإشارة…' : '—';
          return (
            <Pressable onPress={() => (hasPw ? open(item.id) : edit(item.id))}
              style={({ pressed }) => [s.card, s.cardSlim, pressed && { opacity: 0.9 }]}>
              <View style={s.row}>
                <LinearGradient
                  colors={sig && !noService ? [color, color + 'AA'] : noService || st?.error ? [P.red, P.red + 'AA'] : [P.heroA, P.heroB]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={s.avatar}
                >
                  {loading && !sig
                    ? <ActivityIndicator size="small" color={tFg('#fff')} />
                    : <Icon name="wifi" size={22} color={tFg('#fff')} stroke={2.1} />}
                </LinearGradient>
                <View style={{ flex: 1, alignItems: 'flex-end', gap: 4 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                    <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                    {item.driverId === 'demo' && (
                      <View style={s.demoTag}><Text style={s.demoTagTxt}>🧪 تجريبي</Text></View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                    <View style={[s.stateDot, { backgroundColor: tone }]} />
                    <Text style={[s.slimLine, { color: tone }]} numberOfLines={1}>{line}</Text>
                  </View>
                  <Text style={s.metaTxt} numberOfLines={1}>
                    {[hostLabel(item.host), st?.operator].filter(Boolean).join('  ·  ')}
                  </Text>
                </View>
                <View style={{ gap: 6, alignItems: 'center' }}>
                  <Pressable style={s.iconBtnSm} onPress={() => edit(item.id)} hitSlop={6}>
                    <Icon name="settings" size={16} color={P.sub} />
                  </Pressable>
                  <Pressable style={[s.iconBtnSm, s.delBtn]} onPress={() => onDelete(item)} hitSlop={6}>
                    <Icon name="trash" size={16} color={P.red} />
                  </Pressable>
                </View>
              </View>
              <PrimaryBtn
                small
                text={hasPw ? (loading ? 'يتصل…' : 'دخول للراوتر') : 'إضافة بيانات الدخول'}
                icon={hasPw ? 'login' : 'lock'}
                busy={loading}
                disabled={loading}
                colors={hasPw ? [P.heroA, P.heroB] : [P.amber, tBg('#f97316')]}
                onPress={() => (hasPw ? open(item.id) : edit(item.id))}
              />
            </Pressable>
          );
        }}
      />
    </View>
  );
}




const s = sheet({
  cardSlim: { paddingVertical: 14, gap: 10 },
  slimLine: { fontSize: 13, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  iconBtnSm: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: P.border, backgroundColor: P.soft },
  theme: {
    backgroundColor: P.card, borderColor: P.border, borderWidth: 1.5, borderRadius: 18,
    paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
  },
  themeTitle: { color: P.text, fontWeight: '800', fontSize: 14 },
  themeSub: { color: P.sub, fontSize: 11.5, marginTop: 2 },
  themeRow: { flexDirection: 'row-reverse', gap: 8 },
  themeOpt: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: P.soft, borderWidth: 1.5, borderColor: P.soft },
  themeOn: { borderColor: P.blue, backgroundColor: P.blueSoft },
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

  card: { backgroundColor: P.card, borderRadius: 24, padding: 14, gap: 12, ...(isDark ? { borderWidth: 1, borderColor: P.border } : { ...shadow, shadowOpacity: 0.09, shadowRadius: 14, elevation: 4 }) },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  name: { color: P.text, fontSize: 17, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
  state: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  stateDot: { width: 7, height: 7, borderRadius: 4 },
  stateTxt: { fontSize: 11, fontWeight: '800' },
  metaRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  meta: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: P.soft, borderRadius: 14, paddingHorizontal: 7, paddingVertical: 3 },
  metaTxt: { color: P.sub, fontSize: 11.5, fontWeight: '700' },

  status: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderRadius: 18, padding: 12 },
  statusIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: 16, fontWeight: '800' },
  statusSub: { color: P.sub, fontSize: 11.5, fontWeight: '600' },
  techBadge: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  techBadgeTxt: { fontSize: 18, fontWeight: '900' },

  tiles: { flexDirection: 'row-reverse', gap: 6 },
  tile: { flex: 1, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  tileLbl: { color: P.sub, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },
  tileVal: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  tileUnit: { color: P.sub, fontSize: 9.5, fontWeight: '600' },

  btnRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 46, height: 46, borderRadius: 15, backgroundColor: P.soft,
    borderWidth: 1.5, borderColor: P.border, alignItems: 'center', justifyContent: 'center',
  },
  delBtn: { backgroundColor: P.redSoft, borderColor: tBd('#ffdde2') },
  pwRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: -4 },
  pwTxt: { color: P.faint, fontSize: 10.5, fontWeight: '600' },

  tech: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginTop: 4,
    borderRadius: 20, padding: 14, backgroundColor: tBg('#0ea5c6'),
    borderWidth: 1.5, borderColor: tBd('#0b86a1'),
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
  demoTag: { backgroundColor: tBg('#f3edff'), borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  demoTagTxt: { color: tFg('#5b34c9'), fontSize: 11, fontWeight: '800' },
  helpBtn: {
    alignSelf: 'stretch', alignItems: 'center', marginBottom: 10, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 16,
    borderWidth: 1.5, borderColor: tBd('#12b76a66'), backgroundColor: tBg('#12b76a14'),
  },
  helpTitle: { color: tFg('#0f9a5f'), fontWeight: '900', fontSize: 16, textAlign: 'center' },
  helpSub: { color: P.sub, fontSize: 12.5, marginTop: 3, textAlign: 'center' },
  demoBtn: {
    alignSelf: 'stretch', alignItems: 'center', marginTop: 10, paddingVertical: 12, borderRadius: 16,
    borderWidth: 1.5, borderColor: P.border, backgroundColor: P.card,
  },
  demoTxt: { color: P.blue, fontWeight: '800', fontSize: 15 },
  demoSub: { color: P.sub, fontSize: 11.5, marginTop: 2 },
});
