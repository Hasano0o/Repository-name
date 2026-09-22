import { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import Svg, {
  Circle, Path, Line, Ellipse, Rect, G, Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient as SvgRadialGradient,
  Stop,
} from 'react-native-svg';

interface Props {
  color: string;        // لون الإشارة (أخضر/برتقالي/أحمر)
  active?: boolean;     // تشغيل نبض الموجات
  width?: number;
  height?: number;
}

/**
 * صورة أنتنا نصف واقعية (SVG) — طبق + LNB + عمود + سماء + موجات.
 * التصميم مستوحى من صور منتج احترافية، لكن مرسوم بالكود.
 */
export function AntennaHero({ color, active = true, width = 180, height = 230 }: Props) {
  // نبض موجات الإشارة
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const waveOpacity = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.9, 0.4, 0],
  });
  const waveScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1.4],
  });

  const vw = 160;
  const vh = 220;

  return (
    <View style={[s.wrap, { width, height }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${vw} ${vh}`}>
        <Defs>
          {/* سماء متدرجة */}
          <SvgLinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#BCDEFF" />
            <Stop offset="40%" stopColor="#D6EAFF" />
            <Stop offset="75%" stopColor="#EAF4FF" />
            <Stop offset="100%" stopColor="#F6FAFF" />
          </SvgLinearGradient>

          {/* معدن الصحن (تدرج قطري) */}
          <SvgRadialGradient id="dishMetal" cx="35%" cy="30%" r="80%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <Stop offset="30%" stopColor="#F1F5F9" />
            <Stop offset="65%" stopColor="#CBD5E1" />
            <Stop offset="100%" stopColor="#94A3B8" />
          </SvgRadialGradient>

          {/* الوجه الأمامي للصحن (لون فاتح، يعكس السماء) */}
          <SvgRadialGradient id="dishFace" cx="40%" cy="35%" r="75%">
            <Stop offset="0%" stopColor="#FFFFFF" />
            <Stop offset="55%" stopColor="#EEF5FF" />
            <Stop offset="100%" stopColor="#D5E3F5" />
          </SvgRadialGradient>

          {/* حافة لامعة */}
          <SvgLinearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#FFFFFF" />
            <Stop offset="50%" stopColor="#E2E8F0" />
            <Stop offset="100%" stopColor="#94A3B8" />
          </SvgLinearGradient>

          {/* عمود معدني */}
          <SvgLinearGradient id="pole" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#94A3B8" />
            <Stop offset="35%" stopColor="#E2E8F0" />
            <Stop offset="65%" stopColor="#CBD5E1" />
            <Stop offset="100%" stopColor="#64748B" />
          </SvgLinearGradient>

          {/* قاعدة */}
          <SvgLinearGradient id="base" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#94A3B8" />
            <Stop offset="100%" stopColor="#475569" />
          </SvgLinearGradient>

          {/* LNB */}
          <SvgRadialGradient id="lnb" cx="35%" cy="30%" r="70%">
            <Stop offset="0%" stopColor="#FFFFFF" />
            <Stop offset="50%" stopColor="#E2E8F0" />
            <Stop offset="100%" stopColor="#64748B" />
          </SvgRadialGradient>
        </Defs>

        {/* ═══ الخلفية: سماء + جبال ═══ */}
        <Rect x={0} y={0} width={vw} height={vh} fill="url(#sky)" />

        {/* سحاب خفيف */}
        <Ellipse cx={40} cy={40} rx={22} ry={10} fill="#FFFFFF" opacity={0.6} />
        <Ellipse cx={58} cy={42} rx={14} ry={7} fill="#FFFFFF" opacity={0.5} />
        <Ellipse cx={130} cy={30} rx={16} ry={7} fill="#FFFFFF" opacity={0.55} />

        {/* جبال خلفية */}
        <Path
          d="M 0 175 L 30 145 L 55 165 L 85 135 L 115 160 L 145 140 L 160 155 L 160 220 L 0 220 Z"
          fill="#C8D9EC"
          opacity={0.7}
        />
        <Path
          d="M 0 190 L 35 165 L 70 185 L 105 165 L 140 180 L 160 170 L 160 220 L 0 220 Z"
          fill="#B0C6DB"
          opacity={0.6}
        />

        {/* ═══ موجات الإشارة (تتحرك) ═══ */}
        {active && (
          <G>
            <Animated.View style={[s.waveWrap, {
              opacity: waveOpacity,
              transform: [{ scale: waveScale }],
            }]}>
              <Svg width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`}>
                <Path
                  d="M 100 90 Q 130 90 130 115"
                  stroke={color} strokeWidth={2.5} fill="none"
                  opacity={0.6} strokeLinecap="round"
                />
                <Path
                  d="M 100 78 Q 145 78 145 115"
                  stroke={color} strokeWidth={2} fill="none"
                  opacity={0.4} strokeLinecap="round"
                />
                <Path
                  d="M 100 66 Q 160 66 160 115"
                  stroke={color} strokeWidth={1.5} fill="none"
                  opacity={0.25} strokeLinecap="round"
                />
              </Svg>
            </Animated.View>
          </G>
        )}

        {/* ═══ العمود الأرضي ═══ */}
        <Rect x={68} y={148} width={8} height={60} fill="url(#pole)" />

        {/* ═══ القاعدة ═══ */}
        <Ellipse cx={72} cy={210} rx={22} ry={4} fill="#334155" opacity={0.2} />
        <Rect x={52} y={206} width={40} height={6} rx={2} fill="url(#base)" />

        {/* ═══ مشبك التوصيل ═══ */}
        <Path d="M 66 140 L 78 140 L 78 158 L 66 158 Z" fill="#64748B" />
        <Circle cx={72} cy={149} r={2.5} fill="#334155" />

        {/* ═══ الصحن الطبق (منظور 3D مائل) ═══ */}
        <G rotation={-8} origin="60, 90">
          {/* الظل تحت الصحن */}
          <Ellipse cx={58} cy={90} rx={48} ry={54} fill="#94A3B8" opacity={0.25} />

          {/* الحافة الخلفية (معدنية داكنة) */}
          <Ellipse cx={58} cy={88} rx={46} ry={52} fill="url(#rim)" />

          {/* الوجه الأمامي للصحن (بيضاوي، مفتوح للأمام) */}
          <Ellipse cx={58} cy={86} rx={43} ry={49} fill="url(#dishFace)" />

          {/* خطوط الهيكل الخفيفة على السطح */}
          <Ellipse cx={58} cy={86} rx={30} ry={36} fill="none" stroke="#E2E8F0" strokeWidth={0.6} opacity={0.7} />
          <Ellipse cx={58} cy={86} rx={16} ry={20} fill="none" stroke="#E2E8F0" strokeWidth={0.6} opacity={0.7} />

          {/* لمعة العلوية (انعكاس ضوء) */}
          <Ellipse cx={46} cy={62} rx={18} ry={22} fill="#FFFFFF" opacity={0.5} />

          {/* حافة أمامية لامعة (كأنها معدن) */}
          <Ellipse cx={58} cy={86} rx={43} ry={49} fill="none" stroke="#FFFFFF" strokeWidth={1.4} opacity={0.65} />

          {/* البراغي حول الحافة */}
          {Array.from({ length: 8 }, (_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const x = 58 + Math.cos(angle) * 40;
            const y = 86 + Math.sin(angle) * 46;
            return (
              <G key={i}>
                <Circle cx={x} cy={y} r={2.2} fill="#94A3B8" />
                <Circle cx={x} cy={y} r={1} fill="#475569" />
              </G>
            );
          })}
        </G>

        {/* ═══ ذراع LNB ═══ */}
        <G rotation={-8} origin="60, 90">
          {/* الذراع (من مركز الصحن لجهة اليمين-أسفل) */}
          <Path
            d="M 58 86 L 118 60"
            stroke="#94A3B8" strokeWidth={3} strokeLinecap="round"
          />
          <Path
            d="M 58 86 L 118 60"
            stroke="#CBD5E1" strokeWidth={1.5} strokeLinecap="round"
          />

          {/* رأس LNB (بيضاوي، في طرف الذراع) */}
          <Ellipse cx={122} cy={58} rx={10} ry={7} fill="#334155" opacity={0.3} />
          <Ellipse cx={120} cy={56} rx={10} ry={7} fill="url(#lnb)" />
          <Ellipse cx={120} cy={56} rx={10} ry={7} fill="none" stroke="#FFFFFF" strokeWidth={0.6} opacity={0.6} />
          {/* لمعة علوية على LNB */}
          <Ellipse cx={117} cy={53} rx={3.5} ry={2} fill="#FFFFFF" opacity={0.8} />

          {/* نقطة الإشارة (LED أخضر) */}
          <Circle cx={120} cy={56} r={2.4} fill={color} />
          <Circle cx={120} cy={56} r={5} fill={color} opacity={0.3} />
        </G>
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
