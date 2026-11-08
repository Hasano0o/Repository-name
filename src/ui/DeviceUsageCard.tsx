/**
 * «مين يستهلك أكثر؟» — من عدّاد الراوتر نفسه (ZTE: userflowInfo). تطلع بس لو الدرايفر عنده getDeviceUsage.
 * الوحدة من الراوتر غير مؤكدة ← نعرض الترتيب ونسبة كل جهاز من المجموع (صح مهما كانت الوحدة).
 * العدّاد مطفي ← زر «شغّل العدّاد» (USER_FLOW_STATISTIC_SET) بموافقة.
 */
import { useCallback, useRef, useState } from 'react';
import { Alert, ActivityIndicator } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { useFocusEffect } from 'expo-router';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import type { DeviceUsageReport } from '../drivers/types';
import { GlassCard } from './GlassCard';
import { C } from './theme';
import { FONT } from './fonts';
import { sheet } from '../i18n';

export function DeviceUsageCard({ r }: { r: SavedRouter }) {
  const [rep, setRep] = useState<DeviceUsageReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const alive = useRef(true);

  const load = useCallback(() => withSession(r, async d => (d.getDeviceUsage ? d.getDeviceUsage() : null))
    .catch(() => null).then(x => { if (alive.current) setRep(x); }), [r]);

  useFocusEffect(useCallback(() => {
    alive.current = true;
    load();
    const t = setInterval(load, 30_000);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]));

  if (!rep) return null;

  const enable = () => Alert.alert('تشغيل عدّاد الاستهلاك؟', 'الراوتر يبدأ يحسب استهلاك كل جهاز من الحين — ما يأثر على النت.', [
    { text: 'إلغاء', style: 'cancel' },
    {
      text: 'شغّله', onPress: async () => {
        setBusy(true); setNote('');
        try { await withSession(r, d => d.enableDeviceUsage!(), false); setNote('✓ العدّاد اشتغل — ارجع بعد شوي وتطلع الأرقام'); await load(); }
        catch (e: any) { setNote(String(e?.message ?? e).slice(0, 140)); }
        finally { if (alive.current) setBusy(false); }
      },
    },
  ]);

  const sum = rep.list.reduce((a, x) => a + x.total, 0);
  const top = rep.list.filter(x => x.total > 0).slice(0, 8);

  return (
    <GlassCard title="مين يستهلك أكثر؟" icon="📈" tint={C.violetSoft} collapsible={false}>
      {!rep.enabled && (
        <>
          <Text style={s.hint}>عدّاد استهلاك الأجهزة مطفي في راوترك.</Text>
          {rep.canEnable && (
            <Pressable style={[s.btn, busy && { opacity: 0.5 }]} disabled={busy} onPress={enable}>
              {busy ? <ActivityIndicator color={C.blue} /> : <Text style={s.btnTxt}>شغّل العدّاد</Text>}
            </Pressable>
          )}
        </>
      )}
      {rep.enabled && top.length === 0 && <Text style={s.hint}>لسا ما فيه استهلاك محسوب — ارجع بعد شوي.</Text>}
      {top.map((x, i) => {
        const pct = sum > 0 ? Math.round((x.total / sum) * 100) : 0;
        return (
          <View key={x.mac} style={s.row}>
            <View style={s.head}>
              <Text style={s.rank}>{i + 1}</Text>
              <Text style={s.name} numberOfLines={1}>{x.name || x.ip || x.mac}</Text>
              <Text style={[s.pct, i === 0 && { color: '#e5484d' }]}>{pct}٪</Text>
            </View>
            <View style={s.track}><View style={[s.fill, { width: `${Math.max(2, pct)}%`, backgroundColor: i === 0 ? '#e5484d' : '#8b5cf6' }]} /></View>
          </View>
        );
      })}
      {!!note && <Text style={[s.hint, { color: note.startsWith('✓') ? '#12b76a' : '#e5484d' }]}>{note}</Text>}
      {rep.enabled && top.length > 0 && <Text style={s.hint}>النسبة من مجموع اللي حسبه الراوتر من وقت تشغيل العدّاد.</Text>}
    </GlassCard>
  );
}

const s = sheet({
  hint: { color: C.sub, fontSize: 11.5, lineHeight: 18, textAlign: 'right' },
  btn: { marginTop: 8, borderWidth: 1, borderColor: C.blue + '66', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  btnTxt: { color: C.blue, fontSize: 13, fontWeight: '900' },
  row: { gap: 4, marginBottom: 8 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  rank: { color: C.sub, fontSize: 12, fontFamily: FONT.numHeavy, width: 16, textAlign: 'center' },
  name: { flex: 1, color: C.text, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  pct: { color: C.text, fontSize: 13, fontFamily: FONT.numHeavy },
  track: { height: 7, borderRadius: 4, backgroundColor: C.cardBorder + '55', overflow: 'hidden', flexDirection: 'row-reverse' },
  fill: { height: 7, borderRadius: 4 },
});
