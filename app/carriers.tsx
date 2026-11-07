/**
 * «أفضل شركة في منطقتك» — زي OpenSignal: من فحوصات الأعضاء الحقيقية في نفس المدينة/الحي.
 * التنزيل والرفع (اختبار السرعة) · البنق والثبات («جاهز للعب؟») · الليل مقابل النهار · كم مرة فيه 5G.
 * الأرقام ما تطلع إلا لو فيه ٣ أعضاء مختلفين على الأقل للشركة. السيرفر: community.py ← /carriers
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Share } from 'react-native';
import { ScrollView, View, Text, Pressable, TextInput } from '../src/i18n/rn';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CarrierBoard, CarrierCat, CarrierReport, CarrierStat, Consent, fetchCarriers, getConsent, myPlace, setArea, setConsent,
} from '../src/services/community';
import { C, tFg } from '../src/ui/theme';
import { GlassCard } from '../src/ui/GlassCard';
import { sheet } from '../src/i18n';

const CAT: Record<CarrierCat, { icon: string; label: string }> = {
  down: { icon: '⬇️', label: 'أسرع تنزيل' },
  up: { icon: '⬆️', label: 'أسرع رفع' },
  ping: { icon: '🎮', label: 'أقل بنق' },
  steady: { icon: '🧘', label: 'أثبت اتصال' },
  night_ping: { icon: '🌙', label: 'الأفضل بالليل' },
  nr_pct: { icon: '📶', label: 'أكثر 5G' },
};
const OP_COLOR: Record<string, string> = { 'STC': '#4f2d7f', 'موبايلي': '#0d7fc6', 'زين': '#1f9e63', 'سلام': '#e0a100' };
const num = (v: number | null, u = '') => (v === null || v === undefined ? '—' : `${Math.round(v * 10) / 10}${u}`);

export default function Carriers() {
  const insets = useSafeAreaInsets();
  const [city, setCity] = useState('');
  const [dist, setDist] = useState('');
  const [editing, setEditing] = useState(false);
  const [placeReady, setPlaceReady] = useState(false);
  const [scope, setScope] = useState<'city' | 'area'>('city');
  const [rep, setRep] = useState<CarrierReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [consent, setConsentState] = useState<Consent>(null);

  const load = useCallback(async (c: string, a: string) => {
    if (!c) return;
    setLoading(true); setFailed(false);
    const r = await fetchCarriers(c, a);
    setRep(r); setFailed(!r); setLoading(false);
    if (r?.area_stats && r.area_stats.operators.some(o => o.enough)) setScope('area');
  }, []);

  useEffect(() => {
    getConsent().then(setConsentState);
    myPlace().then(p => {
      setCity(p.city);
      setDist(p.area.split('/')[1] ?? '');
      setPlaceReady(true);
      if (p.city) load(p.city, p.area); else setEditing(true);
    });
  }, [load]);

  const savePlace = async () => {
    const c = city.trim();
    if (!c) return;
    const a = [c, dist.trim()].filter(Boolean).join('/');
    await setArea(a);
    setEditing(false);
    load(c, a);
  };

  const board: CarrierBoard | null = rep ? (scope === 'area' && rep.area_stats ? rep.area_stats : rep.city_stats) : null;
  const where = scope === 'area' && rep?.area ? rep.area.replace('/', ' — ') : rep?.city ?? city;

  const share = () => {
    if (!board) return;
    const lines = [`📶 أفضل شركة في ${where} — من قياسات أعضاء Bandly`];
    for (const o of board.operators.filter(x => x.enough)) {
      lines.push(`${o.operator}: تنزيل ${num(o.down)} · رفع ${num(o.up)} Mbps · بنق ${num(o.ping, 'ms')}${o.wins.length ? ` · ${o.wins.map(w => CAT[w].icon).join('')}` : ''}`);
    }
    if (board.winner) lines.push(`🏆 الأفضل: ${board.winner}`);
    lines.push('', 'حمّل Bandly: https://has-host.com/dl/bandly.apk', 'آيفون: https://apps.apple.com/sa/app/id6819877993');
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  return (
    <ScrollView contentContainerStyle={[s.page, { paddingBottom: insets.bottom + 30 }]}>
      <Text style={s.lead}>مقارنة الشركات من قياسات حقيقية لأعضاء Bandly في نفس منطقتك. بدون GPS: المدينة والحي تكتبها أنت.</Text>

      {/* المكان */}
      {placeReady && (editing ? (
        <GlassCard title="وين أنت؟" icon="📍" tint={C.blueSoft} collapsible={false}>
          <View style={s.row}>
            <TextInput style={s.input} value={dist} onChangeText={setDist} placeholder="الحي (اختياري)" placeholderTextColor={C.muted} maxLength={30} />
            <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="المدينة" placeholderTextColor={C.muted} maxLength={25} />
          </View>
          <Pressable style={[s.btn, !city.trim() && s.dim]} onPress={savePlace} disabled={!city.trim()}><Text style={s.btnTxt}>اعرض المقارنة</Text></Pressable>
        </GlassCard>
      ) : (
        <View style={s.placeRow}>
          <Pressable onPress={() => setEditing(true)} hitSlop={8}><Text style={s.link}>غيّر</Text></Pressable>
          <Text style={s.place}>📍 {city}{dist ? ` — ${dist}` : ''}</Text>
        </View>
      ))}

      {!editing && rep?.area_stats && (
        <View style={s.seg}>
          {(['area', 'city'] as const).map(k => (
            <Pressable key={k} style={[s.segBtn, scope === k && s.segOn]} onPress={() => setScope(k)}>
              <Text style={[s.segTxt, scope === k && { color: C.onAccent }]}>{k === 'area' ? 'حيّك' : 'مدينتك'}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {loading && <ActivityIndicator color={C.blue} style={{ marginVertical: 20 }} />}
      {failed && !loading && <Text style={s.err}>ما وصلنا للسيرفر — تأكد من النت وارجع جرّب</Text>}

      {!loading && board && !editing && (
        <>
          {board.winner ? (
            <View style={[s.winner, { borderColor: tFg(OP_COLOR[board.winner] ?? C.green) }]}>
              <Text style={s.trophy}>🏆</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.winTitle}>الأفضل في {where}: {board.winner}</Text>
                <Text style={s.winSub}>فاز بأكثر الفئات من {board.users} عضو قاسوا آخر ٦٠ يوم</Text>
              </View>
            </View>
          ) : (
            <Text style={s.warn}>
              {board.operators.filter(o => o.enough).length < 2
                ? `للحين ما فيه شركتين عندها ${board.min_users} أعضاء أو أكثر هنا — نحتاج قياسات أكثر عشان نحكم بعدل.`
                : 'الشركات متقاربة — ما فيه فائز واضح.'}
            </Text>
          )}
          {board.operators.map(o => <OpCard key={o.operator} o={o} min={board.min_users} />)}
          {!board.operators.length && <Text style={s.hint}>ما فيه قياسات هنا للحين. أول ما الأعضاء يسوون اختبار سرعة أو «جاهز للعب؟» تبدأ تطلع.</Text>}
          {board.operators.some(o => o.enough) && (
            <Pressable style={s.btnGhost} onPress={share}><Text style={s.btnGhostTxt}>شارك النتيجة</Text></Pressable>
          )}
        </>
      )}

      {/* المشاركة */}
      {consent !== 'on' && placeReady && (
        <GlassCard title="ساعد جيرانك" icon="🤝" tint={C.mintSoft} collapsible={false}>
          <Text style={s.hint}>لما تسوي اختبار سرعة أو «جاهز للعب؟» على واي فاي الراوتر، نضيف النتيجة للمقارنة: الشركة والمدينة/الحي والأرقام بس — بدون موقع ولا رقم ولا اسم.</Text>
          <Pressable style={s.btn} onPress={async () => { await setConsent('on'); setConsentState('on'); }}><Text style={s.btnTxt}>شارك نتايجي</Text></Pressable>
        </GlassCard>
      )}

      <Text style={s.note}>كل عضو ينحسب مرة وحدة (وسيط قياساته) · الأرقام تطلع بس لو فيه {rep?.city_stats.min_users ?? 3} أعضاء للشركة · الثبات = نسبة الفحوصات اللي طلعت «جيد للعب» · الليل = ٨م–١ص.</Text>
    </ScrollView>
  );
}

function OpCard({ o, min }: { o: CarrierStat; min: number }) {
  const col = tFg(OP_COLOR[o.operator] ?? C.blue);
  return (
    <View style={[s.op, { borderColor: o.enough ? col + '66' : C.cardBorder }, !o.enough && { opacity: 0.6 }]}>
      <View style={s.opHead}>
        <Text style={s.opUsers}>{o.users} {o.users > 2 ? 'أعضاء' : 'عضو'}</Text>
        <Text style={[s.opName, { color: col }]}>{o.operator}{o.mine ? ' · شريحتك' : ''}</Text>
      </View>
      {o.wins.length > 0 && (
        <View style={s.badges}>
          {o.wins.map(w => <View key={w} style={[s.badge, { backgroundColor: col + '1f' }]}><Text style={[s.badgeTxt, { color: col }]}>{CAT[w].icon} {CAT[w].label}</Text></View>)}
        </View>
      )}
      {o.enough ? (
        <>
          <View style={s.grid}>
            <Cell l="تنزيل" v={num(o.down)} u="Mbps" />
            <Cell l="رفع" v={num(o.up)} u="Mbps" />
            <Cell l="بنق" v={num(o.ping)} u="ms" />
            <Cell l="ثبات" v={num(o.steady)} u="%" />
          </View>
          <Text style={s.opSub}>
            {o.night_ping !== null && o.day_ping !== null ? `🌙 الليل ${o.night_ping}ms مقابل النهار ${o.day_ping}ms · ` : ''}
            {o.nr_pct !== null ? `5G في ${o.nr_pct}% من الاختبارات · ` : ''}
            {o.bloat !== null ? `البنق يزيد ${o.bloat}ms وقت التحميل` : ''}
          </Text>
        </>
      ) : (
        <Text style={s.opSub}>بيانات قليلة — نحتاج {min - o.users} {min - o.users === 1 ? 'عضو' : 'أعضاء'} زيادة عشان نعرض أرقامها</Text>
      )}
    </View>
  );
}

function Cell({ l, v, u }: { l: string; v: string; u: string }) {
  return (
    <View style={s.cell}>
      <Text style={s.cellV}>{v}</Text>
      <Text style={s.cellU}>{u}</Text>
      <Text style={s.cellL}>{l}</Text>
    </View>
  );
}

const s = sheet({
  page: { padding: 16, gap: 12 },
  lead: { color: C.sub, fontSize: 13, textAlign: 'right', lineHeight: 20 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  note: { color: C.muted, fontSize: 11, textAlign: 'center', paddingHorizontal: 16, lineHeight: 17 },
  warn: { color: tFg('#b45309'), fontSize: 12, textAlign: 'right', lineHeight: 19, backgroundColor: C.amberSoft, borderRadius: 12, padding: 10 },
  err: { color: C.red, fontWeight: '700', textAlign: 'right' },
  link: { color: C.blue, fontWeight: '800', fontSize: 13 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: C.rowBg, borderRadius: 12, borderWidth: 1.5, borderColor: C.cardBorder, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14, textAlign: 'right' },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 12, alignItems: 'center' },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  btnGhost: { borderWidth: 1.5, borderColor: C.blue, borderRadius: 14, padding: 12, alignItems: 'center' },
  btnGhostTxt: { color: C.blue, fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.45 },
  placeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  place: { color: C.text, fontWeight: '900', fontSize: 15, textAlign: 'right', flexShrink: 1 },
  seg: { flexDirection: 'row-reverse', backgroundColor: C.rowBg, borderRadius: 12, padding: 3, borderWidth: 1.5, borderColor: C.cardBorder },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segOn: { backgroundColor: C.blue },
  segTxt: { color: C.text, fontWeight: '800', fontSize: 13 },
  winner: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderWidth: 2, borderRadius: 16, padding: 12, backgroundColor: C.card },
  trophy: { fontSize: 30 },
  winTitle: { color: C.text, fontWeight: '900', fontSize: 16, textAlign: 'right' },
  winSub: { color: C.sub, fontSize: 12, textAlign: 'right', marginTop: 2 },
  op: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1.5, padding: 12, gap: 8 },
  opHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  opName: { fontWeight: '900', fontSize: 17 },
  opUsers: { color: C.muted, fontSize: 11, fontWeight: '700' },
  opSub: { color: C.sub, fontSize: 11, textAlign: 'right', lineHeight: 17 },
  badges: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt: { fontWeight: '800', fontSize: 11 },
  grid: { flexDirection: 'row-reverse', gap: 6 },
  cell: { flex: 1, alignItems: 'center', backgroundColor: C.rowBg, borderRadius: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.cardBorder },
  cellV: { color: C.text, fontWeight: '800', fontSize: 16 },
  cellU: { color: C.muted, fontSize: 10 },
  cellL: { color: C.sub, fontSize: 11, fontWeight: '700', marginTop: 1 },
});
