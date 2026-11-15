/**
 * «مستشار الفايبر» — بديل مستشار الأنتنا لأجهزة الفايبر (هواوي ONT): قراءة الضوء (Rx/Tx) + نصيحة + متابعة النزول المفاجئ.
 * القراءات تنحفظ بالجوال (وحدة كل ١٠ دقايق، آخر ٢٠٠) عشان نعرف «المعتاد» وننبه لو نزل فجأة.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl } from 'react-native';
import { ScrollView, View, Text } from '../../src/i18n/rn';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import type { OpticReading } from '../../src/drivers/types';
import { adviseFiber, addFiberSample, usualRx, FiberAdvice, FiberSample } from '../../src/utils/fiberAdvice';
import { LEVEL_COLOR, LEVEL_LABEL } from '../../src/utils/signal';
import { C } from '../../src/ui/theme';
import { sheet } from '../../src/i18n';

const histKey = (id: string) => `bandly.fiberRx.${id}`;

async function loadHist(id: string): Promise<FiberSample[]> {
  try { const v = await AsyncStorage.getItem(histKey(id)); const a = v ? JSON.parse(v) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}

export default function FiberAdvisor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [optic, setOptic] = useState<OpticReading | null>(null);
  const [adv, setAdv] = useState<FiberAdvice | null>(null);
  const [hist, setHist] = useState<FiberSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await getRouter(String(id));
      if (!r) { setError('الراوتر مو موجود'); return; }
      const o = await withSession(r, async d => (d.getOptic ? d.getOptic() : null));
      let h = await loadHist(r.id);
      if (o?.rx !== undefined) {
        const next = addFiberSample(h, o.rx);
        if (next !== h) { h = next; AsyncStorage.setItem(histKey(r.id), JSON.stringify(h)).catch(() => {}); }
      }
      // النصيحة تقارن بالمعتاد قبل هالقراءة
      setOptic(o);
      setHist(h);
      setAdv(adviseFiber(o?.rx, o?.tx, o?.rx !== undefined ? h.slice(0, -1) : h));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const lv = adv?.level ?? 'unknown';
  const color = LEVEL_COLOR[lv];
  const usual = usualRx(hist);
  const recent = hist.slice(-12);
  const min = recent.length ? Math.min(...recent.map(x => x.rx)) : 0;
  const max = recent.length ? Math.max(...recent.map(x => x.rx)) : 0;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={C.blue} /> : (
        <>
          {!!error && <Text style={s.err}>{error}</Text>}
          <View style={[s.card, { alignItems: 'center' }]}>
            <Text style={s.lbl}>استقبال الفايبر</Text>
            <Text style={[s.big, { color }]}>{optic?.rx !== undefined ? optic.rx.toFixed(1) : '—'} <Text style={s.unit}>dBm</Text></Text>
            <Text style={[s.grade, { color }]}>{LEVEL_LABEL[lv]}</Text>
            <View style={s.row}>
              <View style={s.cell}><Text style={s.lbl}>الإرسال</Text><Text style={s.val}>{optic?.tx !== undefined ? `${optic.tx.toFixed(1)} dBm` : '—'}</Text></View>
              <View style={s.cell}><Text style={s.lbl}>المعتاد</Text><Text style={s.val}>{usual !== undefined ? `${usual.toFixed(1)} dBm` : '—'}</Text></View>
              <View style={s.cell}><Text style={s.lbl}>الحرارة</Text><Text style={s.val}>{optic?.tempC !== undefined ? `${optic.tempC}°` : '—'}</Text></View>
            </View>
            <Text style={s.ref}>المقبول: الاستقبال من −8 إلى −27 · الإرسال من 0.5 إلى 5</Text>
          </View>

          {adv && (
            <View style={[s.card, { borderColor: color }]}>
              <Text style={[s.title, { color }]}>{adv.title}</Text>
              <Text style={s.why}>{adv.why}</Text>
              {adv.steps.map((x, i) => <Text key={i} style={s.step}>• {x}</Text>)}
            </View>
          )}

          {recent.length >= 2 && (
            <View style={s.card}>
              <Text style={s.title}>آخر القراءات</Text>
              <View style={s.bars}>
                {recent.map((x, i) => {
                  const span = Math.max(1, max - min);
                  const h = 18 + ((x.rx - min) / span) * 52;
                  return <View key={i} style={[s.bar, { height: h, backgroundColor: LEVEL_COLOR[adviseFiber(x.rx, undefined).level] }]} />;
                })}
              </View>
              <Text style={s.ref}>{`من ${min.toFixed(1)} إلى ${max.toFixed(1)} dBm · نحفظ قراءة كل ما تفتح الراوتر (وحدة كل ١٠ دقايق)`}</Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = sheet({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 14, paddingBottom: 60 },
  card: { backgroundColor: C.card, borderRadius: 22, padding: 16, gap: 8, borderWidth: 1.5, borderColor: C.cardBorder },
  lbl: { color: C.sub, fontSize: 12.5, textAlign: 'center' },
  big: { fontSize: 44, fontWeight: '800' },
  unit: { fontSize: 18, fontWeight: '700' },
  grade: { fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row-reverse', alignSelf: 'stretch', marginTop: 8 },
  cell: { flex: 1, alignItems: 'center', gap: 2 },
  val: { color: C.text, fontSize: 14, fontWeight: '800' },
  ref: { color: C.sub, fontSize: 11.5, textAlign: 'center', marginTop: 4 },
  title: { color: C.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  why: { color: C.text, fontSize: 13.5, lineHeight: 21, textAlign: 'right' },
  step: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  err: { color: C.red, textAlign: 'center' },
  bars: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 4, height: 74, marginTop: 4 },
  bar: { flex: 1, borderRadius: 4 },
});
