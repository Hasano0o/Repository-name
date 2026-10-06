/**
 * ترويسة الرئيسية: دائرة جودة الاتصال (أفضل راوتر) + سطر الحالة + شارات المشغّل والتقنية والترددات.
 * لون الدائرة وكلمة الجودة يتغيّرون حسب المستوى.
 */
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Icon } from './Icon';
import { FONT } from './fonts';
import { Hero, P } from './Pro';
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

// على لون الترويسة الأصلي (أزرق→بنفسجي، وفي الداكن نحاسي) — كل شي داخلها أبيض شفاف أو ألوان فاتحة
const RING: Record<HeaderTone, string> = {
  excellent: '#5ff0b0',
  good: '#ffffff',
  fair: '#ffd166',
  poor: '#ff9b9b',
  down: '#ff9b9b',
  unknown: 'rgba(255,255,255,0.7)',
};
const WORD: Record<HeaderTone, string> = {
  excellent: '#b9ffdf',
  good: '#ffffff',
  fair: '#ffe08a',
  poor: '#ffc4c4',
  down: '#ffc4c4',
  unknown: '#ffffff',
};
const CHIP = {
  blue: { bg: 'rgba(255,255,255,0.18)', fg: '#ffffff' },
  violet: { bg: 'rgba(255,255,255,0.28)', fg: '#ffffff' },
  red: { bg: 'rgba(255,90,90,0.35)', fg: '#ffffff' },
  green: { bg: 'rgba(40,220,150,0.30)', fg: '#ffffff' },
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
    <Hero style={s.card}>
      <View style={s.ringWrap}>
        <Svg width={96} height={96} viewBox="0 0 96 96">
          <Circle cx={48} cy={48} r={44} fill="rgba(0,0,0,0.16)" />
          <Circle cx={48} cy={48} r={R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={8} strokeLinecap="round"
            strokeDasharray={`${ARC} ${CIRC}`} rotation={135} origin="48, 48" />
          {prog > 0.5 && (
            <Circle cx={48} cy={48} r={R} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
              strokeDasharray={`${prog} ${CIRC}`} rotation={135} origin="48, 48" />
          )}
          {prog > 0.5 && <Circle cx={dot.x} cy={dot.y} r={5} fill="#ffffff" />}
        </Svg>
        {!!num && (
          <View style={s.ringTxt} pointerEvents="none">
            <Text style={s.num}>{num}</Text>
            <Text style={s.of}>من 100</Text>
          </View>
        )}
        {p.loading && !num && <ActivityIndicator style={StyleSheet.absoluteFill} color="#ffffff" />}
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
          <Icon name="plus" size={20} color={P.blue} stroke={2.6} />
        </Pressable>
        <Pressable onPress={p.onExplore} accessibilityLabel="استكشاف جهاز غير مدعوم" hitSlop={6}
          style={({ pressed }) => [s.btn, s.btnAlt, pressed && { opacity: 0.8 }]}>
          <Icon name="compass" size={19} color="#ffffff" stroke={2.1} />
        </Pressable>
      </View>
    </Hero>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
  ringWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  ringTxt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingTop: 4 },
  num: { color: '#ffffff', fontSize: 26, fontWeight: '700', lineHeight: 30, fontFamily: FONT.bold },
  of: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '500', marginTop: -2 },
  mid: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  brand: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '500', letterSpacing: 0.4 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginTop: 2, textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  chip: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 2 },
  chipTxt: { fontSize: 11.5, fontWeight: '500' },
  btns: { gap: 8 },
  btn: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  btnAdd: { backgroundColor: '#ffffff' },
  btnAlt: { backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
});
