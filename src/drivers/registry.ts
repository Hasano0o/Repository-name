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
import { LuciDriver } from './luci';
import { DlinkDriver } from './dlink';
import { InseegoDriver } from './inseego';
import { HuaweiOntDriver } from './hgont';
import { Fg360Driver } from './fg360';
import { M2aDriver } from './m2a';
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
  // لوحة FG360 (AW1000 — 5G CPE، :8088/cgi-bin/api.cgi) — قبل الكل: على المنفذ 80 فيه LuCI تعلق وتضيّع وقت الباقين.
  // يدق على :8088 بس (مهلة 2.5ث) — راوتر ما فيه هالمنفذ يرفض فوراً
  () => new Fg360Driver(),
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
  // OpenWrt / LuCI القديم (5G CPE Pro 7 — ١ نوفمبر): الدخول + ملفات FULL، والإشارة بعد ما نشوف صفحاتها
  () => new LuciDriver(),
  // D-Link DWR-2000M / DWR-3000M (React «cpe-webui»، JSON على /acfun/، دخول HMAC-MD5) — من ملفات صفحة ٣ أعضاء (٣١ أكتوبر). قراءة بس للحين
  () => new DlinkDriver(),
  // Inseego MiFi 8000 / 8800L (Verizon Jetpack) و M2000 — /srv/status بدون دخول، الدخول sha1. قراءة بس للحين (٧ نوفمبر)
  () => new InseegoDriver(),
  // هواوي فايبر (ONT: DG8245V · HG8245 · LG8245X6) — /login.cgi بكلمة base64. الدخول + FULL بس للحين (٧ نوفمبر)
  () => new HuaweiOntDriver(),
  // جيب M2A-77 (٨ نوفمبر): بصمته ipaddr.js بمنفذ الأوامر — قبل Unknown
  () => new M2aDriver(),
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
