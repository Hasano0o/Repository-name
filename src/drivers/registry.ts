import { RouterDriver } from './types';
import { HuaweiDriver } from './huawei';
import { ZteDriver } from './zte';
import { ZteNgDriver } from './zteng';
import { ZyxelDriver } from './zyxel';
import { FiberhomeDriver } from './fiberhome';
import { OppoDriver } from './oppo';
import { GreenPacketDriver } from './greenpacket';
import { NokiaDriver } from './nokia';
import { NokiaFwaDriver } from './nokia/fwa';
import { ZteUfiDriver } from './zteufi';
import { UnknownDriver } from './unknown';
import { DeviceDriver } from './device';
import { DemoDriver } from './demo';

// ═══ لماذا لا Mikrotik/OpenWrt؟ ═══
// ملفات `mikrotik/index.ts` و `openwrt/index.ts` موجودة كـ stubs فقط
// (detect ترجع false دائماً). إبقاؤها في registry يعني طلبي شبكة ميتين
// في كل `detectDriver()` — بطيء بلا فائدة.
// نحتفظ بالملفات للمستقبل، لكن نستثنيها من الـ factories النشطة.
const factories: (() => RouterDriver)[] = [
  // «هذا الجهاز» أول — detect يرجع false فوراً لأي عنوان غير device (بدون شبكة)
  () => new DeviceDriver(),
  // «راوتر تجريبي» — detect يرجع true بس للعنوان demo (بدون شبكة)
  () => new DemoDriver(),
  () => new HuaweiDriver(),
  () => new ZteDriver(),
  // ZTE الجيل الجديد (U60 Pro / MU5250 …) — ubus بدل goform. قراءة بس للحين
  () => new ZteNgDriver(),
  // ZTE القديم (راوترات الجيب 4G «UFI» — بدون wa_inner_version، دخول بـ username) — درايفر لحاله عشان ما يلمس MU5001
  () => new ZteUfiDriver(),
  // زيكسل (صفحة Web-Based Configurator الجديدة) — قراءة بس للحين
  () => new ZyxelDriver(),
  // FiberHome 5G CPE (واجهة Vue، /api/tmp/FHAPIS) — من ملفات صفحة حقيقية (٢٦ أكتوبر)، لسا ما انجرّب ميداني
  () => new FiberhomeDriver(),
  // OPPO 5G CPE (T1a — زين، /api/... مشفّر AES-CTR + RSA) — من ملفات صفحة حقيقية (٢٦ أكتوبر)، لسا ما انجرّب ميداني
  () => new OppoDriver(),
  // Green Packet 5G CPE (E5-250MK — زين، /web/v1 JSON) — من ملفات صفحة حقيقية (٢٦ أكتوبر)، لسا ما انجرّب ميداني
  () => new GreenPacketDriver(),
  // Nokia FastMile 5G Gateway (3.1 — Angular /web_whw/، *_web_app.cgi) — من ملفات صفحة حقيقية (٢٧ و٣١ أكتوبر)، لسا ما انجرّب ميداني
  () => new NokiaDriver(),
  // Nokia FastMile 6.1 (Angular جديد بدون main-es2015، دخول بـ salt، ubus service_function) — درايفر لحاله، من ملفات صفحة عضو (٣١ أكتوبر)
  () => new NokiaFwaDriver(),
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
