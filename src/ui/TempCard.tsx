/**
 * حرارة الراوتر — بطاقة في صفحة الراوتر (تطلع بس لو الراوتر يعطي قراءات).
 * تتحدّث كل ٣٠ ثانية وهي ظاهرة. فوق ٧٠° = حار (تنبيه)، فوق ٨٠° = خطر.
 * الحر يخلي الراوتر يخفّض السرعة لحاله أو يطيّح 5G أو يعيد التشغيل — وكثير يحسبونها مشكلة برج.
 */
import { useCallback, useRef, useState } from 'react';
import { View, Text } from '../i18n/rn';
import { useFocusEffect } from 'expo-router';
import Svg, { Rect, Circle } from 'react-native-svg';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import type { DeviceTemp } from '../drivers/types';
import { C, R, isDark, tBd } from './theme';
import { FONT } from './fonts';
import { sheet } from '../i18n';

type Lv = 'ok' | 'warm' | 'hot' | 'danger';
const lvOf = (c: number): Lv => (c >= 80 ? 'danger' : c >= 70 ? 'hot' : c >= 58 ? 'warm' : 'ok');
const COL: Record<Lv, string> = { ok: '#12b76a', warm: '#f59e0b', hot: '#f97316', danger: '#e5484d' };
const SOFT: Record<Lv, string> = isDark
  ? { ok: '#24493c', warm: '#4d3e25', hot: '#4d3423', danger: '#4d2c33' }
  : { ok: '#e8f8f0', warm: '#fff6e8', hot: '#fff0e6', danger: '#ffeef0' };
const WORD: Record<Lv, string> = { ok: 'طبيعي', warm: 'دافي', hot: 'حار', danger: 'حار جداً' };

function Thermo({ c, color, small }: { c: number; color: string; small?: boolean }) {
  // التعبئة من ٢٠° (فاضي) لـ ٩٠° (مليان)
  const f = Math.max(0.08, Math.min(1, (c - 20) / 70));
  const H = 46, top = 4, tube = 32;
  const scale = small ? 0.62 : 1;
  const fillH = tube * f;
  return (
    <Svg width={22 * scale} height={H * scale} viewBox={`0 0 22 ${H}`}>
      <Rect x={7} y={top} width={8} height={tube + 6} rx={4} fill={C.track} />
      <Rect x={9} y={top + tube + 2 - fillH} width={4} height={fillH + 4} rx={2} fill={color} />
      <Circle cx={11} cy={H - 7} r={6.5} fill={C.track} />
      <Circle cx={11} cy={H - 7} r={4.6} fill={color} />
    </Svg>
  );
}

export function TempCard({ r }: { r: SavedRouter }) {
  const [list, setList] = useState<DeviceTemp[] | null>(null);
  const alive = useRef(true);

  useFocusEffect(useCallback(() => {
    alive.current = true;
    const load = () => withSession(r, async d => (d.getTemps ? d.getTemps() : []))
      .catch(() => [] as DeviceTemp[])
      .then(l => { if (alive.current) setList(l); });
    load();
    const t = setInterval(load, 30_000);
    return () => { alive.current = false; clearInterval(t); };
  }, [r]));

  if (!list || list.length === 0) return null;
  const shown = list.slice(0, 3);
  const max = Math.max(...list.map(x => x.c));
  const lv = lvOf(max);
  const tip = lv === 'danger' ? 'الراوتر حار جداً — بعّده عن الشمس والأجهزة الحارة، وخلّ حوله تهوية'
    : lv === 'hot' ? 'حار شوي — ممكن يخفّض السرعة لحاله. بعّده عن الشمس المباشرة'
    : lv === 'warm' ? 'دافي وطبيعي وقت التحميل'
    : 'الحرارة ممتازة';

  return (
    <View style={s.card}>
      {/* سطر واحد: العنوان والحالة يمين، والقراءات جنبها — والنصيحة بس لو حار */}
      <View style={s.row}>
        <View style={[s.icon, { backgroundColor: SOFT[lv] }]}>
          <Thermo c={max} color={COL[lv]} small />
        </View>
        <View style={s.headTxt}>
          <Text style={s.title} numberOfLines={1}>حرارة الراوتر</Text>
          <Text style={[s.word, { color: COL[lv] }]} numberOfLines={1}>{WORD[lv]}</Text>
        </View>
        <View style={s.vals}>
          {shown.map(t => {
            const l = lvOf(t.c);
            return (
              <View key={t.key} style={s.cell}>
                <Text style={[s.val, { color: COL[l] }]}>{t.c}°</Text>
                <Text style={s.lbl} numberOfLines={1}>{t.label}</Text>
              </View>
            );
          })}
        </View>
      </View>
      {(lv === 'hot' || lv === 'danger') && (
        <Text style={[s.tip, { color: COL[lv], backgroundColor: SOFT[lv] }]}>{tip}</Text>
      )}
    </View>
  );
}

const s = sheet({
  card: {
    backgroundColor: C.card, borderRadius: R.lg, paddingVertical: 10, paddingHorizontal: 12, gap: 8,
    borderWidth: 1, borderColor: tBd('#ffffff'),
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  headTxt: { alignItems: 'flex-end', minWidth: 78 },
  title: { color: C.text, fontSize: 13, fontWeight: '900' },
  word: { fontSize: 10.5, fontWeight: '800' },
  vals: { flex: 1, flexDirection: 'row-reverse', justifyContent: 'space-around' },
  cell: { alignItems: 'center' },
  val: { fontSize: 15, lineHeight: 18, fontFamily: FONT.numHeavy, includeFontPadding: false },
  lbl: { color: C.sub, fontSize: 9, fontWeight: '700' },
  tip: { fontSize: 10.5, fontWeight: '700', textAlign: 'right', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
});
