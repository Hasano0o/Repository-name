/**
 * ترويسة الرئيسية: دائرة جودة الاتصال (أفضل راوتر) + سطر الحالة + شارات المشغّل والتقنية والترددات.
 * لون الدائرة وكلمة الجودة يتغيّرون حسب المستوى.
 */
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { Icon } from './Icon';
import { FONT } from './fonts';
import type { Level } from '../utils/signal';

export type HeaderTone = Level | 'down';

export interface HeaderChip { text: string; tone?: 'blue' | 'violet' | 'red' | 'green' }

export interface HomeHeaderProps {
  /** ٠–١ */
  score: number;
  tone: HeaderTone;
  loading: boolean;
  /** «اتصالك» */
  lead: string;
  /** الكلمة الملوّنة: «متوسط» / «بلا شبكة» */
  word: string;
  chips: HeaderChip[];
  onAdd: () => void;
  onExplore: () => void;
}

const RING: Record<HeaderTone, string> = {
  excellent: '#3ddc97',
  good: '#85B7EB',
  fair: '#EF9F27',
  poor: '#F09595',
  down: '#F09595',
  unknown: '#85B7EB',
};
const WORD: Record<HeaderTone, string> = {
  excellent: '#9ff0cf',
  good: '#B5D4F4',
  fair: '#FAC775',
  poor: '#F7C1C1',
  down: '#F7C1C1',
  unknown: '#B5D4F4',
};
const CHIP = {
  blue: { bg: '#185FA5', fg: '#E6F1FB' },
  violet: { bg: '#3C3489', fg: '#CECBF6' },
  red: { bg: '#791F1F', fg: '#F7C1C1' },
  green: { bg: '#085041', fg: '#9FE1CB' },
};

const R = 36;
const CIRC = 2 * Math.PI * R; // 226.2
const ARC = CIRC * 0.75; // قوس ٢٧٠°

export function HomeHeader(p: HomeHeaderProps) {
  const color = RING[p.tone];
  const score = Math.max(0, Math.min(1, p.score));
  const prog = ARC * score;
  // نقطة في طرف القوس — يبدأ عند ١٣٥° ويمشي باتجاه عقارب الساعة
  const ang = ((135 + 270 * score) * Math.PI) / 180;
  const dot = { x: 48 + R * Math.cos(ang), y: 48 + R * Math.sin(ang) };
  const num = p.loading && !score ? '' : String(Math.round(score * 100));

  return (
    <LinearGradient colors={['#0F4F8F', '#0C447C', '#0A3866']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.card}>
      <View style={s.ringWrap}>
        <Svg width={96} height={96} viewBox="0 0 96 96">
          <Circle cx={48} cy={48} r={44} fill="#042C53" />
          <Circle cx={48} cy={48} r={R} fill="none" stroke="#185FA5" strokeWidth={8} strokeLinecap="round"
            strokeDasharray={`${ARC} ${CIRC}`} rotation={135} origin="48, 48" />
          {prog > 0.5 && (
            <Circle cx={48} cy={48} r={R} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
              strokeDasharray={`${prog} ${CIRC}`} rotation={135} origin="48, 48" />
          )}
          {prog > 0.5 && <Circle cx={dot.x} cy={dot.y} r={5} fill="#FAEEDA" />}
          {!!num && (
            <SvgText x={48} y={54} textAnchor="middle" fontSize={26} fontFamily={FONT.bold} fontWeight="700" fill="#FFFFFF">{num}</SvgText>
          )}
          {!!num && (
            <SvgText x={48} y={71} textAnchor="middle" fontSize={11} fontFamily={FONT.regular} fill="#85B7EB">من 100</SvgText>
          )}
        </Svg>
        {p.loading && !num && <ActivityIndicator style={StyleSheet.absoluteFill} color="#E6F1FB" />}
      </View>

      <View style={s.mid}>
        <Text style={s.brand}>Bandly · راوتراتي</Text>
        <Text style={s.title} numberOfLines={1}>
          {p.lead ? `${p.lead} ` : ''}<Text style={{ color: WORD[p.tone] }}>{p.word}</Text>
        </Text>
        {p.chips.length > 0 && (
          <View style={s.chips}>
            {p.chips.map((c, i) => {
              const k = CHIP[c.tone ?? 'blue'];
              return (
                <View key={i} style={[s.chip, { backgroundColor: k.bg }]}>
                  <Text style={[s.chipTxt, { color: k.fg }]} numberOfLines={1}>{c.text}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={s.btns}>
        <Pressable onPress={p.onAdd} accessibilityLabel="إضافة راوتر" hitSlop={6}
          style={({ pressed }) => [s.btn, s.btnAdd, pressed && { opacity: 0.8 }]}>
          <Icon name="plus" size={20} color="#0C447C" stroke={2.6} />
        </Pressable>
        <Pressable onPress={p.onExplore} accessibilityLabel="استكشاف جهاز غير مدعوم" hitSlop={6}
          style={({ pressed }) => [s.btn, s.btnAlt, pressed && { opacity: 0.8 }]}>
          <Icon name="compass" size={19} color="#E6F1FB" stroke={2.1} />
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 22, paddingVertical: 18, paddingHorizontal: 16,
    flexDirection: 'row-reverse', alignItems: 'center', gap: 14,
  },
  ringWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  brand: { color: '#85B7EB', fontSize: 12, fontWeight: '500', letterSpacing: 0.4 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginTop: 2, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  chip: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 2 },
  chipTxt: { fontSize: 11.5, fontWeight: '500' },
  btns: { gap: 8 },
  btn: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  btnAdd: { backgroundColor: '#E6F1FB' },
  btnAlt: { backgroundColor: '#185FA5' },
});
