import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  G, Path, Circle, Line, Text as SvgText, Defs,
  RadialGradient, LinearGradient as SvgLinearGradient, Stop,
} from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from './theme';

interface Props {
  score: number;
  label: string;
  sub?: string;
  size?: number;
  active?: boolean;
}

function stageColors(v: number): { main: string; deep: string; soft: string; bg: [string, string]; glow: string; needle: string } {
  if (v >= 0.72) return { main: '#fbbf24', deep: '#b45309', soft: '#fef3c7', bg: ['#fffbeb', '#fef3c7'], glow: '#fcd34d', needle: '#dc2626' };
  if (v >= 0.45) return { main: '#34d399', deep: '#047857', soft: '#d1fae5', bg: ['#f0fdf4', '#d1fae5'], glow: '#6ee7b7', needle: '#dc2626' };
  if (v >= 0.25) return { main: '#fb923c', deep: '#c2410c', soft: '#ffedd5', bg: ['#fff7ed', '#fed7aa'], glow: '#fdba74', needle: '#dc2626' };
  return { main: '#f87171', deep: '#b91c1c', soft: '#fee2e2', bg: ['#fef2f2', '#fecaca'], glow: '#fca5a5', needle: '#dc2626' };
}

const MIN_ANGLE = -135;
const MAX_ANGLE = 135;
const TICKS_TOTAL = 60;
const MAJOR_EVERY = 10;

