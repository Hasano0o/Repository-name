/**
 * تأكيد الخروج من شاشة فيها عملية طويلة على الراوتر (المُحسّن التلقائي ~٧ دقايق، مُحسّن الألعاب، الدمج…).
 * قبل: الخروج (رجوع/سحب) يخلي العملية شغالة بالخلفية وماسكة الراوتر ← لو رجع العضو يطلع له «الراوتر مشغول».
 * الحين: نسأله — «كمّل» يبقى في الشاشة، «أوقف واطلع» يوقف الفحص (والتطبيق يرجّع إعداده الأصلي) ويطلع.
 * onStop غير موجود (آي بي جديد — إعادة التشغيل ما تنوقف) ← «اطلع» والعملية تكمل لحالها.
 */
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';

export function useLeaveGuard(active: boolean, opts: { what: string; onStop?: () => void }) {
  const navigation = useNavigation();
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    // السحب من طرف الشاشة (آيفون) ما يمر على التأكيد في كل الإصدارات — نقفله وقت العملية
    try { (navigation as any).setOptions?.({ gestureEnabled: !active }); } catch {}
    if (!active) return;
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      e.preventDefault();
      const { what, onStop } = ref.current;
      Alert.alert(
        `${what} شغّال`,
        onStop
          ? 'لو طلعت نوقف الفحص ونرجّع إعداد راوترك الأصلي (ياخذ ثواني). تبي تكمّل ولا توقف؟'
          : 'العملية ما تنوقف من نصها — لو طلعت تكمل لحالها، ولا تقدر تسوي شي ثاني على الراوتر لين تخلص.',
        [
          { text: onStop ? 'كمّل' : 'ابقَ', style: 'cancel' },
          {
            text: onStop ? 'أوقف واطلع' : 'اطلع',
            style: 'destructive',
            onPress: () => { try { onStop?.(); } catch {} (navigation as any).dispatch(e.data.action); },
          },
        ],
      );
    });
    return unsub;
  }, [navigation, active]);
}
