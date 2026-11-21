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
import { StcAxDriver } from './stcax';
import { DlinkDriver } from './dlink';
import { InseegoDriver } from './inseego';
import { HuaweiOntDriver } from './hgont';
import { ZteOntDriver } from './ztont';
import { Fg360Driver } from './fg360';
import { M2aDriver } from './m2a';
import { TplinkDriver } from './tplink';
import { TplinkMrDriver } from './tpmr';
import { JrdDriver } from './jrd';
import { HuaweiGwDriver } from './hwgw';
import { SrtDriver } from './srt';
import { AtelSchdDriver } from './atel';
import { ZltDriver } from './zlt';
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
  // STC 5G AX3600 (OpenWrt + واجهة Vue، JSON على svcrunner) — قبل LuCI القديم. من ملفات صفحة عضو (١٤ نوفمبر)، لسا ما انجرّب ميداني
  () => new StcAxDriver(),
  // سلام HomeFi Max الخارجي (Asiatelco JW515، 192.168.100.1، واجهة /schd/ + REST /rest/1.0/، دخول sha1) — من ملفات «مو مدعوم؟» (٢٠ نوفمبر). دخول + قراءة + FULL
  () => new AtelSchdDriver(),
  // ZLT / SIMCom «war» (X10 · X21 · X28 Pro · VN007+ · X300A، /cgi-bin/http.cgi JSON، دخول sha256(token+كلمة)) — من ملفات «مو مدعوم؟» لـ ٤ أعضاء (٢١ نوفمبر). دخول + إشارة + FULL
  () => new ZltDriver(),
  // OpenWrt / LuCI القديم (5G CPE Pro 7 — ١ نوفمبر): الدخول + ملفات FULL، والإشارة بعد ما نشوف صفحاتها
  () => new LuciDriver(),
  // D-Link DWR-2000M / DWR-3000M (React «cpe-webui»، JSON على /acfun/، دخول HMAC-MD5) — من ملفات صفحة ٣ أعضاء (٣١ أكتوبر). قراءة بس للحين
  () => new DlinkDriver(),
  // Inseego MiFi 8000 / 8800L (Verizon Jetpack) و M2000 — /srv/status بدون دخول، الدخول sha1. قراءة بس للحين (٧ نوفمبر)
  () => new InseegoDriver(),
  // هواوي فايبر (ONT: DG8245V · HG8245 · LG8245X6) — /login.cgi بكلمة base64. الدخول + FULL بس للحين (٧ نوفمبر)
  () => new HuaweiOntDriver(),
  // ZTE فايبر F660 (١٥ نوفمبر): صفحة Frm_Username — ما تتلخبط مع ZTE الشريحة (goform/ubus)
  () => new ZteOntDriver(),
  // جيب M2A-77 (٨ نوفمبر): بصمته ipaddr.js بمنفذ الأوامر — قبل Unknown
  () => new M2aDriver(),
  // TP-Link 4G/5G نسخة GDPR (Archer NX200 — ١٥ نوفمبر): http «ترحيب» والواجهة https، /cgi/getGDPRParm + AES/RSA. الدخول + قراءة أولية + FULL
  // TP-Link 4G القديمة (TL-MR100 — ٢١ نوفمبر): oid_str.js + encrypt.js بدون gdprProxy، دخول /cgi/login?data&sign والأوامر بالصيغة القديمة — قبل NX200
  () => new TplinkMrDriver(),
  () => new TplinkDriver(),
  // عائلة فيرموير JRD/webapi (HH10E وغيره — واجهة Vue، /jrd/webapi JSON-RPC، دخول scramble authType2) — من ملفات صفحة عضو (١٦ نوفمبر). دخول + قراءة، لسا ما انجرّب ميداني
  () => new JrdDriver(),
  // هواوي البوابة القديمة E5172 (V200R001 — /index/login.cgi بكلمة RSA ثابتة) — من ملفات «مو مدعوم؟» (١٧ نوفمبر). دخول + الحالة + FULL
  () => new HuaweiGwDriver(),
  // زين SRT858M (واجهة «5G Device»: goform/action JSON + تشفير MG اختياري، دخول hmac-md5) — من ملفات «مو مدعوم؟» (١٧ نوفمبر). دخول + الحالة + FULL
  () => new SrtDriver(),
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

/** الدرايفرات الحقيقية في هالنسخة (بدون «هذا الجهاز» والتجريبي والاحتياطي) — «برمج لي جهازي» يرسلها للرسيفر */
export function driverIds(): string[] {
  return factories.map(make => make().id).filter(id => id !== 'unknown' && id !== 'device' && id !== 'demo');
}

export function driverById(id: string): RouterDriver | null {
  for (const make of factories) {
    const d = make();
    if (d.id === id) return d;
  }
  return null;
}
