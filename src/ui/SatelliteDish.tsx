import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { isDark } from './theme';

/* ═══ رسمة دش أصلية (ملك Bandly) — معدنية مع موجات إشارة ═══ */
export function SatelliteDish({ size = 64, wave = '#7655F5' }: { size?: number; wave?: string }) {
  const metal = isDark ? ['#c9d2df', '#8d99ae', '#5d6a80'] : ['#ffffff', '#d5dce6', '#9aa6b8'];
  const inner = isDark ? ['#a7b2c3', '#6f7c92'] : ['#eef2f7', '#b9c3d1'];
  const dark = isDark ? '#4a566b' : '#7d899c';
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="dishBowl" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={metal[0]} />
          <Stop offset="0.55" stopColor={metal[1]} />
          <Stop offset="1" stopColor={metal[2]} />
        </LinearGradient>
        <LinearGradient id="dishInner" x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={inner[0]} />
          <Stop offset="1" stopColor={inner[1]} />
        </LinearGradient>
        <LinearGradient id="dishPole" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#8b97aa" />
          <Stop offset="0.5" stopColor={isDark ? '#b9c3d1' : '#e3e8ef'} />
          <Stop offset="1" stopColor="#7d899c" />
        </LinearGradient>
      </Defs>
      <Ellipse cx={34} cy={58} rx={13} ry={2.6} fill="#000000" fillOpacity={isDark ? 0.3 : 0.12} />
      <Path d="M28 57 L31.5 38 L35.5 38 L40 57 Z" fill="url(#dishPole)" />
      <Rect x={25} y={55.5} width={18} height={3.4} rx={1.7} fill={dark} />
      <G transform="rotate(-38 25 29)">
        <Ellipse cx={25} cy={29} rx={21} ry={12.5} fill="url(#dishBowl)" stroke="#8c98ab" strokeWidth={0.8} />
        <Ellipse cx={25.8} cy={28.2} rx={17.5} ry={9.6} fill="url(#dishInner)" />
      </G>
      <Line x1={26} y1={28.5} x2={41} y2={15} stroke="#6b778b" strokeWidth={2} strokeLinecap="round" />
      <Rect x={38.5} y={10.5} width={7} height={5.5} rx={1.8} transform="rotate(-38 42 13)" fill="#3567F5" />
      <Circle cx={26} cy={28.5} r={1.6} fill="#6b778b" />
      <Path d="M49 9.5 a6 6 0 0 1 4 4" stroke={wave} strokeWidth={2} strokeLinecap="round" fill="none" />
      <Path d="M50 4.5 a11 11 0 0 1 8.5 8.5" stroke={wave} strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" fill="none" />
    </Svg>
  );
}
