import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, RefreshControl, ActivityIndicator,
  StyleSheet, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Carrier, CellTower, Signal } from '../../src/drivers/types';
import { adviseAntenna, AntennaAdvice, Need } from '../../src/utils/antenna';
import { Icon } from '../../src/ui/Icon';
import { Level, LEVEL_COLOR, LEVEL_LABEL, rsrpLevel, rsrqLevel, sinrLevel, rssiLevel } from '../../src/utils/signal';

const { width: SCREEN_W } = Dimensions.get('window');

// ═══ Design tokens (هوية Bandly) ═══
const BLUE = '#3567F5';
const PURPLE = '#7655F5';
const TEXT = '#14264A';
const MUTED = '#71809A';
const BG = '#F4F8FF';
const SUCCESS = '#13B783';
const WARN = '#F59E0B';
const DANGER = '#DC2626';
const CARD = '#FFFFFF';
const CARD_BG = '#FAFCFF';
const BORDER = '#E6ECF5';

// ═══ تقييم كل مؤشر (نص + لون) — من المصدر الموحّد src/utils/signal.ts ═══
type Grade = { label: string; color: string };
const toGrade = (l: Level): Grade =>
  l === 'unknown' ? { label: '—', color: MUTED } : { label: LEVEL_LABEL[l], color: LEVEL_COLOR[l] };
const rsrpGrade = (v?: number) => toGrade(rsrpLevel(v));
const sinrGrade = (v?: number) => toGrade(sinrLevel(v));
const rsrqGrade = (v?: number) => toGrade(rsrqLevel(v));
const rssiGrade = (v?: number) => toGrade(rssiLevel(v));

/** بطاقة مؤشر صغيرة */
function MetricCard({
  icon, iconBg, iconColor, name, value, unit, grade,
}: {
  icon: 'chart' | 'speed' | 'tower' | 'bands';
  iconBg: string;
  iconColor: string;
  name: string;
  value?: number;
  unit: string;
  grade: Grade;
}) {
  return (
    <View style={g.metricCard}>
      <View style={g.metricHead}>
        <View style={[g.metricIcon, { backgroundColor: iconBg }]}>
          <Icon name={icon} size={14} color={iconColor} />
        </View>
        <Text style={g.metricName}>{name}</Text>
      </View>
      <View style={g.metricValueRow}>
        <Text style={[g.metricValue, { color: grade.color }]}>
          {value ?? '—'}
        </Text>
        <Text style={g.metricUnit}>{unit}</Text>
      </View>
      <View style={[g.gradeChip, { backgroundColor: grade.color + '18' }]}>
        <Text style={[g.gradeChipTxt, { color: grade.color }]}>{grade.label}</Text>
      </View>
    </View>
  );
}

// ═══ Colour by need ═══
const NEED_THEME: Record<Need, { main: string; soft: string; icon: string; headline: string }> = {
  yes: { main: DANGER, soft: '#FEF2F2', icon: '📡', headline: 'ننصح بأنتنا خارجية' },
  maybe: { main: WARN, soft: '#FFFBEB', icon: '🤔', headline: 'أنتنا خارجية قد تساعد' },
  no: { main: SUCCESS, soft: '#ECFDF5', icon: '✅', headline: 'أنتنا الراوتر كافية' },
};


// ═══ Helpers لحساب النسب ═══
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const pctFromRsrp = (v?: number): number => (v === undefined ? 0 : clamp01((v + 120) / 55));
const pctFromSinr = (v?: number): number => (v === undefined ? 0 : clamp01((v + 5) / 25));
const pctFromRsrq = (v?: number): number => (v === undefined ? 0 : clamp01((v + 20) / 15));
const pctFromRssi = (v?: number): number => (v === undefined ? 0 : clamp01((v + 100) / 45));

