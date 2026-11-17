/**
 * «أي سيرفر أقرب لك؟» — تصميم ١٧ نوفمبر (بعد ملاحظة حسن: الأعضاء ما فهموا القائمة الطويلة).
 * - فوق: «أنسب سيرفر لك» بخط كبير + وش يختار داخل اللعبة + زر «خلّه سيرفر لعبتي».
 * - دليل ألوان بسيط (ممتاز / جيد / مقبول / بعيد) بدل أرقام التذبذب والفقد في كل صف.
 * - المناطق مجمّعة مثل «تغيير الخادم» في الألعاب، والأقرب مفتوحة والباقي ورا زر.
 * - سيرفر Bandly (المسرّع) يطلع لحاله للمقارنة لو موجود في accel.json.
 */
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { REGIONS } from '../utils/latency';
import { PingRes, Quality, QUALITY_WORD, quality, bestRegion, rankedIds, groupResults, barPct, inGameName, shaky, Q_GREAT, Q_GOOD, Q_OK } from '../utils/serverRank';
import { flagOf } from './RegionGrid';
import { C, isDark } from './theme';
import { sheet, LOCALE } from '../i18n';

export interface ServerRes extends PingRes { error?: string; via?: string }
export interface ExtraServer { id: string; name: string; res: ServerRes }

const QC: Record<Quality, string> = {
  great: '#22c55e',
  good: '#84cc16',
  ok: '#e0a100',
  far: '#f2703a',
  drops: '#e5484d',
  none: '#8a94a8',
};

const nameOf = (id: string) => REGIONS.find(r => r.id === id)?.name ?? id;

