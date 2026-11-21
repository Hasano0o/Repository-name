/**
 * «👥 أعضاء Bandly على برجك» — كم عضو Bandly شفناه على نفس البرج (آخر ٣٠ يوم) وبنقهم بالليل والنهار.
 * ⚠️ عدد مستخدمي Bandly بس — جزء صغير من كل المتصلين؛ عدد كل الأجهزة على البرج ما يعرفه إلا شركة الاتصال.
 */
import { useEffect, useState } from 'react';
import { View, Text } from '../i18n/rn';
import { Signal } from '../drivers/types';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { fetchMembers, TowerMembers } from '../services/community';
import { C, tBd, tBg, tFg } from './theme';
import { sheet } from '../i18n';

export function TowerMembersCard({ router, signal }: { router: SavedRouter; signal: Signal | null }) {
  const tower = signal?.enodebId || signal?.cellId;
  const [m, setM] = useState<TowerMembers | null>(null);

  useEffect(() => {
    if (!tower) return;
    let alive = true;
    (async () => {
      const net = await withSession(router, async d => (d.getNetworkInfo ? d.getNetworkInfo() : null)).catch(() => null);
      const r = await fetchMembers({ tower: String(tower), operator: net?.operator ?? '' });
      if (alive) setM(r);
    })();
    return () => { alive = false; };
  }, [router.id, tower]);

  if (!tower || !m) return null;
  const others = Math.max(0, m.users - (m.mine ? 1 : 0));
  const busyNight = m.night_ping != null && m.day_ping != null && m.night_ping > m.day_ping * 1.3 && m.night_ping - m.day_ping >= 15;

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>👥 أعضاء Bandly على برجك</Text>
        <Text style={s.num}>{m.users}</Text>
      </View>
      <Text style={s.sub}>
        {others > 0 ? `آخر ٣٠ يوم — منهم ${m.users7} هالأسبوع${m.mine ? ' (أنت معهم)' : ''}` : 'للحين ما شفنا أعضاء غيرك على هالبرج.'}
      </Text>
      {m.enough && m.ping != null && (
        <View style={s.row}>
          <Text style={s.stat}>بنقهم: {m.ping}ms</Text>
          {m.night_ping != null && m.day_ping != null && (
            <Text style={s.stat}>الليل {m.night_ping}ms · النهار {m.day_ping}ms</Text>
          )}
        </View>
      )}
      {busyNight && <Text style={s.warn}>🌙 بنق الأعضاء بالليل أعلى بوضوح — البرج يزحم وقت الذروة (٨م–١ص).</Text>}
      {!m.enough && others > 0 && <Text style={s.tiny}>الأرقام تطلع لما يصيرون {m.min_users} أعضاء أو أكثر.</Text>}
      <Text style={s.tiny}>هذا عدد مستخدمي Bandly بس — جزء صغير من كل المتصلين على البرج.</Text>
    </View>
  );
}

const s = sheet({
  card: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1.5, borderColor: tBd('#c7d2fe'), padding: 14, gap: 6 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: C.text, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  num: { color: tFg('#4338ca'), fontSize: 24, fontWeight: '900' },
  sub: { color: C.sub, fontSize: 12.5, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  stat: { color: tFg('#4338ca'), backgroundColor: tBg('#eef2ff'), fontSize: 12, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  warn: { color: tFg('#b45309'), fontSize: 12, textAlign: 'right', lineHeight: 18 },
  tiny: { color: C.muted, fontSize: 10.5, textAlign: 'right' },
});
