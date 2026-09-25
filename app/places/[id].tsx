import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, TextInput, Alert,
  ActivityIndicator, StyleSheet, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Path, Rect, G, Line, Text as SvgText } from 'react-native-svg';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Signal } from '../../src/drivers/types';
import { snapshot } from '../../src/utils/safeLock';
import { Icon, IconName } from '../../src/ui/Icon';
import { LEVEL_COLOR, LEVEL_LABEL, rsrpLevel } from '../../src/utils/signal';

const { width: SCREEN_W } = Dimensions.get('window');

// ═══ Design tokens (هوية Bandly) ═══
const BLUE = '#3567F5';
const PURPLE = '#7655F5';
const TEXT = '#14264A';
const MUTED = '#71809A';
const BG = '#F4F8FF';
const SUCCESS = '#13B783';
const CARD = '#FFFFFF';
const CARD_BG = '#FAFCFF';
const BORDER = '#E6ECF5';
const WARN = '#F59E0B';
const DANGER = '#DC2626';

interface Place {
  id: string;
  name: string;
  at: number;
  cap: number;
  rsrp?: number;
  sinr?: number;
  bw: number;
  carriers: number;
  bands: string;
  cqi?: number;
  tx?: number;
  streams?: number;
  nr: boolean;
}
const QUICK = ['الصالة', 'غرفة النوم', 'جنب الشباك', 'المجلس', 'المطبخ', 'السطح'];
const key = (id: string) => `places:${id}`;
async function loadPlaces(id: string): Promise<Place[]> {
  try {
    const raw = await AsyncStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as Place[]) : [];
  } catch {
    return [];
  }
}
async function savePlaces(id: string, list: Place[]) {
  try { await AsyncStorage.setItem(key(id), JSON.stringify(list.slice(0, 30))); } catch {}
}
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'الحين';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.round(h / 24);
  return d === 1 ? 'أمس' : `قبل ${d} أيام`;
};
// التقييم من المصدر الموحّد (src/utils/signal.ts)
function rsrpColor(v?: number): string {
  return v === undefined ? MUTED : LEVEL_COLOR[rsrpLevel(v)];
}
function rsrpGrade(v?: number): string {
  return v === undefined ? '—' : LEVEL_LABEL[rsrpLevel(v)];
}

/** ═══ خريطة منزل مبسّطة (SVG) ═══ */
function HouseMap({ places }: { places: Place[] }) {
  const W = SCREEN_W - 60;
  const H = 200;
  // مواقع الراوتر (ثابتة للتخطيط — تعرض الأماكن المُختبرة)
  const slots = [
    { x: 30, y: 30, w: 100, h: 70, label: 'الصالة' },
    { x: 140, y: 30, w: 110, h: 70, label: 'غرفة ١' },
    { x: 260, y: 30, w: 60, h: 70, label: 'مطبخ' },
    { x: 30, y: 110, w: 130, h: 70, label: 'غرفة ٢' },
    { x: 170, y: 110, w: 80, h: 70, label: 'حمام' },
    { x: 260, y: 110, w: 60, h: 70, label: 'شرفة' },
  ];
  // نأخذ أفضل مكان لكل slot (إن وُجد)
  const filled = slots.map((slot, i) => {
    const p = places[i];
    return { ...slot, rsrp: p?.rsrp, hasData: !!p };
  });
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={W} height={H} viewBox="0 0 350 200">
        {/* الخلفية */}
        <Rect x={0} y={0} width={350} height={200} fill="#EEF5FF" rx={16} />

        {/* الجدران */}
        {filled.map((s, i) => (
          <G key={i}>
            <Rect
              x={s.x} y={s.y} width={s.w} height={s.h}
              fill="#FFFFFF"
              stroke="#CBD5E1"
              strokeWidth={2}
              rx={6}
            />
            <SvgText
              x={s.x + s.w / 2}
              y={s.y + s.h / 2 + 4}
              fontSize={11}
              fill="#94A3B8"
              textAnchor="middle"
              fontWeight="700"
            >
              {s.label}
            </SvgText>
            {/* مؤشر القياس */}
            {s.hasData && (
              <>
                <Circle
                  cx={s.x + s.w / 2}
                  cy={s.y + s.h / 2 - 16}
                  r={9}
                  fill={rsrpColor(s.rsrp) + '30'}
                />
                <Circle
                  cx={s.x + s.w / 2}
                  cy={s.y + s.h / 2 - 16}
                  r={5}
                  fill={rsrpColor(s.rsrp)}
                />
              </>
            )}
          </G>
        ))}

        {/* اتصال بين المواقع المُختبرة (سهم التحسّن) */}
        {filled.filter(x => x.hasData).length >= 2 && (() => {
          const pts = filled.filter(x => x.hasData).map(x => ({ x: x.x + x.w / 2, y: x.y + x.h / 2 }));
          return pts.slice(0, -1).map((p, i) => {
            const q = pts[i + 1];
            return (
              <Line
                key={i}
                x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                stroke={BLUE}
                strokeWidth={2}
                strokeDasharray="4 4"
                opacity={0.4}
              />
            );
          });
        })()}
      </Svg>
      <Text style={g.mapHint}>
        {places.length === 0
          ? '📍 ما زلت ما اختبرت مواقع. ابدأ بقياس مكانك الحالي'
          : `📍 ${places.length} مكان مُختبر — الأخضر = أقوى إشارة`}
      </Text>
    </View>
  );
}

