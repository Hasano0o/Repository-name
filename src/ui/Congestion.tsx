import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Signal } from '../drivers/types';
import {
  estimateLoad, loadLevel, LOAD_LABEL, LOAD_COLOR, LoadSample,
  loadSamples, recordLoad, hourlyProfile, peakSentence,
} from '../utils/congestion';
import { C, R, S } from './theme';

const NOTE = {
  free: 'البرج شبه فاضي — السرعة اللي تشوفها هي أقصى ما تعطيه إشارتك.',
  normal: 'ضغط طبيعي على البرج.',
  busy: 'فيه ناس كثير على البرج — السرعة تنزل شوي حتى لو الإشارة قوية.',
  packed: 'البرج مضغوط بقوة — هذا سبب البطء مو إشارتك. جرّب وقت ثاني، أو تردد/برج ثاني من شاشة الأبراج.',
};

/** يسجّل زحمة البرج كل ٤ دقائق (لما ما تحمّل) ويرجع السجل */
export function useLoadHistory(routerId: string, signal: Signal | null, downBps?: number) {
  const [list, setList] = useState<LoadSample[]>([]);
  const listRef = useRef<LoadSample[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadSamples(routerId).then(l => { if (alive) { listRef.current = l; setList(l); } });
    return () => { alive = false; };
  }, [routerId]);

  const own = (downBps ?? 0) > 150_000; // تحميلك أنت يرفع الرقم — ما نقيس وقتها
  const load = signal ? estimateLoad(signal.rsrq, signal.sinr) : undefined;

  useEffect(() => {
    if (load === undefined || own || !listRef.current) return;
    recordLoad(routerId, { t: Date.now(), load, pci: signal?.pci }, listRef.current).then(next => {
      if (next !== listRef.current) { listRef.current = next; setList(next); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, own, routerId]);

  return { list, load, own };
}

/** بطاقة زحمة البرج + أوقات الزحمة عبر اليوم */
export function CongestionCard({ routerId, signal, downBps, history }: {
  routerId: string; signal: Signal | null; downBps?: number;
  /** لو السجل جاي من برا (useLoadHistory) ما نسجّل مرتين */
  history?: { list: LoadSample[]; load?: number; own: boolean };
}) {
  const inner = useLoadHistory(history ? '' : routerId, history ? null : signal, downBps);
  const { list, load, own } = history ?? inner;

  if (!signal) return null;
  const lv = load !== undefined ? loadLevel(load) : undefined;
  const { avg, count } = hourlyProfile(list);
  const enough = list.length >= 12;
  const nowH = new Date().getHours();
  const peak = peakSentence(list);

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>زحمة البرج</Text>
        {lv && !own && (
          <Text style={[s.badge, { color: LOAD_COLOR[lv] }]}>{LOAD_LABEL[lv]} · {Math.round(load! * 100)}٪</Text>
        )}
      </View>

      {own ? (
        <Text style={s.note}>تحمّل الحين — ننتظر لين يهدأ التحميل عشان نقيس زحمة البرج بدقة.</Text>
      ) : lv ? (
        <>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.max(4, Math.round(load! * 100))}%`, backgroundColor: LOAD_COLOR[lv] }]} />
          </View>
          <Text style={s.note}>{NOTE[lv]}</Text>
        </>
      ) : (
        <Text style={s.note}>التشويش عالي الحين، فما نقدر نفرّق بين الزحمة والتشويش.</Text>
      )}

      <View style={s.sep} />
      <Text style={s.sub}>الزحمة عبر اليوم</Text>
      {enough ? (
        <>
          <View style={s.bars}>
            {avg.map((v, h) => (
              <View key={h} style={s.barCol}>
                <View style={[
                  s.bar,
                  {
                    height: v === undefined ? 3 : Math.max(4, Math.round(v * 44)),
                    backgroundColor: v === undefined ? C.track : LOAD_COLOR[loadLevel(v)],
                    opacity: h === nowH ? 1 : 0.8,
                  },
                  h === nowH && s.barNow,
                ]} />
              </View>
            ))}
          </View>
          <View style={s.axis}>
            {['12ص', '6ص', '12ظ', '6م', '11م'].map(t => <Text key={t} style={s.axisT}>{t}</Text>)}
          </View>
          {!!peak && <Text style={s.peak}>{peak}</Text>}
          <Text style={s.tiny}>من {list.length} قياس خلال {count.filter(c => c > 0).length} ساعة مختلفة</Text>
        </>
      ) : (
        <Text style={s.note}>
          نسجّل الزحمة كل ما فتحت التطبيق. بعد كم يوم استخدام نوريك أوقات الزحمة وأفضل وقت للتحميل.
          ({list.length} من 12 قياس)
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  head: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: C.text, fontWeight: '800', fontSize: 15, textAlign: 'right' },
  badge: { fontWeight: '800', fontSize: 13 },
  track: { height: 7, borderRadius: R.pill, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row-reverse' },
  fill: { height: '100%', borderRadius: R.pill },
  note: { color: C.sub, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  sep: { height: 1, backgroundColor: C.lineSoft, marginVertical: 4 },
  sub: { color: C.text, fontWeight: '700', fontSize: 13, textAlign: 'right' },
  // الساعات من اليسار (١٢ص) لليمين (١١م) مثل أي رسم زمني
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 2, direction: 'ltr' },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2 },
  barNow: { borderWidth: 1, borderColor: C.text },
  axis: { flexDirection: 'row', justifyContent: 'space-between', direction: 'ltr' },
  axisT: { color: C.muted, fontSize: 10 },
  peak: { color: C.text, fontSize: 12.5, fontWeight: '600', textAlign: 'right', lineHeight: 19 },
  tiny: { color: C.muted, fontSize: 10.5, textAlign: 'right' },
});
