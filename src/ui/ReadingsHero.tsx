/**
 * أجزاء صفحة القراءة — تصميم حسن (صورة «القراءة» ٢٢ نوفمبر):
 * ترويسة الراوتر (الصورة · الاسم ✓ · متصل · الترس) · شريط «مثبّت على … | رجوع للتلقائي» · شريط السرعة الحالية.
 * بطاقات 4G/5G في TechCards.tsx، و«اتصالك جيد» في صفحة الراوتر نفسها.
 */
import type { ReactNode } from 'react';
import { Image } from 'react-native';
import { View, Text, Pressable } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { Icon } from './Icon';
import { C, isDark, tBd, tBg } from './theme';
import { FONT } from './fonts';
import { sheet } from '../i18n';
import { CpeArt, BoxArt, RouterArtKind } from './RouterArt';

const MIFI = require('../../assets/images/router-mifi.png');

export function TowerIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={7} r={1.8} fill={color} />
      <Path d="M8.6 3.8a4.8 4.8 0 0 0 0 6.4M15.4 3.8a4.8 4.8 0 0 1 0 6.4M5.8 1.8a8.4 8.4 0 0 0 0 10.4M18.2 1.8a8.4 8.4 0 0 1 0 10.4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M12 9l-5 13M12 9l5 13M8.6 17.5h6.8M9.8 13.5h4.4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function LinkIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M10 13.5a4.5 4.5 0 0 0 6.4.3l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M14 10.5a4.5 4.5 0 0 0-6.4-.3l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

function VerifiedDot({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20">
      <Circle cx={10} cy={10} r={10} fill={color} />
      <Path d="M5.6 10.3l2.9 2.9 5.9-6" stroke="#fff" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** ترويسة الراوتر: الصورة يسار · الاسم والحالة بالوسط · الترس يمين */
/** زر الرجوع الدائري (صفحة الراوتر بدون الشريط العلوي — حسن ٢٢ نوفمبر: الفراغ فوق «موكويس») */
export function BackBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="رجوع" hitSlop={8}
      style={({ pressed }) => [s.back, pressed && { opacity: 0.8 }]}>
      <Icon name="back" size={22} color={isDark ? '#e5e7eb' : '#1e3a8a'} stroke={2.8} />
    </Pressable>
  );
}

