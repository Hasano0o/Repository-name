import { RouterDriver } from './types';
import { HuaweiDriver } from './huawei';
import { ZteDriver } from './zte';
import { UnknownDriver } from './unknown';

// ═══ لماذا لا Mikrotik/OpenWrt؟ ═══
// ملفات `mikrotik/index.ts` و `openwrt/index.ts` موجودة كـ stubs فقط
// (detect ترجع false دائماً). إبقاؤها في registry يعني طلبي شبكة ميتين
// في كل `detectDriver()` — بطيء بلا فائدة.
// نحتفظ بالملفات للمستقبل، لكن نستثنيها من الـ factories النشطة.
const factories: (() => RouterDriver)[] = [
  () => new HuaweiDriver(),
  () => new ZteDriver(),
  () => new UnknownDriver(),
];

export async function detectDriver(host: string): Promise<RouterDriver | null> {
  for (const make of factories) {
    const d = make();
    try {
      if (await d.detect(host)) return d;
    } catch {
      // لا نوقف — نجرب التالي
    }
  }
  return null;
}

export function driverById(id: string): RouterDriver | null {
  for (const make of factories) {
    const d = make();
    if (d.id === id) return d;
  }
  return null;
}
