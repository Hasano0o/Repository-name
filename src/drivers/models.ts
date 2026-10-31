/**
 * ملفات الموديلات — التطبيق يعرف موديل الراوتر من أول ثانية (بدون كلمة مرور) ويضبط نفسه عليه:
 * أي طريقة كتابة تشتغل، هل يقبل تثبيت 5G، هل تثبيت البرج آمن.
 * كل ما ضبط موديل جديد مع مستخدم نضيفه هنا — والكل يستفيد.
 * ملف صافي بدون react-native (عليه اختبارات).
 */
export interface ModelProfile {
  /** مفتاح ثابت */
  id: string;
  /** الاسم اللي يشوفه المستخدم */
  label: string;
  brand: 'zte' | 'huawei' | 'zyxel' | 'fiberhome' | 'oppo' | 'greenpacket';
  tech: '4G' | '5G';
  /** ZTE: طريقة الكتابة — goform (القديمة) أو ubus (أجهزة G5/الجيل الجديد) */
  write?: 'goform' | 'ubus';
  /** يقبل تثبيت ترددات 5G؟ (false = 5G يبقى تلقائي) */
  nrLock?: boolean;
  /** ملاحظة تطلع للمستخدم لو فيه شي يعرفه */
  note?: string;
  /** جرّبناه مع مستخدم حقيقي */
  verified?: boolean;
  /**
   * القراءة شغالة بس أوامر الكتابة ما انثبتت (ولا تجربة ناجحة ولا كود صفحة الراوتر).
   * نوقف التغيير قبل ما يرسل أي أمر، برسالة واضحة — لين نضيف الأوامر الصحيحة من دليل.
   */
  writeUnverified?: boolean;
  /** مع writeUnverified: الأوامر اللي ثبتت من كود صفحة الراوتر نفسه — تنرسل، وغيرها يبقى محجوب */
  writeAllow?: string[];
  /** ZTE: مجموعة أوامر ترددات خاصة بالموديل (u30 = LTE_BAND_LOCK/NR_BAND_LOCK بقوائم أرقام) */
  cmdSet?: 'u30';
  /**
   * مقفول على اللي ثبت إنه يشتغل عنده — بدون أي بدائل أو تجارب.
   * أي إصلاح لموديل ثاني ما يمر على هذا الموديل أبداً.
   */
  pinned?: { ad: string; lteMask: 'short' | 'padded'; nrCmd: 'classic' | 'sansa' };
}

import { U30_WRITES } from './zte/u30';

const P = (p: ModelProfile) => p;

