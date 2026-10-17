import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { View } from '../i18n/rn';
import { C } from './theme';

/* ═══ مؤشر إشارة صغير (عدّاد بإبرة) ═══
 * قوس ٢٤٠° خفيف، الجزء الملوّن لحد القراءة بلون التقييم، شرطات ناعمة،
 * وإبرة رفيعة بمركز ملوّن. بدون أرقام على القوس — الرقم يُكتب تحت المؤشر.
 */

const START = 150; // أسفل اليسار
const SWEEP = 240; // لين أسفل اليمين

const rad = (d: number) => (d * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) => ({
  x: cx + r * Math.cos(rad(deg)),
  y: cy + r * Math.sin(rad(deg)),
});

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = pt(cx, cy, r, from);
  const b = pt(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function SignalGauge({ ratio, color, size = 120, has = true }: {
  /** ٠ = أضعف، ١ = أقوى */
  ratio: number;
  color: string;
  size?: number;
  /** فيه قراءة؟ لو لا: القوس فاضي وما فيه إبرة */
  has?: boolean;
}) {
  const f = Math.max(0, Math.min(1, has ? ratio : 0));
  const stroke = Math.round(size * 0.075);
  const r = size / 2 - stroke / 2 - 2;
  const cx = size / 2;
  const cy = r + stroke / 2 + 2;
  const h = Math.ceil(cy + r * Math.sin(rad(30)) + stroke / 2 + 4);
  const valAng = START + SWEEP * f;
  const tip = pt(cx, cy, r - stroke - 4, valAng);
  const gid = `g${Math.round(size)}${color.replace(/[^0-9a-z]/gi, '')}`;

  return (
    <View style={{ width: size, height: h, alignSelf: 'center' }}>
      <Svg width={size} height={h}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={0.45} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>

        {/* المسار */}
        <Path d={arc(cx, cy, r, START, START + SWEEP)} stroke={C.track} strokeOpacity={0.55}
          strokeWidth={stroke} strokeLinecap="round" fill="none" />

        {/* الجزء المعبّى */}
        {has && f > 0.005 && (
          <Path d={arc(cx, cy, r, START, valAng)} stroke={`url(#${gid})`}
            strokeWidth={stroke} strokeLinecap="round" fill="none" />
        )}

        {/* شرطات خفيفة داخل القوس */}
        {Array.from({ length: 9 }, (_, i) => {
          const a = START + (SWEEP / 8) * i;
          const p1 = pt(cx, cy, r - stroke / 2 - 3, a);
          const p2 = pt(cx, cy, r - stroke / 2 - (i % 2 === 0 ? 8 : 6), a);
          return <Line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
            stroke={C.sub} strokeOpacity={i % 2 === 0 ? 0.45 : 0.25} strokeWidth={1.4} strokeLinecap="round" />;
        })}

        {/* الإبرة */}
        {has && (
          <>
            <Line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={C.text} strokeWidth={2.4} strokeLinecap="round" />
            <Circle cx={cx} cy={cy} r={size * 0.075} fill={color} fillOpacity={0.22} />
            <Circle cx={cx} cy={cy} r={size * 0.045} fill={color} />
            <Circle cx={cx} cy={cy} r={size * 0.018} fill="#ffffff" />
          </>
        )}
      </Svg>
    </View>
  );
}
