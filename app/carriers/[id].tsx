import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Carrier } from '../../src/drivers/types';
import { LEVEL_COLOR, LEVEL_LABEL, overallLevel, signalScore } from '../../src/utils/signal';
import { bandLabel, freqLabel } from '../../src/utils/bands';
import { C, R, S, T } from '../../src/ui/theme';
import { HeroCard, MetricCard, Section } from '../../src/ui/Cards';
import { Icon } from '../../src/ui/Icon';
import { Skeleton, ErrorCard } from '../../src/ui/States';

/** الجملة التي تترجم الجدول إلى قرار */
function verdictOf(list: Carrier[]): { text: string; tone: 'ok' | 'warn'; weak?: Carrier } {
  if (!list.length) {
    return { text: 'ما قدرنا نقرأ الناقلات النشطة من راوترك الآن.', tone: 'warn' };
  }
  if (list.length === 1) {
    const c = list[0];
    return {
      tone: 'warn',
      text: `راوترك على ناقل واحد فقط (${bandLabel(c.tech, c.band)}) — ما فيه دمج ترددات الآن. ` +
        'الدمج يحتاج تغطية جيدة لأكثر من تردد في موقعك.',
    };
  }
  const rated = list.filter(c => c.sinr !== undefined || c.rsrp !== undefined);
  const weak = rated
    .filter(c => c.role === 'SCC')
    .sort((a, b) => signalScore(a) - signalScore(b))[0];
  if (weak && signalScore(weak) < 0.35) {
    return {
      tone: 'warn',
      weak,
      text: `الناقل ${bandLabel(weak.tech, weak.band)} ضعيف${weak.sinr !== undefined ? ` (SINR ${weak.sinr})` : ''}` +
        ' — ناقل ضعيف داخل الدمج يقلّل السرعة بدل ما يزيدها. جرّب تثبّت الراوتر على الترددات القوية فقط.',
    };
  }
  return {
    tone: 'ok',
    text: `راوترك يدمج ${list.length} ناقلات وكلها بحالة جيدة. هذا أفضل وضع ممكن في موقعك الحالي.`,
  };
}

