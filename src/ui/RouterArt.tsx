/**
 * رسمة الراوتر في ترويسة صفحة القراءة (طلب حسن ٢٨ نوفمبر: بدل أيقونة الواي فاي، رسمة ثابتة حسب نوع الجهاز).
 * رسومات من عندنا (SVG) بدون شعارات ولا أسماء شركات:
 *  • cpe — راوتر بيت واقف (شكل هواوي 4G/5G: صندوق أبيض طويل + عمود أنوار)
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

/** راوتر بيت واقف: وجه أبيض + جنب رمادي + عمود أنوار زرقاء + أعمدة إشارة */
export function CpeArt({ width = 74, height = 56 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 74 56" accessibilityLabel="راوتر">
      <Defs>
        <SvgGrad id="cpeFront" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="1" stopColor="#e6ebf2" />
        </SvgGrad>
        <SvgGrad id="cpeSide" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#cfd6e0" />
          <Stop offset="1" stopColor="#aeb7c4" />
        </SvgGrad>
      </Defs>
      <Ellipse cx={37} cy={52.5} rx={20} ry={2.6} fill={SHADOW} />
      {/* الجنب */}
      <Path d="M45 6.5 L52 9.5 L52 48.5 L45 51 Z" fill="url(#cpeSide)" />
      {/* الوجه */}
      <Rect x={22} y={4} width={24} height={47.5} rx={5} fill="url(#cpeFront)" stroke="#c9d1dc" strokeWidth={0.8} />
      {/* لمعة */}
      <Rect x={24.5} y={6.5} width={3} height={41} rx={1.5} fill="#ffffff" opacity={0.9} />
      {/* عمود الأنوار */}
      <Rect x={31} y={11} width={6} height={26} rx={3} fill="#0f172a" opacity={0.9} />
      <Circle cx={34} cy={15} r={1.3} fill="#38bdf8" />
      <Circle cx={34} cy={20} r={1.3} fill="#38bdf8" />
      <Circle cx={34} cy={25} r={1.3} fill="#22c55e" />
      <Circle cx={34} cy={30} r={1.3} fill="#38bdf8" opacity={0.55} />
      {/* أعمدة الإشارة */}
      <Rect x={30} y={42} width={1.8} height={3} rx={0.6} fill="#2f6bff" />
      <Rect x={32.6} y={40.5} width={1.8} height={4.5} rx={0.6} fill="#2f6bff" />
      <Rect x={35.2} y={39} width={1.8} height={6} rx={0.6} fill="#2f6bff" />
      <Rect x={37.8} y={37.5} width={1.8} height={7.5} rx={0.6} fill="#93b4ff" />
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
