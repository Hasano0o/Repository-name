import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { AreaOp, Consent, fetchArea, getArea, setArea } from '../services/community';
import { C } from './theme';
import { GlassCard } from './GlassCard';

const col = (sc: number | null) => (sc === null ? C.sub : sc >= 70 ? C.green : sc >= 45 ? '#e0a100' : C.red);

/** أي شريحة أفضل في حيّك — من فحوصات «جاهز للعب؟» عند الناس في نفس الحي */
export function AreaCompare({ consent, region, regionName, refresh }: {
  consent: Consent; region: string; regionName: string; refresh: number;
}) {
  const [area, setAreaState] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [dist, setDist] = useState('');
  const [editing, setEditing] = useState(false);
  const [ops, setOps] = useState<AreaOp[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { getArea().then(a => setAreaState(a)); }, []);

  const load = useCallback(async (a: string) => {
    if (!a) return;
    setLoading(true);
    setOps(await fetchArea(a, region));
    setLoading(false);
  }, [region]);

  useEffect(() => { if (consent === 'on' && area) load(area); }, [consent, area, load, refresh]);

  const save = async () => {
    const a = [city.trim(), dist.trim()].filter(Boolean).join('/');
    if (!a) return;
    await setArea(a);
    setAreaState(a);
    setEditing(false);
  };

  const startEdit = () => {
    const [c = '', d = ''] = (area ?? '').split('/');
    setCity(c);
    setDist(d);
    setEditing(true);
  };

  return (
    <GlassCard title="أي شريحة أفضل في حيّك؟" icon="📶" tint={C.mintSoft} collapsible={false}>
      {consent !== 'on' ? (
        <Text style={s.hint}>فعّل «شارك» في بطاقة «على برجك» فوق، وبعدها تشوف مقارنة الشرائح (STC وموبايلي وزين) في حيّك من فحوصات الناس الحقيقية</Text>
      ) : area === null ? (
        <ActivityIndicator color={C.blue} />
      ) : !area || editing ? (
        <>
          <Text style={s.hint}>اكتب مدينتك وحيّك (بدون موقع GPS). نقارن فحوصات «جاهز للعب؟» لكل شريحة عند الناس في نفس الحي</Text>
          <View style={s.row}>
            <TextInput style={s.input} value={dist} onChangeText={setDist} placeholder="الحي" placeholderTextColor={C.muted} maxLength={30} />
            <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="المدينة" placeholderTextColor={C.muted} maxLength={25} />
          </View>
          <Pressable style={[s.btn, !city.trim() && s.dim]} onPress={save} disabled={!city.trim()}>
            <Text style={s.btnTxt}>احفظ</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={s.areaRow}>
            <Pressable onPress={startEdit} hitSlop={8}><Text style={s.change}>غيّر</Text></Pressable>
            <Text style={s.areaTxt}>📍 {area.replace('/', ' — ')} · سيرفرات {regionName}</Text>
          </View>
          {loading && <ActivityIndicator color={C.blue} />}
          {!loading && ops && ops.length > 0 && ops.map((o, i) => (
            <View key={o.operator} style={[s.op, i === 0 && ops.length > 1 && s.opBest]}>
              <View style={s.opHead}>
                <Text style={[s.opScore, { color: col(o.score) }]}>{o.score ?? '—'}<Text style={s.of}>/100</Text></Text>
                <Text style={s.opName}>{i === 0 && ops.length > 1 ? '⭐ ' : ''}{o.operator}{o.mine ? ' (شريحتك)' : ''}</Text>
              </View>
              <Text style={s.opSub}>بنق {o.ping ?? '—'}ms · تذبذب {o.jitter ?? '—'}ms · {o.tests} فحص من {o.users} {o.users > 2 ? 'مستخدمين' : 'مستخدم'}</Text>
            </View>
          ))}
          {!loading && (!ops || ops.length === 0) && (
            <Text style={s.hint}>ما فيه نتائج في حيّك للحين. كل ما أحد فحص «جاهز للعب؟» تتجمع النتائج — شارك التطبيق مع جيرانك وقروبك 😄</Text>
          )}
          {!loading && ops && ops.length === 1 && (
            <Text style={s.hint}>للحين شريحة وحدة بس في حيّك — نحتاج مستخدمين من شركات ثانية عشان تصير مقارنة</Text>
          )}
        </>
      )}
    </GlassCard>
  );
}

const s = StyleSheet.create({
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: C.rowBg, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14, textAlign: 'right' },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 12, alignItems: 'center' },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.45 },
  areaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  areaTxt: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right', flexShrink: 1 },
  change: { color: C.blue, fontWeight: '800', fontSize: 12 },
  op: { backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 11, gap: 4 },
  opBest: { borderColor: C.green, borderWidth: 2 },
  opHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  opScore: { fontWeight: '900', fontSize: 18 },
  of: { color: C.sub, fontSize: 11, fontWeight: '700' },
  opName: { color: C.text, fontWeight: '800', fontSize: 15 },
  opSub: { color: C.sub, fontSize: 11, textAlign: 'right' },
});
