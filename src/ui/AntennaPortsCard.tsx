/**
 * منافذ الأنتنا (MIMO) — بطاقة في صفحة الراوتر (حسن ٢٨ نوفمبر).
 * تطلع بس لو الدرايفر يعطي getAntennas وفيه منفذين أو أكثر. تتحدّث كل ١٥ ثانية وهي ظاهرة.
 * منفذ أضعف بوضوح من الباقي = كيبل مفصول/بقتيل خربان/منفذ بدون أنتنا.
 */
import { useCallback, useRef, useState } from 'react';
import { View, Text } from '../i18n/rn';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import type { AntennaSetInfo } from '../drivers/types';
import { antennaVerdict, AntennaVerdict, PortState } from '../utils/antennaPorts';
import { bandLabel } from '../utils/bands';
import { Icon } from './Icon';
import { C, R, tBd, tBg } from './theme';
import { FONT } from './fonts';
import { sheet } from '../i18n';

const COL: Record<PortState, string> = { ok: '#12b76a', low: '#f59e0b', weak: '#e5484d', dead: '#e5484d' };
/** طول الشريط: ‎-125 فاضي · ‎-65 مليان */
const fill = (v?: number) => (v === undefined ? 0.04 : Math.max(0.08, Math.min(1, (v + 125) / 60)));

export function AntennaPortsCard({ r }: { r: SavedRouter }) {
  const [sets, setSets] = useState<AntennaVerdict[] | null>(null);
  const alive = useRef(true);

  useFocusEffect(useCallback(() => {
    alive.current = true;
    const load = () => withSession(r, async d => (d.getAntennas ? d.getAntennas() : []))
      .catch(() => [] as AntennaSetInfo[])
      .then(l => {
        if (!alive.current) return;
        setSets(l.map(antennaVerdict).filter((v): v is AntennaVerdict => !!v));
      });
    load();
    const t = setInterval(load, 15_000);
    return () => { alive.current = false; clearInterval(t); };
  }, [r]));

  if (!sets || sets.length === 0) return null;
  const worst = sets.some(v => v.worst === 'weak' || v.worst === 'dead') ? 'weak' : sets.some(v => v.worst === 'low') ? 'low' : 'ok';

  return (
    <View style={s.card}>
      <View style={s.head}>
        <LinearGradient colors={['#0ea5b7', '#2f6bff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>
          <Icon name="antenna" size={18} color="#ffffff" />
        </LinearGradient>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={s.title}>منافذ الأنتنا</Text>
          <Text style={s.sub} numberOfLines={1}>قراءة كل منفذ — يكشف الكيبل المفصول</Text>
        </View>
        <View style={[s.state, { backgroundColor: tBg(worst === 'ok' ? '#e8f8f0' : worst === 'low' ? '#fff6e8' : '#ffeef0') }]}>
          <Text style={[s.stateTxt, { color: COL[worst as PortState] }]}>{worst === 'ok' ? 'سليمة' : worst === 'low' ? 'انتبه' : 'تأكد'}</Text>
        </View>
      </View>

      {sets.map((v, k) => (
        <View key={k} style={s.group}>
          <View style={s.gHead}>
            <View style={[s.tech, { backgroundColor: v.tech === 'NR' ? '#7c3aed' : C.blue }]}>
              <Text style={s.techTxt}>{v.tech === 'NR' ? '5G' : '4G'}</Text>
            </View>
            {!!v.band && <Text style={s.band}>{bandLabel(v.tech, v.band)}</Text>}
            <View style={{ flex: 1 }} />
            <Text style={s.mimo}>MIMO {v.mimo}</Text>
          </View>
          <View style={s.ports}>
            {v.ports.map(p => (
              <View key={p.idx} style={s.port}>
                <View style={s.track}>
                  <View style={[s.bar, { height: `${Math.round(fill(p.rsrp) * 100)}%`, backgroundColor: COL[p.state] }]} />
                </View>
                <Text style={[s.num, { color: p.rsrp === undefined ? C.muted : C.text }]}>{p.rsrp ?? '—'}</Text>
                <Text style={s.rx}>RX{p.idx}</Text>
                {p.behind !== undefined && <Text style={[s.behind, { color: COL[p.state] }]}>{`−${p.behind}`}</Text>}
              </View>
            ))}
          </View>
          <Text style={[s.msg, { color: v.worst === 'ok' ? C.sub : COL[v.worst] }]}>{v.msg}</Text>
        </View>
      ))}
    </View>
  );
}

const s = sheet({
  card: {
    backgroundColor: C.card, borderRadius: R.lg, padding: 12, gap: 10,
    borderWidth: 1, borderColor: tBd('#ffffff'), marginBottom: 4,
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 14.5, fontWeight: '900' },
  sub: { color: C.sub, fontSize: 10.5, marginTop: 1, textAlign: 'right' },
  state: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  stateTxt: { fontSize: 11.5, fontWeight: '900' },

  group: { backgroundColor: C.rowBg, borderRadius: 14, padding: 10, gap: 8 },
  gHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  tech: { borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1 },
  techTxt: { color: '#ffffff', fontSize: 10.5, fontFamily: FONT.numHeavy },
  band: { color: C.text, fontSize: 12, fontFamily: FONT.numHeavy },
  mimo: { color: C.sub, fontSize: 11, fontFamily: FONT.numSemi },

  ports: { flexDirection: 'row', justifyContent: 'space-around', gap: 6 },
  port: { flex: 1, alignItems: 'center', gap: 3 },
  track: { width: 14, height: 44, borderRadius: 7, backgroundColor: C.track, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 7 },
  num: { fontSize: 13, fontFamily: FONT.numHeavy, writingDirection: 'ltr' },
  rx: { color: C.sub, fontSize: 9.5, fontFamily: FONT.numSemi },
  behind: { fontSize: 9.5, fontFamily: FONT.numSemi, writingDirection: 'ltr' },
  msg: { fontSize: 11, fontWeight: '800', textAlign: 'right' },
});
