/**
 * «استهلاكك اليومي» — اليوم · آخر ٧ أيام · أعمدة لكل يوم · متوسط اليوم.
 * الأرقام محسوبة من عدّاد الشهر حق الراوتر (src/utils/usageDays.ts) — كل ما قرينا العدّاد أكثر صارت أدق،
 * والمراقبة بالخلفية تخليها دقيقة حتى لو التطبيق مقفول.
 */
import { useCallback, useState } from 'react';
import { View, Text } from '../i18n/rn';
import { useFocusEffect } from 'expo-router';
import { GlassCard } from './GlassCard';
import { C } from './theme';
import { FONT } from './fonts';
import { fmtBytes } from '../utils/format';
import { summarize, UsageSummary } from '../utils/usageDays';
import { getUsageLog } from '../store/usageLog';
import { sheet } from '../i18n';

const DAY_AR = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

export function UsageDaysCard({ routerId, refresh }: { routerId: string; refresh?: unknown }) {
  const [sum, setSum] = useState<UsageSummary | null>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    getUsageLog(routerId).then(l => { if (alive) setSum(summarize(l, Date.now())); }).catch(() => {});
    return () => { alive = false; };
  }, [routerId, refresh]));

  if (!sum) return null;

  if (sum.daysKnown === 0) {
    return (
      <GlassCard title="استهلاكك اليومي" icon="📅" tint={C.blueSoft} collapsible={false}>
        <Text style={s.hint}>بدأنا نحسب استهلاكك من الحين — افتح التطبيق بعد شوي وتطلع لك أرقام اليوم والأسبوع.</Text>
      </GlassCard>
    );
  }

  const max = Math.max(1, ...sum.last7.map(d => d.bytes));
  return (
    <GlassCard title="استهلاكك اليومي" icon="📅" tint={C.blueSoft} collapsible={false}>
      <View style={s.row}>
        <View style={s.box}>
          <Text style={s.val}>{fmtBytes(sum.today)}</Text>
          <Text style={s.lbl}>اليوم</Text>
        </View>
        <View style={s.box}>
          <Text style={s.val}>{fmtBytes(sum.week)}</Text>
          <Text style={s.lbl}>آخر ٧ أيام</Text>
        </View>
        {sum.avg > 0 && (
          <View style={s.box}>
            <Text style={s.val}>{fmtBytes(sum.avg)}</Text>
            <Text style={s.lbl}>متوسط اليوم</Text>
          </View>
        )}
      </View>

      <View style={s.bars}>
        {sum.last7.map((d, i) => {
          const h = d.known ? Math.max(3, Math.round((d.bytes / max) * 64)) : 3;
          const today = i === 6;
          return (
            <View key={d.key} style={s.col}>
              <Text style={s.colVal} numberOfLines={1}>{d.known ? fmtBytes(d.bytes).replace(' ', '') : '—'}</Text>
              <View style={s.track}>
                <View style={[s.bar, { height: h, backgroundColor: !d.known ? C.track : today ? C.violet : C.blue, opacity: d.est ? 0.55 : 1 }]} />
              </View>
              <Text style={[s.colDay, today && { color: C.violet }]}>{today ? 'اليوم' : DAY_AR[new Date(d.key + 'T12:00:00').getDay()]}</Text>
            </View>
          );
        })}
      </View>

      {sum.partial && (
        <Text style={s.hint}>
          الأرقام تقريبية للأيام الباهتة أو الفاضية (التطبيق ما انفتح وقتها). شغّل «المراقبة بالخلفية» عشان تصير دقيقة.
        </Text>
      )}
    </GlassCard>
  );
}

const s = sheet({
  row: { flexDirection: 'row-reverse', gap: 8 },
  box: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, gap: 2,
  },
  val: { color: C.text, fontSize: 16, fontFamily: FONT.numHeavy, includeFontPadding: false },
  lbl: { color: C.sub, fontSize: 11, fontWeight: '600' },
  bars: { flexDirection: 'row-reverse', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 12, gap: 4 },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  colVal: { color: C.sub, fontSize: 9, fontFamily: FONT.num },
  track: { height: 64, width: 14, justifyContent: 'flex-end' },
  bar: { width: 14, borderRadius: 6 },
  colDay: { color: C.muted, fontSize: 10, fontWeight: '600' },
  hint: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 16 },
});
