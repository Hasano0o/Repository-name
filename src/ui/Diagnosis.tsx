import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Signal } from '../drivers/types';
import { linkHealth, HEALTH_COLOR } from '../utils/linkHealth';
import { loadLevel, LOAD_LABEL, LOAD_COLOR } from '../utils/congestion';
import { LinkHealthCard } from './LinkHealth';
import { CongestionCard, useLoadHistory } from './Congestion';
import { C, R, S } from './theme';

/**
 * "التشخيص": ملخص سطر واحد (كفاءة · إرسال · مسارات · زحمة) — والتفاصيل تنفتح بضغطة.
 * يجمع بطاقتي صحة الوصلة وزحمة البرج بدل ما يكونون فوق بعض.
 */
export function DiagnosisCard({ routerId, signal, downBps }: { routerId: string; signal: Signal; downBps?: number }) {
  const [open, setOpen] = useState(false);
  const health = linkHealth(signal, 'LTE');
  const hist = useLoadHistory(routerId, signal, downBps);
  const lv = hist.load !== undefined && !hist.own ? loadLevel(hist.load) : undefined;

  const chips: { label: string; value: string; color: string }[] = health.map(h => ({
    label: h.key === 'efficiency' ? 'الكفاءة' : h.key === 'uplink' ? 'الإرسال' : 'المسارات',
    value: h.value.split(' · ')[0].replace(' من 23', ''),
    color: HEALTH_COLOR[h.level],
  }));
  if (lv) chips.push({ label: 'زحمة البرج', value: LOAD_LABEL[lv], color: LOAD_COLOR[lv] });
  if (!chips.length) return null;

  return (
    <View style={s.card}>
      <Pressable style={s.head} onPress={() => setOpen(o => !o)} hitSlop={6}>
        <Text style={s.title}>🩺 التشخيص</Text>
        <Text style={s.more}>{open ? 'إخفاء ▴' : 'التفاصيل ▾'}</Text>
      </Pressable>
      <View style={s.chips}>
        {chips.map(c => (
          <View key={c.label} style={[s.chip, { borderColor: c.color }]}>
            <Text style={s.chipLabel}>{c.label}</Text>
            <Text style={[s.chipVal, { color: c.color }]}>{c.value}</Text>
          </View>
        ))}
      </View>
      {open && (
        <View style={{ gap: S.md, marginTop: S.sm }}>
          <LinkHealthCard items={health} />
          <CongestionCard routerId={routerId} signal={signal} downBps={downBps} history={hist} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  head: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: C.text, fontWeight: '800', fontSize: 15 },
  more: { color: C.blue, fontWeight: '700', fontSize: 12.5 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: S.sm },
  chip: { borderWidth: 1, borderRadius: R.md, paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center', backgroundColor: C.rowBg, minWidth: 70 },
  chipLabel: { color: C.muted, fontSize: 10.5 },
  chipVal: { fontWeight: '800', fontSize: 12.5 },
});
