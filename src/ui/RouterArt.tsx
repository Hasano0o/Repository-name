/**
 * رسمة الراوتر في ترويسة صفحة القراءة (طلب حسن ٢٨ نوفمبر: بدل أيقونة الواي فاي، رسمة ثابتة حسب نوع الجهاز).
 * رسومات من عندنا (SVG) بدون شعارات ولا أسماء شركات:
 *  • cpe — راوتر بيت اسطواني حديث (هواوي)
 *  • box — راوتر عام بأنتنتين (باقي الماركات)
 * ZTE يبقى على صورته (router-mifi.png).
 */
import Svg, { Rect, Path, Circle, Defs, LinearGradient as SvgGrad, Stop, Ellipse } from 'react-native-svg';
import { isDark } from './theme';

export type RouterArtKind = 'mifi' | 'cpe' | 'box';

/** نوع الرسمة من الدرايفر — ثابت لكل ماركة */
export function routerArtKind(driverId?: string): RouterArtKind {
  const id = (driverId || '').toLowerCase();
  if (id === 'zte') return 'mifi';
  if (id.startsWith('huawei') || id === 'hwgw') return 'cpe';
  return 'box';
}

const SHADOW = isDark ? '#00000066' : '#0f172a22';

/** راوتر بيت اسطواني حديث (طلب حسن ٢٨ نوفمبر): جسم أبيض بتظليل دائري · غطاء علوي شبكي · حلقة نور زرقاء تحت · نقطة حالة */
export function CpeArt({ width = 74, height = 56 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 74 56" accessibilityLabel="راوتر">
      <Defs>
        <SvgGrad id="cylBody" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#c7cfdb" />
          <Stop offset="0.22" stopColor="#f4f6fa" />
          <Stop offset="0.45" stopColor="#ffffff" />
          <Stop offset="0.8" stopColor="#dde3ec" />
          <Stop offset="1" stopColor="#b3bccb" />
        </SvgGrad>
        <SvgGrad id="cylTop" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#5b6577" />
          <Stop offset="1" stopColor="#2b3242" />
        </SvgGrad>
        <SvgGrad id="cylGlow" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#2f6bff" stopOpacity={0.35} />
          <Stop offset="0.5" stopColor="#38bdf8" />
          <Stop offset="1" stopColor="#2f6bff" stopOpacity={0.35} />
        </SvgGrad>
      </Defs>
      <Ellipse cx={37} cy={52.6} rx={17} ry={2.6} fill={SHADOW} />
      {/* الجسم */}
      <Path d="M23 8.5 L23 47.5 A14 3.6 0 0 0 51 47.5 L51 8.5 Z" fill="url(#cylBody)" />
      {/* الغطاء العلوي (شبكي) */}
      <Ellipse cx={37} cy={8.5} rx={14} ry={3.6} fill="url(#cylTop)" />
      <Ellipse cx={37} cy={8.5} rx={11.5} ry={2.6} fill="none" stroke="#7b8596" strokeWidth={0.5} strokeDasharray="0.9 1.2" />
      <Ellipse cx={37} cy={8.5} rx={8} ry={1.7} fill="none" stroke="#7b8596" strokeWidth={0.5} strokeDasharray="0.9 1.2" />
      {/* حلقة النور */}
      <Path d="M23 40.5 A14 3.6 0 0 0 51 40.5 L51 42.3 A14 3.6 0 0 1 23 42.3 Z" fill="url(#cylGlow)" />
      {/* لمعة طولية */}
      <Rect x={30} y={13} width={2.2} height={24} rx={1.1} fill="#ffffff" opacity={0.85} />
      {/* نقطة الحالة */}
      <Circle cx={37} cy={17} r={1.4} fill="#22c55e" />
    </Svg>
  );
}

/** راوتر عام: صندوق عرضي بأنتنتين وأنوار */
export function BoxArt({ width = 74, height = 56 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 74 56" accessibilityLabel="راوتر">
      <Defs>
        <SvgGrad id="boxTop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="1" stopColor="#e3e8ef" />
        </SvgGrad>
      </Defs>
      <Ellipse cx={37} cy={50.5} rx={27} ry={2.8} fill={SHADOW} />
      {/* الأنتنات */}
      <Rect x={16} y={5} width={4} height={26} rx={2} fill="#dfe5ee" stroke="#c3ccd8" strokeWidth={0.8} transform="rotate(-10 18 31)" />
      <Rect x={54} y={5} width={4} height={26} rx={2} fill="#dfe5ee" stroke="#c3ccd8" strokeWidth={0.8} transform="rotate(10 56 31)" />
      {/* الجسم */}
      <Rect x={9} y={28} width={56} height={20} rx={6} fill="url(#boxTop)" stroke="#c9d1dc" strokeWidth={0.8} />
      <Rect x={9} y={41} width={56} height={7} rx={3.5} fill="#cfd6e0" opacity={0.7} />
      <Rect x={13} y={30.5} width={48} height={2.2} rx={1.1} fill="#ffffff" opacity={0.9} />
      {/* الأنوار */}
      <Circle cx={26} cy={37} r={1.4} fill="#22c55e" />
      <Circle cx={32} cy={37} r={1.4} fill="#38bdf8" />
      <Circle cx={38} cy={37} r={1.4} fill="#38bdf8" />
      <Circle cx={44} cy={37} r={1.4} fill="#38bdf8" opacity={0.55} />
      <Circle cx={50} cy={37} r={1.4} fill="#38bdf8" opacity={0.55} />
    </Svg>
  );
}
