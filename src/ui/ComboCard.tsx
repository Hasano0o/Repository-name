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
import { C, R, tBd, tBg } from './theme';

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

  const secTiles = (list: Carrier[]) => list.slice(0, 4).map((c, i) => (
    <LinearGradient key={i} colors={secGrad(c)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[s.sec, list.length > 2 && s.secSmall]}>
      <View style={[s.secTop, list.length > 2 && { justifyContent: 'center' }]}>
        <View style={s.secPill}><Text style={s.secPillTxt} numberOfLines={1}>الثانوي</Text></View>
        {list.length <= 2 && <Text style={s.secTech}>{c.tech === 'NR' ? '5G' : '4G'}</Text>}
      </View>
      <Text style={[s.secBand, list.length > 2 && { fontSize: 17, lineHeight: 20 }]} numberOfLines={1} adjustsFontSizeToFit>
        {bandLabel(c.tech, c.band)}
      </Text>
      {list.length <= 2 && (
        <Text style={s.secNice} numberOfLines={1} adjustsFontSizeToFit>
          {friendlyBand(c.tech, c.band)}{mhzOf(c) ? ` · ${mhzOf(c)}MHz` : ''}
        </Text>
      )}
    </LinearGradient>
  ));
  const linkDot = (on: boolean) => (
    <View style={s.link}>
      <View style={s.linkLine} />
      <View style={[s.plus, !on && { backgroundColor: C.rowBg }]}>
        <Text style={[s.plusTxt, !on && { color: C.muted }]}>+</Text>
      </View>
      <View style={s.linkLine} />
    </View>
  );
  const groupHead = (title: string, txt: string) => (
    <View style={s.gHead}>
      <Text style={s.gTitle}>{title}</Text>
      <Text style={s.gTxt} numberOfLines={1}>{txt}</Text>
    </View>
  );
  const nsaSecs = nsa ? [...chainScc, ...nrScc] : [];

  return (
    <Pressable
      onPress={() => router.push(`/combo/${r.id}` as Href)}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.9 }]}
    >
      {/* الرأس */}
      <View style={s.head}>
        <LinearGradient colors={GRAD.LTE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>
          <Icon name="layers" size={19} color="#ffffff" />
        </LinearGradient>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={s.title}>الأساسي والثانوي</Text>
          <Text style={s.sub} numberOfLines={1}>{fromWoke ? 'الدمج وقت التحميل (قريناه بتحميل قصير)' : 'التردد اللي يمسك الاتصال، واللي ينضم معه'}</Text>
        </View>
        {total > 0 && (
          <View style={s.total}>
            <Text style={s.totalNum}>{total}</Text>
            <Text style={s.totalLbl}>MHz</Text>
          </View>
        )}
      </View>

      {/* السلسلة */}
      {list === null ? (
        <View style={s.loadRow}>
          <Text style={s.muted}>نقرأ الترددات…</Text>
          <ActivityIndicator size="small" color={C.blue} />
        </View>
      ) : !pcc ? (
        <Text style={[s.muted, { paddingVertical: 8 }]}>اضغط تشوف الترددات الحالية وتغيّرها</Text>
      ) : (
        nsa && nrMain ? (
          /* NSA (حسن ٢٣ نوفمبر): الأساسي 4G + رئيسي 5G جنب بعض فوق، والثانوي كله لحاله تحت */
          <View style={{ gap: 8 }}>
            {groupHead('الأساسي', `${bandLabel(nrMain.tech, nrMain.band)} مربوط على ${anchor} — لو طاح ${anchor} يطيح معه`)}
            <View style={s.chain}>
              <LinearGradient colors={GRAD.LTE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.main, { flex: 1 }]}>
                <View style={s.mainTop}>
                  <Text style={s.star}>⭐</Text>
                  <View style={s.mainPill}><Text style={s.mainPillTxt}>الأساسي 4G</Text></View>
                </View>
                <Text style={s.mainBand} numberOfLines={1} adjustsFontSizeToFit>{bandLabel(pcc.tech, pcc.band)}</Text>
                <Text style={s.mainNice} numberOfLines={1} adjustsFontSizeToFit>
                  {friendlyBand(pcc.tech, pcc.band)}{mhzOf(pcc) ? `  ·  ${mhzOf(pcc)}MHz` : ''}
                </Text>
              </LinearGradient>
              {linkDot(true)}
              <LinearGradient colors={GRAD.NR} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.main, { flex: 1 }]}>
                <View style={s.mainTop}>
                  <Text style={s.star}>⚡</Text>
                  <View style={s.mainPill}><Text style={s.mainPillTxt}>الأساسي 5G</Text></View>
                </View>
                <Text style={s.mainBand} numberOfLines={1} adjustsFontSizeToFit>{bandLabel(nrMain.tech, nrMain.band)}</Text>
                <Text style={s.mainNice} numberOfLines={1} adjustsFontSizeToFit>
                  {friendlyBand(nrMain.tech, nrMain.band)}{mhzOf(nrMain) ? `  ·  ${mhzOf(nrMain)}MHz` : ''}
                </Text>
              </LinearGradient>
            </View>

            {groupHead('الثانوي', nsaSecs.length ? 'ينضم مع الأساسي ويزيد السرعة' : 'يجي وقت التحميل')}
            {nsaSecs.length === 0 ? (
              <View style={[s.sec, s.secEmpty, { minHeight: 44 }]}>
                <Text style={s.emptyTxt}>بدون دمج</Text>
              </View>
            ) : (
              <View style={s.secRow}>
                {nsaSecs.slice(0, 6).map((c, i) => (
                  <LinearGradient key={i} colors={secGrad(c)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[s.secCell, { flexBasis: nsaSecs.length <= 3 ? '30%' : '22%' }]}>
                    <Text style={s.secTech}>{c.tech === 'NR' ? '5G' : '4G'}</Text>
                    <Text style={[s.secBand, { fontSize: 19, lineHeight: 22 }]} numberOfLines={1} adjustsFontSizeToFit>
                      {bandLabel(c.tech, c.band)}
                    </Text>
                    {!!mhzOf(c) && <Text style={s.secNice} numberOfLines={1}>{mhzOf(c)}MHz</Text>}
                  </LinearGradient>
                ))}
              </View>
            )}
          </View>
        ) : (
        <View style={s.chain}>
          {/* الأساسي */}
          <LinearGradient colors={GRAD[pcc.tech]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.main}>
            <View style={s.mainTop}>
              <Text style={s.star}>⭐</Text>
              <View style={s.mainPill}><Text style={s.mainPillTxt}>الأساسي</Text></View>
            </View>
            <Text style={s.mainBand} numberOfLines={1} adjustsFontSizeToFit>{bandLabel(pcc.tech, pcc.band)}</Text>
            <Text style={s.mainNice} numberOfLines={1} adjustsFontSizeToFit>
              {friendlyBand(pcc.tech, pcc.band)}{mhzOf(pcc) ? `  ·  ${mhzOf(pcc)}MHz` : ''}
            </Text>
          </LinearGradient>

          {/* الربط */}
          {linkDot(chainScc.length > 0)}

          {/* الثانوي */}
          <View style={s.side}>
            {chainScc.length === 0 ? (
              <View style={[s.sec, s.secEmpty]}>
                <Text style={s.secLbl}>الثانوي</Text>
                <Text style={s.emptyTxt}>بدون دمج</Text>
                <Text style={s.emptySub}>يجي وقت التحميل</Text>
              </View>
            ) : secTiles(chainScc)}
          </View>
        </View>
        )
      )}

      {/* توزيع عرض النطاق: مين شايل السرعة — بنفس الألوان (أساسي أزرق · ثانوي برتقالي · 5G بنفسجي) */}
      {(() => {
        const parts = [pcc, ...scc].filter((c): c is Carrier => !!c && !!mhzOf(c));
        if (parts.length < 2 || total <= 0) return null;
        const colOf = (c: Carrier) => (c.role === 'PCC' ? C.blue : c.tech === 'NR' ? '#7c3aed' : SEC_ORANGE);
        return (
          <View style={{ gap: 5 }}>
            <View style={s.share}>
              {parts.map((c, i) => (
                <View key={i} style={{ flex: mhzOf(c)!, backgroundColor: colOf(c) }} />
              ))}
            </View>
            <View style={s.shareLbls}>
              {parts.map((c, i) => (
                <View key={i} style={s.shareLbl}>
                  <View style={[s.shareDot, { backgroundColor: colOf(c) }]} />
                  <Text style={s.shareTxt}>{bandLabel(c.tech, c.band)} {mhzOf(c)}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })()}

      {/* «نشّط الدمج» — دايماً (حسن ٢٢ نوفمبر)؛ والدمج شغال ← يأكّده «الدمج شغال» */}
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

      {/* الزر */}
      <LinearGradient colors={['#2f6bff', '#6a4cff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.btn}>
        <Text style={s.btnTxt}>غيّر الأساسي والثانوي</Text>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <Icon name="chevron" size={16} color="#ffffff" />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const s = sheet({
  card: {
    backgroundColor: C.card, borderRadius: R.lg, padding: 12, gap: 12,
    borderWidth: 1, borderColor: tBd('#ffffff'), marginBottom: 4,
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
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
    height: 40, borderRadius: 14,
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  btnTxt: { color: '#ffffff', fontSize: 13.5, fontWeight: '900' },
  wake: {
    height: 40, borderRadius: 14, borderWidth: 1.5, borderColor: SEC_ORANGE + '88', backgroundColor: tBg('#fff4ec'),
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  wakeTxt: { color: SEC_ORANGE, fontSize: 13.5, fontWeight: '900' },
  wakeMsg: { fontSize: 11.5, textAlign: 'center', fontWeight: '700' },
});
