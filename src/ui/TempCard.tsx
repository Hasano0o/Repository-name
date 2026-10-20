/**
 * حرارة الراوتر — بطاقة في صفحة الراوتر (تطلع بس لو الراوتر يعطي قراءات).
 * تتحدّث كل ٣٠ ثانية وهي ظاهرة. فوق ٧٠° = حار (تنبيه)، فوق ٨٠° = خطر.
 * الحر يخلي الراوتر يخفّض السرعة لحاله أو يطيّح 5G أو يعيد التشغيل — وكثير يحسبونها مشكلة برج.
 */
import { useCallback, useRef, useState } from 'react';
import { View, Text } from '../i18n/rn';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
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

function Thermo({ c, color }: { c: number; color: string }) {
  // التعبئة من ٢٠° (فاضي) لـ ٩٠° (مليان)
  const f = Math.max(0.08, Math.min(1, (c - 20) / 70));
  const H = 46, top = 4, tube = 32;
  const fillH = tube * f;
  return (
    <Svg width={22} height={H} viewBox={`0 0 22 ${H}`}>
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
      <View style={s.head}>
        <View style={[s.icon, { backgroundColor: SOFT[lv] }]}>
          <Thermo c={max} color={COL[lv]} />
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={s.title}>حرارة الراوتر</Text>
          <Text style={[s.sub, { color: COL[lv] }]} numberOfLines={2}>{tip}</Text>
        </View>
        <View style={[s.badge, { backgroundColor: SOFT[lv] }]}>
          <Text style={[s.badgeTxt, { color: COL[lv] }]}>{WORD[lv]}</Text>
        </View>
      </View>

      <LinearGradient colors={['#34d399', '#f59e0b', '#f97316', '#e5484d']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.scale} />

      <View style={s.row}>
        {shown.map(t => {
          const l = lvOf(t.c);
          return (
            <View key={t.key} style={s.cell}>
              <Thermo c={t.c} color={COL[l]} />
              <Text style={[s.val, { color: COL[l] }]}>{t.c}°</Text>
              <Text style={s.lbl} numberOfLines={1}>{t.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = sheet({
  card: {
    backgroundColor: C.card, borderRadius: R.lg, padding: 12, gap: 10,
    borderWidth: 1, borderColor: tBd('#ffffff'),
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  title: { color: C.text, fontSize: 14.5, fontWeight: '900' },
  sub: { fontSize: 10.5, fontWeight: '700', marginTop: 1, textAlign: 'right' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeTxt: { fontSize: 11, fontWeight: '900' },
  scale: { height: 5, borderRadius: 99 },
  row: { flexDirection: 'row-reverse', justifyContent: 'space-around' },
  cell: { alignItems: 'center', gap: 2, minWidth: 70 },
  val: { fontSize: 18, lineHeight: 22, fontFamily: FONT.numHeavy, includeFontPadding: false },
  lbl: { color: C.sub, fontSize: 10.5, fontWeight: '700' },
});
