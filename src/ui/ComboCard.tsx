import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { useFocusEffect, router, Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { Carrier } from '../drivers/types';
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

  useFocusEffect(useCallback(() => {
    alive.current = true;
    withSession(r, async d => (d.getCarriers ? d.getCarriers() : []))
      .catch(() => [] as Carrier[])
      .then(l => { if (alive.current) setList(l); });
    return () => { alive.current = false; };
  }, [r]));

  const pcc = list?.find(c => c.role === 'PCC');
  const scc = (list ?? []).filter(c => c.role === 'SCC');
  const total = [pcc, ...scc].reduce((a, c) => a + ((c && mhzOf(c)) || 0), 0);

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
          <Text style={s.sub} numberOfLines={1}>التردد اللي يمسك الاتصال، واللي ينضم معه</Text>
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
          <View style={s.link}>
            <View style={s.linkLine} />
            <View style={[s.plus, scc.length === 0 && { backgroundColor: C.rowBg }]}>
              <Text style={[s.plusTxt, scc.length === 0 && { color: C.muted }]}>+</Text>
            </View>
            <View style={s.linkLine} />
          </View>

          {/* الثانوي */}
          <View style={s.side}>
            {scc.length === 0 ? (
              <View style={[s.sec, s.secEmpty]}>
                <Text style={s.secLbl}>الثانوي</Text>
                <Text style={s.emptyTxt}>بدون دمج</Text>
                <Text style={s.emptySub}>يجي وقت التحميل</Text>
              </View>
            ) : scc.slice(0, 4).map((c, i) => (
              <LinearGradient key={i} colors={secGrad(c)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={[s.sec, scc.length > 2 && s.secSmall]}>
                <View style={s.secTop}>
                  <View style={s.secPill}><Text style={s.secPillTxt} numberOfLines={1}>{scc.length > 2 ? `${i + 1}` : i === 0 ? 'الثانوي' : `ثانوي ${i + 1}`}</Text></View>
                  {scc.length <= 2 && <Text style={s.secTech}>{c.tech === 'NR' ? '5G' : '4G'}</Text>}
                </View>
                <Text style={[s.secBand, scc.length > 2 && { fontSize: 18, lineHeight: 22 }]} numberOfLines={1} adjustsFontSizeToFit>
                  {bandLabel(c.tech, c.band)}
                </Text>
                {scc.length <= 2 && (
                  <Text style={s.secNice} numberOfLines={1} adjustsFontSizeToFit>
                    {friendlyBand(c.tech, c.band)}{mhzOf(c) ? ` · ${mhzOf(c)}MHz` : ''}
                  </Text>
                )}
              </LinearGradient>
            ))}
          </View>
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
  main: { flex: 1, borderRadius: 16, padding: 9, justifyContent: 'space-between', alignItems: 'center', minHeight: 84 },
  mainTop: { alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  mainPill: { borderRadius: 999, borderWidth: 1, borderColor: '#ffffff99', backgroundColor: '#ffffff26', paddingHorizontal: 8, paddingVertical: 1 },
  mainPillTxt: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  star: { fontSize: 14 },
  mainBand: { color: '#ffffff', fontSize: 26, lineHeight: 30, fontFamily: FONT.numHeavy, textAlign: 'center', includeFontPadding: false },
  mainNice: { color: '#ffffffe6', fontSize: 9.5, fontWeight: '700', textAlign: 'center' },

  link: { width: 26, alignItems: 'center', justifyContent: 'center' },
  linkLine: { flex: 1, width: 2, backgroundColor: C.track, borderRadius: 1 },
  plus: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginVertical: 3 },
  plusTxt: { color: '#ffffff', fontSize: 14, fontWeight: '900', marginTop: -2 },

  side: { flex: 1, gap: 6, flexDirection: 'row-reverse', flexWrap: 'wrap', alignContent: 'stretch' },
  sec: { flexGrow: 1, flexBasis: '100%', borderRadius: 16, padding: 9, justifyContent: 'space-between', alignItems: 'center', minHeight: 84 },
  secSmall: { flexBasis: '45%', minHeight: 40, padding: 6 },
  secEmpty: { backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  secTop: { alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  secPill: { borderRadius: 999, borderWidth: 1, borderColor: '#ffffff99', backgroundColor: '#ffffff26', paddingHorizontal: 8, paddingVertical: 1 },
  secPillTxt: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  secTech: { color: '#ffffffcc', fontSize: 11, fontFamily: FONT.num },
  secLbl: { color: C.sub, fontSize: 10.5, fontWeight: '800', textAlign: 'right' },
  secBand: { color: '#ffffff', fontSize: 26, lineHeight: 30, fontFamily: FONT.numHeavy, textAlign: 'center', includeFontPadding: false },
  secNice: { color: '#ffffffe6', fontSize: 9.5, fontWeight: '700', textAlign: 'center' },
  emptyTxt: { color: C.text, fontSize: 15, fontWeight: '800' },
  emptySub: { color: C.muted, fontSize: 10 },

  btn: {
    height: 40, borderRadius: 14,
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  btnTxt: { color: '#ffffff', fontSize: 13.5, fontWeight: '900' },
});
