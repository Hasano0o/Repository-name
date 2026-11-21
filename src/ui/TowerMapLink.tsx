/**
 * «📍 وين برجي على الخريطة؟» — يفتح خريطة CellMapper لشركة الشريحة على مدينة العضو،
 * ويعطيه رقم موقع البرج (eNB) ينسخه ويبحث فيه (CellMapper ما يسمح برابط لبرج محدد).
 */
import { Alert, Linking, Share } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { Signal } from '../drivers/types';
import { SavedRouter } from '../store/routers';
import { withSession } from '../store/sessions';
import { getCity } from '../services/stats';
import { carrierOf } from '../utils/recharge';
import { enbOf, cellMapperUrl, SaCarrier, CARRIER_NAME } from '../utils/towerMap';
import { C, tBd, tBg, tFg } from './theme';
import { sheet } from '../i18n';

export function TowerMapLink({ router, signal }: { router: SavedRouter; signal: Signal | null }) {
  const enb = enbOf(signal);
  if (!enb) return null;

  const open = (carrier: SaCarrier, city: string) => {
    const where = city && city !== '-' ? city : 'السعودية';
    Alert.alert(
      'وين برجي؟',
      `رقم موقع برجك (eNB): ${enb}\n\nبنفتح خريطة ${CARRIER_NAME[carrier]} في CellMapper على ${where}. عشان يطلع برجك بالضبط: Menu ← Search ← Tower Search واكتب الرقم.\n\nالخريطة يعبّيها مستخدمين، فممكن برجك ما يكون مسجّل فيها.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'انسخ الرقم', onPress: () => Share.share({ message: String(enb) }).catch(() => {}) },
        { text: 'افتح الخريطة', onPress: () => Linking.openURL(cellMapperUrl(carrier, city)).catch(() => {}) },
      ],
    );
  };

  const press = async () => {
    const [net, city] = await Promise.all([
      withSession(router, async d => (d.getNetworkInfo ? d.getNetworkInfo() : null)).catch(() => null),
      getCity().catch(() => ''),
    ]);
    const c = carrierOf(net?.operator) as SaCarrier | null;
    if (c) { open(c, city); return; }
    // ما عرفنا الشركة من الراوتر ← يختارها
    Alert.alert('وش شركة الشريحة؟', 'عشان نفتح خريطة أبراجها.', [
      { text: 'STC', onPress: () => open('stc', city) },
      { text: 'موبايلي', onPress: () => open('mobily', city) },
      { text: 'زين', onPress: () => open('zain', city) },
    ]);
  };

  return (
    <Pressable onPress={press} style={({ pressed }) => [s.row, pressed && { opacity: 0.85 }]}>
      <Text style={s.txt}>📍 وين برجي على الخريطة؟</Text>
      <View style={s.tag}><Text style={s.tagTxt}>eNB {enb}</Text></View>
    </Pressable>
  );
}

const s = sheet({
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: tBg('#ecfdf3'), borderColor: tBd('#a7f3d0'), borderWidth: 1.5, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  txt: { color: tFg('#047857'), fontSize: 14, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
  tag: { backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  tagTxt: { color: C.sub, fontSize: 11.5, fontWeight: '800' },
});