export function ServerMap({ res, extra, at, warn, now, total, current, busy, onMeasure, onPick }: {
  res: Record<string, ServerRes>;
  extra: ExtraServer[];
  at: number | null;
  warn: string;
  now: string;
  total: number;
  current: string;
  busy: boolean;
  onMeasure: () => void;
  onPick: (id: string) => void;
}) {
  const [more, setMore] = useState(false);
  const done = Object.keys(res).length;
  const measuring = !!now;
  const best = bestRegion(res);
  const groups = groupResults(res);
  const okMeds = Object.values(res).filter(r => r.samples > 0).map(r => r.median);
  const minMs = okMeds.length ? Math.min(...okMeds) : 1;
  // بعد القياس: أفضل دولتين بس، والباقي (مجمّع حسب المنطقة) ورا الزر. وقت القياس كله مفتوح عشان يشوف التقدّم
  const top2 = rankedIds(res).slice(0, 2);
  const showAll = measuring || more;
  const hidden = done;
  const bestRes = best ? res[best] : undefined;

  const row = (id: string, ref = false) => {
    const r = res[id];
    const q = quality(r);
    const on = id === current;
    const note = q === 'drops' ? `⚠️ يفقد ${r.lossPct}% من البيانات` : shaky(r) ? '⚠️ متذبذب' : '';
    return (
      <Pressable
        key={id}
        onPress={() => !ref && onPick(id)}
        disabled={busy || ref}
        style={({ pressed }) => [s.row, on && s.rowOn, pressed && { opacity: 0.8 }]}
      >
        <View style={s.rowMain}>
          <Text style={s.rowFlag}>{flagOf(id)}</Text>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={s.rowName} numberOfLines={1}>{nameOf(id)}{on ? '  ✓' : ''}</Text>
            <View style={s.barTrack}>
              <View style={[s.barFill, { width: `${barPct(r, minMs)}%`, backgroundColor: QC[q] }]} />
            </View>
            {!!note && <Text style={[s.note, { color: QC[q === 'drops' ? 'drops' : 'ok'] }]}>{note}</Text>}
            {q === 'none' && <Text style={[s.note, { color: QC.none }]}>{r.error ?? 'الخادم ما رد'}</Text>}
          </View>
          <View style={s.msBox}>
            <Text style={[s.ms, { color: QC[q] }]}>{r.samples ? r.median : '—'}</Text>
            <Text style={[s.qWord, { color: QC[q] }]}>{QUALITY_WORD[q]}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={s.titleRow}>
          <LinearGradient colors={['#34d399', '#0f9f6e']} style={s.headIcon}><Text style={{ fontSize: 16 }}>🌍</Text></LinearGradient>
          <Text style={s.title}>أي سيرفر أقرب لك؟</Text>
        </View>
        <View style={s.pill}><Text style={s.pillTxt}>الرقم الأقل = لعب أسلس</Text></View>
      </View>

      {!done && !measuring && (
        <Text style={s.lead}>نقيس البنق من راوترك لسيرفرات كل منطقة، ونقولك وش تختار داخل اللعبة (ببجي، كود، فورتنايت…)</Text>
      )}

      {measuring && (
        <View style={s.progress}>
          <View style={s.progHead}>
            <ActivityIndicator size="small" color={C.blue} />
            <Text style={s.progTxt}>نقيس {now}... ({done}/{total})</Text>
          </View>
          <View style={s.track}><View style={[s.trackFill, { width: `${Math.round((done / Math.max(1, total)) * 100)}%` }]} /></View>
        </View>
      )}

      {!measuring && best && bestRes && (
        <LinearGradient
          colors={isDark ? ['#0f3b2e', '#0b2a22'] : ['#ecfdf5', '#d1fae5']}
          start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }}
          style={s.hero}
        >
          <Text style={s.heroLabel}>⭐ أنسب سيرفر لك الحين</Text>
          <View style={s.heroRow}>
            <Text style={s.heroFlag}>{flagOf(best)}</Text>
            <Text style={s.heroName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{nameOf(best)}</Text>
            <Text style={[s.heroMs, { color: QC[quality(bestRes)] }]}>{bestRes.median}<Text style={s.heroUnit}> ms</Text></Text>
          </View>
          <View style={s.gameLine}>
            <Text style={s.gameTxt}>🎮 داخل اللعبة اختار منطقة «{inGameName(best)}»</Text>
          </View>
          {best === current ? (
            <Text style={s.isCurrent}>✓ هذا سيرفر لعبتك المختار</Text>
          ) : (
            <Pressable style={({ pressed }) => [s.setBtn, pressed && { opacity: 0.8 }, busy && s.dim]} onPress={() => onPick(best)} disabled={busy}>
              <Text style={s.setBtnTxt}>خلّه سيرفر لعبتي</Text>
            </Pressable>
          )}
        </LinearGradient>
      )}

      {(done > 0 || measuring) && (
        <View style={s.legend}>
          {([['great', `ممتاز (أقل من ${Q_GREAT})`], ['good', `جيد (أقل من ${Q_GOOD})`], ['ok', `مقبول (أقل من ${Q_OK})`], ['far', 'بعيد']] as [Quality, string][]).map(([q, t]) => (
            <View key={q} style={s.legendItem}>
              <View style={[s.dot, { backgroundColor: QC[q] }]} />
              <Text style={s.legendTxt}>{t}</Text>
            </View>
          ))}
        </View>
      )}

      {extra.filter(x => x.res.samples > 0 || !measuring).map(x => {
        const q = quality(x.res);
        return (
          <View key={x.id} style={s.bandly}>
            <View style={s.rowMain}>
              <Text style={s.rowFlag}>⚡</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.rowName} numberOfLines={1}>سيرفر Bandly · {x.name}</Text>
                <Text style={s.bandlySub}>سيرفرنا الخاص — للمقارنة. كل ما قرب رقمه من رقمك الأقل، كان المسرّع أنفع لك</Text>
              </View>
              <View style={s.msBox}>
                <Text style={[s.ms, { color: QC[q] }]}>{x.res.samples ? x.res.median : '—'}</Text>
                <Text style={[s.qWord, { color: QC[q] }]}>{QUALITY_WORD[q]}</Text>
              </View>
            </View>
          </View>
        );
      })}

      {!showAll && top2.length > 0 && (
        <View style={s.group}>
          <View style={s.groupHead}><Text style={s.groupName}>الأقل بنق عندك</Text></View>
          {top2.map(id => row(id))}
        </View>
      )}

      {showAll && groups.map(g => (
        <View key={g.id} style={s.group}>
          <View style={s.groupHead}>
            <Text style={s.groupName}>{g.name}</Text>
            {g.best !== undefined && <Text style={s.groupBest}>الأقل {g.best}ms</Text>}
          </View>
          {g.ids.map(id => row(id, g.id === 'ref'))}
        </View>
      ))}

      {!measuring && hidden > 0 && (
        <Pressable style={s.moreBtn} onPress={() => setMore(m => !m)}>
          <Text style={s.moreTxt}>{more ? 'اعرض أقل ▲' : `اعرض كل الدول (${hidden}) ▼`}</Text>
        </Pressable>
      )}

      {!measuring && !!warn && <Text style={s.warn}>{warn}</Text>}

      {!measuring && done > 0 && (
        <Text style={s.foot}>اضغط أي منطقة تخليها سيرفر لعبتك · القياس يمر من الواي فاي والراوتر، فالرقم أعلى شوي من اللي داخل اللعبة</Text>
      )}

      {!measuring && (
        <Pressable onPress={onMeasure} disabled={busy} style={({ pressed }) => [pressed && { opacity: 0.85 }, busy && s.dim]}>
          <LinearGradient colors={['#4f8bff', '#1d4ed8']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.mainBtn}>
            <Text style={s.mainBtnTxt}>{done ? '↻ قِس مرة ثانية' : '📡 وش أقرب سيرفر لي؟ (30 ثانية)'}</Text>
          </LinearGradient>
        </Pressable>
      )}

      {!measuring && !!at && (
        <Text style={s.at}>آخر قياس: {new Date(at).toLocaleString(LOCALE, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}</Text>
      )}
    </View>
  );
}

