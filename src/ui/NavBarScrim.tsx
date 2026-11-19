/**
 * خلفية ثابتة تحت شريط أزرار أندرويد (رجوع · الرئيسية · الأخيرة).
 *
 * أندرويد ١٥ (targetSdk 35+) يفرض edge-to-edge: التطبيق يرسم لين تحت شريط النظام،
 * والشريط شفاف ← آخر البطاقات يبان نصها مغطّى تحت الأزرار وهي تمرّ تحته.
 * نرسم مستطيل بلون خلفية التطبيق بارتفاع الشريط نفسه (insets.bottom) فوق كل الشاشات،
 * فالمحتوى يختفي قبل ما يوصل الأزرار. ما يلقط اللمس (pointerEvents none).
 * الآيفون والويندوز ما يتغيّر عليهم شي.
 */
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './theme';

export function NavBarScrim() {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'android' || !insets.bottom) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: insets.bottom, backgroundColor: C.bg,
      }}
    />
  );
}