export default function AntennaAdvisor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [adv, setAdv] = useState<AntennaAdvice | null>(null);
  const [sig, setSig] = useState<Signal | null>(null);
  const [hasAnt, setHasAnt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);

  const load = useCallback(async (r: SavedRouter) => {
    setError('');
    try {
      const { s: sigData, carriers, cells } = await withSession(r, async d => {
        const s = d.getSignal ? await d.getSignal() : ({} as Signal);
        const carriers = d.getCarriers ? await d.getCarriers().catch(() => [] as Carrier[]) : [];
        const cells = d.getCells ? await d.getCells().catch(() => [] as CellTower[]) : [];
        return { s, carriers, cells };
      });
      if (sigData.rsrp === undefined) throw new Error('ما قدرنا نقرأ الإشارة من الراوتر.');
      if (alive.current) {
        setSig(sigData);
        setAdv(adviseAntenna(sigData, carriers, cells));
      }
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

  const theme = adv ? NEED_THEME[adv.need] : NEED_THEME.maybe;

  // القيم الأربع للدوائر
  const c1 = { pct: pctFromRsrp(sig?.rsrp), color: rsrpGrade(sig?.rsrp).color };
  const c2 = { pct: pctFromRsrq(sig?.rsrq), color: rsrqGrade(sig?.rsrq).color };
  const c3 = { pct: pctFromSinr(sig?.sinr), color: sinrGrade(sig?.sinr).color };
  const c4 = { pct: pctFromRssi(sig?.rssi), color: rssiGrade(sig?.rssi).color };

  return (
    <View style={g.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[g.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />
        }
      >
        {/* ═══ Header ═══ */}
        <View style={g.header}>
          <View style={g.headerIcon}>
            <Icon name="antenna" size={20} color={PURPLE} />
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={g.title}>مستشار الأنتنا</Text>
            <Text style={g.subtitle}>هل تحتاج أنتنا خارجية؟ — تحليل تلقائي</Text>
          </View>
        </View>

        {loading && (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={PURPLE} />
            <Text style={{ color: MUTED }}>نحلّل إشارتك...</Text>
          </View>
        )}
        {!!error && <Text style={g.err}>{error}</Text>}

        {adv && sig && (
          <>
            {/* ═══ البطاقة الرئيسية: التوصية ═══ */}
            <LinearGradient
              colors={[theme.soft, '#FFFFFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[g.mainCard, { borderColor: theme.main + '60' }]}
            >
              <View style={g.mainHead}>
                <View style={[g.mainIconBox, { backgroundColor: theme.main + '20' }]}>
                  <Text style={{ fontSize: 30 }}>{theme.icon}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={g.mainQ}>هل تحتاج أنتنا خارجية؟</Text>
                  <Text style={[g.mainHeadline, { color: theme.main }]}>{adv.headline}</Text>
                </View>
              </View>

              {/* الأسباب */}
              {adv.reasons.length > 0 && (
                <View style={g.reasonsBox}>
                  {adv.reasons.map((r, i) => (
                    <View key={i} style={g.reasonRow}>
                      <View style={[g.reasonDot, { backgroundColor: theme.main }]} />
                      <Text style={g.reasonTxt}>{r}</Text>
                    </View>
                  ))}
                </View>
              )}

              {!!adv.otherCause && (
                <View style={[g.otherBox, { backgroundColor: '#FFFBEB', borderColor: WARN + '50' }]}>
                  <Text style={[g.otherTxt, { color: '#92400E' }]}>💡 {adv.otherCause}</Text>
                </View>
              )}
            </LinearGradient>

            {/* ═══ 4 دوائر مؤشرات ═══ */}
            <View style={g.ringsCard}>
              <View style={g.ringsHead}>
                <View style={g.ringsIcon}>
                  <Icon name="chart" size={16} color={BLUE} />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={g.ringsTitle}>التفاصيل التقنية</Text>
                  <Text style={g.ringsSub}>مؤشرات الإشارة الحالية</Text>
                </View>
              </View>
              <View style={g.grid2x2}>
                <MetricCard
                  icon="chart"
                  iconBg="#DFF9ED"
                  iconColor="#16A34A"
                  name="RSRP"
                  value={sig.rsrp}
                  unit="dBm"
                  grade={rsrpGrade(sig.rsrp)}
                />
                <MetricCard
                  icon="speed"
                  iconBg="#E1F5FF"
                  iconColor="#0891B2"
                  name="SINR"
                  value={sig.sinr}
                  unit="dB"
                  grade={sinrGrade(sig.sinr)}
                />
                <MetricCard
                  icon="bands"
                  iconBg="#FEF3C7"
                  iconColor="#D97706"
                  name="RSRQ"
                  value={sig.rsrq}
                  unit="dB"
                  grade={rsrqGrade(sig.rsrq)}
                />
                <MetricCard
                  icon="tower"
                  iconBg="#EEE8FF"
                  iconColor="#7C3AED"
                  name="RSSI"
                  value={sig.rssi}
                  unit="dBm"
                  grade={rssiGrade(sig.rssi)}
                />
              </View>
            </View>

            {/* ═══ نوع الأنتنا الموصى به ═══ */}
            <View style={g.card}>
              <View style={g.cardHead}>
                <View style={[g.cardIcon, { backgroundColor: PURPLE + '18' }]}>
                  <Icon name="antenna" size={16} color={PURPLE} />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={g.cardTitle}>
                    {adv.need === 'no' ? 'لو حبيت تركّب أنتنا — هذا المناسب' : adv.type.title}
                  </Text>
                  <Text style={g.cardSub}>الأنتنا الموصى بها لحالتك</Text>
                </View>
              </View>
              <View style={{ gap: 6, marginTop: 4 }}>
                {adv.type.points.map((p, i) => (
                  <View key={i} style={g.bulletRow}>
                    <Text style={g.bulletStar}>★</Text>
                    <Text style={g.bulletTxt}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ═══ فحص التركيب (لو عنده أنتنا) ═══ */}
            <View style={g.card}>
              <View style={g.cardHead}>
                <View style={[g.cardIcon, { backgroundColor: BLUE + '18' }]}>
                  <Icon name="settings" size={16} color={BLUE} />
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={g.cardTitle}>فحص تركيب الأنتنا</Text>
                  <Text style={g.cardSub}>
                    {hasAnt ? 'نراجع الكيبلات والتوجيه' : 'فعّل الزر لو ركّبت أنتنا'}
                  </Text>
                </View>
                <Pressable
                  style={[g.toggleBtn, hasAnt && g.toggleBtnOn]}
                  onPress={toggleAnt}
                >
                  <Text style={[g.toggleTxt, hasAnt && { color: '#FFF' }]}>
                    {hasAnt ? '✓ عندي أنتنا' : 'عندي أنتنا؟'}
                  </Text>
                </Pressable>
              </View>

              {hasAnt ? (
                adv.install.length > 0 ? (
                  <View style={{ gap: 6, marginTop: 6 }}>
                    {adv.install.map((x, i) => (
                      <View key={i} style={g.checkRow}>
                        <View style={[g.checkDot, { backgroundColor: x.ok ? SUCCESS : DANGER }]}>
                          <Text style={g.checkDotTxt}>{x.ok ? '✓' : '✗'}</Text>
                        </View>
                        <Text style={g.checkTxt}>{x.text}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={g.emptyTxt}>ما لقينا ملاحظات على التركيب — يبدو ممتاز.</Text>
                )
              ) : (
                <Text style={g.hintTxt}>
                  لو ركّبت أنتنا خارجية، فعّل الزر ونفحص لك الكيبلات والتوجيه من بيانات الراوتر.
                </Text>
              )}
            </View>

            {/* ═══ زر CTA — انتقل للتوجيه ═══ */}
            {info && (
              <Pressable onPress={() => router.push(`/aim/${info.id}` as Href)}>
                <LinearGradient
                  colors={[BLUE, PURPLE]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={g.cta}
                >
                  <Icon name="antenna" size={20} color="#FFF" />
                  <Text style={g.ctaTxt}>🔊 وجّه الأنتنا بوضع الصوت</Text>
                </LinearGradient>
              </Pressable>
            )}

            <Text style={g.footNote}>
              اسحب لتحت لتحديث التحليل بعد ما تغيّر مكان أو اتجاه الأنتنا.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const g = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },

  // Header
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  headerIcon: {
    width: 46, height: 46, borderRadius: 16,
    backgroundColor: PURPLE + '15',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: PURPLE + '30',
  },
  title: { fontSize: 20, fontWeight: '900', color: TEXT, textAlign: 'right' },
  subtitle: { fontSize: 12, color: MUTED, textAlign: 'right', marginTop: 3 },

  err: { color: DANGER, textAlign: 'center', fontSize: 12.5 },

  // Main card
  mainCard: {
    borderRadius: 24, padding: 16, gap: 12,
    borderWidth: 1.5,
    shadowColor: '#0D2350', shadowOpacity: 0.05,
    shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  mainHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14 },
  mainIconBox: {
    width: 60, height: 60, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  mainQ: { color: MUTED, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  mainHeadline: { fontSize: 17, fontWeight: '900', textAlign: 'right', marginTop: 3, lineHeight: 24 },

  reasonsBox: { gap: 6, marginTop: 4 },
  reasonRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8 },
  reasonDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  reasonTxt: { flex: 1, color: TEXT, fontSize: 12.5, lineHeight: 20, textAlign: 'right' },

  otherBox: {
    borderRadius: 12, padding: 10, borderWidth: 1,
  },
  otherTxt: { fontSize: 12.5, lineHeight: 19, textAlign: 'right', fontWeight: '700' },

  // Grid 2x2 للمؤشرات
  grid2x2: {
    flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10,
    marginTop: 4,
  },
  metricCard: {
    flexBasis: '47%', flexGrow: 1,
    backgroundColor: '#FAFCFF', borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
    paddingVertical: 12, paddingHorizontal: 10, gap: 6,
  },
  metricHead: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
  },
  metricIcon: {
    width: 26, height: 26, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  metricName: { color: MUTED, fontSize: 11.5, fontWeight: '800' },
  metricValueRow: {
    flexDirection: 'row-reverse', alignItems: 'baseline', gap: 3,
  },
  metricValue: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5, lineHeight: 28 },
  metricUnit: { color: MUTED, fontSize: 10.5, fontWeight: '700' },
  gradeChip: {
    alignSelf: 'flex-end',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999,
  },
  gradeChipTxt: { fontSize: 10.5, fontWeight: '900' },
  // Rings card
  ringsCard: {
    backgroundColor: CARD, borderRadius: 22, padding: 14, gap: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  ringsHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  ringsIcon: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: '#E1F5FF',
    alignItems: 'center', justifyContent: 'center',
  },
  ringsTitle: { color: TEXT, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  ringsSub: { color: MUTED, fontSize: 11, textAlign: 'right', marginTop: 2 },

  // Generic card
  card: {
    backgroundColor: CARD, borderRadius: 22, padding: 14, gap: 10,
    borderWidth: 1, borderColor: BORDER,
  },
  cardHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  cardIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: TEXT, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  cardSub: { color: MUTED, fontSize: 11, textAlign: 'right', marginTop: 2 },

  bulletRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8 },
  bulletStar: { color: PURPLE, fontSize: 12, marginTop: 2 },
  bulletTxt: { flex: 1, color: TEXT, fontSize: 12.5, lineHeight: 20, textAlign: 'right' },

  // Toggle
  toggleBtn: {
    borderWidth: 1.5, borderColor: BLUE,
    borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14,
  },
  toggleBtnOn: { backgroundColor: BLUE },
  toggleTxt: { color: BLUE, fontWeight: '800', fontSize: 12 },

  // Check rows
  checkRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8 },
  checkDot: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkDotTxt: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  checkTxt: { flex: 1, color: TEXT, fontSize: 12.5, lineHeight: 20, textAlign: 'right' },

  emptyTxt: { color: MUTED, fontSize: 12.5, textAlign: 'right', marginTop: 4 },
  hintTxt: { color: MUTED, fontSize: 12, textAlign: 'right', lineHeight: 19, marginTop: 4 },

  // CTA
  cta: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16, borderRadius: 20,
    shadowColor: PURPLE, shadowOpacity: 0.4,
    shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  ctaTxt: { color: '#FFF', fontWeight: '900', fontSize: 15 },

  footNote: { color: MUTED, fontSize: 11.5, textAlign: 'center', lineHeight: 18, marginTop: 4 },
});
