import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, router, Href } from 'expo-router';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { Carrier } from '../drivers/types';
import { bandLabel } from '../utils/bands';
import { Icon } from './Icon';
import { C, R } from './theme';

/**
 * بطاقة بارزة في صفحة الراوتر: تعرض الأساسي والثانوي الحين (من الناقلات الفعلية)
 * وتودّي لشاشة تغييرهم. كانت مجرد مربع صغير تحت «إعدادات وأدوات».
 */
export function ComboCard({ r }: { r: SavedRouter }) {
  const [list, setList] = useState<Carrier[] | null>(null);
  const alive = useRef(true);

  useFocusEffect(useCallback(() => {
    alive.current = true;
    withSession(r, async d => (d.getCarriers ? d.getCarriers() : []))
      .catch(() => [] as Carrier[])
      .then(l => { if (alive.current) setList(l); });
    return () => { alive.current = false; };
  }, [r]));

  const pcc = list?.find(c => c.role === 'PCC');
  const scc = (list ?? []).filter(c => c.role === 'SCC');

  return (
    <Pressable
      onPress={() => router.push(`/combo/${r.id}` as Href)}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.88 }]}
    >
      <View style={s.head}>
        <View style={s.icon}><Icon name="layers" size={20} color={C.onAccent} /></View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={s.title}>الأساسي والثانوي</Text>
          <Text style={s.sub}>اختر أي تردد يكون الأساسي ووش ينضم معه</Text>
        </View>
      </View>

      <View style={s.now}>
        {list === null ? (
          <View style={s.loadRow}>
            <Text style={s.muted}>نقرأ الترددات…</Text>
            <ActivityIndicator size="small" color={C.blue} />
          </View>
        ) : !pcc ? (
          <Text style={s.muted}>اضغط تشوف الترددات الحالية وتغيّرها</Text>
        ) : (
          <>
            <View style={s.line}>
              <Text style={s.lbl}>⭐ الأساسي</Text>
              <View style={[s.chip, s.chipMain]}>
                <Text style={s.chipMainTxt}>{bandLabel(pcc.tech, pcc.band)}</Text>
              </View>
            </View>
            <View style={s.line}>
              <Text style={s.lbl}>الثانوي</Text>
              <View style={s.chips}>
                {scc.length === 0 ? (
                  <Text style={s.muted}>بدون دمج</Text>
                ) : scc.map((c, i) => (
                  <View key={i} style={[s.chip, c.tech === 'NR' ? s.chipNr : s.chipLte]}>
                    <Text style={[s.chipTxt, { color: c.tech === 'NR' ? C.violet : C.blue }]}>
                      {bandLabel(c.tech, c.band)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </View>

      <View style={s.btn}>
        <Text style={s.btnTxt}>غيّر الأساسي والثانوي</Text>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <Icon name="chevron" size={16} color={C.onAccent} />
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: R.lg, padding: 14, gap: 12,
    borderWidth: 1.5, borderColor: C.blue + '55', marginBottom: 4,
  },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 16.5, fontWeight: '800' },
  sub: { color: C.sub, fontSize: 12, marginTop: 2, textAlign: 'right' },
  now: { backgroundColor: C.rowBg, borderRadius: R.md, padding: 12, gap: 10 },
  loadRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  line: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  lbl: { color: C.sub, fontSize: 12.5, fontWeight: '700', minWidth: 70, textAlign: 'right' },
  chips: { flex: 1, flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  chipMain: { backgroundColor: C.blue, paddingHorizontal: 14, paddingVertical: 6 },
  chipMainTxt: { color: C.onAccent, fontSize: 16, fontWeight: '800' },
  chipLte: { backgroundColor: C.blueSoft },
  chipNr: { backgroundColor: C.violetSoft },
  chipTxt: { fontSize: 13.5, fontWeight: '800' },
  muted: { color: C.sub, fontSize: 12.5, textAlign: 'right' },
  btn: {
    height: 44, borderRadius: R.md, backgroundColor: C.blue,
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  btnTxt: { color: C.onAccent, fontSize: 14, fontWeight: '800' },
});