/** ═══ شريط أعمدة لمقارنة الأماكن (SVG) ═══ */
function CompareBars({ places }: { places: Place[] }) {
  if (places.length === 0) return null;
  const W = SCREEN_W - 80;
  const H = 120;
  const pad = { top: 10, bottom: 28, left: 8, right: 8 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const sorted = [...places].sort((a, b) => {
    const ra = a.rsrp ?? -140;
    const rb = b.rsrp ?? -140;
    return rb - ra;
  }).slice(0, 8);

  const range = { min: -125, max: -60 };
  const barW = (innerW / sorted.length) * 0.65;
  const gap = (innerW / sorted.length) * 0.35;

  return (
    <Svg width={W} height={H}>
      {[0, 0.5, 1].map((f, i) => (
        <Line key={i} x1={0} y1={pad.top + f * innerH} x2={W} y2={pad.top + f * innerH} stroke={BORDER} strokeWidth={1} />
      ))}
      {sorted.map((p, i) => {
        const v = p.rsrp ?? -125;
        const pct = Math.max(0.05, (v - range.min) / (range.max - range.min));
        const h = pct * innerH;
        const x = pad.left + i * (barW + gap) + gap / 2;
        const y = pad.top + innerH - h;
        return (
          <G key={p.id}>
            <Rect
              x={x} y={y} width={barW} height={h}
              fill={rsrpColor(p.rsrp)}
              rx={4}
            />
            <SvgText
              x={x + barW / 2}
              y={H - 10}
              fontSize={9}
              fill={MUTED}
              textAnchor="middle"
              fontWeight="700"
            >
              {p.name.length > 8 ? p.name.slice(0, 7) + '…' : p.name}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

/** ═══ بطاقة مكان محفوظ ═══ */
function PlaceCard({ p, isBest, onDelete }: { p: Place; isBest: boolean; onDelete: () => void }) {
  const col = rsrpColor(p.rsrp);
  return (
    <Pressable
      style={[g.placeCard, isBest && g.placeCardBest]}
      onLongPress={onDelete}
    >
      {isBest && (
        <View style={g.bestBadge}>
          <Text style={g.bestBadgeTxt}>⭐ الأفضل</Text>
        </View>
      )}
      <View style={[g.placeDot, { backgroundColor: col }]} />
      <View style={{ flex: 1 }}>
        <Text style={g.placeName} numberOfLines={1}>{p.name}</Text>
        <Text style={g.placeMeta}>
          {p.bands || '—'} {p.nr ? '· 5G' : ''} · {ago(p.at)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-start' }}>
        <Text style={[g.placeRsrp, { color: col }]}>
          {p.rsrp ?? '—'} <Text style={g.placeUnit}>dBm</Text>
        </Text>
        <Text style={g.placeGrade}>{rsrpGrade(p.rsrp)}</Text>
      </View>
    </Pressable>
  );
}

export default function Places() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [list, setList] = useState<Place[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showInput, setShowInput] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive.current) return;
      if (!r) { setError('الراوتر غير موجود'); return; }
      setInfo(r);
      setList(await loadPlaces(r.id));
    })();
    return () => { alive.current = false; };
  }, [id]);

  const measure = useCallback(async () => {
    if (!info || busy) return;
    const label = name.trim() || `مكان ${list.length + 1}`;
    if (list.some(p => p.name === label)) {
      Alert.alert('الاسم مستخدم', `فيه مكان محفوظ باسم "${label}". تبي تستبدل قياسه؟`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'استبدال', onPress: () => run(label, true) },
      ]);
      return;
    }
    run(label, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, busy, name, list]);

  const run = async (label: string, replace: boolean) => {
    if (!info) return;
    setError('');
    setBusy('خلّ الراوتر ثابت — نقيس ١٠ ثواني...');
    try {
      const snap = await snapshot(info, true, 4);
      let sig: Signal | null = null;
      try { sig = await withSession(info, d => (d.getSignal ? d.getSignal() : Promise.resolve(null)), false); } catch {}
      if (!snap) throw new Error('ما قدرنا نقرأ الإشارة — تأكد إن الراوتر متصل.');
      const p: Place = {
        id: String(Date.now()),
        name: label,
        at: Date.now(),
        cap: snap.cap,
        rsrp: snap.rsrp !== undefined ? Math.round(snap.rsrp) : undefined,
        sinr: snap.sinr !== undefined ? Math.round(snap.sinr) : undefined,
        bw: snap.bw,
        carriers: snap.carriers,
        bands: snap.bands,
        cqi: sig?.cqi,
        tx: sig?.txPower,
        streams: sig?.dlStreams,
        nr: snap.nr,
      };
      const next = [p, ...(replace ? list.filter(x => x.name !== label) : list)];
      if (!alive.current) return;
      setList(next);
      setName('');
      setShowInput(false);
      await savePlaces(info.id, next);
      if (alive.current) {
        setBusy('');
        Alert.alert('تم', `سجّلنا "${label}": ${p.rsrp ?? '—'} dBm`);
      }
    } catch (e: any) {
      if (alive.current) { setBusy(''); setError(e?.message ?? String(e)); }
    }
  };

  const removePlace = (p: Place) => {
    Alert.alert('حذف القياس', `تحذف قياس "${p.name}"؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: async () => {
          if (!info) return;
          const next = list.filter(x => x.id !== p.id);
          setList(next);
          await savePlaces(info.id, next);
        },
      },
    ]);
  };

  const clearAll = () => {
    if (!info || list.length === 0) return;
    Alert.alert('مسح الكل', `تحذف ${list.length} قياس محفوظ؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'امسح', style: 'destructive', onPress: async () => {
          if (!info) return;
          setList([]);
          await savePlaces(info.id, []);
        },
      },
    ]);
  };

  const bestPlace = list.length
    ? [...list].sort((a, b) => (b.rsrp ?? -140) - (a.rsrp ?? -140))[0]
    : null;

  return (
    <View style={g.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[g.content, { paddingBottom: insets.bottom + 40 }]}
      >
        {/* ═══ Header ═══ */}
        <View style={g.header}>
          <View style={g.headerIcon}>
            <Icon name="pin" size={20} color={BLUE} />
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={g.title}>ضبط موقع الراوتر</Text>
            <Text style={g.subtitle}>حرّك الراوتر لمكان يمنحك أفضل إشارة</Text>
          </View>
        </View>

        {/* ═══ الخريطة ═══ */}
        <View style={g.card}>
          <View style={g.cardHead}>
            <View style={g.cardIcon}>
              <Icon name="home" size={16} color={BLUE} />
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={g.cardTitle}>مواقع مُختبرة</Text>
              <Text style={g.cardSub}>اختر الأماكن وقارن إشارتها</Text>
            </View>
          </View>
          <HouseMap places={list} />
        </View>

        {/* ═══ أفضل مكان ═══ */}
        {bestPlace && (
          <View style={g.bestCard}>
            <View style={g.bestHead}>
              <View style={[g.bestIcon, { backgroundColor: rsrpColor(bestPlace.rsrp) + '20' }]}>
                <Text style={{ fontSize: 22 }}>🏆</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={g.bestTitle}>أفضل مكان: {bestPlace.name}</Text>
                <Text style={g.bestSub}>وجّه الراوتر لهذا المكان</Text>
              </View>
            </View>
            <View style={g.bestStats}>
              <View style={g.bestStat}>
                <Text style={[g.bestStatVal, { color: rsrpColor(bestPlace.rsrp) }]}>
                  {bestPlace.rsrp ?? '—'}
                </Text>
                <Text style={g.bestStatUnit}>dBm RSRP</Text>
              </View>
              <View style={g.bestStat}>
                <Text style={g.bestStatVal}>{bestPlace.sinr ?? '—'}</Text>
                <Text style={g.bestStatUnit}>SINR</Text>
              </View>
              <View style={g.bestStat}>
                <Text style={g.bestStatVal}>{bestPlace.carriers}</Text>
                <Text style={g.bestStatUnit}>نواقل</Text>
              </View>
              <View style={g.bestStat}>
                <Text style={g.bestStatVal}>{Math.round(bestPlace.bw)}</Text>
                <Text style={g.bestStatUnit}>MHz</Text>
              </View>
            </View>
          </View>
        )}

        {/* ═══ مقارنة الأماكن ═══ */}
        {list.length >= 2 && (
          <View style={g.card}>
            <View style={g.cardHead}>
              <View style={g.cardIcon}>
                <Icon name="chart" size={16} color={BLUE} />
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={g.cardTitle}>مقارنة المواقع</Text>
                <Text style={g.cardSub}>من الأقوى للأضعف</Text>
              </View>
            </View>
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <CompareBars places={list} />
            </View>
          </View>
        )}

        {/* ═══ قائمة الأماكن ═══ */}
        {list.length > 0 && (
          <View style={g.card}>
            <View style={g.cardHead}>
              <View style={g.cardIcon}>
                <Icon name="folder" size={16} color={BLUE} />
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={g.cardTitle}>القياسات المحفوظة</Text>
                <Text style={g.cardSub}>اضغط مطولاً للحذف</Text>
              </View>
              <Pressable onPress={clearAll} hitSlop={8}>
                <Text style={g.clearTxt}>مسح الكل</Text>
              </Pressable>
            </View>
            <View style={{ gap: 8, marginTop: 4 }}>
              {list.map(p => (
                <PlaceCard
                  key={p.id}
                  p={p}
                  isBest={bestPlace?.id === p.id}
                  onDelete={() => removePlace(p)}
                />
              ))}
            </View>
          </View>
        )}

        {/* ═══ اختبر مكان جديد ═══ */}
        <View style={g.card}>
          <View style={g.cardHead}>
            <View style={[g.cardIcon, { backgroundColor: '#EEE8FF' }]}>
              <Icon name="pin" size={16} color={PURPLE} />
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={g.cardTitle}>اختبر مكان جديد</Text>
              <Text style={g.cardSub}>حرّك الراوتر هنا ثم اضغط قِس</Text>
            </View>
          </View>

          {/* chips الأسماء السريعة */}
          <View style={g.chipsRow}>
            {QUICK.map(q => {
              const on = name === q;
              return (
                <Pressable
                  key={q}
                  onPress={() => { setName(q); setShowInput(false); }}
                  style={[g.chip, on && g.chipOn]}
                >
                  <Text style={[g.chipTxt, on && { color: '#FFF' }]}>{q}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* زر إضافة نص مخصص */}
          <Pressable onPress={() => setShowInput(v => !v)} hitSlop={8}>
            <Text style={g.customLink}>
              {showInput ? '− إخفاء' : '+ اسم مخصص'}
            </Text>
          </Pressable>

          {showInput && (
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="مثال: جنب التلفزيون"
              placeholderTextColor={MUTED}
              style={g.input}
              textAlign="right"
            />
          )}

          {/* زر القياس */}
          <Pressable
            onPress={measure}
            disabled={!!busy}
            style={[g.measureBtn, busy && { opacity: 0.6 }]}
          >
            {busy ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Icon name="spark" size={18} color="#FFF" />
                <Text style={g.measureTxt}>
                  {name ? `قِس "${name}"` : 'قِس المكان الحالي'}
                </Text>
              </>
            )}
          </Pressable>

          {!!busy && <Text style={g.busyTxt}>{busy}</Text>}
          {!!error && <Text style={g.errTxt}>{error}</Text>}
        </View>

        {/* ═══ نصائح ═══ */}
        <View style={g.tipsCard}>
          <View style={g.tipsHead}>
            <View style={[g.cardIcon, { backgroundColor: '#FEF3C7' }]}>
              <Icon name="bulb" size={16} color={WARN} />
            </View>
            <Text style={g.tipsTitle}>نصائح لاختيار المكان</Text>
          </View>
          <View style={g.tipRow}>
            <Text style={g.tipCheck}>✓</Text>
            <Text style={g.tipTxt}>قرب النافذة يعطي إشارة أقوى بـ 10-15%</Text>
          </View>
          <View style={g.tipRow}>
            <Text style={g.tipCheck}>✓</Text>
            <Text style={g.tipTxt}>الارتفاع (رف عالي) يحسّن الاستقبال</Text>
          </View>
          <View style={g.tipRow}>
            <Text style={g.tipCheck}>✓</Text>
            <Text style={g.tipTxt}>ابتعد عن الأجهزة الإلكترونية والجدران السميكة</Text>
          </View>
          <View style={g.tipRow}>
            <Text style={g.tipCheck}>✓</Text>
            <Text style={g.tipTxt}>خلّ الراوتر ثابت 10 ثواني أثناء القياس</Text>
          </View>
        </View>
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
    width: 46, height: 46, borderRadius: 16, backgroundColor: CARD,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  title: { fontSize: 20, fontWeight: '900', color: TEXT, textAlign: 'right' },
  subtitle: { fontSize: 12, color: MUTED, textAlign: 'right', marginTop: 3 },

  // Card
  card: {
    backgroundColor: CARD, borderRadius: 22, padding: 14, gap: 10,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: '#0D2350', shadowOpacity: 0.04,
    shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  cardHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  cardIcon: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: '#E1F5FF',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: TEXT, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  cardSub: { color: MUTED, fontSize: 11, textAlign: 'right', marginTop: 2 },

  mapHint: { color: MUTED, fontSize: 11.5, textAlign: 'center', marginTop: 10 },

  // Best card
  bestCard: {
    backgroundColor: '#F0FDF4', borderRadius: 22, padding: 14, gap: 12,
    borderWidth: 1.5, borderColor: '#86EFAC',
  },
  bestHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  bestIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bestTitle: { color: '#166534', fontSize: 15.5, fontWeight: '900', textAlign: 'right' },
  bestSub: { color: '#15803D', fontSize: 11.5, textAlign: 'right', marginTop: 2 },
  bestStats: { flexDirection: 'row-reverse', gap: 8 },
  bestStat: {
    flex: 1, alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#D1FAE5',
  },
  bestStatVal: { fontSize: 16, fontWeight: '900', color: '#166534' },
  bestStatUnit: { color: '#15803D', fontSize: 9.5, fontWeight: '700', marginTop: 2 },

  // Place cards
  placeCard: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    backgroundColor: CARD_BG, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: BORDER, position: 'relative',
  },
  placeCardBest: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  bestBadge: {
    position: 'absolute', top: -8, right: 12,
    backgroundColor: SUCCESS, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  bestBadgeTxt: { color: '#FFF', fontSize: 9.5, fontWeight: '900' },
  placeDot: { width: 10, height: 10, borderRadius: 5 },
  placeName: { color: TEXT, fontSize: 14, fontWeight: '900', textAlign: 'right' },
  placeMeta: { color: MUTED, fontSize: 11, textAlign: 'right', marginTop: 2 },
  placeRsrp: { fontSize: 16, fontWeight: '900' },
  placeUnit: { color: MUTED, fontSize: 9.5, fontWeight: '700' },
  placeGrade: { color: MUTED, fontSize: 10, fontWeight: '700', marginTop: 1 },

  clearTxt: { color: DANGER, fontSize: 12, fontWeight: '800' },

  // Chips
  chipsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
  },
  chipOn: { backgroundColor: BLUE, borderColor: BLUE },
  chipTxt: { color: TEXT, fontSize: 12.5, fontWeight: '800' },

  customLink: { color: PURPLE, fontSize: 12.5, fontWeight: '800', textAlign: 'right', paddingVertical: 4 },

  input: {
    backgroundColor: CARD_BG, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 14, paddingVertical: 11, color: TEXT, fontSize: 13.5,
  },

  measureBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: BLUE, marginTop: 4,
    shadowColor: BLUE, shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  measureTxt: { color: '#FFF', fontWeight: '900', fontSize: 15 },

  busyTxt: { color: MUTED, fontSize: 12, textAlign: 'center', marginTop: 4 },
  errTxt: { color: DANGER, fontSize: 12, textAlign: 'center', marginTop: 4 },

  // Tips
  tipsCard: {
    borderRadius: 22, backgroundColor: '#F7F3FF',
    borderWidth: 1, borderColor: '#E4D9FF',
    padding: 14, gap: 8,
  },
  tipsHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 4 },
  tipsTitle: { color: PURPLE, fontSize: 14.5, fontWeight: '900', flex: 1, textAlign: 'right' },
  tipRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 3 },
  tipCheck: { color: SUCCESS, fontSize: 14, fontWeight: '900' },
  tipTxt: { flex: 1, textAlign: 'right', color: '#68718A', fontSize: 12.5, lineHeight: 19 },

  // (legacy - unused but kept for safety)
  center: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  muted: { color: MUTED, textAlign: 'center' },
});