export function RouterHead({ name, ok, statusText, statusColor, art, onSettings, onBack, extra }: {
  name: string; ok: boolean; statusText: string; statusColor: string; art: RouterArtKind; onSettings?: () => void; onBack?: () => void; extra?: ReactNode;
}) {
  return (
    <View style={s.head}>
      <Pressable onPress={onSettings} disabled={!onSettings} accessibilityRole="button" accessibilityLabel="تعديل الراوتر"
        style={({ pressed }) => [s.gear, pressed && { opacity: 0.8 }]}>
        <Icon name="settings" size={22} color={isDark ? '#e5e7eb' : '#14213d'} stroke={2.4} />
      </Pressable>
      <View style={s.headMid}>
        <View style={s.nameRow}>
          {ok && <VerifiedDot color="#22c55e" />}
          <Text style={s.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{name}</Text>
        </View>
        <View style={s.statusRow}>
          {extra}
          <View style={[s.status, { backgroundColor: statusColor + (isDark ? '33' : '1f') }]}>
            <Text style={[s.statusTxt, { color: statusColor }]}>{statusText}</Text>
            <View style={[s.dot, { backgroundColor: statusColor }]} />
          </View>
        </View>
      </View>
      <View style={[s.photoWrap, !!onBack && s.photoSmall]}>
        {/* رسمة ثابتة حسب نوع الجهاز (حسن ٢٨ نوفمبر) — ZTE صورته، هواوي راوتر واقف، الباقي راوتر بأنتنات */}
        {art === 'mifi'
          ? <Image source={MIFI} style={onBack ? s.photoS : s.photo} resizeMode="contain" />
          : art === 'cpe'
            ? <CpeArt width={onBack ? 58 : 74} height={onBack ? 44 : 56} />
            : <BoxArt width={onBack ? 58 : 74} height={onBack ? 44 : 56} />}
        <View style={s.wifi}><Icon name="wifi" size={onBack ? 18 : 22} color="#2f6bff" stroke={2.6} /></View>
      </View>
      {!!onBack && <BackBtn onPress={onBack} />}
    </View>
  );
}

/** شريط التثبيت: «مثبّت على …» يمين · زر «رجوع للتلقائي» متدرّج يسار */
export function LockBar({ text, note, onAuto, busy }: { text: string; note?: string; onAuto: () => void; busy?: boolean }) {
  return (
    <View style={s.lock}>
      <View style={s.lockTxtWrap}>
        <View style={s.lockLine}>
          <TowerIcon color={isDark ? '#93b4ff' : '#1e3a8a'} size={22} />
          <Text style={s.lockTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{text}</Text>
        </View>
        {!!note && <Text style={s.lockNote} numberOfLines={2}>{note}</Text>}
      </View>
      <Pressable onPress={onAuto} disabled={busy} accessibilityRole="button" accessibilityLabel="رجوع للتلقائي"
        style={({ pressed }) => [s.autoWrap, (pressed || busy) && { opacity: 0.75 }]}>
        <LinearGradient colors={['#2563eb', '#7c3aed']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={s.auto}>
          <Text style={s.autoTxt} numberOfLines={1} adjustsFontSizeToFit>رجوع للتلقائي</Text>
          <Icon name="refresh" size={18} color="#fff" stroke={2.6} />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

/** «السرعة الحالية ↓ … ↑ …» */
export function SpeedPill({ down, up }: { down: string; up: string }) {
  return (
    <View style={s.speed}>
      <Icon name="speed" size={17} color={isDark ? '#93b4ff' : '#1e3a8a'} stroke={2.4} />
      <Text style={s.speedLbl}>السرعة الحالية</Text>
      <Text style={s.speedTxt} numberOfLines={1}>{'\u2066↓ ' + down + '\u2069'}</Text>
      <Text style={s.speedTxt} numberOfLines={1}>{'\u2066↑ ' + up + '\u2069'}</Text>
    </View>
  );
}

/** بطاقة «اتصالك جيد»: العنوان بين خطين + صندوق البرج · الدمج · الترددات */
export function SummaryCard({ title, color, bars, tower, tower5g, ca, chips, chipsSub, onPress }: {
  title: string; color: string; bars: ReactNode; tower: string; tower5g?: string;
  ca: { text: string; color: string; sub?: string; linked?: boolean }; chips: ReactNode; chipsSub?: string; onPress?: () => void;
}) {
  return (
    <View style={s.sum}>
      <View style={s.sumHead}>
        <View style={[s.sumRule, { backgroundColor: color }]} />
        <Text style={s.sumTitle}>{title}</Text>
        {bars}
        <View style={[s.sumRule, { backgroundColor: color }]} />
      </View>
      <Pressable style={s.sumBox} onPress={onPress} disabled={!onPress}>
        <View style={s.sumCell}>
          <Text style={s.sumLbl}>البرج</Text>
          <View style={s.sumValRow}>
            <TowerIcon color={isDark ? '#93b4ff' : '#1e3a8a'} size={22} />
            <Text style={s.sumVal} numberOfLines={1} adjustsFontSizeToFit>{tower}</Text>
          </View>
          {!!tower5g && <Text style={s.sumSub}>{`5G: ${tower5g}`}</Text>}
        </View>
        <View style={s.sumDiv} />
        <View style={s.sumCell}>
          <Text style={s.sumLbl}>الدمج</Text>
          <View style={s.sumValRow}>
            {ca.linked && <LinkIcon color={ca.color} size={22} />}
            <Text style={[s.sumVal, { color: ca.color }]} numberOfLines={1} adjustsFontSizeToFit>{ca.text}</Text>
          </View>
          {!!ca.sub && <Text style={s.sumSub} numberOfLines={2} adjustsFontSizeToFit>{ca.sub}</Text>}
        </View>
        <View style={s.sumDiv} />
        <View style={s.sumCell}>
          <Text style={s.sumLbl}>الترددات</Text>
          <View style={s.sumChips}>{chips}</View>
          {!!chipsSub && <Text style={s.sumSub} numberOfLines={1} adjustsFontSizeToFit>{chipsSub}</Text>}
        </View>
      </Pressable>
    </View>
  );
}

const s = sheet({
  sum: {
    backgroundColor: tBg('#ffffffcc'), borderRadius: 24, borderWidth: 1, borderColor: tBd('#ffffff'), padding: 10, paddingTop: 8, gap: 8,
    shadowColor: C.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  sumHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
  sumRule: { flex: 1, height: 2, borderRadius: 1, opacity: 0.7 },
  sumTitle: { color: C.text, fontSize: 18, fontWeight: '900' },
  sumBox: {
    flexDirection: 'row-reverse', backgroundColor: tBg('#ffffff'), borderRadius: 18, borderWidth: 1, borderColor: tBd('#e6ecf8'),
    paddingVertical: 10, paddingHorizontal: 4,
  },
  sumCell: { flex: 1, alignItems: 'center', gap: 3, minWidth: 0 },
  sumDiv: { width: 1, backgroundColor: C.line, marginVertical: 2 },
  sumLbl: { color: C.text, fontSize: 12, fontWeight: '800' },
  sumValRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, maxWidth: '100%' },
  sumVal: { color: C.text, fontSize: 19, fontFamily: FONT.numHeavy, flexShrink: 1 },
  sumChips: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 1 },
  sumSub: { color: C.sub, fontSize: 11, fontWeight: '700', textAlign: 'center' },

  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingTop: 2, paddingBottom: 2 },
  gear: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: tBg('#ffffff'), alignItems: 'center', justifyContent: 'center',
    shadowColor: C.shadow, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  headMid: { flex: 1, alignItems: 'center', gap: 5, minWidth: 0 },
  nameRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, maxWidth: '100%' },
  name: { color: isDark ? '#f1f5f9' : '#14213d', fontSize: 21, fontFamily: FONT.numHeavy, flexShrink: 1 },
  statusRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  status: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 3 },
  statusTxt: { fontSize: 14, fontWeight: '900' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  photoWrap: { width: 96, height: 66, justifyContent: 'center' },
  photoSmall: { width: 72, height: 56 },
  photoS: { width: 58, height: 44 },
  back: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: tBg('#ffffff'), alignItems: 'center', justifyContent: 'center',
    shadowColor: C.shadow, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  photo: { width: 74, height: 56 },
  wifi: { position: 'absolute', right: 0, top: 0 },

  lock: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: tBg('#ffffff'), borderRadius: 999,
    borderWidth: 1, borderColor: tBd('#ffffff'), padding: 5, paddingRight: 14,
    shadowColor: C.shadow, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  lockTxtWrap: { flex: 1, minWidth: 0 },
  lockLine: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  lockTxt: { color: C.text, fontSize: 14, fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  lockNote: { color: C.sub, fontSize: 10.5, fontWeight: '700', textAlign: 'right', marginTop: 1 },
  autoWrap: { width: '46%', borderRadius: 999, shadowColor: '#5b3df5', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  auto: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 12 },
  autoTxt: { color: '#fff', fontSize: 15, fontWeight: '900', flexShrink: 1 },

  speed: {
    alignSelf: 'center', flexDirection: 'row-reverse', alignItems: 'center', gap: 7, backgroundColor: tBg('#ffffffcc'),
    borderRadius: 999, borderWidth: 1, borderColor: tBd('#dbe5f8'), paddingHorizontal: 16, paddingVertical: 6,
  },
  speedLbl: { color: C.text, fontSize: 12, fontWeight: '800' },
  speedTxt: { color: C.text, fontSize: 12, fontFamily: FONT.numSemi },
});
