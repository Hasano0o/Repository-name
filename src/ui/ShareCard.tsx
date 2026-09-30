/**
 * تقرير كصورة: بطاقة «قبل وبعد» للإشارة والسرعة — تنرسل بالواتساب.
 * نفس البطاقة عند العميل (مساعد التوجيه) وعند الفني (نهاية الجلسة).
 */
import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator, Share } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Icon } from './Icon';
import { P } from './Pro';
import { SpeedPair } from '../services/live';

import { tBd, tBg, tFg } from './theme';
export interface ShareData {
  router: string;
  before?: number; after?: number; best?: number;   // RSRP
  sinrBefore?: number; sinrAfter?: number;
  tower?: string;                                     // الباند · PCI
  speed?: SpeedPair;
  tech?: string;
  minutes?: number;
}

const f1 = (v?: number) => (v == null ? '—' : v >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString());
const LTR = (t: string) => `⁦${t}⁩`;

function Row({ label, a, b, unit, better }: { label: string; a?: number; b?: number; unit: string; better: 'up' | 'down' }) {
  const d = a != null && b != null ? b - a : undefined;
  const good = d !== undefined && (better === 'up' ? d > 0.4 : d < -0.4);
  const bad = d !== undefined && (better === 'up' ? d < -0.4 : d > 0.4);
  return (
    <View style={c.row}>
      <Text style={c.rowLbl}>{label}</Text>
      <View style={c.rowVals}>
        <Text style={c.rowA}>{LTR(`${f1(a)}`)}</Text>
        <Icon name="chevron" size={14} color={P.faint} stroke={2.4} />
        <Text style={[c.rowB, good && { color: tFg('#0f9d5f') }, bad && { color: P.red }]}>{LTR(`${f1(b)}`)}</Text>
        <Text style={c.rowUnit}>{unit}</Text>
      </View>
    </View>
  );
}

