/**
 * عدّاد التوجيه — بطاقة متدرجة فيها قوس نصف دائري (التعبئة = الإشارة الحين، العلامة الذهبية = أفضل نقطة)
 * يستخدمه مساعد التوجيه (عند العميل) ووضع الفني (عند الفني) بنفس الشكل.
 */
import { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Path, Line, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { Icon } from './Icon';
import { P, Hero } from './Pro';

export type Trend = 'up' | 'down' | 'flat';
export const trendOf = (now?: number, prev?: number): Trend =>
  now !== undefined && prev !== undefined ? (now > prev + 0.5 ? 'up' : now < prev - 0.5 ? 'down' : 'flat') : 'flat';

export function TrendMark({ t, light }: { t: Trend; light?: boolean }) {
  if (t === 'flat') return <View style={[a.flat, light && { backgroundColor: 'rgba(255,255,255,0.6)' }]} />;
  return (
    <View style={[a.trend, { backgroundColor: t === 'up' ? '#16c784' : '#ff5a5f' }]}>
      <Icon name={t} size={11} color="#fff" stroke={3} />
    </View>
  );
}

export function AimArc({ value, best, min = -120, max = -70, size = 240 }: {
  value?: number; best?: number; min?: number; max?: number; size?: number;
}) {
  const sw = 16;
  const r = (size - sw) / 2;
  const cx = size / 2, cy = r + sw / 2;
  const h = cy + sw / 2 + 2;
  const f = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const pt = (t: number) => {
    const a = Math.PI * (1 - t); // من اليسار (ضعيف) لليمين (قوي)
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };
  const arc = (t0: number, t1: number) => {
    const p0 = pt(t0), p1 = pt(t1);
    return `M ${p0.x} ${p0.y} A ${r} ${r} 0 0 1 ${p1.x} ${p1.y}`;
  };
  const tv = value === undefined ? 0 : f(value);
  const tb = best === undefined ? undefined : f(best);
  const knob = pt(Math.max(0.005, tv));
  return (
    <Svg width={size} height={h}>
      <Defs>
        <SvgLinearGradient id="aimArc" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="1" />
        </SvgLinearGradient>
      </Defs>
      <Path d={arc(0, 1)} stroke="rgba(255,255,255,0.18)" strokeWidth={sw} strokeLinecap="round" fill="none" />
      {value !== undefined && (
        <Path d={arc(0, Math.max(0.005, tv))} stroke="url(#aimArc)" strokeWidth={sw} strokeLinecap="round" fill="none" />
      )}
      {tb !== undefined && (() => {
        const a = Math.PI * (1 - tb);
        const x1 = cx + (r - sw * 0.9) * Math.cos(a), y1 = cy - (r - sw * 0.9) * Math.sin(a);
        const x2 = cx + (r + sw * 0.9) * Math.cos(a), y2 = cy - (r + sw * 0.9) * Math.sin(a);
        return <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffd166" strokeWidth={4} strokeLinecap="round" />;
      })()}
      {value !== undefined && (
        <>
          <Circle cx={knob.x} cy={knob.y} r={sw * 0.62} fill="#ffffff" />
          <Circle cx={knob.x} cy={knob.y} r={sw * 0.3} fill={P.heroA} />
        </>
      )}
    </Svg>
  );
}


export function AimMeter({ value, best, delta, sinr, trend, levelLabel, cellLabel, isNr, hint, hintColor, right }: {
  value?: number; best?: number; delta?: number; sinr?: number; trend: Trend; levelLabel?: string;
  cellLabel?: string; isNr?: boolean; hint: string; hintColor?: string; right?: ReactNode;
}) {
  return (
    <Hero colors={isNr ? ['#6a45ec', '#a24bd8'] : [P.heroA, P.heroB]} style={{ paddingVertical: 14 }}>
      <View style={a.mTop}>
        <View style={a.mTag}>
          <Icon name="tower" size={13} color="#fff" stroke={2.2} />
          <Text style={a.mTagTxt} numberOfLines={1}>{cellLabel || (isNr ? '5G' : '4G')}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {right}
      </View>

      <View style={a.mGauge}>
        <AimArc value={value} best={best} />
        <View style={a.mCenter}>
          <View style={a.mNumRow}>
            <Text style={a.mNum}>{value ?? '—'}</Text>
            <Text style={a.mUnit}>dBm</Text>
          </View>
          <View style={a.mChips}>
            <TrendMark t={trend} light />
            <Text style={a.mLevel}>{levelLabel ?? '—'}</Text>
          </View>
        </View>
        <View style={a.mScale}>
          <Text style={a.mScaleTxt}>ضعيف</Text>
          <Text style={a.mScaleTxt}>قوي</Text>
        </View>
      </View>

      <View style={a.mStats}>
        <View style={a.mStat}>
          <Text style={a.mStatLbl}>عن البداية</Text>
          <Text style={[a.mStatVal, delta !== undefined && delta > 0.5 && { color: '#7dffc4' }, delta !== undefined && delta < -0.5 && { color: '#ffb3b5' }]}>
            {delta === undefined ? '—' : `${delta > 0.5 ? '+' : ''}${Math.round(delta)} dB`}
          </Text>
        </View>
        <View style={a.mSep} />
        <View style={a.mStat}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
            <View style={a.mBestDot} />
            <Text style={a.mStatLbl}>أفضل نقطة</Text>
          </View>
          <Text style={a.mStatVal}>{best !== undefined ? `${Math.round(best)} dBm` : '—'}</Text>
        </View>
        <View style={a.mSep} />
        <View style={a.mStat}>
          <Text style={a.mStatLbl}>SINR</Text>
          <Text style={a.mStatVal}>{sinr !== undefined ? `${sinr} dB` : '—'}</Text>
        </View>
      </View>

      <View style={a.mHint}>
        <View style={[a.mDot, { backgroundColor: hintColor || 'rgba(255,255,255,0.5)' }]} />
        <Text style={a.mHintTxt} numberOfLines={1}>{hint}</Text>
      </View>
    </Hero>
  );
}

const a = StyleSheet.create({
  mTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  mTag: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexShrink: 1,
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 11, height: 30,
  },
  mTagTxt: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  mBtn: {
    width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  mBtnOn: { backgroundColor: '#fff', borderColor: '#fff' },
  mGauge: { alignItems: 'center', marginTop: 6 },
  mCenter: { position: 'absolute', bottom: 6, alignItems: 'center' },
  mNumRow: { flexDirection: 'row', alignItems: 'baseline' },
  mNum: { color: '#fff', fontSize: 50, fontWeight: '800', letterSpacing: -2, lineHeight: 56 },
  mUnit: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '700', marginLeft: 4 },
  mChips: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  mLevel: { color: '#fff', fontSize: 13, fontWeight: '800' },
  mScale: { flexDirection: 'row', justifyContent: 'space-between', width: 250, marginTop: -2 },
  mScaleTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '700' },
  mStats: {
    flexDirection: 'row-reverse', marginTop: 10, backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 16, paddingVertical: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  mStat: { flex: 1, alignItems: 'center', gap: 1 },
  mSep: { width: 1, backgroundColor: 'rgba(255,255,255,0.22)', marginVertical: 3 },
  mStatLbl: { color: 'rgba(255,255,255,0.75)', fontSize: 10.5, fontWeight: '700' },
  mStatVal: { color: '#fff', fontSize: 15, fontWeight: '800' },
  mBestDot: { width: 8, height: 3, borderRadius: 2, backgroundColor: '#ffd166' },
  mHint: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  mHintTxt: { color: '#fff', fontSize: 12.5, fontWeight: '700' },

  mDot: { width: 8, height: 8, borderRadius: 4 },
  trend: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  flat: { width: 8, height: 8, borderRadius: 4, backgroundColor: P.faint, marginHorizontal: 4 },
});