const s = sheet({
  card: {
    backgroundColor: C.card, borderColor: isDark ? '#22c55e44' : C.cardBorder, borderWidth: 1.5, borderRadius: 24,
    paddingVertical: 14, paddingHorizontal: 12, gap: 11,
  },
  head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flexShrink: 1 },
  headIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontWeight: '900', fontSize: 16, textAlign: 'right' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder, flexShrink: 1 },
  pillTxt: { color: C.sub, fontWeight: '700', fontSize: 11 },
  lead: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },

  progress: { gap: 8, backgroundColor: C.rowBg, borderRadius: 14, padding: 11 },
  progHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  progTxt: { color: C.text, fontWeight: '700', fontSize: 13, textAlign: 'right', flex: 1 },
  track: { height: 6, borderRadius: 3, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row-reverse' },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: C.blue },

  hero: { borderRadius: 18, padding: 14, gap: 9, borderWidth: 1.5, borderColor: '#22c55e88' },
  heroLabel: { color: isDark ? '#86efac' : '#047857', fontWeight: '800', fontSize: 12.5, textAlign: 'right' },
  heroRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  heroFlag: { fontSize: 32 },
  heroName: { flex: 1, color: C.text, fontWeight: '900', fontSize: 19, textAlign: 'right' },
  heroMs: { fontWeight: '900', fontSize: 30 },
  heroUnit: { fontSize: 13, fontWeight: '700' },
  gameLine: { backgroundColor: isDark ? '#00000033' : '#ffffffaa', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  gameTxt: { color: C.text, fontWeight: '700', fontSize: 13.5, textAlign: 'right' },
  isCurrent: { color: isDark ? '#86efac' : '#047857', fontWeight: '800', fontSize: 13, textAlign: 'center' },
  setBtn: { backgroundColor: '#16a34a', borderRadius: 13, paddingVertical: 10, alignItems: 'center' },
  setBtnTxt: { color: '#fff', fontWeight: '900', fontSize: 14 },

  legend: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  legendItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  legendTxt: { color: C.sub, fontSize: 11, fontWeight: '600' },

  bandly: {
    borderRadius: 16, padding: 11, borderWidth: 1.5, borderColor: isDark ? '#a67cff88' : '#8448f566',
    backgroundColor: isDark ? '#29204e88' : '#f3eeff',
  },
  bandlySub: { color: C.sub, fontSize: 11.5, lineHeight: 17, textAlign: 'right', marginTop: 3 },

  group: { gap: 7 },
  groupHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 4 },
  groupName: { color: C.text, fontWeight: '900', fontSize: 14 },
  groupBest: { color: C.sub, fontSize: 11.5, fontWeight: '700' },
  row: { backgroundColor: C.rowBg, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 11, borderWidth: 1, borderColor: C.cardBorder },
  rowOn: { borderColor: C.blue, borderWidth: 1.5 },
  rowMain: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  rowFlag: { fontSize: 24 },
  rowName: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row-reverse' },
  barFill: { height: 5, borderRadius: 3 },
  note: { fontSize: 11, fontWeight: '700', textAlign: 'right' },
  msBox: { alignItems: 'center', minWidth: 54 },
  ms: { fontWeight: '900', fontSize: 19 },
  qWord: { fontWeight: '800', fontSize: 11 },

  moreBtn: {
    alignItems: 'center', paddingVertical: 10, borderRadius: 14,
    borderWidth: 1, borderColor: isDark ? '#2f6bff66' : C.cardBorder, backgroundColor: C.rowBg,
  },
  moreTxt: { color: C.blue, fontWeight: '800', fontSize: 13 },
  warn: { color: '#e0a100', fontSize: 12.5, lineHeight: 19, textAlign: 'right', fontWeight: '700' },
  foot: { color: C.sub, fontSize: 11.5, lineHeight: 18, textAlign: 'right' },
  mainBtn: { borderRadius: 15, paddingVertical: 13, alignItems: 'center' },
  mainBtnTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },
  at: { color: C.muted, fontSize: 11.5, textAlign: 'center' },
  dim: { opacity: 0.5 },
});