export const MODELS = {
  mu5001: P({ id: 'mu5001', label: 'ZTE MU5001', brand: 'zte', tech: '5G', write: 'goform', nrLock: true, verified: true,
    // مجرّب على جهاز حسن (STC، BD_STCMU5001V1.0.2B04): توقيع MD5 · القناع القصير · أمر 5G القديم
    pinned: { ad: 'wa+cr', lteMask: 'short', nrCmd: 'classic' } }),
  // MC801A Pro (BD_XCBZHKMC801A ProV1.0.0B03 · WEB_XCBZHKG5BV1.0.0B03، زين) — جهاز حسن ٣٠ أكتوبر:
  // صفحة G5 بس كل التغييرات goform (service.js بدون ubus، و /ubus/ = 404). SET_BEARER_PREFERENCE رد success
  // بتوقيع sha:wa+cr = SHA256↑(SHA256↑(wa+cr)+RD). قبل كان مصنّف ubus فكل تغيير يوقف برسالة G5.
  mc801aPro: P({ id: 'mc801a-pro', label: 'ZTE MC801A Pro', brand: 'zte', tech: '5G', write: 'goform', nrLock: true }),
  // MC801A العادي (ملف FULL ٣١ أكتوبر، فيرموير Elisa B06 على stc): goform، AD = md5(md5(wa+cr)+RD)، /ubus/ = 404،
  // قطع/وصل الاتصال اليدوي مرفوض (الصفحة ما تعرضه إلا ببعض أوضاع WAN) ← «آي بي جديد» بإعادة التشغيل
  mc801a: P({ id: 'mc801a', label: 'ZTE MC801A', brand: 'zte', tech: '5G', write: 'goform', nrLock: true }),
  mc888: P({ id: 'mc888', label: 'ZTE MC888', brand: 'zte', tech: '5G', write: 'goform', nrLock: true }),
  mc889: P({ id: 'mc889', label: 'ZTE MC889', brand: 'zte', tech: '5G', write: 'goform', nrLock: true }),
  // U30 Pro (STC، U30Pro_GEN_MEASV1.0.0B07 · cr_version MU5358): صفحته goform القديمة (require.js) — تقرير ٢٥ أكتوبر، @Mjeeduk
  // الكتابة: BAND_SELECT يرد «{}» (ما فيه معالج) بتوقيع صحيح، وsetAccessPointInfo يقول success وما يتغيّر شي (٢٥–٢٦ أكتوبر)
  // ٢٧ أكتوبر: وصل service.js (صفحة UFI mu3351) — الترددات بأوامر ثانية (LTE_BAND_LOCK/NR_BAND_LOCK) وتوقيع SHA256.
  // نسمح بس بالأوامر اللي في كود الصفحة (zte/u30.ts)؛ الواي فاي يبقى محجوب (كلماته مشفّرة AES-GCM في هالفيرموير)
  u30Pro: P({ id: 'u30-pro', label: 'ZTE U30 Pro', brand: 'zte', tech: '5G', write: 'goform', nrLock: true, writeUnverified: true,
    writeAllow: U30_WRITES, cmdSet: 'u30',
    note: 'الترددات ووضع الشبكة وإعادة التشغيل — من كود صفحة الراوتر (لسا ما انجرّبت ميداني). الواي فاي نضيفه قريب' }),
  u10sPro: P({ id: 'u10s-pro', label: 'ZTE U10S Pro', brand: 'zte', tech: '4G', write: 'goform', nrLock: false, note: 'راوتر جيب 4G — ما فيه 5G' }),
  zteG5: P({ id: 'zte-g5', label: 'ZTE (G5)', brand: 'zte', tech: '5G', write: 'ubus', nrLock: true }),
  zte: P({ id: 'zte', label: 'ZTE', brand: 'zte', tech: '5G', write: 'goform' }),
  u60Pro: P({ id: 'u60-pro', label: 'ZTE U60 Pro', brand: 'zte', tech: '5G', write: 'ubus', nrLock: true, verified: true, note: 'تثبيت 5G يسري على وضع SA بس' }),
  zteNg: P({ id: 'zte-ng', label: 'ZTE (الجيل الجديد)', brand: 'zte', tech: '5G', write: 'ubus' }),
  h158: P({ id: 'h158', label: 'Huawei H158-381', brand: 'huawei', tech: '5G', nrLock: false, note: 'يقبل تثبيت 4G بس — 5G يبقى تلقائي' }),
  huawei: P({ id: 'huawei', label: 'Huawei', brand: 'huawei', tech: '5G' }),
} as const;

/** ZTE goform: من wa_inner_version (مثل BD_XCBZHKMC801A ProV1.0.0B03) و web_version (مثل WEB_…G5BV1.0.0B03) */
export function identifyZte(wa?: string, web?: string, hw?: string): ModelProfile {
  const s = `${wa ?? ''} ${hw ?? ''}`;
  if (/MU5001/i.test(s)) return MODELS.mu5001;
  if (/MU5250|U60/i.test(s)) return MODELS.u60Pro;
  // MU3351 = منصة صفحة U30 Pro (config.js: DEVICE "ufi/mu3351") — تقرير ٢٧ أكتوبر
  if (/U30\s*Pro|MU5358|MU3351/i.test(s)) return MODELS.u30Pro;
  if (/U10S\s*Pro/i.test(s)) return MODELS.u10sPro;
  if (/MC801A\s*Pro/i.test(s)) return MODELS.mc801aPro;
  // صفحة G5 (WEB_…G5…) = عائلة جديدة: تقرا goform وتكتب ubus
  if (/(^|_)WEB_\w*G5/i.test(web ?? '') || /G5[A-Z]?V\d/i.test(web ?? '')) {
    const m = s.match(/(MC\d{3}[A-Z]?(?:\s*Pro)?)/i);
    return m ? { ...MODELS.zteG5, id: 'zte-g5-' + m[1].toLowerCase().replace(/\s+/g, ''), label: 'ZTE ' + m[1].toUpperCase().replace(/PRO$/i, 'Pro') } : MODELS.zteG5;
  }
  if (/MC801A/i.test(s)) return MODELS.mc801a;
  if (/MC888/i.test(s)) return MODELS.mc888;
  if (/MC889/i.test(s)) return MODELS.mc889;
  const m = s.match(/\b((?:MC|MU|MF|U)\d{2,4}[A-Z]{0,2}(?:\s*Pro)?)/i);
  return m ? { ...MODELS.zte, id: 'zte-' + m[1].toLowerCase().replace(/\s+/g, ''), label: 'ZTE ' + m[1] } : MODELS.zte;
}

/** هواوي: من devicename في device/basic_information أو device/information */
export function identifyHuawei(name?: string): ModelProfile {
  const n = (name ?? '').trim();
  if (/H158/i.test(n)) return MODELS.h158;
  if (n) return { ...MODELS.huawei, id: 'huawei-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: 'Huawei ' + n };
  return MODELS.huawei;
}
