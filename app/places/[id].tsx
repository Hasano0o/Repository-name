import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession } from '../../src/store/sessions';
import { Signal } from '../../src/drivers/types';
import { snapshot } from '../../src/utils/safeLock';
import { linkHealth, HEALTH_COLOR } from '../../src/utils/linkHealth';
import { C, R, S } from '../../src/ui/theme';

/** قياس محفوظ لمكان واحد */
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
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  const d = Math.round(h / 24);
  return d === 1 ? 'أمس' : `قبل ${d} أيام`;
};

export default function Places() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [list, setList] = useState<Place[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
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
      await savePlaces(info.id, next);
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? String(e));
    } finally {
      if (alive.current) setBusy('');
    }
  };

  const remove = (p: Place) => {
    if (!info) return;
    Alert.alert('حذف المكان', `نحذف قياس "${p.name}"؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive', onPress: async () => {
          const next = list.filter(x => x.id !== p.id);
          setList(next);
          await savePlaces(info.id, next);
        },
      },
    ]);
  };

  const ranked = [...list].sort((a, b) => b.cap - a.cap);
  const top = ranked[0]?.cap ?? 0;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBottom]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.title}>وين أحط الراوتر؟</Text>
          <Text style={s.body}>
            حط الراوتر في مكان، اكتب اسمه واضغط «قيس هنا». بعدها انقله لمكان ثاني وكرّر.
            نقارن الأماكن بالسرعة المتوقعة — مو بقوة الإشارة بس.
          </Text>

          <View style={s.quick}>
            {QUICK.map(q => (
              <Pressable key={q} style={[s.qChip, name === q && s.qChipOn]} onPress={() => setName(q)}>
                <Text style={[s.qText, name === q && { color: C.onAccent }]}>{q}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="اسم المكان (مثلاً: الصالة جنب التلفزيون)"
            placeholderTextColor={C.muted}
            textAlign="right"
            maxLength={40}
          />

          <Pressable style={[s.btn, (!!busy || !info) && { opacity: 0.6 }]} onPress={measure} disabled={!!busy || !info}>
            {busy ? (
              <View style={s.busyRow}>
                <ActivityIndicator color={C.onAccent} />
                <Text style={s.btnText}>{busy}</Text>
              </View>
            ) : (
              <Text style={s.btnText}>📍 قيس هنا واحفظ</Text>
            )}
          </Pressable>
          {!!error && <Text style={s.err}>{error}</Text>}
        </View>

        {ranked.length === 0 ? (
          <Text style={s.empty}>ما قست أي مكان للحين. ابدأ بالمكان اللي فيه الراوتر الحين.</Text>
        ) : (
          ranked.map((p, i) => {
            const rel = top > 0 ? p.cap / top : 0;
            const best = i === 0 && ranked.length > 1;
            const health = linkHealth({ cqi: p.cqi, txPower: p.tx, dlStreams: p.streams, sinr: p.sinr } as Signal);
            return (
              <View key={p.id} style={[s.card, best && s.bestCard]}>
                <View style={s.head}>
                  <Text style={s.pName}>{best ? '🏆 ' : ''}{p.name}</Text>
                  <Pressable onPress={() => remove(p)} hitSlop={10}>
                    <Text style={s.del}>✕</Text>
                  </Pressable>
                </View>
                <View style={s.track}>
                  <View style={[s.fill, { width: `${Math.max(4, Math.round(rel * 100))}%`, backgroundColor: best ? C.green : C.blue }]} />
                </View>
                <Text style={[s.rel, { color: best ? C.green : C.sub }]}>
                  {i === 0 ? (ranked.length > 1 ? 'أفضل مكان قسته' : 'أول قياس — قيس مكان ثاني للمقارنة')
                    : `أقل من الأفضل بـ ${Math.round((1 - rel) * 100)}٪`}
                </Text>
                <Text style={s.line}>
                  {p.bands || '—'} · {p.carriers > 1 ? `${p.carriers} نواقل · ` : ''}{Math.round(p.bw)} MHz{p.nr ? ' · 5G ✓' : ''}
                </Text>
                <Text style={s.line}>
                  {p.rsrp !== undefined ? `${p.rsrp} dBm` : '—'}{p.sinr !== undefined ? ` · SINR ${p.sinr}` : ''}
                </Text>
                {health.length > 0 && (
                  <View style={s.hRow}>
                    {health.map(h => (
                      <Text key={h.key} style={[s.hItem, { color: HEALTH_COLOR[h.level] }]}>
                        {h.title}: {h.value.split(' · ')[0]}
                      </Text>
                    ))}
                  </View>
                )}
                <Text style={s.ago}>{ago(p.at)}</Text>
              </View>
            );
          })
        )}

        {ranked.length > 1 && (
          <Text style={s.note}>
            الترتيب حسب السرعة المتوقعة من عرض النطاق وجودة كل ناقل. الأماكن اللي فيها دمج أكثر تطلع فوق حتى لو إشارتها أضعف شوي.
          </Text>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  page: { padding: S.lg, gap: S.md },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  bestCard: { borderColor: C.green, backgroundColor: C.greenSoft },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  body: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  quick: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  qChip: { borderRadius: R.pill, borderWidth: 1, borderColor: C.line, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: C.rowBg },
  qChipOn: { backgroundColor: C.blue, borderColor: C.blue },
  qText: { color: C.text, fontSize: 12.5, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14, backgroundColor: C.rowBg },
  btn: { backgroundColor: C.blue, borderRadius: R.md, paddingVertical: 13, alignItems: 'center' },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  busyRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  err: { color: C.red, fontSize: 12.5, textAlign: 'right' },
  empty: { color: C.muted, textAlign: 'center', marginTop: S.lg, fontSize: 13 },
  head: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  pName: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right', flexShrink: 1 },
  del: { color: C.muted, fontSize: 16, paddingHorizontal: 4 },
  track: { height: 8, borderRadius: R.pill, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row-reverse' },
  fill: { height: '100%', borderRadius: R.pill },
  rel: { fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  line: { color: C.sub, fontSize: 12.5, textAlign: 'right' },
  hRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  hItem: { fontSize: 12, fontWeight: '700' },
  ago: { color: C.muted, fontSize: 11, textAlign: 'right' },
  note: { color: C.muted, fontSize: 12, lineHeight: 19, textAlign: 'right' },
});
