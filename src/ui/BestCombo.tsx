/**
 * «لقّ لي أفضل تركيبة» + «حارس 5G» — تحت شاشة اختيار الترددات.
 */
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LabRow, comboScore } from '../utils/bandLab';
import { BAND_FREQ, NR_FREQ } from '../utils/bands';
import { C, isDark } from './theme';
import { Icon } from './Icon';

const VIOLET = isDark ? '#c9b8ff' : '#7a51e0';
const VIOLET_SOFT = isDark ? '#33294f' : '#f4efff';
const VIOLET_LINE = isDark ? '#53447f' : '#dccdff';

export const comboLabel = (lte: number[], nr: number[] = []) =>
  [
    lte.map(b => BAND_FREQ[b] ?? `B${b}`).join(' + '),
    nr.length ? '5G ' + nr.map(b => NR_FREQ[b] ?? `n${b}`).join(' + ') : '',
  ].filter(Boolean).join(' · ');

/** التركيبة كشارات: [4G] 1800 + 2100  [5G] 3500 — أوضح من نص واحد مخلوط */
function ComboChips({ lte, nr = [] }: { lte: number[]; nr?: number[] }) {
  const part = (tech: '4G' | '5G', txt: string) => (
    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5 }}>
      <View style={[s.tech, tech === '5G' ? { backgroundColor: VIOLET_SOFT, borderColor: VIOLET_LINE } : null]}>
        <Text style={[s.techText, tech === '5G' && { color: VIOLET }]}>{tech}</Text>
      </View>
      <Text style={s.rowTitle}>{txt}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {part('4G', lte.map(b => BAND_FREQ[b] ?? `B${b}`).join(' + '))}
      {nr.length > 0 && part('5G', nr.map(b => NR_FREQ[b] ?? `n${b}`).join(' + '))}
    </View>
  );
}

