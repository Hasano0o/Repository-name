/**
 * «مزايا تجريبية» (٢٨ نوفمبر — قرار حسن: «سوّ كل الميزات المكتشفة حتى لو بدون تجربة حقيقية، ولو طلع خطأ يظهر لنا ونصلحه»).
 * الشاشة عامة: كل درايفر يعرض اللي لقيناه في كود صفحته (getLabs) — تشغيل/إطفاء · خيارات · زر · قراءة.
 * أي فشل ← reportError(`lab-<id>`) باسم الأمر ورد الراوتر (data/errors.jsonl + تقرير) عشان نصلحه بالمسار الصحيح.
 * كل أمر من خلال routerWrite (قفل الراوتر — ما يتداخل مع المراقبة أو أمر ثاني).
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { ScrollView, View, Text, Pressable } from '../../src/i18n/rn';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SavedRouter, getRouter } from '../../src/store/routers';
import { withSession, routerWrite } from '../../src/store/sessions';
import { reportError } from '../../src/services/errors';
import type { LabItem } from '../../src/drivers/types';
import { C, tBg } from '../../src/ui/theme';

export default function LabsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<SavedRouter | null>(null);
  const [items, setItems] = useState<LabItem[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const load = useCallback(async (r: SavedRouter) => {
    try {
      const l = await withSession(r, async d => (d.getLabs ? d.getLabs() : []), false);
      setItems(l);
      setErr('');
    } catch (e: any) {
      setItems([]);
      setErr(e?.message ?? 'ما قدرنا نقرأ الراوتر');
      reportError('lab-list', e, r);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const r = await getRouter(id);
      if (!alive) return;
      if (!r) { setErr('الراوتر غير موجود'); setItems([]); return; }
      setInfo(r);
      await load(r);
    })();
    return () => { alive = false; };
  }, [id, load]));

  const run = async (it: LabItem, value?: string) => {
    if (!info || busy) return;
    const go = async () => {
      setBusy(it.id);
      setNote(n => ({ ...n, [it.id]: { ok: true, msg: 'نطبّق…' } }));
      try {
        const msg = await routerWrite(info, d => {
          if (!d.runLab) throw new Error('راوترك ما فيه هالميزة');
          return d.runLab(it.id, value);
        }, { label: it.title });
        setNote(n => ({ ...n, [it.id]: { ok: true, msg: msg || 'تم' } }));
      } catch (e: any) {
        const m = String(e?.message ?? e);
        setNote(n => ({ ...n, [it.id]: { ok: false, msg: m + ' — وصلنا الخطأ ونصلحه' } }));
        reportError(`lab-${it.id.split(':')[0]}`, new Error(`${it.cmd ?? it.id}${value !== undefined ? '=' + value : ''} · ${m}`), info);
      } finally {
        setBusy(null);
        await load(info);
      }
    };
    if (it.confirm) Alert.alert(it.title, it.confirm, [{ text: 'إلغاء', style: 'cancel' }, { text: 'كمّل', onPress: go }]);
    else go();
  };

  const groups: [string, LabItem[]][] = [];
  for (const it of items ?? []) {
    const g = groups.find(x => x[0] === it.group);
    if (g) g[1].push(it); else groups.push([it.group, [it]]);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={[s.banner, { backgroundColor: tBg('#fff6e8') }]}>
        <Text style={s.bannerTitle}>مزايا تجريبية 🧪</Text>
        <Text style={s.bannerTxt}>ميزات لقيناها في صفحة راوترك نفسه وأضفناها قبل ما تنجرّب على كل الموديلات. لو وحدة ما مشت، الخطأ يوصلنا تلقائي ونصلحها.</Text>
      </View>

      {items === null && <ActivityIndicator style={{ marginTop: 30 }} color={C.blue} />}
      {!!err && <Text style={s.err}>{err}</Text>}
      {items !== null && !items.length && !err && <Text style={s.empty}>ما لقينا مزايا تجريبية لراوترك للحين.</Text>}

      {groups.map(([g, list]) => (
        <View key={g} style={s.card}>
          <Text style={s.group}>{g}</Text>
          {list.map(it => {
            const n = note[it.id];
            const on = it.value === '1';
            return (
              <View key={it.id} style={s.item}>
                <View style={s.row}>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={s.title}>{it.title}</Text>
                    {!!it.desc && <Text style={s.desc}>{it.desc}</Text>}
                  </View>
                  {busy === it.id && <ActivityIndicator color={C.blue} style={{ marginLeft: 8 }} />}
                  {it.kind === 'toggle' && busy !== it.id && (
                    <Pressable onPress={() => run(it, on ? '0' : '1')} accessibilityRole="switch" accessibilityState={{ checked: on }}
                      style={[s.switch, { backgroundColor: on ? C.blue : C.track }]}>
                      <View style={[s.knob, on ? { left: 22 } : { left: 2 }]} />
                    </Pressable>
                  )}
                  {it.kind === 'action' && busy !== it.id && (
                    <Pressable onPress={() => run(it)} accessibilityRole="button" style={s.btn}><Text style={s.btnTxt}>شغّل</Text></Pressable>
                  )}
                </View>
                {it.kind === 'choice' && (
                  <View style={s.opts}>
                    {(it.options ?? []).map(o => {
                      const sel = it.value === o.value;
                      return (
                        <Pressable key={o.value} disabled={!!busy} onPress={() => run(it, o.value)} accessibilityRole="button"
                          style={[s.opt, sel && { backgroundColor: C.blue, borderColor: C.blue }]}>
                          <Text style={[s.optTxt, sel && { color: '#fff' }]}>{o.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {!!it.rows?.length && (
                  <View style={s.rows}>
                    {it.rows.map((r, i) => (
                      <View key={i} style={s.kv}>
                        <Text style={s.kvV} numberOfLines={1}>{r.value}</Text>
                        <Text style={s.kvK} numberOfLines={1}>{r.label}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {!!n && <Text style={[s.note, { color: n.ok ? '#12b76a' : '#e5484d' }]}>{n.msg}</Text>}
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  banner: { borderRadius: 16, padding: 14, marginBottom: 14 },
  bannerTitle: { fontSize: 16, fontWeight: '800', color: C.text, textAlign: 'right' },
  bannerTxt: { fontSize: 13, color: C.sub, textAlign: 'right', marginTop: 4, lineHeight: 20 },
  err: { color: '#e5484d', textAlign: 'center', marginTop: 16 },
  empty: { color: C.sub, textAlign: 'center', marginTop: 24 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, padding: 14, marginBottom: 12 },
  group: { fontSize: 13, fontWeight: '800', color: C.blue, textAlign: 'right', marginBottom: 6 },
  item: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.cardBorder },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  title: { fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'right' },
  desc: { fontSize: 12, color: C.sub, textAlign: 'right', marginTop: 2, lineHeight: 18 },
  switch: { width: 46, height: 26, borderRadius: 13 },
  knob: { position: 'absolute', top: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  btn: { backgroundColor: C.blue, borderRadius: 999, paddingHorizontal: 16, minHeight: 36, justifyContent: 'center' },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  opts: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  opt: { borderWidth: 1, borderColor: C.cardBorder, borderRadius: 999, paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
  optTxt: { fontSize: 13, color: C.text, fontWeight: '600' },
  rows: { marginTop: 8, backgroundColor: C.rowBg, borderRadius: 10, padding: 8 },
  kv: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: 8, paddingVertical: 2 },
  kvK: { fontSize: 12, color: C.sub, flexShrink: 1 },
  kvV: { fontSize: 12, color: C.text, fontWeight: '600', flexShrink: 1 },
  note: { fontSize: 12, textAlign: 'right', marginTop: 6 },
});
