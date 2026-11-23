/**
 * أقسام «كل المزايا» — مصدر واحد للصفحة ولبطاقة «كل المزايا» في صفحة الراوتر.
 * ٢٢ نوفمبر (تصميم حسن الثاني): لون لكل ميزة (أيقونات ناعمة) + أيقونة وحبة لكل قسم.
 * ما فيه قسم بميزة وحدة: «كاشف اللاق» في الإشارة، و«ملفاتي» و«باقتي» في الأجهزة والباقة.
 */
import type { SavedRouter } from '../store/routers';
import type { IconName } from './Icon';

export interface FeatItem { key: string; title: string; icon: IconName; color: string; onPress: () => void }
export interface FeatGroup {
  key: string; title: string; short: string; chipIcon: IconName; color: string; band: [string, string];
  icon: IconName; hot?: boolean; items: FeatItem[];
}
export interface FeatFlags { usage?: boolean; cellular?: boolean; optic?: boolean; reboot?: boolean; network?: boolean; ussd?: boolean; sms?: boolean; antenna?: boolean }

export const CONTROL_DRIVERS = ['huawei-lte', 'zte', 'fiberhome', 'oppo', 'greenpacket', 'zyxel', 'demo'];

const ORANGE = '#f97316', BLUE = '#2563eb', GREEN = '#16a34a', PURPLE = '#9333ea', PINK = '#e11d48', TEAL = '#0d9488', VIOLET = '#7c3aed', AMBER = '#d97706';

export function buildFeatureGroups(info: SavedRouter, f: FeatFlags | undefined, go: (path: string) => () => void, onReboot: () => void): FeatGroup[] {
  const cell = f?.cellular ?? true;
  const rid = info.id;
  const notDevice = info.driverId !== 'device';
  const pick = (xs: (FeatItem | false | undefined)[]) => xs.filter((x): x is FeatItem => !!x);
  const groups: FeatGroup[] = [
    {
      key: 'hot', title: 'الأكثر طلباً', short: 'الأكثر طلباً', chipIcon: 'fire', color: '#f59e0b', band: ['#fde8c8', '#fff7ea'], icon: 'star', hot: true, items: pick([
        notDevice && cell && { key: 'newip', title: 'آي بي جديد', icon: 'refresh', color: ORANGE, onPress: go(`/newip/${rid}`) },
        CONTROL_DRIVERS.includes(info.driverId) && { key: 'control', title: 'مركز التحكم', icon: 'settings', color: BLUE, onPress: go(`/control/${rid}`) },
        { key: 'speed', title: 'السرعة', icon: 'speed', color: GREEN, onPress: go(`/speed/${rid}`) },
        !cell && { key: 'planspeed', title: 'سرعتك وباقتك', icon: 'chart', color: TEAL, onPress: go(`/planspeed/${rid}`) },
        !cell && { key: 'rooms', title: 'الواي فاي بالغرف', icon: 'wifi', color: BLUE, onPress: go(`/rooms/${rid}`) },
        !!f?.reboot && { key: 'reboot', title: 'إعادة التشغيل', icon: 'power', color: PURPLE, onPress: onReboot },
      ]),
    },
    {
      key: 'signal', title: 'الإشارة والأبراج', short: 'الإشارة', chipIcon: 'sliders', color: '#4f6bff', band: ['#e3e8ff', '#f4f6ff'], icon: 'antenna', items: pick([
        cell && { key: 'antenna', title: 'الأنتنا', icon: 'antenna', color: VIOLET, onPress: go(`/antenna/${rid}`) },
        cell && { key: 'places', title: 'الأماكن', icon: 'pin', color: GREEN, onPress: go(`/places/${rid}`) },
        { key: 'details', title: 'التفاصيل', icon: 'trend', color: BLUE, onPress: go(`/details/${rid}`) },
        cell && { key: 'carriers', title: 'أفضل شركة', icon: 'globe', color: PURPLE, onPress: go('/carriers') },
        !cell && !!f?.optic && { key: 'fiber', title: 'مستشار الفايبر', icon: 'spark', color: ORANGE, onPress: go(`/fiber/${rid}`) },
        (info.driverId === 'huawei-lte' || (info.driverId === 'fiberhome' && !!f?.antenna)) &&
          { key: 'hwtools', title: info.driverId === 'fiberhome' ? 'الأنتنا' : 'الأنتنا والباقة', icon: 'layers', color: AMBER, onPress: go(`/hwtools/${rid}`) },
        !!f?.network && { key: 'network', title: 'الشبكة', icon: 'settings', color: PINK, onPress: go(`/network/${rid}`) },
        cell && { key: 'rooms', title: 'الواي فاي بالغرف', icon: 'wifi', color: BLUE, onPress: go(`/rooms/${rid}`) },
        { key: 'lag', title: 'كاشف اللاق', icon: 'target', color: TEAL, onPress: go(`/lag/${rid}`) },
        { key: 'monitor', title: 'المراقبة', icon: 'bell', color: VIOLET, onPress: go('/monitor') },
      ]),
    },
    {
      key: 'devices', title: 'الأجهزة والباقة', short: 'الأجهزة', chipIcon: 'router', color: '#8b5cf6', band: ['#ede4ff', '#f7f3ff'], icon: 'wifi', items: pick([
        { key: 'devices', title: 'الأجهزة', icon: 'phone', color: GREEN, onPress: go(`/device/${rid}`) },
        { key: 'heavy', title: 'وش يثقّل نتك؟', icon: 'down', color: PURPLE, onPress: go(`/heavy/${rid}`) },
        cell && (!!f?.ussd || !!f?.sms) && { key: 'recharge', title: 'اشحن رصيدك', icon: 'star', color: ORANGE, onPress: go(`/recharge/${rid}`) },
        notDevice && { key: 'wifi', title: 'شارك الواي فاي', icon: 'wifi', color: BLUE, onPress: go(`/wifi/${rid}`) },
        !!f?.sms && { key: 'sms', title: 'الرسائل', icon: 'sms', color: VIOLET, onPress: go(`/sms/${rid}`) },
        { key: 'profiles', title: 'ملفاتي', icon: 'folder', color: TEAL, onPress: go(`/profiles/${rid}`) },
        !!f?.usage && { key: 'plan', title: 'باقتي', icon: 'chart', color: AMBER, onPress: go(`/plan/${rid}`) },
      ]),
    },
  ];
  return groups.filter(g => g.items.length);
}