export function BestCombo({
  rows, running, done, busy, onStart, onStop, onApply,
}: {
  rows: LabRow[];
  running: boolean;
  done: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onApply: (r: LabRow) => void;
}) {
  const ranked = done ? [...rows].filter(r => r.status === 'done').sort((a, b) => comboScore(b) - comboScore(a)) : [];
  const best = ranked[0];
  const list = done ? [...ranked, ...rows.filter(r => r.status !== 'done')] : rows;

  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={s.icon}><Icon name="spark" size={18} color={VIOLET} /></View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={s.title}>لقّ لي أفضل تركيبة</Text>
          <Text style={s.hint}>نجرب كم تركيبة ورا بعض ونقيس السرعة والبنق فعلياً، وبالآخر نرجّع إعدادك ونقترح الأفضل.</Text>
        </View>
      </View>

      {list.map((r, i) => {
        const isBest = !!best && r === best;
        return (
          <View key={i} style={[s.row, isBest && s.rowBest]}>
            <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                {isBest && <View style={s.bestTag}><Text style={s.bestTagText}>الأفضل</Text></View>}
                <ComboChips lte={r.bands} nr={r.nrBands} />
              </View>
              <Text style={[s.rowSub, r.status === 'failed' && { color: C.red }]} numberOfLines={1}>
                {r.status === 'pending' ? 'بالانتظار'
                  : r.status === 'testing' ? r.note ?? 'نجرب...'
                  : r.status === 'failed' ? r.note ?? 'فشل'
                  : [
                      r.speedMbps !== undefined ? `${Math.round(r.speedMbps)} ميقا` : null,
                      r.pingMs !== undefined ? `بنق ${Math.round(r.pingMs)}` : null,
                      r.nrBands?.length ? (r.nrActive ? '5G اشتغل' : '5G ما اشتغل') : null,
                    ].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {r.status === 'testing' && <ActivityIndicator size="small" color={VIOLET} />}
            {r.status === 'done' && !isBest && <Icon name="check" size={16} color={C.green} />}
          </View>
        );
      })}

      {running ? (
        <Pressable style={[s.btn, s.btnStop]} onPress={onStop}>
          <Text style={[s.btnText, { color: C.red }]}>وقّف — ونرجّع إعدادك</Text>
        </Pressable>
      ) : best ? (
        <View style={{ gap: 8 }}>
          <Pressable style={[s.btn, s.btnMain, busy && { opacity: 0.45 }]} onPress={() => onApply(best)} disabled={busy}>
            <Text style={[s.btnText, { color: '#fff' }]}>ثبّت الأفضل</Text>
          </Pressable>
          <Pressable onPress={onStart} disabled={busy} hitSlop={6}>
            <Text style={[s.hint, { textAlign: 'center', color: VIOLET, fontWeight: '700' }]}>جرّب من جديد</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={[s.btn, s.btnMain, busy && { opacity: 0.45 }]} onPress={onStart} disabled={busy}>
          <Text style={[s.btnText, { color: '#fff' }]}>{done ? 'ما نجحت ولا تركيبة — جرّب مرة ثانية' : 'ابدأ'}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function GuardCard({
  on, reason, fellBackAt, monitorOn, onToggle, onOpenMonitor,
}: {
  on: boolean;
  reason?: string;
  fellBackAt?: number;
  monitorOn: boolean;
  onToggle: () => void;
  onOpenMonitor: () => void;
}) {
  const when = fellBackAt ? new Date(fellBackAt) : null;
  return (
    <View style={s.card}>
      <Pressable style={s.head} onPress={onToggle}>
        <View style={[s.icon, { backgroundColor: isDark ? '#24493c' : '#e3f8ef' }]}>
          <Icon name="lock" size={18} color={isDark ? '#6adcbd' : '#0f7a52'} />
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={s.title}>حارس 5G</Text>
          <Text style={s.hint}>
            لو التركيبة المثبّتة طيّحت النت أو اختفى 5G، يرجّع الراوتر يختار بنفسه، ولما تستقر الإشارة يرجع لتركيبتك.
          </Text>
        </View>
        <View style={[s.sw, on ? { backgroundColor: C.green, justifyContent: 'flex-start' } : { justifyContent: 'flex-end' }]}>
          <View style={s.knob} />
        </View>
      </Pressable>
      {on && !monitorOn && (
        <Pressable style={s.warn} onPress={onOpenMonitor}>
          <Text style={s.warnText}>الحارس يشتغل مع «المراقبة بالخلفية» — اضغط هنا وشغّلها</Text>
        </Pressable>
      )}
      {on && when && (
        <Text style={s.hint}>
          آخر تدخّل: {reason ?? ''} — {when.getHours() % 12 || 12}:{String(when.getMinutes()).padStart(2, '0')}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 22, padding: 14, gap: 10 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: VIOLET_SOFT, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 15, fontWeight: '700' },
  hint: { color: C.muted, fontSize: 11.5, fontWeight: '600', textAlign: 'right', lineHeight: 18 },
  row: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1,
    borderColor: isDark ? '#3a3128' : '#edf0f6', paddingVertical: 10, paddingHorizontal: 12,
  },
  rowBest: { borderColor: VIOLET_LINE, backgroundColor: VIOLET_SOFT },
  rowTitle: { color: C.text, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  tech: { borderRadius: 6, borderWidth: 1, borderColor: isDark ? '#3b4d72' : '#c9d8ff', backgroundColor: isDark ? '#26324a' : '#eef3ff', paddingHorizontal: 5, paddingVertical: 0 },
  techText: { color: isDark ? '#9cbcff' : '#2f6bff', fontSize: 10, fontWeight: '800' },
  rowSub: { color: C.muted, fontSize: 11.5, fontWeight: '600' },
  bestTag: { backgroundColor: VIOLET, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  bestTagText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  btn: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center' },
  btnMain: { backgroundColor: VIOLET },
  btnStop: { borderWidth: 1, borderColor: C.red },
  btnText: { fontSize: 14, fontWeight: '700' },
  sw: { width: 44, height: 26, borderRadius: 999, padding: 3, flexDirection: 'row', backgroundColor: C.line },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  warn: { backgroundColor: isDark ? '#4d3e25' : '#fff6e8', borderRadius: 12, padding: 10 },
  warnText: { color: isDark ? '#ffcb8c' : '#9a5b00', fontSize: 12, fontWeight: '700', textAlign: 'right' },
});
