/**
 * آخر ميزات معروفة لكل راوتر (من صفحة الراوتر) — صفحة «كل المزايا» تعرضها فوراً
 * بدون ما تنتظر دخول جديد للراوتر، وبعدها تحدّثها لو قدرت.
 */
export interface RouterFeatures {
  bands: boolean; sms: boolean; ussd: boolean; reboot: boolean; devices: boolean; usage: boolean;
  network: boolean; antenna: boolean; cellular: boolean; optic: boolean;
  /** مركز التحكم لدرايفر مو في CONTROL_DRIVERS (ZTE TopFlow MU5252 بس) */
  control?: boolean;
}

const cache = new Map<string, RouterFeatures>();

export const setFeatCache = (id: string, f: RouterFeatures) => { cache.set(id, f); };
export const getFeatCache = (id: string): RouterFeatures | undefined => cache.get(id);
