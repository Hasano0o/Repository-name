/**
 * «ادعُ ربعك» — مشاركة رابط البوت بكود المستخدم (t.me/NetGuide1_bot?start=r_CODE).
 * البوت يعدّ كل شخص مرة وحدة لكل كود (/refs عند المالك). الكود من المعرّف العشوائي للجهاز — مو اسم ولا رقم.
 * الزر نفسه صار مربع في أسفل الرئيسية (HomeFooter).
 */
import { Share } from 'react-native';
import { deviceId } from '../services/community';

const IOS = 'https://apps.apple.com/sa/app/id6819877993';

export async function invite() {
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
