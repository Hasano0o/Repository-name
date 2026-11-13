/**
 * «تفاصيل الاستهلاك» — جدول مثل صفحة الراوتر (طلب عضو ١٣ نوفمبر):
 * السرعة الحين · هالاتصال (تنزيل/رفع) · هالشهر (تنزيل/رفع) · مدة الاتصال · مدة الشهر.
 * كل سطر يطلع بس لو الراوتر يعطي قيمته.
 */
import { View, Text } from '../i18n/rn';
import type { Traffic, Usage } from '../drivers/types';
import { GlassCard } from './GlassCard';
import { C } from './theme';
import { FONT } from './fonts';
import { fmtBytes, fmtRate, fmtDuration } from '../utils/format';
import { sheet } from '../i18n';

function Row({ label, down, up, one }: { label: string; down?: string; up?: string; one?: string }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      {one !== undefined ? (
        <Text style={[s.val, s.one]} numberOfLines={1}>{one}</Text>
      ) : (
        <>
          <Text style={[s.val, { color: C.blue }]} numberOfLines={1}>↓ {down}</Text>
          <Text style={[s.val, { color: C.violet }]} numberOfLines={1}>↑ {up}</Text>
        </>
      )}
    </View>
  );
}

export function UsageTableCard({ traffic, usage }: { traffic: Traffic | null; usage: Usage | null }) {
  if (!traffic && !usage) return null;
  const hasSession = traffic?.sessionDownBytes !== undefined || traffic?.sessionUpBytes !== undefined;
  return (
    <GlassCard title="تفاصيل الاستهلاك" icon="📈" tint={C.violetSoft} collapsible={false}>
      <View style={s.table}>
        {!!traffic && (
          <Row label="السرعة الحين" down={fmtRate(traffic.downBytesPerSec)} up={fmtRate(traffic.upBytesPerSec)} />
        )}
        {!!traffic && hasSession && (
          <Row label="هالاتصال" down={fmtBytes(traffic.sessionDownBytes ?? 0)} up={fmtBytes(traffic.sessionUpBytes ?? 0)} />
        )}
        {!!usage && (
          <Row label="هالشهر" down={fmtBytes(usage.downloadBytes)} up={fmtBytes(usage.uploadBytes)} />
        )}
        {!!traffic && traffic.connectedSecs > 0 && <Row label="مدة الاتصال" one={fmtDuration(traffic.connectedSecs)} />}
        {!!usage?.monthSecs && <Row label="مدة الشهر" one={fmtDuration(usage.monthSecs)} />}
      </View>
    </GlassCard>
  );
}

const s = sheet({
  table: { borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: C.cardBorder, backgroundColor: C.card,
  },
  label: { width: 88, color: C.sub, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  val: { flex: 1, color: C.text, fontSize: 13, fontFamily: FONT.num, textAlign: 'center' },
  one: { flex: 2 },
});
