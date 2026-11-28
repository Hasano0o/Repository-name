/**
 * «انصلحت — جرّبها» في صفحة الراوتر (٢٨ نوفمبر): لو ميزة تجريبية فشلت عند العضو ونزل إصلاحها (LAB_FIXES في labFixCore)،
 * تطلع بطاقة صغيرة تفتح «مزايا تجريبية». تختفي لما يفتحها أو يضغط ✕.
 */
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { useFocusEffect, router, type Href } from 'expo-router';
import type { SavedRouter } from '../store/routers';
import { noticesFor, ackNotice } from '../services/labFix';
import type { FixedNotice } from '../utils/labFixCore';
import { C, tBg } from './theme';

export function LabFixedCard({ r }: { r: SavedRouter }) {
  const [list, setList] = useState<FixedNotice[]>([]);
  useFocusEffect(useCallback(() => {
    let alive = true;
    noticesFor(r.id, r.driverId).then(l => { if (alive) setList(l); }).catch(() => {});
    return () => { alive = false; };
  }, [r]));
  if (!list.length) return null;
  const close = () => { list.forEach(f => ackNotice(f.key)); setList([]); };
  return (
    <Pressable onPress={() => router.push(`/labs/${r.id}` as Href)} accessibilityRole="button" style={[s.card, { backgroundColor: tBg('#e8f8f0') }]}>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Text style={s.title}>انصلحت — جرّبها ✅</Text>
        <Text style={s.sub} numberOfLines={2}>{list[0].note}</Text>
      </View>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="إخفاء" hitSlop={10} style={s.x}>
        <Text style={s.xTxt}>✕</Text>
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#9fe3c4' },
  title: { fontSize: 15, fontWeight: '800', color: C.text, textAlign: 'right' },
  sub: { fontSize: 12, color: C.sub, textAlign: 'right', marginTop: 2 },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  xTxt: { fontSize: 16, color: C.sub },
});