export default function Carriers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [list, setList] = useState<Carrier[]>([]);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (r: SavedRouter) => {
    setError('');
    try {
      const res = await withSession(r, async d => ({
        ok: !!d.getCarriers,
        rows: d.getCarriers ? await d.getCarriers() : [],
      }));
      if (!alive.current) return;
      setSupported(res.ok);
      setList(res.rows);
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      const r = await getRouter(id);
      if (!r) { setError('الراوتر غير موجود'); setLoading(false); return; }
      setInfo(r);
      await load(r);
      if (alive.current) setLoading(false);
    })();
  }, [id, load]);

  const onRefresh = useCallback(async () => {
    if (!info) return;
    setRefreshing(true);
    await load(info);
    if (alive.current) setRefreshing(false);
  }, [info, load]);

  const verdict = verdictOf(list);
  const totalBw = list.reduce((a, c) => a + (c.bandwidth ?? 0), 0);
  const withBw = list.filter(c => c.bandwidth !== undefined).length;
  const partial = list.some(c => c.role === 'SCC' && c.sinr === undefined && c.rsrp === undefined);

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.blue} colors={[C.blue]} />
        }
      >
        {loading && (
          <View style={{ gap: S.lg }}>
            <Skeleton h={110} radius={R.lg} />
            <Skeleton h={70} radius={R.md} />
            <Skeleton h={70} radius={R.md} />
          </View>
        )}

        {!!error && (
          <ErrorCard message={error} onRetry={info ? () => load(info) : undefined} retrying={refreshing} />
        )}

        {!loading && !supported && (
          <MetricCard>
            <Text style={s.title}>غير مدعوم</Text>
            <Text style={s.hint}>راوترك ما يكشف تفاصيل الناقلات. هذي الخاصية متاحة حالياً على أجهزة هواوي.</Text>
          </MetricCard>
        )}

        {!loading && supported && (
          <>
            <HeroCard>
              <View style={s.top}>
                <View style={[s.pill, { backgroundColor: verdict.tone === 'ok' ? C.green : C.gold }]}>
                  <Text style={s.pillTxt}>{list.length > 1 ? 'دمج نشط' : 'ناقل واحد'}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.big}>{list.length}</Text>
                  <Text style={s.small}>ناقل نشط</Text>
                </View>
              </View>

              {totalBw > 0 && (
                <View style={s.bwRow}>
                  <Text style={s.bwVal}>{totalBw} MHz</Text>
                  <Text style={s.bwKey}>
                    إجمالي عرض النطاق{withBw < list.length ? ` (من ${withBw} ناقل)` : ''}
                  </Text>
                </View>
              )}

              <Text style={s.verdict}>{verdict.text}</Text>

              {verdict.weak && info && (
                <Pressable style={s.action} onPress={() => router.push(`/bands/${info.id}` as Href)}>
                  <Icon name="bands" size={15} color={C.onAccent} />
                  <Text style={s.actionTxt}>افتح الترددات</Text>
                </Pressable>
              )}
            </HeroCard>

            <Section title="الناقلات" icon="chart">
              {list.map(c => {
                const lvl = overallLevel(c);
                const color = LEVEL_COLOR[lvl];
                const known = c.sinr !== undefined || c.rsrp !== undefined;
                return (
                  <MetricCard key={c.tech + c.band + c.role}>
                    <View style={s.rowTop}>
                      <View style={[s.role, c.role === 'PCC' ? { backgroundColor: C.blue } : { backgroundColor: C.rowBg }]}>
                        <Text style={[s.roleTxt, c.role === 'SCC' && { color: C.sub }]}>{c.role}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', flex: 1 }}>
                        <Text style={[s.band, c.tech === 'NR' && { color: C.violet }]}>
                          {bandLabel(c.tech, c.band)}
                        </Text>
                        <Text style={s.freq}>
                          {freqLabel(c.tech, c.band)}{c.bandwidth ? ` · ${c.bandwidth} MHz` : ''}
                        </Text>
                      </View>
                    </View>

                    {known ? (
                      <>
                        <View style={s.bar}>
                          <View style={[s.fill, { width: `${Math.round(signalScore(c) * 100)}%` as const, backgroundColor: color }]} />
                        </View>
                        <View style={s.stats}>
                          <Stat k="SINR" v={c.sinr} />
                          <Stat k="RSRP" v={c.rsrp} />
                          <Stat k="RSRQ" v={c.rsrq} />
                          <View style={s.stat}>
                            <Text style={[s.statV, { color, fontSize: T.label + 1 }]}>{LEVEL_LABEL[lvl]}</Text>
                            <Text style={s.statK}>الحالة</Text>
                          </View>
                        </View>
                      </>
                    ) : (
                      <Text style={s.hint}>
                        الراوتر يذكر هذا الناقل ضمن الدمج لكنه ما يعطي قياساته منفصلة.
                      </Text>
                    )}

                    {(c.pci || c.arfcn) && (
                      <Text style={s.ids}>
                        {c.pci ? `PCI ${c.pci}` : ''}{c.pci && c.arfcn ? '  ·  ' : ''}{c.arfcn ? `ARFCN ${c.arfcn}` : ''}
                      </Text>
                    )}
                  </MetricCard>
                );
              })}
            </Section>

            {partial && (
              <Text style={s.note}>
                ملاحظة: واجهة هواوي تعطي قياسات الناقل الأساسي فقط على أغلب الإصدارات. الناقلات الإضافية نعرضها
                بأسمائها بدون أرقام — وهذا حد الجهاز، مو نقص في القراءة.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

function Stat({ k, v }: { k: string; v?: number }) {
  return (
    <View style={s.stat}>
      <Text style={s.statV}>{v !== undefined ? v : '—'}</Text>
      <Text style={s.statK}>{k}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.xl },
  title: { color: C.text, fontWeight: '800', fontSize: T.h2, textAlign: 'right' },
  hint: { color: C.muted, fontSize: T.label, textAlign: 'right', lineHeight: 19 },
  note: { color: C.muted, fontSize: T.label, textAlign: 'right', lineHeight: 19 },

  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: { borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: 5 },
  pillTxt: { color: '#fff', fontWeight: '800', fontSize: T.label },
  big: { color: C.text, fontWeight: '800', fontSize: 30, lineHeight: 34 },
  small: { color: C.sub, fontSize: T.label },
  bwRow: {
    flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: S.sm,
  },
  bwKey: { color: C.sub, fontSize: T.label },
  bwVal: { color: C.text, fontWeight: '800', fontSize: T.h2 },
  verdict: { color: C.text, fontSize: T.body, textAlign: 'right', lineHeight: 21 },
  action: {
    backgroundColor: C.blue, borderRadius: R.md, paddingVertical: 11,
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  actionTxt: { color: C.onAccent, fontWeight: '800', fontSize: T.body + 0.5 },

  rowTop: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  role: { borderRadius: R.sm, paddingHorizontal: 9, paddingVertical: 3 },
  roleTxt: { color: C.onAccent, fontWeight: '800', fontSize: T.tiny },
  band: { color: C.text, fontWeight: '800', fontSize: T.h2 + 1 },
  freq: { color: C.muted, fontSize: T.label, marginTop: 1 },
  bar: { height: 7, borderRadius: 4, backgroundColor: C.track, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4 },
  stats: { flexDirection: 'row-reverse', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 1 },
  statV: { color: C.text, fontWeight: '800', fontSize: T.h2 },
  statK: { color: C.muted, fontSize: T.tiny },
  ids: { color: C.muted, fontSize: T.tiny + 0.5, textAlign: 'right' },
});
