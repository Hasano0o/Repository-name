import '../src/desktop/install'; // نسخة الويندوز: توجيه الطلبات عبر البرنامج (ما يأثر على الجوال)
import '../src/desktop/scrollbar'; // نسخة الويندوز: شريط تمرير ظاهر تسحبه بالماوس
import { patchAlert, tr } from '../src/i18n';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { pingDaily, markScreen } from '../src/services/stats';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});
import {
  useFonts,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
// كل وزن من مساره — الاستيراد من الجذر يضم كل الأوزان (~٣ ميقا) في الحزمة
import { Rubik_600SemiBold } from '@expo-google-fonts/rubik/600SemiBold';
import { Rubik_700Bold } from '@expo-google-fonts/rubik/700Bold';
import { Rubik_800ExtraBold } from '@expo-google-fonts/rubik/800ExtraBold';
import { applyGlobalFont, FONT } from '../src/ui/fonts';
import { C, isDark } from '../src/ui/theme';
import { UpdateBanner } from '../src/ui/UpdateBanner';
import { initNotificationHandler } from '../src/utils/notify';
import '../src/tasks/monitor'; // يسجّل تعريف مهمة المراقبة الخلفية عند الإقلاع
import { setLanTlsFlag } from '../src/drivers/http';
import { lanTlsAvailable } from '../modules/bandly-tls/src';
// راوترات https بشهادة ذاتية: النسخة فيها القبول؟ (بناء نوفمبر ٢٠٢٦) — يحدد رسالة الخطأ (حدّث / فشل التشفير)
setLanTlsFlag(lanTlsAvailable);
import { ProgressHost } from '../src/ui/Progress';
import { OpPill } from '../src/ui/OpPill';

initNotificationHandler();
patchAlert(); // بالإنجليزي: نوافذ التنبيه تنترجم
import('../src/services/errors').then(m => setTimeout(m.flushErrors, 8000)).catch(() => {}); // تقارير ما وصلت وقت انقطاع النت

const SCREENS: [string, string][] = [
  ['index', 'راوتراتي'],
  ['add-router', 'إضافة راوتر'],
  ['router/[id]', 'الراوتر'],
  ['bands/[id]', 'الترددات'],
  ['towers/[id]', 'الأبراج'],
  ['history/[id]', 'السجل'],
  ['sms/[id]', 'الرسائل'],
  ['hwtools/[id]', 'الأنتنا والباقة'],
  ['aim/[id]', 'توجيه الأنتنا'],
  ['hunt/[id]', 'صيد الإشارة'],
  ['ping/[id]', 'مُحسّن الألعاب'],
  ['gameboost/[id]', 'تعزيز اللعب'],
  ['heavy/[id]', 'وش يثقّل نتك؟'],
  ['carriers', 'أفضل شركة في منطقتك'],
  ['lag/[id]', 'كاشف اللاق'],
  ['auto/[id]', 'الوضع الذكي'],
  ['combo/[id]', 'الأساسي والثانوي'],
  ['probe', 'استكشاف جهاز'],
  ['newdevice', 'برمج لي جهازي'],
  ['profiles/[id]', 'ملفاتي'],
  ['optimize/[id]', 'المُحسِّن التلقائي'],
  ['report/[id]', 'تقرير الاتصال'],
  ['wifi/[id]', 'مشاركة الواي فاي'],
  ['nsacombo/[id]', 'دمج 4G + 5G'],
  ['nrdual/[id]', 'دمج 5G المزدوج'],
  ['nrprimary/[id]', '5G الأساسي'],
  ['newip/[id]', 'آي بي جديد'],
  ['wifich/[id]', 'قناة الواي فاي'],
  ['control/[id]', 'مركز التحكم'],
  ['techs', 'الفنيين'],
  ['device/[id]', 'الجهاز'],
  ['speed/[id]', 'اختبار السرعة'],
  ['network/[id]', 'إعدادات الشبكة'],
  ['carriers/[id]', 'الناقلات النشطة'],
  ['places/[id]', 'مقارنة الأماكن'],
  ['antenna/[id]', 'مستشار الأنتنا'],
  ['finder/[id]', 'اختار لي الأفضل'],
  ['advisor/[id]', 'المستشار الذكي'],
  ['calab/[id]', 'مختبر الدمج'],
  ['anchor/[id]', 'مرساة 5G'],
  ['trials/[id]', 'وش نجح عندي'],
  ['assistant/[id]', 'مساعد Bandly'],
  ['setup', 'المساعد يدخّلك'],
  ['autopilot/[id]', 'اضبط لي كل شي'],
  ['monitor', 'المراقبة والتنبيهات'],
  ['tech', 'وضع الفني'],
];

// اسم الشاشة بالعربي من أول جزء في المسار (/towers/abc ← الأبراج) — للإحصائيات
const SCREEN_NAME: Record<string, string> = { details: 'التفاصيل', ...Object.fromEntries(SCREENS.map(([k, t]) => [k.split('/')[0], t])) };

// شاشات فيها عنوان كبير داخل الصفحة — ما نكرره في الشريط العلوي
const OWN_TITLE = new Set(['aim/[id]', 'antenna/[id]']);
// شاشات لها ترويسة كاملة خاصة (فيها زر الرجوع) — نخفي الشريط العلوي
const NO_HEADER = new Set(['hunt/[id]']);

export default function RootLayout() {
  const [loaded, error] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
    // أرقام البطاقات (قوة الإشارة، الترددات) — أوضح من خط العربي في الأرقام الكبيرة
    Rubik_600SemiBold,
    Rubik_700Bold,
    Rubik_800ExtraBold,
  });

  const path = usePathname();
  useEffect(() => {
    const seg = (path || '/').split('/').filter(Boolean)[0] ?? 'index';
    if (seg !== 'index') markScreen(SCREEN_NAME[seg] ?? seg);
  }, [path]);

  // «تجربة ما خلصت»: لو انقطعت تجربة (التطبيق طلع / الجوال طلع من شبكة الراوتر) نرجّع إعداد الراوتر اللي كان قبلها
  useEffect(() => {
    const go = () => {
      import('../src/services/pendingRecovery').then(m => m.runPendingRecovery()).catch(() => {})
        // «وضع المباراة» خلص وقته ← نرجّع النت للأجهزة اللي وقّفناها
        .then(() => import('../src/services/gameBoost')).then(m => m?.recoverMatches())
        .then(msg => { if (msg) Alert.alert('✓ رجّعنا النت', msg); })
        // «ثبّت للعب» خلص وقته أو النت طاح عليه ← نرجّع إعداد العضو
        .then(() => import('../src/services/gameLockGuard')).then(m => m?.runGameLockRecovery())
        .then(msg => { if (msg) Alert.alert('🎮 رجّعنا إعدادك', msg); }).catch(() => {});
    };
    const t = setTimeout(go, 6000);
    const sub = AppState.addEventListener('change', st => { if (st === 'active') setTimeout(go, 3000); });
    return () => { clearTimeout(t); sub.remove(); };
  }, []);

  useEffect(() => {
    if (loaded || error) {
      try { applyGlobalFont(); } catch {}
      SplashScreen.hideAsync().catch(() => {});
      pingDaily();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
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
        {SCREENS.map(([name, ar]) => {
          const title = tr(ar); // بالإنجليزي: عنوان الشريط العلوي
          return (
          <Stack.Screen
            key={name}
            name={name}
            options={
              name === 'index' || NO_HEADER.has(name)
                ? { title, headerShown: false } // الرئيسية لها عنوانها الخاص داخل الصفحة
                : OWN_TITLE.has(name)
                  ? { title, headerTitle: '' } // الصفحة تعرض عنوانها بنفسها — نخلي زر الرجوع بس
                  : { title }
            }
          />
          );
        })}
      </Stack>
      <UpdateBanner />
      <OpPill />
      <ProgressHost />
    </>
  );
}
