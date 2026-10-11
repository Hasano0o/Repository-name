/**
 * «ادعُ ربعك» — مشاركة رابط البوت بكود المستخدم (t.me/NetGuide1_bot?start=r_CODE).
 * البوت يعدّ كل شخص مرة وحدة لكل كود (/refs عند المالك). الكود من المعرّف العشوائي للجهاز — مو اسم ولا رقم.
 */
import { Share, } from 'react-native';
import { Pressable, Text, View } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { deviceId } from '../services/community';
import { FONT } from './fonts';
import { C, tBd, tBg, tFg } from './theme';

import { sheet } from '../i18n';
const IOS = 'https://apps.apple.com/sa/app/id6819877993';

async function invite() {
  let code = '';
  try { code = (await deviceId()).replace(/[^A-Za-z0-9]/g, '').slice(0, 8); } catch {}
  const bot = `https://t.me/NetGuide1_bot${code ? `?start=r_${code}` : ''}`;
  const message =
    '📶 جرّب Bandly — يطلّع أقوى إشارة من راوترك 4G/5G\n' +
    'يوجّهك للبرج الأقوى، يثبّت التردد، ويحسّن البنق للألعاب.\n\n' +
    `🤖 أندرويد وكمبيوتر: ${bot}\n` +
    `🍎 آيفون: ${IOS}`;
  Share.share({ message }).catch(() => {});
}

function PeopleIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8} r={3.4} fill="#ffffff" />
      <Path d="M2.6 19.5c.6-3.4 3.2-5.4 6.4-5.4s5.8 2 6.4 5.4" fill="#ffffff" />
      <Circle cx={17.2} cy={9} r={2.6} fill="rgba(255,255,255,0.75)" />
      <Path d="M15.6 14.4c2.8-.3 5.2 1.4 5.8 4.6" stroke="rgba(255,255,255,0.75)" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function InviteCard() {
  return (
    <Pressable onPress={invite} style={({ pressed }) => [s.card, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}>
      <LinearGradient colors={['#ec4899', '#8b5cf6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.icon}>
        <PeopleIcon />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>ادعُ ربعك لـ Bandly</Text>
        <Text style={s.sub}>شارك الرابط مع أهلك وربعك</Text>
      </View>
      <View style={s.btn}><Text style={s.btnTxt}>شارك</Text></View>
    </Pressable>
  );
}

const s = sheet({
  card: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22,
    backgroundColor: tBg('#fdf4ff'), borderWidth: 1.5, borderColor: tBd('#f5d0fe'),
  },
  icon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FONT.bold, color: C.text, fontSize: 15.5, textAlign: 'right' },
  sub: { fontFamily: FONT.medium, color: tFg('#86198f'), fontSize: 12.5, textAlign: 'right', marginTop: 2 },
  btn: { backgroundColor: tBg('#a21caf'), paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  btnTxt: { fontFamily: FONT.bold, color: tFg('#ffffff'), fontSize: 13 },
});
