/**
 * كرت «بعد البرج عنك» (صفحة التفاصيل) — قاعدة الأبراج من الأعضاء (src/services/towerMap.ts).
 * أول مرة يشرح ويطلب الموافقة + صلاحية الموقع. بعدها: «حوالي ٢٫٣ كم · شمال شرق» أو «نجمع: ١ من ٣ أعضاء».
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { Icon } from './Icon';
import { P } from './Pro';
import { Signal } from '../drivers/types';
import { cellOf } from '../services/towerGeo';
import {
  TowerInfo, TowerConsent, getTowerConsent, setTowerConsent, requestLocation, contributeTower, towerInfo, locationAvailable,
} from '../services/towerMap';

export function TowerDistance({ signal }: { signal?: Signal | null }) {
  const [consent, setConsent] = useState<TowerConsent | undefined>();
  const [info, setInfo] = useState<TowerInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasLib, setHasLib] = useState<boolean | null>(null);
  const cell = cellOf(signal);
  const key = cell ? `${cell.mcc}-${cell.mnc}-${cell.tac}-${cell.eci}` : '';

  useEffect(() => { getTowerConsent().then(setConsent); locationAvailable().then(setHasLib); }, []);

  const load = async () => {
    setBusy(true);
    try {
      await contributeTower(signal);
      setInfo(await towerInfo(signal));
    } catch {
      setInfo(null);
    } finally { setBusy(false); }
  };
  useEffect(() => { if (consent === 'yes' && key) load(); }, [consent, key]);

  if (!cell || consent === undefined || hasLib === null) return null;

  const enable = () => {
    Alert.alert('اعرف بعد البرج عنك',
      'نحسب بعد البرج واتجاهه من أماكن أعضاء Bandly اللي يشبكون عليه.\n\n' +
      '• نرسل موقعك التقريبي (لأقرب ١٠٠ متر تقريباً) مع رقم البرج — والتطبيق مفتوح بس.\n' +
      '• ما يطلع موقع أي عضو لأحد: نعرض موقع البرج بس، ولما يكون عليه ٣ أعضاء أو أكثر.\n' +
      '• تقدر توقفها أي وقت من نفس الكرت.',
      [
        { text: 'لا، شكراً', style: 'cancel', onPress: async () => { await setTowerConsent('no'); setConsent('no'); } },
        {
          text: 'موافق', onPress: async () => {
            const ok = await requestLocation();
            if (!ok) { Alert.alert('صلاحية الموقع', 'بدون صلاحية الموقع ما نقدر نحسب البعد. تقدر تفعّلها من إعدادات الجوال ← Bandly ← الموقع.'); return; }
            await setTowerConsent('yes');
            setConsent('yes');
          },
        },
      ]);
  };
  const stop = () => Alert.alert('توقف «بعد البرج»؟', 'نوقف إرسال موقعك التقريبي. القراءات القديمة تبقى بدون أي شي يربطها فيك.', [
    { text: 'رجوع', style: 'cancel' },
    { text: 'أوقف', style: 'destructive', onPress: async () => { await setTowerConsent('no'); setConsent('no'); setInfo(null); } },
  ]);

  // النسخ القديمة (قبل بناء نوفمبر) ما فيها مكتبة الموقع
  if (!hasLib) {
    return (
      <View style={s.card}>
        <Head />
        <Text style={s.sub}>يحتاج آخر نسخة من التطبيق (حمّلها من المتجر أو من رابط الأندرويد).</Text>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <Head />
      {consent !== 'yes' ? (
        <>
          <Text style={s.sub}>اعرف كم يبعد البرج عنك ووين اتجاهه — يفيد بتوجيه الأنتنا.</Text>
          <Pressable onPress={enable} style={({ pressed }) => [s.btn, pressed && { opacity: 0.8 }]}>
            <Text style={s.btnTxt}>اعرف بعد البرج</Text>
          </Pressable>
        </>
      ) : busy && !info ? (
        <ActivityIndicator color={P.blue} style={{ marginTop: 8 }} />
      ) : info?.state === 'found' ? (
        <>
          <Text style={s.big}>{info.label}{info.dir ? ` · ${info.dir}` : ''}</Text>
          <Text style={s.sub}>
            {info.noLoc ? 'فعّل الموقع عشان نحسب البعد منك. ' : ''}
            {info.deg !== undefined ? `الاتجاه ${info.deg}° من الشمال · ` : ''}من {info.members} أعضاء · الدقة ±{info.accuracy >= 1000 ? `${(info.accuracy / 1000).toFixed(1)} كم` : `${info.accuracy} م`}
          </Text>
        </>
      ) : info?.state === 'collecting' ? (
        <Text style={s.sub}>
          نجمع أماكن الأعضاء على هالبرج: {Math.min(info.members, info.need)} من {info.need}.{'\n'}
          أول ما يكتمل العدد يطلع لك البعد والاتجاه. شارك Bandly مع جيرانك على نفس الشبكة يكمل أسرع 🌹
        </Text>
      ) : (
        <Text style={s.sub}>ما قدرنا نوصل للسيرفر — جرّب بعد شوي.</Text>
      )}
      {consent === 'yes' && (
        <Pressable onPress={stop} hitSlop={8}><Text style={s.stop}>إيقاف</Text></Pressable>
      )}
    </View>
  );
}

function Head() {
  return (
    <View style={s.head}>
      <View style={s.icon}><Icon name="tower" size={18} color={P.blue} /></View>
      <Text style={s.title}>بعد البرج عنك</Text>
    </View>
  );
}

const s = {
  card: { backgroundColor: P.card, borderColor: P.border, borderWidth: 1.5, borderRadius: 18, padding: 14, gap: 8 },
  head: { flexDirection: 'row-reverse' as const, alignItems: 'center' as const, gap: 8 },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: P.blueSoft, alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { color: P.text, fontWeight: '800' as const, fontSize: 16, textAlign: 'right' as const },
  big: { color: P.blue, fontWeight: '900' as const, fontSize: 22, textAlign: 'right' as const },
  sub: { color: P.sub, fontSize: 13, lineHeight: 19, textAlign: 'right' as const },
  btn: { backgroundColor: P.blue, borderRadius: 14, paddingVertical: 11, alignItems: 'center' as const },
  btnTxt: { color: '#fff', fontWeight: '800' as const, fontSize: 15 },
  stop: { color: P.faint, fontSize: 12, textAlign: 'left' as const },
};