export function AimDish({ score, label, sub, size = 260, active = true }: Props) {
  const val = Math.max(0, Math.min(1, score));
  const targetAngle = MIN_ANGLE + val * (MAX_ANGLE - MIN_ANGLE);
  const [shownAngle, setShownAngle] = useState(targetAngle);
  const shownRef = useRef(targetAngle);
  const targetRef = useRef(targetAngle);

  useEffect(() => { targetRef.current = targetAngle; }, [targetAngle]);

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      const current = shownRef.current;
      const target = targetRef.current;
      const diff = target - current;
      if (Math.abs(diff) < 0.3) { shownRef.current = target; setShownAngle(target); return; }
      const next = current + diff * 0.15;
      shownRef.current = next;
      setShownAngle(next);
    }, 40);
    return () => clearInterval(iv);
  }, [active]);

  const cols = stageColors(val);
  const cardSize = size + 40;
  const cx = 50;
  const cy = 55;
  const rOuter = 42;
  const rBezelOuter = 47;
  const rInner = 34;
  const rTickStart = 38;
  const rTickEnd = 42;

  return (
    <View style={{ alignItems: 'center' }}>
      <LinearGradient
        colors={cols.bg}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.card, { width: cardSize, height: cardSize, borderRadius: cardSize / 2 }]}
      >
        {/* هالة بلون المرحلة */}
        <View
          style={{
            position: 'absolute',
            width: size * 1.02,
            height: size * 1.02,
            borderRadius: size * 1.02 / 2,
            backgroundColor: cols.glow,
            opacity: 0.14 + val * 0.22,
          }}
        />

        <View style={{ width: size, height: size }}>
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <Defs>
              {/* معدن الحلقة الخارجية — تدرج رمادي يعطي إحساس معدن */}
              <SvgLinearGradient id="bezel" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor="#ffffff" />
                <Stop offset="20%" stopColor="#e5e7eb" />
                <Stop offset="45%" stopColor="#9ca3af" />
                <Stop offset="55%" stopColor="#6b7280" />
                <Stop offset="80%" stopColor="#9ca3af" />
                <Stop offset="100%" stopColor="#374151" />
              </SvgLinearGradient>

              {/* داخلية العداد — عمق غائر */}
              <RadialGradient id="dialInset" cx="50%" cy="35%" r="75%">
                <Stop offset="0%" stopColor="#1f2937" stopOpacity="0.35" />
                <Stop offset="45%" stopColor="#ffffff" stopOpacity="1" />
                <Stop offset="100%" stopColor="#f3f4f6" stopOpacity="1" />
              </RadialGradient>

              {/* زجاج فوق العداد (لمعة) */}
              <SvgLinearGradient id="glass" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
                <Stop offset="35%" stopColor="#ffffff" stopOpacity="0.1" />
                <Stop offset="70%" stopColor="#ffffff" stopOpacity="0" />
                <Stop offset="100%" stopColor="#000000" stopOpacity="0.08" />
              </SvgLinearGradient>

              {/* مركز الإبرة — كرة 3D */}
              <RadialGradient id="hub3d" cx="35%" cy="30%" r="70%">
                <Stop offset="0%" stopColor="#ffffff" />
                <Stop offset="40%" stopColor="#e5e7eb" />
                <Stop offset="80%" stopColor="#4b5563" />
                <Stop offset="100%" stopColor="#1f2937" />
              </RadialGradient>

              {/* ظل داخلي للحلقة */}
              <RadialGradient id="shadowIn" cx="50%" cy="50%" r="50%">
                <Stop offset="70%" stopColor="#000000" stopOpacity="0" />
                <Stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
              </RadialGradient>
            </Defs>

            {/* ─── ظل خارجي دائري ─── */}
            <Circle cx={cx} cy={cy + 1} r={rBezelOuter} fill="#000000" opacity={0.15} />

            {/* ─── الحلقة المعدنية الخارجية (3 rings) ─── */}
            <Circle cx={cx} cy={cy} r={rBezelOuter} fill="url(#bezel)" />
            <Circle cx={cx} cy={cy} r={rBezelOuter - 1.5} fill="#f3f4f6" />
            <Circle cx={cx} cy={cy} r={rBezelOuter - 2.5} fill="url(#bezel)" opacity={0.4} />

            {/* ─── قرص العداد الغائر ─── */}
            <Circle cx={cx} cy={cy} r={rOuter + 2} fill="url(#dialInset)" />
            {/* ظل داخلي على الحافة (يخليها تبدو غائرة) */}
            <Circle cx={cx} cy={cy} r={rOuter + 2} fill="url(#shadowIn)" />

            {/* ─── قوس التقدم (المسار كامل باهت + القوس الملون) ─── */}
            <Path
              d={describeArc(cx, cy, rOuter, MIN_ANGLE, MAX_ANGLE)}
              stroke="#d1d5db"
              strokeWidth={1.2}
              fill="none"
              strokeLinecap="round"
              opacity={0.7}
            />
            {/* القوس الملون مع ظل خفيف */}
            <Path
              d={describeArc(cx, cy, rOuter, MIN_ANGLE, shownAngle)}
              stroke={cols.deep}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              opacity={0.3}
            />
            <Path
              d={describeArc(cx, cy, rOuter, MIN_ANGLE, shownAngle)}
              stroke={cols.main}
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
            />

            {/* ─── نقاط الحدود (بداية/نهاية) ─── */}
            <Circle cx={polarX(cx, rOuter, MIN_ANGLE)} cy={polarY(cy, rOuter, MIN_ANGLE)} r={1.6} fill="#dc2626" />
            <Circle cx={polarX(cx, rOuter, MAX_ANGLE)} cy={polarY(cy, rOuter, MAX_ANGLE)} r={1.6} fill="#16a34a" />

            {/* ─── 60 شرطة دقيقة مع ظل ─── */}
            {Array.from({ length: TICKS_TOTAL + 1 }, (_, i) => {
              const ang = MIN_ANGLE + (i / TICKS_TOTAL) * (MAX_ANGLE - MIN_ANGLE);
              const isMajor = i % MAJOR_EVERY === 0;
              const r1 = isMajor ? rTickStart - 1.5 : rTickStart;
              const r2 = rTickEnd;
              const rad = (ang * Math.PI) / 180;
              const x1 = cx + Math.sin(rad) * r1;
              const y1 = cy - Math.cos(rad) * r1;
              const x2 = cx + Math.sin(rad) * r2;
              const y2 = cy - Math.cos(rad) * r2;
              const isActive = ang <= shownAngle;
              const strokeColor = isMajor
                ? (isActive ? cols.deep : '#4b5563')
                : (isActive ? cols.main : '#9ca3af');
              return (
                <G key={i}>
                  {/* ظل صغير للشرطة */}
                  <Line
                    x1={x1 + 0.15} y1={y1 + 0.2} x2={x2 + 0.15} y2={y2 + 0.2}
                    stroke="#000000"
                    strokeWidth={isMajor ? 1 : 0.35}
                    opacity={0.15}
                    strokeLinecap="round"
                  />
                  <Line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={strokeColor}
                    strokeWidth={isMajor ? 1 : 0.35}
                    opacity={isActive ? 1 : (isMajor ? 0.75 : 0.55)}
                    strokeLinecap="round"
                  />
                </G>
              );
            })}

            {/* ─── أرقام القياس ─── */}
            {[0, 25, 50, 75, 100].map(pct => {
              const ang = MIN_ANGLE + (pct / 100) * (MAX_ANGLE - MIN_ANGLE);
              const rad = (ang * Math.PI) / 180;
              const r = rInner - 3;
              const x = cx + Math.sin(rad) * r;
              const y = cy - Math.cos(rad) * r;
              return (
                <G key={pct}>
                  <SvgText
                    x={x + 0.3} y={y + 1.8} fontSize={3.3}
                    fontWeight="800" fill="#000000" opacity={0.15}
                    textAnchor="middle"
                  >{pct}</SvgText>
                  <SvgText
                    x={x} y={y + 1.5} fontSize={3.2}
                    fontWeight="800" fill={cols.deep}
                    textAnchor="middle" opacity={0.75}
                  >{pct}</SvgText>
                </G>
              );
            })}

            {/* ─── الإبرة 3D ─── */}
            <G rotation={shownAngle} origin={`${cx}, ${cy}`}>
              {/* ظل الإبرة على القرص */}
              <Path
                d={`M ${cx - 1.4 + 0.4} ${cy + 0.5} L ${cx + 0.4} ${cy - 31.5} L ${cx + 1.4 + 0.4} ${cy + 0.5} Z`}
                fill="#000000"
                opacity={0.18}
              />
              {/* ذيل الإبرة */}
              <Path
                d={`M ${cx} ${cy + 7} L ${cx - 1.4} ${cy} L ${cx + 1.4} ${cy} Z`}
                fill="#1f2937"
              />
              <Path
                d={`M ${cx - 0.6} ${cy + 6} L ${cx - 0.9} ${cy} L ${cx} ${cy} Z`}
                fill="#4b5563"
                opacity={0.7}
              />
              {/* جسم الإبرة (تدرج من أحمر → أحمر غامق) */}
              <Path
                d={`M ${cx - 1.5} ${cy} L ${cx} ${cy - 32} L ${cx + 1.5} ${cy} Z`}
                fill="#dc2626"
              />
              {/* لمعة يسار الإبرة */}
              <Path
                d={`M ${cx - 1.4} ${cy} L ${cx - 0.2} ${cy - 30} L ${cx + 0.2} ${cy - 30} L ${cx + 0.5} ${cy} Z`}
                fill="#fca5a5"
                opacity={0.9}
              />
              {/* حافة داكنة يمين الإبرة */}
              <Path
                d={`M ${cx + 0.7} ${cy} L ${cx + 0.3} ${cy - 30} L ${cx + 1.4} ${cy - 30} L ${cx + 1.5} ${cy} Z`}
                fill="#7f1d1d"
                opacity={0.6}
              />
              {/* رأس الإبرة (كبسولة بيضاء صغيرة) */}
              <Circle cx={cx} cy={cy - 31} r={1.4} fill="#ffffff" opacity={0.9} />
            </G>

            {/* ─── مركز الإبرة 3D ─── */}
            <Circle cx={cx} cy={cy + 0.6} r={5} fill="#000000" opacity={0.25} />
            <Circle cx={cx} cy={cy} r={4.6} fill="url(#hub3d)" />
            <Circle cx={cx} cy={cy} r={4.6} stroke="#1f2937" strokeWidth={0.3} fill="none" opacity={0.7} />
            <Circle cx={cx} cy={cy} r={2} fill="#1f2937" />
            <Circle cx={cx - 1.2} cy={cy - 1.2} r={0.8} fill="#ffffff" opacity={0.85} />

            {/* ─── الزجاج فوق كل شي (لمعة علوية) ─── */}
            <Path
              d={describeGlassArc(cx, cy, rOuter)}
              fill="url(#glass)"
              opacity={0.75}
            />
          </Svg>

          {/* الرقم أسفل المركز */}
          <View style={s.centerOverlay}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start', marginTop: size * 0.34 }}>
              <Text style={[s.pct, { color: cols.deep, fontSize: size * 0.17, textShadowColor: 'rgba(255,255,255,0.8)', textShadowRadius: 1, textShadowOffset: { width: 0.5, height: 0.5 } }]}>
                {Math.round(val * 100)}
              </Text>
              <Text style={[s.pctSign, { fontSize: size * 0.07, marginTop: size * 0.025 }]}>٪</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* التسمية + sub */}
      <View style={s.textBox}>
        <View style={[s.labelChip, { backgroundColor: cols.soft }]}>
          <Text style={[s.label, { color: cols.deep, fontSize: 15 }]}>{label}</Text>
        </View>
        {!!sub && <Text style={s.sub}>{sub}</Text>}
      </View>
    </View>
  );
}

function polarX(cx: number, r: number, angleDeg: number): number {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return cx + r * Math.cos(rad);
}
function polarY(cy: number, r: number, angleDeg: number): number {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return cy + r * Math.sin(rad);
}

function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

/** قوس الزجاج — قمة الدائرة فقط */
function describeGlassArc(cx: number, cy: number, r: number): string {
  const start = polar(cx, cy, r, -130);
  const end = polar(cx, cy, r, 130);
  return `M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y} Z`;
}

const s = StyleSheet.create({
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0d2350',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pct: { fontWeight: '900', letterSpacing: -1.5 },
  pctSign: { color: C.muted, fontWeight: '800' },
  textBox: { alignItems: 'center', marginTop: 12 },
  labelChip: { paddingHorizontal: 16, paddingVertical: 5, borderRadius: 999 },
  label: { fontWeight: '900' },
  sub: { color: C.sub, fontWeight: '700', marginTop: 8, fontSize: 13 },
});
