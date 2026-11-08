/**
 * الشرايح الإضافية — راوتر بأكثر من مودم (ZTE MU5252: شريحة 5G + شريحتين 4G يدمجهم مع الإيثرنت).
 * قراءة بس: إشارة كل شريحة (التردد، RSRP، النقاء، الجودة، البرج). تطلع بس لو الدرايفر يرجّع مودمات.
 * التحكم (الترددات/الأبراج/المحسّن) للشريحة الأساسية بس — نقولها بصراحة تحت.
 */
import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable } from '../i18n/rn';
import { Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import type { ModemSignal } from '../drivers/types';
import { bandFreq } from '../utils/bands';
import { C, R, isDark } from './theme';
import { FONT } from './fonts';
import { sheet } from '../i18n';

const lv = (rsrp?: number) => rsrp === undefined ? null : rsrp >= -80 ? 'ممتازة' : rsrp >= -90 ? 'جيدة' : rsrp >= -100 ? 'متوسطة' : 'ضعيفة';
const col = (rsrp?: number) => rsrp === undefined ? C.sub : rsrp >= -80 ? '#12b76a' : rsrp >= -90 ? '#2f6bff' : rsrp >= -100 ? '#f59e0b' : '#e5484d';

export function ModemsCard({ r }: { r: SavedRouter }) {
  const [list, setList] = useState<ModemSignal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const alive = useRef(true);
  const canPower = useRef(false);

  useFocusEffect(useCallback(() => {
    alive.current = true;
    const load = () => withSession(r, async d => { canPower.current = !!d.setModemPower; return d.getModems ? d.getModems() : []; })
      .catch(() => [] as ModemSignal[])
      .then(l => { if (alive.current) setList(l); });
    load();
    const t = setInterval(load, 15_000);
    return () => { alive.current = false; clearInterval(t); };
  }, [r]));

  if (!list || list.length === 0) return null;

  const toggle = (m: ModemSignal) => {
    const on = !!m.off;
    Alert.alert(
      on ? `تشغيل ${m.label}؟` : `إطفاء ${m.label}؟`,
      on ? 'الراوتر يرجع يدمجها مع باقي الشرايح.'
        : 'الراوتر يوقف هالشريحة ويكمّل بالباقي — جرّب السرعة بعدها وقارن. تقدر ترجّعها من نفس الزر.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: on ? 'شغّلها' : 'طفّها', style: on ? 'default' : 'destructive',
          onPress: async () => {
            setBusy(m.key); setNote('');
            try {
              await withSession(r, d => d.setModemPower!(m.key, on), false);
              setNote(`✓ ${m.label} ${on ? 'اشتغلت' : 'انطفت'}`);
              const l = await withSession(r, d => d.getModems!()).catch(() => null);
              if (l && alive.current) setList(l);
            } catch (e: any) {
              setNote(String(e?.message ?? e).slice(0, 140));
            } finally { if (alive.current) setBusy(null); }
          },
        },
      ],
    );
  };

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>الشرايح الثانية</Text>
        <Text style={s.sub}>راوترك يدمجها مع الأساسية</Text>
      </View>
      {list.map(m => {
        const c = col(m.rsrp);
        const word = m.off ? 'مطفية' : m.rsrp === undefined ? (m.network ? 'بدون خدمة' : 'ما فيه قراءة') : lv(m.rsrp);
        return (
          <View key={m.key} style={[s.row, { borderColor: c + '55' }]}>
            <View style={s.left}>
              <Text style={s.label}>{m.label}</Text>
              <Text style={[s.word, { color: c }]}>{word}</Text>
              {!!m.band && (
                <Text style={s.band}>B{m.band}{bandFreq(m.band) ? ` · ${bandFreq(m.band)}` : ''}{m.earfcn ? ` · ${m.earfcn}` : ''}</Text>
              )}
            </View>
            {canPower.current && (
              <Pressable disabled={!!busy} onPress={() => toggle(m)}
                style={[s.pw, { borderColor: m.off ? '#12b76a88' : C.cardBorder }, !!busy && { opacity: 0.5 }]}>
                {busy === m.key ? <ActivityIndicator size="small" color={C.blue} /> : <Text style={[s.pwTxt, { color: m.off ? '#12b76a' : C.sub }]}>{m.off ? 'شغّل' : 'طفّ'}</Text>}
              </Pressable>
            )}
            {m.rsrp !== undefined && !m.off && (
              <View style={s.vals}>
                <View style={s.cell}><Text style={[s.val, { color: c }]}>{m.rsrp}</Text><Text style={s.lbl}>RSRP</Text></View>
                {m.sinr !== undefined && <View style={s.cell}><Text style={s.val}>{m.sinr}</Text><Text style={s.lbl}>SINR</Text></View>}
                {m.rsrq !== undefined && <View style={s.cell}><Text style={s.val}>{m.rsrq}</Text><Text style={s.lbl}>RSRQ</Text></View>}
                {m.pci !== undefined && <View style={s.cell}><Text style={s.val}>{m.pci}</Text><Text style={s.lbl}>PCI</Text></View>}
              </View>
            )}
          </View>
        );
      })}
      {!!note && <Text style={[s.note, { color: note.startsWith('✓') ? '#12b76a' : '#e5484d' }]}>{note}</Text>}
      <Text style={s.note}>تثبيت الترددات والأبراج والمحسّن للشريحة الأساسية بس — راوترك ما يسمح بتثبيت ترددات الشرايح الثانية</Text>
    </View>
  );
}

const s = sheet({
  card: {
    borderRadius: R.lg, paddingVertical: 10, paddingHorizontal: 12, gap: 8,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder,
  },
  head: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 8 },
  title: { color: C.text, fontSize: 14, fontWeight: '900' },
  sub: { color: C.sub, fontSize: 10.5, fontWeight: '700' },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14,
    paddingVertical: 8, paddingHorizontal: 10, backgroundColor: isDark ? '#ffffff08' : '#f7f9fd',
  },
  left: { alignItems: 'flex-end', minWidth: 92 },
  label: { color: C.text, fontSize: 12.5, fontWeight: '900' },
  word: { fontSize: 10.5, fontWeight: '800' },
  band: { color: C.sub, fontSize: 10, fontWeight: '700', fontFamily: FONT.num },
  vals: { flex: 1, flexDirection: 'row-reverse', gap: 5 },
  cell: { flex: 1, alignItems: 'center' },
  val: { color: C.text, fontSize: 14, lineHeight: 18, fontFamily: FONT.numHeavy, includeFontPadding: false },
  lbl: { color: C.sub, fontSize: 9, fontWeight: '700' },
  pw: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, minWidth: 44, alignItems: 'center' },
  pwTxt: { fontSize: 11.5, fontWeight: '900' },
  note: { color: C.sub, fontSize: 10, fontWeight: '700', textAlign: 'right' },
});
