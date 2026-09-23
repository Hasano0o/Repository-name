/**
 * Screenshot Flow Layout — PHASE 4C-2C-1
 *
 * - يستقبل host من params (من probe.tsx)
 * - يحوط كل الشاشات بـ ScreenshotFlowProvider
 * - يُصفّر الحالة عند unmount
 */

import { useEffect } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScreenshotFlowProvider } from '../../src/ui/screenshot-flow-context';
import { isLanHost } from '../../src/utils/host';
import { C } from '../../src/ui/theme';

export default function ScreenshotLayout() {
  const params = useLocalSearchParams<{ host?: string }>();
  const host = typeof params.host === 'string' ? params.host : '';

  // ═══ حماية: لا نسمح بمسار Screenshot بدون host LAN صالح
  // ═══ (لن نعرض Alert هنا — فقط host فارغ إذا كان غير صالح)
  const safeHost = isLanHost(host) ? host : '';

  // ═══ ملاحظة: لا نحتاج cleanup يدوي هنا، لأن Provider يُفكّ عند unmount
  // ═══ ويُصفّر state تلقائيًا
  useEffect(() => {
    // لا شيء — Provider يتكفّل بالحالة
  }, []);

  return (
    <ScreenshotFlowProvider host={safeHost}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.bgTop },
          headerTintColor: C.text,
          headerTitleAlign: 'center',
          headerShadowVisible: false,
          contentStyle: { backgroundColor: C.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'مساعد الصور' }} />
        <Stack.Screen name="input" options={{ title: 'إدخال المعلومات' }} />
        <Stack.Screen name="review" options={{ title: 'مراجعة المعلومات' }} />
        <Stack.Screen name="result" options={{ title: 'تم' }} />
      </Stack>
    </ScreenshotFlowProvider>
  );
}