export function ShareCardView({ d }: { d: ShareData }) {
  const gain = d.before != null && d.after != null ? Math.round(d.after - d.before) : undefined;
  const sp = d.speed ?? {};
  const spGain = sp.before && sp.after && sp.before.down > 0 ? Math.round(((sp.after.down - sp.before.down) / sp.before.down) * 100) : undefined;
  const date = new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <View style={c.card}>
      <LinearGradient colors={[tBg('#2f6bff'), tBg('#6a45ec')]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={c.head}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
          <View style={c.logo}><Icon name="tower" size={16} color={tFg('#fff')} stroke={2.2} /></View>
          <Text style={c.brand}>Bandly</Text>
          <View style={{ flex: 1 }} />
          <Text style={c.date}>{date}</Text>
        </View>
        <Text style={c.title}>تقرير ضبط الإشارة</Text>
        <Text style={c.router} numberOfLines={1}>{d.router}</Text>
        <View style={c.bigRow}>
          <View style={c.big}>
            <Text style={c.bigVal}>{gain === undefined ? '—' : LTR(`${gain > 0 ? '+' : ''}${gain} dB`)}</Text>
            <Text style={c.bigLbl}>تحسّن الإشارة</Text>
          </View>
          {spGain !== undefined && (
            <View style={c.big}>
              <Text style={c.bigVal}>{LTR(`${spGain > 0 ? '+' : ''}${spGain}%`)}</Text>
              <Text style={c.bigLbl}>تحسّن السرعة</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      <View style={c.body}>
        <Text style={c.colTxt}>الرقم الرمادي قبل الضبط، والغامق بعده</Text>
        <Row label="قوة الإشارة RSRP" a={d.before} b={d.after} unit="dBm" better="up" />
        {(d.sinrBefore != null || d.sinrAfter != null) && <Row label="جودة الإشارة SINR" a={d.sinrBefore} b={d.sinrAfter} unit="dB" better="up" />}
        {(sp.before || sp.after) && <>
          <Row label="سرعة التحميل" a={sp.before?.down} b={sp.after?.down} unit="Mbps" better="up" />
          <Row label="سرعة الرفع" a={sp.before?.up} b={sp.after?.up} unit="Mbps" better="up" />
          <Row label="البنق" a={sp.before?.ping} b={sp.after?.ping} unit="ms" better="down" />
        </>}
        <View style={c.tags}>
          {d.best != null && <View style={c.tag}><Text style={c.tagTxt}>أفضل قراءة {LTR(`${Math.round(d.best)} dBm`)}</Text></View>}
          {!!d.tower && <View style={c.tag}><Text style={c.tagTxt}>البرج {LTR(d.tower)}</Text></View>}
          {!!d.minutes && <View style={c.tag}><Text style={c.tagTxt}>{d.minutes} دقيقة</Text></View>}
          {!!d.tech && <View style={[c.tag, { backgroundColor: P.greenSoft }]}><Text style={[c.tagTxt, { color: tFg('#0b7a47') }]}>الفني: {d.tech}</Text></View>}
        </View>
      </View>
      <View style={c.foot}>
        <Text style={c.footTxt}>اضبط إشارتك مجاناً مع Bandly</Text>
        <Text style={[c.footTxt, { color: P.blue, fontWeight: '800' }]}>t.me/NetGuide1_bot</Text>
      </View>
    </View>
  );
}

/** نافذة معاينة + زر مشاركة الصورة */
export function ShareCardModal({ data, onClose }: { data: ShareData | null; onClose: () => void }) {
  const ref = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await captureRef(ref, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'أرسل التقرير' });
      else await Share.share({ url: uri });
    } catch {} finally { setBusy(false); }
  };
  return (
    <Modal visible={!!data} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={c.dim}>
        <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 50 }}>
          {data && <View ref={ref} collapsable={false} style={{ backgroundColor: P.bg, borderRadius: 26 }}><ShareCardView d={data} /></View>}
          <Pressable onPress={share} style={{ marginTop: 14, borderRadius: 18, overflow: 'hidden' }}>
            <LinearGradient colors={[tBg('#12b76a'), tBg('#0ea5a0')]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={c.btn}>
              {busy ? <ActivityIndicator color={tFg('#fff')} /> : <Icon name="share" size={18} color={tFg('#fff')} stroke={2.2} />}
              <Text style={c.btnTxt}>أرسل الصورة (واتساب وغيره)</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={onClose} style={c.close}><Text style={c.closeTxt}>إغلاق</Text></Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const c = StyleSheet.create({
  card: { backgroundColor: P.card, borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: P.border },
  head: { padding: 18, paddingBottom: 16 },
  logo: { width: 30, height: 30, borderRadius: 10, backgroundColor: tBg('rgba(255,255,255,0.22)'), alignItems: 'center', justifyContent: 'center' },
  brand: { color: tFg('#fff'), fontSize: 17, fontWeight: '800' },
  date: { color: tFg('rgba(255,255,255,0.8)'), fontSize: 11.5, fontWeight: '700' },
  title: { color: tFg('#fff'), fontSize: 22, fontWeight: '800', textAlign: 'right', marginTop: 14 },
  router: { color: tFg('rgba(255,255,255,0.85)'), fontSize: 13, textAlign: 'right', marginTop: 2 },
  bigRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 14 },
  big: { flex: 1, backgroundColor: tBg('rgba(255,255,255,0.16)'), borderRadius: 18, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: tBd('rgba(255,255,255,0.2)') },
  bigVal: { color: tFg('#fff'), fontSize: 28, fontWeight: '800' },
  bigLbl: { color: tFg('rgba(255,255,255,0.85)'), fontSize: 12, fontWeight: '700', marginTop: 2 },
  body: { padding: 16, paddingTop: 12 },
  colTxt: { color: P.faint, fontSize: 11.5, fontWeight: '700', textAlign: 'right', marginBottom: 2 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: P.border },
  rowLbl: { color: P.sub, fontSize: 13, fontWeight: '700' },
  rowVals: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowA: { color: P.sub, fontSize: 14, fontWeight: '700' },
  rowB: { color: P.text, fontSize: 16, fontWeight: '800' },
  rowUnit: { color: P.faint, fontSize: 11, fontWeight: '700' },
  tags: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  tag: { backgroundColor: P.soft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  tagTxt: { color: P.text, fontSize: 11.5, fontWeight: '700' },
  foot: { backgroundColor: P.soft, paddingVertical: 10, alignItems: 'center' },
  footTxt: { color: P.sub, fontSize: 11.5, fontWeight: '700' },
  dim: { flex: 1, backgroundColor: tBg('rgba(8,15,40,0.6)') },
  btn: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15 },
  btnTxt: { color: tFg('#fff'), fontSize: 15.5, fontWeight: '800' },
  close: { alignSelf: 'center', padding: 14 },
  closeTxt: { color: tFg('#fff'), fontSize: 14, fontWeight: '700' },
});
