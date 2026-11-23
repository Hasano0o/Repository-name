import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { useFocusEffect, router, Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { Carrier } from '../drivers/types';
import { getWoke, onWoke } from '../services/caWake';
import { useCaActivate } from './useCaActivate';
import { bandLabel, friendlyBand } from '../utils/bands';
import { Icon } from './Icon';
import { C, R, tBd, tBg, glow, isDark } from './theme';
import { measureLatency, LatencyResult } from '../utils/latency';

import { sheet } from '../i18n';
import { FONT } from './fonts';
/**
 * بطاقة «الأساسي والثانوي» في صفحة الراوتر — بنفس روح بطاقات الإشارة:
 * شارة كبيرة للأساسي (متدرّجة) + علامة ربط + شارات الثانوي، ومجموع عرض النطاق.
 * الضغط في أي مكان يودّي لشاشة التغيير.
 */
const GRAD = {
  LTE: ['#1f5eff', '#3b8bff'] as [string, string],
  NR: ['#5b3df5', '#9466ff'] as [string, string],
};
/**
 * ثلاث ألوان ثابتة في كل التطبيق (اختيار حسن): الأساسي أزرق · الثانوي 4G برتقالي · 5G بنفسجي
 */
export const SEC_ORANGE = '#f97316';
const GRAD_SEC_LTE: [string, string] = ['#ea580c', '#fb923c'];
const GRAD_NR_SEC: [string, string] = ['#7c3aed', '#a78bfa'];
const secGrad = (c: Carrier): [string, string] => (c.tech === 'NR' ? GRAD_NR_SEC : GRAD_SEC_LTE);

const GAME_CACHE = new Map<string, { at: number; res: LatencyResult }>();
const mhzOf = (c: Carrier) => (typeof c.bandwidth === 'number' && c.bandwidth > 0 ? c.bandwidth : undefined);

export function ComboCard({ r }: { r: SavedRouter }) {
  const [list, setList] = useState<Carrier[] | null>(null);
  const alive = useRef(true);

  const reload = useCallback(() => {
    withSession(r, async d => (d.getCarriers ? d.getCarriers() : []))
      .catch(() => [] as Carrier[])
      .then(l => { if (alive.current) setList(l); });
  }, [r]);
  useFocusEffect(useCallback(() => {
    alive.current = true;
    reload();
    return () => { alive.current = false; };
  }, [reload]));

  // «نشّط الدمج» (src/ui/useCaActivate)
  const { act, msg: actMsg, activate, label: actLabel } = useCaActivate(r, reload);

  // أرقام الألعاب (استجابة · استقرار · تذبذب): قياس قصير لسيرفر اللعبة المختار — مرة كل دقيقتين بالكثير لكل راوتر
  const [game, setGame] = useState<LatencyResult | null>(() => GAME_CACHE.get(r.id)?.res ?? null);
  const [gameBusy, setGameBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    const c = GAME_CACHE.get(r.id);
    if (c && Date.now() - c.at < 120_000) { setGame(c.res); return; }
    let live = true;
    setGameBusy(true);
    measureLatency(8, 2500).then(res => {
      GAME_CACHE.set(r.id, { at: Date.now(), res });
      if (live) setGame(res);
    }).catch(() => {}).finally(() => { if (live) setGameBusy(false); });
    return () => { live = false; };
  }, [r.id]));

  // الدمج وقت التحميل (services/caWake — صفحة الراوتر تقراه بتحميل قصير): لو الحين بدون ثانوي ونفس الأساسي ← نعرضه
  const [woke, setWoke] = useState(() => getWoke(r.id));
  useEffect(() => {
    setWoke(getWoke(r.id));
    return onWoke(x => { if (x === r.id) setWoke(getWoke(x)); });
  }, [r.id]);
  const live = list ?? [];
  const livePcc = live.find(c => c.role === 'PCC');
  const wPcc = woke?.carriers.find(c => c.role === 'PCC');
  const fromWoke = !!list && !!woke && !live.some(c => c.role === 'SCC') && woke.carriers.some(c => c.role === 'SCC')
    && (!livePcc || (!!wPcc && wPcc.tech === livePcc.tech && wPcc.band === livePcc.band));
  const shown = fromWoke ? woke!.carriers : list;
  const pcc = shown?.find(c => c.role === 'PCC');
  const scc = (shown ?? []).filter(c => c.role === 'SCC');
  const total = [pcc, ...scc].reduce((a, c) => a + ((c && mhzOf(c)) || 0), 0);
  // NSA (حسن ٢٣ نوفمبر): الأساسي 4G وفيه 5G ← مجموعتين: 4G (أساسي + ثانوي 4G) و 5G (رئيسي 5G مربوط على الأساسي + ثانوي 5G)
  const nrAll = scc.filter(c => c.tech === 'NR');
  const nsa = !!pcc && pcc.tech === 'LTE' && nrAll.length > 0;
  const nrMain = nsa ? nrAll[0] : undefined;
  const nrScc = nsa ? nrAll.slice(1) : [];
  const chainScc = nsa ? scc.filter(c => c.tech === 'LTE') : scc;
  const anchor = pcc ? bandLabel(pcc.tech, pcc.band) : '';

  const nsaSecs = nsa ? [...chainScc, ...nrScc] : [];

  // ── تصميم حسن (٢٣ نوفمبر): بطاقة «التجميعة» — المجموع + الجودة، الأساسي (4G + 5G)، الثانوية، التوزيع، أرقام الألعاب، «طبّق» ──
  const pccSinr = pcc?.sinr;
  const perf = total >= 100 ? { t: 'أداء ممتاز', c: '#22c55e' } : total >= 40 ? { t: 'أداء جيد', c: '#3b82f6' } : total > 0 ? { t: 'أداء متوسط', c: '#f59e0b' } : null;
  const stab = game && game.samples > 0
    ? (game.lossPct < 2 && game.jitter < 10 ? { t: 'استقرار عالي', c: '#22c55e' } : game.lossPct < 5 && game.jitter < 25 ? { t: 'استقرار جيد', c: '#3b82f6' } : { t: 'استقرار ضعيف', c: '#ef4444' })
    : typeof pccSinr === 'number' ? (pccSinr >= 13 ? { t: 'استقرار عالي', c: '#22c55e' } : pccSinr >= 5 ? { t: 'استقرار جيد', c: '#3b82f6' } : { t: 'استقرار ضعيف', c: '#ef4444' }) : null;
  const pingQ = game && game.samples > 0
    ? (game.median <= 40 ? { t: 'Ping منخفض', c: '#22c55e' } : game.median <= 80 ? { t: 'Ping متوسط', c: '#f59e0b' } : { t: 'Ping عالي', c: '#ef4444' })
    : null;
  const secsAll = nsa ? nsaSecs : chainScc;
  const primTile = (c: Carrier, kind: '4G' | '5G' | 'one') => (
    <LinearGradient colors={c.tech === 'NR' ? GRAD.NR : GRAD.LTE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[s.prim, glow(c.tech === 'NR' ? '#8b5cf6' : '#3b82f6', 16)]}>
      <View style={s.primTower}><Icon name="tower" size={kind === 'one' ? 40 : 30} color="#ffffff" stroke={1.6} /></View>
      <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
        <View style={s.mainPill}>
          <Text style={s.mainPillTxt}>{kind === 'one' ? (c.tech === 'NR' ? 'الأساسي 5G' : 'الأساسي 4G') : kind === '5G' ? 'الأساسي 5G' : 'الأساسي 4G'}</Text>
        </View>
        <Text style={s.primBand} numberOfLines={1} adjustsFontSizeToFit>{bandLabel(c.tech, c.band)}</Text>
        <Text style={s.mainNice} numberOfLines={1} adjustsFontSizeToFit>
          {friendlyBand(c.tech, c.band)}{mhzOf(c) ? `  ·  ${mhzOf(c)}MHz` : ''}
        </Text>
      </View>
    </LinearGradient>
  );

  return (
    <View style={[s.card, glow('#3b82f6', 18)]}>
      {list === null ? (
        <View style={s.loadRow}>
          <Text style={s.muted}>نقرأ الترددات…</Text>
          <ActivityIndicator size="small" color={C.blue} />
        </View>
      ) : !pcc ? (
        <Pressable onPress={() => router.push(`/combo/${r.id}` as Href)}>
          <Text style={[s.muted, { paddingVertical: 8 }]}>اضغط تشوف الترددات الحالية وتغيّرها</Text>
        </Pressable>
      ) : (
        <>
          {/* المجموع + الجودة */}
          <View style={[s.top, glow('#22c55e', 12)]}>
            <View style={s.badge}>
              <Icon name="check" size={13} color="#22c55e" stroke={2.6} />
              <Text style={s.badgeTxt}>{fromWoke ? 'الدمج وقت التحميل' : 'تجميعتك الحالية'}</Text>
            </View>
            <View style={s.topRow}>
              <View style={s.qBox}>
                {[perf && { ...perf, i: 'spark' as const }, stab && { ...stab, i: 'target' as const }, pingQ ? { ...pingQ, i: 'game' as const } : { t: gameBusy ? 'نقيس البنق…' : 'Ping —', c: C.muted, i: 'game' as const }]
                  .filter((x): x is { t: string; c: string; i: 'spark' | 'target' | 'game' } => !!x)
                  .map((q, i) => (
                    <View key={i} style={s.qRow}>
                      <Text style={s.qTxt} numberOfLines={1}>{q.t}</Text>
                      <Icon name={q.i} size={15} color={q.c} stroke={2.4} />
                    </View>
                  ))}
              </View>
              <View style={s.pad}>
                <LinearGradient colors={['#2f6bff', '#7c3aed']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.padIcon, glow('#5b5bff', 22)]}>
                  <Icon name="game" size={34} color="#ffffff" stroke={2} />
                </LinearGradient>
                <View style={s.padRing} />
              </View>
              <View style={s.totalBox}>
                <View style={s.totalRow}>
                  <Text style={s.totalBig}>{total || '—'}</Text>
                  <Icon name="chart" size={22} color="#22c55e" stroke={2.6} />
                </View>
                <Text style={s.totalMhz}>MHz</Text>
                <View style={s.totalPill}><Text style={s.totalPillTxt}>إجمالي النطاق</Text></View>
              </View>
            </View>
          </View>

          {/* الأساسي */}
          {nsa && nrMain ? (
            <View style={s.chain}>
              {primTile(pcc, '4G')}
              <View style={s.plusWrap}><View style={[s.plusBig, glow('#3b82f6', 10)]}><Text style={s.plusBigTxt}>+</Text></View></View>
              {primTile(nrMain, '5G')}
            </View>
          ) : primTile(pcc, 'one')}
          {nsa && nrMain && (
            <Text style={s.anchorTxt} numberOfLines={1}>{`الـ 5G (${bandLabel(nrMain.tech, nrMain.band)}) مربوط على ${anchor} — لو طاح ${anchor} يطيح معه`}</Text>
          )}

          {/* الثانوية */}
          <View style={s.divider}>
            <View style={s.divLine} />
            <Text style={s.divTxt}>الترددات الثانوية</Text>
            <View style={s.divLine} />
          </View>
          <View style={s.secBox}>
            {secsAll.length === 0 ? (
              <View style={[s.secEmptyBox]}>
                <Text style={s.emptyTxt}>بدون دمج</Text>
                <Text style={s.emptySub}>يجي وقت التحميل</Text>
              </View>
            ) : (
              <View style={s.secRow}>
                {secsAll.slice(0, 6).map((c, i) => (
                  <LinearGradient key={i} colors={secGrad(c)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[s.secCell, { flexBasis: secsAll.length <= 3 ? '30%' : '22%' }, glow(c.tech === 'NR' ? '#8b5cf6' : '#f97316', 10)]}>
                    <View style={s.secCellTop}>
                      <Text style={s.secTech}>{c.tech === 'NR' ? '5G' : '4G'}</Text>
                      <Icon name="chart" size={13} color="#ffffffcc" stroke={2.4} />
                    </View>
                    <Text style={[s.secBand, { fontSize: 21, lineHeight: 25 }]} numberOfLines={1} adjustsFontSizeToFit>
                      {bandLabel(c.tech, c.band)}
                    </Text>
                    {!!mhzOf(c) && <Text style={s.secNice} numberOfLines={1}>{mhzOf(c)}MHz</Text>}
                  </LinearGradient>
                ))}
              </View>
            )}
          </View>
        </>
      )}

      {/* توزيع عرض النطاق */}
      {(() => {
        const parts = [pcc, ...scc].filter((c): c is Carrier => !!c && !!mhzOf(c));
        if (parts.length < 2 || total <= 0) return null;
        const colOf = (c: Carrier) => (c.role === 'PCC' ? C.blue : c.tech === 'NR' ? '#7c3aed' : SEC_ORANGE);
        return (
          <View style={{ gap: 7 }}>
            <View style={s.shareLbls}>
              {parts.map((c, i) => (
                <View key={i} style={s.shareChip}>
                  <View style={[s.shareDot, { backgroundColor: colOf(c) }]} />
                  <Text style={s.shareTxt}>{bandLabel(c.tech, c.band)} {mhzOf(c)}</Text>
                </View>
              ))}
            </View>
            <View style={s.share}>
              {parts.map((c, i) => (
                <View key={i} style={{ flex: mhzOf(c)!, backgroundColor: colOf(c) }} />
              ))}
            </View>
          </View>
        );
      })()}

      {/* أرقام الألعاب */}
      {!!pcc && (
        <View style={s.stats}>
          <View style={s.stat}>
            <Icon name="game" size={24} color="#60a5fa" stroke={2.2} />
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.statLbl}>استجابة الألعاب</Text>
              <Text style={[s.statVal, { color: '#22c55e' }]}>{game && game.samples ? Math.round(game.median) : '—'}<Text style={s.statUnit}> ms</Text></Text>
            </View>
          </View>
          <View style={s.statSep} />
          <View style={s.stat}>
            <Icon name="check" size={22} color="#38bdf8" stroke={2.6} />
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.statLbl}>استقرار الاتصال</Text>
              <Text style={[s.statVal, { color: '#38bdf8' }]}>{game && game.samples ? Math.max(0, Math.round(100 - game.lossPct)) : '—'}<Text style={s.statUnit}> %</Text></Text>
            </View>
          </View>
          <View style={s.statSep} />
          <View style={s.stat}>
            <Icon name="trend" size={22} color="#c084fc" stroke={2.4} />
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.statLbl}>التذبذب</Text>
              <Text style={[s.statVal, { color: '#c084fc' }]}>{game && game.samples ? Math.round(game.jitter) : '—'}<Text style={s.statUnit}> ms</Text></Text>
            </View>
          </View>
        </View>
      )}

      {/* «نشّط الدمج» — دايماً (حسن ٢٢ نوفمبر) */}
      {!!pcc && (
        <View style={{ gap: 6 }}>
          <Pressable onPress={() => activate(scc.length > 0)} disabled={!!act} accessibilityRole="button" accessibilityLabel="نشّط الدمج"
            style={({ pressed }) => [s.wake, pressed && { opacity: 0.8 }]}>
            {act ? <ActivityIndicator size="small" color={SEC_ORANGE} /> : <Icon name="spark" size={16} color={SEC_ORANGE} />}
            <Text style={s.wakeTxt}>{actLabel}</Text>
          </Pressable>
          {!!actMsg && !act && <Text style={[s.wakeMsg, { color: actMsg.ok ? '#12b76a' : C.sub }]}>{actMsg.text}</Text>}
        </View>
      )}

      {/* طبّق */}
      <Pressable onPress={() => router.push(`/combo/${r.id}` as Href)} style={({ pressed }) => [glow('#6a4cff', 18), { borderRadius: 999 }, pressed && { opacity: 0.88 }]}>
        <LinearGradient colors={['#2f8bff', '#2f6bff', '#8b3dff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.btn}>
          <View style={s.btnCheck}><Icon name="check" size={16} color="#2f6bff" stroke={3} /></View>
          <Text style={s.btnTxt}>طبّق أفضل تجميعة الآن</Text>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <Icon name="chevron" size={18} color="#ffffff" />
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const s = sheet({
  card: {
    backgroundColor: C.card, borderRadius: R.lg, padding: 12, gap: 12,
    borderWidth: 1, borderColor: isDark ? '#2c4fa0aa' : tBd('#ffffff'), marginBottom: 4,
  },
  top: { borderRadius: 22, borderWidth: 1, borderColor: isDark ? '#2e5bb8aa' : tBd('#dbe5f3'), backgroundColor: isDark ? '#0c1a45' : tBg('#f6f9ff'), paddingTop: 20, paddingBottom: 12, paddingHorizontal: 10, marginTop: 10 },
  badge: { position: 'absolute', top: -13, alignSelf: 'center', flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 14, height: 26, borderRadius: 999, backgroundColor: isDark ? '#0f3a26' : '#e7f8ee', borderWidth: 1, borderColor: '#22c55e99' },
  badgeTxt: { color: isDark ? '#ffffff' : '#15803d', fontSize: 12, fontWeight: '900' },
  topRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  qBox: { flex: 1.1, borderRadius: 14, borderWidth: 1, borderColor: isDark ? '#2c4a8c' : tBd('#dbe5f3'), paddingVertical: 6, paddingHorizontal: 8, gap: 5 },
  qRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  qTxt: { flex: 1, color: C.text, fontSize: 11.5, fontWeight: '800', textAlign: 'right' },
  pad: { flex: 0.9, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  padIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff55' },
  padRing: { marginTop: -6, width: 84, height: 14, borderRadius: 42, borderWidth: 2, borderColor: '#3b82f6aa', backgroundColor: '#3b82f622' },
  totalBox: { flex: 1, alignItems: 'center', gap: 1 },
  totalRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  totalBig: { color: C.text, fontSize: 32, lineHeight: 36, fontFamily: FONT.numHeavy, includeFontPadding: false },
  totalMhz: { color: '#22c55e', fontSize: 13, fontFamily: FONT.numHeavy },
  totalPill: { marginTop: 3, borderRadius: 999, borderWidth: 1, borderColor: isDark ? '#3a548c' : tBd('#dbe5f3'), paddingHorizontal: 9, paddingVertical: 2 },
  totalPillTxt: { color: C.sub, fontSize: 10, fontWeight: '800' },
  prim: { flex: 1, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 8, flexDirection: 'row-reverse', alignItems: 'center', gap: 4, minHeight: 92, borderWidth: 1, borderColor: '#ffffff40' },
  primTower: { opacity: 0.55 },
  primBand: { color: '#ffffff', fontSize: 28, lineHeight: 32, fontFamily: FONT.numHeavy, textAlign: 'center', includeFontPadding: false },
  plusWrap: { width: 30, alignItems: 'center', justifyContent: 'center' },
  plusBig: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#60a5fa', backgroundColor: isDark ? '#0e1838' : '#ffffff', alignItems: 'center', justifyContent: 'center' },
  plusBigTxt: { color: '#60a5fa', fontSize: 18, fontWeight: '900', marginTop: -2 },
  anchorTxt: { color: C.sub, fontSize: 10.5, fontWeight: '700', textAlign: 'center', marginTop: -4 },
  divider: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  divLine: { flex: 1, height: 1, backgroundColor: isDark ? '#2c4a8c' : C.line },
  divTxt: { color: C.text, fontSize: 13, fontWeight: '900' },
  secBox: { borderRadius: 18, borderWidth: 1, borderColor: isDark ? '#22386b' : tBd('#e6ecf6'), backgroundColor: isDark ? '#0b1533' : tBg('#fafbfe'), padding: 8 },
  secEmptyBox: { alignItems: 'center', paddingVertical: 10, gap: 2 },
  secCellTop: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 5 },
  shareChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, borderRadius: 999, borderWidth: 1, borderColor: isDark ? '#2c4a8c' : tBd('#dbe5f3'), paddingHorizontal: 9, paddingVertical: 3 },
  stats: { flexDirection: 'row-reverse', alignItems: 'center', borderRadius: 18, borderWidth: 1, borderColor: isDark ? '#2c4a8c' : tBd('#dbe5f3'), backgroundColor: isDark ? '#0b1533' : tBg('#fafbfe'), paddingVertical: 10, paddingHorizontal: 6 },
  stat: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6 },
  statSep: { width: 1, alignSelf: 'stretch', backgroundColor: isDark ? '#2c4a8c' : C.line },
  statLbl: { color: C.sub, fontSize: 10, fontWeight: '800', textAlign: 'right' },
  statVal: { fontSize: 20, lineHeight: 24, fontFamily: FONT.numHeavy, textAlign: 'right' },
  statUnit: { fontSize: 11, fontFamily: FONT.numSemi },
  btnCheck: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 14.5, fontWeight: '900' },
  sub: { color: C.sub, fontSize: 10.5, marginTop: 1, textAlign: 'right' },
  total: { alignItems: 'center', backgroundColor: tBg('#e8f8f0'), borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  totalNum: { color: '#12b76a', fontSize: 15, fontFamily: FONT.numHeavy },
  totalLbl: { color: '#12b76a', fontSize: 9, fontFamily: FONT.numSemi, marginTop: -2 },

  loadRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 10 },
  muted: { color: C.sub, fontSize: 12.5, textAlign: 'right' },

  chain: { flexDirection: 'row-reverse', alignItems: 'stretch' },
  main: { flex: 0.8, borderRadius: 16, padding: 8, justifyContent: 'space-between', alignItems: 'center', minHeight: 72 },
  mainTop: { alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  mainPill: { borderRadius: 999, borderWidth: 1, borderColor: '#ffffff99', backgroundColor: '#ffffff26', paddingHorizontal: 8, paddingVertical: 1 },
  mainPillTxt: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  star: { fontSize: 12 },
  mainBand: { color: '#ffffff', fontSize: 22, lineHeight: 26, fontFamily: FONT.numHeavy, textAlign: 'center', includeFontPadding: false },
  mainNice: { color: '#ffffffe6', fontSize: 9, fontWeight: '700', textAlign: 'center' },

  link: { width: 26, alignItems: 'center', justifyContent: 'center' },
  linkLine: { flex: 1, width: 2, backgroundColor: C.track, borderRadius: 1 },
  plus: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginVertical: 3 },
  plusTxt: { color: '#ffffff', fontSize: 14, fontWeight: '900', marginTop: -2 },

  side: { flex: 1.2, gap: 6, flexDirection: 'row-reverse', flexWrap: 'wrap', alignContent: 'stretch' },
  sec: { flexGrow: 1, flexBasis: '100%', borderRadius: 16, padding: 8, justifyContent: 'space-between', alignItems: 'center', minHeight: 72 },
  secSmall: { flexBasis: '45%', minHeight: 33, padding: 5, gap: 2, justifyContent: 'center' },
  secEmpty: { backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  secTop: { alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  secPill: { borderRadius: 999, borderWidth: 1, borderColor: '#ffffff99', backgroundColor: '#ffffff26', paddingHorizontal: 8, paddingVertical: 1 },
  secPillTxt: { color: '#ffffff', fontSize: 9.5, fontWeight: '900' },
  secTech: { color: '#ffffffcc', fontSize: 11, fontFamily: FONT.num },
  secLbl: { color: C.sub, fontSize: 10.5, fontWeight: '800', textAlign: 'right' },
  secBand: { color: '#ffffff', fontSize: 22, lineHeight: 26, fontFamily: FONT.numHeavy, textAlign: 'center', includeFontPadding: false },
  secNice: { color: '#ffffffe6', fontSize: 9.5, fontWeight: '700', textAlign: 'center' },
  emptyTxt: { color: C.text, fontSize: 15, fontWeight: '800' },
  emptySub: { color: C.muted, fontSize: 10 },

  gHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  gChip: { borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1 },
  gChipTxt: { color: '#ffffff', fontSize: 10.5, fontFamily: FONT.numHeavy },
  gTitle: { color: C.text, fontSize: 12.5, fontWeight: '900' },
  secRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  secCell: { flexGrow: 1, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: 58 },
  gTxt: { flex: 1, color: C.sub, fontSize: 10.5, fontWeight: '700', textAlign: 'right' },

  share: { flexDirection: 'row-reverse', height: 8, borderRadius: 99, overflow: 'hidden', gap: 2, backgroundColor: C.track },
  shareLbls: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  shareLbl: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  shareDot: { width: 7, height: 7, borderRadius: 4 },
  shareTxt: { color: C.sub, fontSize: 10, fontFamily: FONT.numSemi },
  btn: {
    height: 54, borderRadius: 999, borderWidth: 1, borderColor: '#ffffff40', paddingHorizontal: 14,
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  btnTxt: { flex: 1, color: '#ffffff', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  wake: {
    height: 40, borderRadius: 14, borderWidth: 1.5, borderColor: SEC_ORANGE + '88', backgroundColor: tBg('#fff4ec'),
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  wakeTxt: { color: SEC_ORANGE, fontSize: 13.5, fontWeight: '900' },
  wakeMsg: { fontSize: 11.5, textAlign: 'center', fontWeight: '700' },
});
