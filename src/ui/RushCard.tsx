/**
 * «أوقات الزحمة» — رسم ٢٤ ساعة لبنق سيرفر اللعبة المختار (آخر ١٤ يوم) + متى الزحمة ومتى الأهدى.
 * البيانات: فحوصات المستخدم + قياس خفيف من المراقبة بالخلفية (src/tasks/monitor.ts).
 */
import { useCallback, useState } from 'react';
import { View, Text } from '../i18n/rn';
import { useFocusEffect } from 'expo-router';
import { GlassCard } from './GlassCard';
import { C } from './theme';
import { FONT } from './fonts';
import { listGameLog } from '../store/gameLog';
import { rushReport, hourLabel, RushReport } from '../utils/rushHours';
import { sheet } from '../i18n';

export function RushCard({ routerId, region, regionName }: { routerId: string; region: string; regionName: string }) {
  const [rep, setRep] = useState<RushReport | null>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    listGameLog(routerId).then(l => { if (alive) setRep(rushReport(l, Date.now(), region)); }).catch(() => {});
    return () => { alive = false; };
  }, [routerId, region]));

  if (!rep) return null;

  const pings = rep.hours.map(h => h.ping ?? 0).filter(Boolean);
  const max = Math.max(1, ...pings);
  const min = pings.length ? Math.min(...pings) : 0;
  const inWin = (h: number, w?: { from: number; to: number }) => !!w && (w.to > w.from ? h >= w.from && h < w.to : h >= w.from || h < w.to);
  const nowH = new Date().getHours();

  return (
    <GlassCard title="أوقات الزحمة" icon="🚦" tint={C.violetSoft} collapsible={false}>
      {rep.ready && rep.worst && rep.best ? (
        <View style={{ gap: 4 }}>
          <Text style={s.lead}>
            الزحمة عندك من {hourLabel(rep.worst.from)} إلى {hourLabel(rep.worst.to)} — البنق يرتفع {rep.risePct}٪
          </Text>
          <Text style={s.sub}>
            أهدى وقت: من {hourLabel(rep.best.from)} إلى {hourLabel(rep.best.to)} (بنق {rep.best.ping}ms بدل {rep.worst.ping}ms)
          </Text>
        </View>
      ) : (
        <Text style={s.sub}>
          نجمع قياسات عشان نعرف أوقات الزحمة عندك: {rep.samples} من 20 قياس · {rep.hoursCovered} من 8 ساعات مختلفة.
          شغّل «المراقبة بالخلفية» ونقيس لحالنا كل نص ساعة تقريباً — بعد يومين تطلع لك النتيجة.
        </Text>
      )}

      <View style={s.chart}>
        {rep.hours.map(h => {
          const has = h.count > 0 && h.ping !== undefined;
          const ht = has ? Math.max(4, Math.round(((h.ping! - min * 0.8) / (max - min * 0.8 || 1)) * 56)) : 3;
          const color = !has ? C.track : inWin(h.hour, rep.worst) ? '#e5484d' : inWin(h.hour, rep.best) ? '#12b76a' : C.blue;
          return (
            <View key={h.hour} style={s.col}>
              <View style={[s.bar, { height: ht, backgroundColor: color, opacity: h.count === 1 ? 0.5 : 1 }, h.hour === nowH && s.now]} />
            </View>
          );
        })}
      </View>
      <View style={s.axis}>
        {[0, 6, 12, 18, 23].map(h => <Text key={h} style={s.axisTxt}>{hourLabel(h)}</Text>)}
      </View>
      <Text style={s.hint}>لسيرفرات {regionName} — آخر 14 يوم · الأحمر الزحمة · الأخضر الأهدى</Text>
    </GlassCard>
  );
}

const s = sheet({
  lead: { color: C.text, fontSize: 14, fontWeight: '800', textAlign: 'right', lineHeight: 21 },
  sub: { color: C.sub, fontSize: 12, textAlign: 'right', lineHeight: 18 },
  // اليسار = منتصف الليل (الوقت يمشي يمين، مثل الساعة على الرسم البياني)
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 62, gap: 2, marginTop: 10, direction: 'ltr' },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3 },
  now: { borderWidth: 1.5, borderColor: C.text },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, direction: 'ltr' },
  axisTxt: { color: C.muted, fontSize: 9, fontFamily: FONT.num },
  hint: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 6 },
});
