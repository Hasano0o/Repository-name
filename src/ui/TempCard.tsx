/**
 * حرارة الراوتر — بطاقة في صفحة الراوتر (تطلع بس لو الراوتر يعطي قراءات).
 * تتحدّث كل ٣٠ ثانية وهي ظاهرة. فوق ٧٠° = حار (تنبيه)، فوق ٨٠° = خطر.
 * الحر يخلي الراوتر يخفّض السرعة لحاله أو يطيّح 5G أو يعيد التشغيل — وكثير يحسبونها مشكلة برج.
 */
import { useCallback, useRef, useState } from 'react';
import { View, Text } from '../i18n/rn';
import { useFocusEffect } from 'expo-router';
import Svg, { Rect, Circle, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
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

/** أيقونة مقياس حرارة بيضاء على خلفية حمراء */
function ThermoIcon() {
  return (
    <Svg width={18} height={22} viewBox="0 0 18 22" fill="none">
      <Path d="M9 2.2a2.6 2.6 0 0 0-2.6 2.6v8.1a4.4 4.4 0 1 0 5.2 0V4.8A2.6 2.6 0 0 0 9 2.2z" stroke="#ffffff" strokeWidth={1.7} />
      <Circle cx={9} cy={16.4} r={2.3} fill="#ffffff" />
      <Rect x={8.1} y={7.5} width={1.8} height={8} rx={0.9} fill="#ffffff" />
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
    <LinearGradient colors={isDark ? ['#3a2424', '#2c2230'] : ['#fff1ec', '#ffe4dc']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.card}>
      {/* سطر واحد: العنوان والحالة يمين، والقراءات جنبها — والنصيحة بس لو حار */}
      <View style={s.row}>
        {/* مقياس حرارة أحمر ثابت — يعرّف البطاقة من أول نظرة */}
        <LinearGradient colors={['#f43f5e', '#f97316']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>
          <ThermoIcon />
        </LinearGradient>
        <View style={s.headTxt}>
          <Text style={s.title} numberOfLines={1}>حرارة الراوتر</Text>
          <Text style={[s.word, { color: COL[lv] }]} numberOfLines={1}>{WORD[lv]}</Text>
        </View>
        <View style={s.vals}>
          {shown.map(t => {
            const l = lvOf(t.c);
            return (
              <View key={t.key} style={[s.cell, { borderColor: COL[l] + '40' }]}>
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
    </LinearGradient>
  );
}

const s = sheet({
  card: {
    borderRadius: R.lg, paddingVertical: 10, paddingHorizontal: 12, gap: 8,
    borderWidth: 1, borderColor: isDark ? '#5a3434' : '#fecdc3',
    shadowColor: '#f43f5e', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headTxt: { alignItems: 'flex-end', minWidth: 74 },
  title: { color: C.text, fontSize: 13, fontWeight: '900' },
  word: { fontSize: 10.5, fontWeight: '800' },
  vals: { flex: 1, flexDirection: 'row-reverse', gap: 6 },
  cell: { flex: 1, alignItems: 'center', backgroundColor: isDark ? '#ffffff12' : '#ffffffcc', borderRadius: 12, borderWidth: 1, paddingVertical: 4 },
  val: { fontSize: 15, lineHeight: 18, fontFamily: FONT.numHeavy, includeFontPadding: false },
  lbl: { color: C.sub, fontSize: 9, fontWeight: '700' },
  tip: { fontSize: 10.5, fontWeight: '700', textAlign: 'right', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
});
