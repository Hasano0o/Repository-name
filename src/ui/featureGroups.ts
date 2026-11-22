/**
 * أقسام «كل المزايا» (٢٢ نوفمبر — تصميم حسن المعتمد): مصدر واحد للصفحة ولبطاقة «كل المزايا» في صفحة الراوتر
 * (البطاقة تعرض العدد وعيّنة). ٣ أقسام بلون واحد لكل قسم، وما فيه قسم بميزة وحدة:
 * «كاشف اللاق» انتقل للإشارة، و«ملفاتي» للأجهزة والباقة.
 */
import type { SavedRouter } from '../store/routers';
import type { IconName } from './Icon';

export interface FeatItem { key: string; title: string; icon: IconName; onPress: () => void }
export interface FeatGroup { key: string; title: string; short: string; color: string; icon: IconName; hot?: boolean; items: FeatItem[] }
export interface FeatFlags { cellular?: boolean; optic?: boolean; reboot?: boolean; network?: boolean; ussd?: boolean; sms?: boolean; antenna?: boolean }

export const CONTROL_DRIVERS = ['huawei-lte', 'zte', 'fiberhome', 'oppo', 'greenpacket', 'zyxel', 'demo'];

export function buildFeatureGroups(info: SavedRouter, f: FeatFlags | undefined, go: (path: string) => () => void, onReboot: () => void): FeatGroup[] {
  const cell = f?.cellular ?? true;
  const rid = info.id;
  const notDevice = info.driverId !== 'device';
  const pick = (xs: (FeatItem | false | undefined)[]) => xs.filter((x): x is FeatItem => !!x);
  const groups: FeatGroup[] = [
    {
      key: 'hot', title: 'الأكثر طلباً', short: 'الأكثر طلباً', color: '#d97706', icon: 'star', hot: true, items: pick([
        notDevice && cell && { key: 'newip', title: 'آي بي جديد', icon: 'refresh', onPress: go(`/newip/${rid}`) },
        CONTROL_DRIVERS.includes(info.driverId) && { key: 'control', title: 'مركز التحكم', icon: 'settings', onPress: go(`/control/${rid}`) },
        { key: 'speed', title: 'السرعة', icon: 'speed', onPress: go(`/speed/${rid}`) },
        !!f?.reboot && { key: 'reboot', title: 'إعادة التشغيل', icon: 'power', onPress: onReboot },
      ]),
    },
    {
      key: 'signal', title: 'الإشارة والأبراج', short: 'الإشارة', color: '#2f6bff', icon: 'tower', items: pick([
        cell && { key: 'antenna', title: 'الأنتنا', icon: 'antenna', onPress: go(`/antenna/${rid}`) },
        cell && { key: 'places', title: 'الأماكن', icon: 'pin', onPress: go(`/places/${rid}`) },
        { key: 'details', title: 'التفاصيل', icon: 'chart', onPress: go(`/details/${rid}`) },
        cell && { key: 'carriers', title: 'أفضل شركة', icon: 'globe', onPress: go('/carriers') },
        !cell && !!f?.optic && { key: 'fiber', title: 'مستشار الفايبر', icon: 'spark', onPress: go(`/fiber/${rid}`) },
        (info.driverId === 'huawei-lte' || (info.driverId === 'fiberhome' && !!f?.antenna)) &&
          { key: 'hwtools', title: info.driverId === 'fiberhome' ? 'الأنتنا' : 'الأنتنا والباقة', icon: 'layers', onPress: go(`/hwtools/${rid}`) },
        !!f?.network && { key: 'network', title: 'الشبكة', icon: 'settings', onPress: go(`/network/${rid}`) },
        { key: 'lag', title: 'كاشف اللاق', icon: 'target', onPress: go(`/lag/${rid}`) },
        { key: 'monitor', title: 'المراقبة', icon: 'bell', onPress: go('/monitor') },
      ]),
    },
    {
      key: 'devices', title: 'الأجهزة والباقة', short: 'الأجهزة', color: '#7c3aed', icon: 'wifi', items: pick([
        { key: 'devices', title: 'الأجهزة', icon: 'phone', onPress: go(`/device/${rid}`) },
        { key: 'heavy', title: 'وش يثقّل نتك؟', icon: 'down', onPress: go(`/heavy/${rid}`) },
        cell && (!!f?.ussd || !!f?.sms) && { key: 'recharge', title: 'اشحن رصيدك', icon: 'spark', onPress: go(`/recharge/${rid}`) },
        notDevice && { key: 'wifi', title: 'شارك الواي فاي', icon: 'wifi', onPress: go(`/wifi/${rid}`) },
        !!f?.sms && { key: 'sms', title: 'الرسائل', icon: 'sms', onPress: go(`/sms/${rid}`) },
        { key: 'profiles', title: 'ملفاتي', icon: 'folder', onPress: go(`/profiles/${rid}`) },
      ]),
    },
  ];
  return groups.filter(g => g.items.length);
}
