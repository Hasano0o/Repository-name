import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { applyGlobalFont, FONT } from '../src/ui/fonts';
import { C } from '../src/ui/theme';

const SCREENS: [string, string][] = [
  ['index', 'راوتراتي'],
  ['add-router', 'إضافة راوتر'],
  ['router/[id]', 'الراوتر'],
  ['bands/[id]', 'الترددات'],
  ['towers/[id]', 'الأبراج'],
  ['history/[id]', 'السجل'],
  ['sms/[id]', 'الرسائل'],
  ['aim/[id]', 'مساعد التوجيه'],
  ['ping/[id]', 'الألعاب والاستجابة'],
  ['probe', 'استكشاف جهاز'],
  ['profiles/[id]', 'ملفات التعريف'],
  ['optimize/[id]', 'المُحسِّن التلقائي'],
  ['report/[id]', 'تقرير الاتصال'],
  ['device/[id]', 'الجهاز'],
  ['speed/[id]', 'اختبار السرعة'],
  ['network/[id]', 'إعدادات الشبكة'],
  ['carriers/[id]', 'الناقلات النشطة'],
  ['places/[id]', 'مقارنة الأماكن'],
  ['antenna/[id]', 'مستشار الأنتنا'],
  ['finder/[id]', 'أفضل تردد'],
  ['calab/[id]', 'مختبر الدمج'],
  ['anchor/[id]', 'مرساة 5G'],
];

export default function RootLayout() {
  const [loaded, error] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    if (error) console.log('FONT ERROR', error);
    if (loaded) console.log('FONTS LOADED');
  }, [loaded, error]);

  if (loaded) {
    try { applyGlobalFont(); } catch {}
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        key={loaded ? 'f' : 'n'}
        screenOptions={{
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: C.bgTop },
          headerTintColor: C.text,
          headerTitleStyle: loaded
            ? { fontWeight: '700', fontFamily: FONT.bold }
            : { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: C.bg },
        }}
      >
        {SCREENS.map(([name, title]) => (
          <Stack.Screen key={name} name={name} options={{ title }} />
        ))}
      </Stack>
    </>
  );
}
