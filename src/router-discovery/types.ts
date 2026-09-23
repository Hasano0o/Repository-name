/**
 * Bandly Router Discovery — الأنواع الأساسية
 *
 * هذا الملف معرّف أنواع فقط — لا منطق، لا اعتماديات.
 * كل قيمة "مكتشفة" في Bandly يجب أن تُغلَّف بـ Evidence<T>
 * حتى نعرف: من أين جاءت، وما مستوى الثقة فيها.
 *
 * قواعد صارمة:
 *  1. لا يوجد حقل بدون Evidence في الروتر المكتشف.
 *  2. UNKNOWN ليس قيمة — هو غياب قيمة، لكن موثَّق.
 *  3. Evidence لا يُزيَّف — CONFIDENCE ثابت من لحظة الالتقاط.
 *  4. لا تخزين قيم حساسة في Evidence (لا password, IMEI, IMSI, MAC,
 *     SSID, tokens). تُستبدل بـ REDACTED قبل التغليف.
 */

/** نسخة schema للتوافق المستقبلي */
export const DISCOVERY_SCHEMA_VERSION = 1 as const;
export type DiscoverySchemaVersion = typeof DISCOVERY_SCHEMA_VERSION;

// ═══════════════════════════════════════════════════════════════════════
// Evidence — حجر الأساس
// ═══════════════════════════════════════════════════════════════════════

/**
 * من أين عرفنا هذه المعلومة؟
 *   - api          : من استجابة HTTP (JSON/XML)
 *   - html         : من تحليل HTML (مثل <title>)
 *   - header       : من ترويسة HTTP (Server, X-Powered-By...)
 *   - screenshot   : من صورة رفعها المستخدم
 *   - user         : أدخلها المستخدم يدويًا
 *   - fingerprint  : من مطابقة بصمة مع قاعدة معروفة
 *   - static       : من مصدر ثابت داخل التطبيق (ندرة)
 */
export type EvidenceSource =
  | 'api'
  | 'html'
  | 'header'
  | 'screenshot'
  | 'user'
  | 'fingerprint'
  | 'static';

/**
 * مستوى الثقة في المعلومة:
 *   - CONFIRMED : تحقّقت من مصدرين، أو من مصدر قاطع
 *   - OBSERVED  : شوهدت فعلاً لكن لم تُتحقَّق مقابل مصدر آخر
 *   - PARTIAL   : شوهد جزء منها فقط
 *   - UNKNOWN   : لا توجد معلومة (value يجب أن يكون null)
 */
export type EvidenceConfidence =
  | 'CONFIRMED'
  | 'OBSERVED'
  | 'PARTIAL'
  | 'UNKNOWN';

/**
 * قيمة موثّقة بمصدرها وثقتها.
 * T يجب أن يكون نوعًا قابلًا للتسلسل JSON (string | number | boolean | null
 * | كائن مسطح). لا دوال، لا class instances.
 */
export interface Evidence<T> {
  /** القيمة — null فقط عند confidence = UNKNOWN */
  value: T | null;
  source: EvidenceSource;
  confidence: EvidenceConfidence;
  /** وقت الالتقاط (ms since epoch) */
  at: number;
  /** ملاحظة قصيرة اختيارية (بالإنجليزية، بدون قيم حساسة) */
  notes?: string;
}

/** خريطة حقول موثّقة (signal/band/cell) — أسماء الحقول فقط */
export interface FieldEvidence {
  [fieldName: string]: Evidence<string | number>;
}

// ═══════════════════════════════════════════════════════════════════════
// Compatibility Levels
// ═══════════════════════════════════════════════════════════════════════

/**
 * مستوى التوافق مع راوتر — يُحدَّد من Evidence فقط، لا تخمين:
 *
 *   FULL             : قراءة كاملة + إعدادات (band lock, cell lock...)
 *   READ_ONLY        : إشارة + نطاقات + خلايا + CA، بدون أي كتابة
 *   PARTIAL          : إشارة + معلومات جهاز فقط
 *   DISCOVERY_ONLY   : اكتُشف لكن لا Driver (API لم يُفهم بعد)
 *   UNSUPPORTED      : لا واجهة قابلة للاستخدام
 */
export type CompatibilityLevel =
  | 'FULL'
  | 'READ_ONLY'
  | 'PARTIAL'
  | 'DISCOVERY_ONLY'
  | 'UNSUPPORTED';

// ═══════════════════════════════════════════════════════════════════════
// Fingerprint (بصمة الراوتر)
// ═══════════════════════════════════════════════════════════════════════

export type FingerprintKind =
  | 'server'          // من ترويسة Server
  | 'title'           // من <title>
  | 'meta-generator'  // من <meta name="generator">
  | 'html-signature'  // من معرف في HTML (مثل data-brand)
  | 'custom';

export interface RouterFingerprint {
  kind: FingerprintKind;
  /** القيمة بعد التنظيف — لا بيانات حساسة */
  value: string;
  /** وزن البصمة عند المطابقة (افتراضي 1) */
  weight?: number;
  at: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Endpoints — ما اكتشفناه عن نقاط الوصول
// ═══════════════════════════════════════════════════════════════════════

export type SchemaKind = 'json' | 'xml' | 'html' | 'text' | 'unknown';

/**
 * ملخّص بنية الاستجابة — مفاتيح فقط، لا قيم.
 * الهدف: نعرف "شكل" البيانات بدون تسريب أي شيء.
 */
export interface SchemaSummary {
  kind: SchemaKind;
  /** مفاتيح JSON top-level فقط */
  jsonKeys?: string[];
  /** وسوم XML top-level فقط */
  xmlTags?: string[];
}

export interface DiscoveredEndpoint {
  /** المسار فقط، بدون query values */
  path: string;
  /** Discovery لا يستخدم إلا GET — مثبت في النوع */
  method: 'GET';
  /** رمز الحالة أو 'ERR' عند فشل الشبكة */
  status: number | 'ERR';
  contentType: string;
  /** بنية الاستجابة (مفاتيح/وسوم فقط) */
  schema?: SchemaSummary;
  /** هل هذا المسار يحتاج مصادقة؟ (401/403) */
  authRequired: boolean;
  /** من أين عرفنا هذا الـ endpoint */
  source: EvidenceSource;
  /** زمن التنفيذ ms */
  ms: number;
  at: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Capabilities — كل قدرة كـ Evidence<boolean>
// ═══════════════════════════════════════════════════════════════════════

export interface CapabilityEvidence {
  signal: Evidence<boolean>;
  lte: Evidence<boolean>;
  nr: Evidence<boolean>;
  bands: Evidence<boolean>;
  cells: Evidence<boolean>;
  neighborCells: Evidence<boolean>;
  carrierAggregation: Evidence<boolean>;
  deviceInfo: Evidence<boolean>;
  traffic: Evidence<boolean>;
  usage: Evidence<boolean>;
  sms: Evidence<boolean>;
  bandLock: Evidence<boolean>;
  cellLock: Evidence<boolean>;
  reboot: Evidence<boolean>;
  block: Evidence<boolean>;
}

// ═══════════════════════════════════════════════════════════════════════
// Errors — كل خطأ موثَّق
// ═══════════════════════════════════════════════════════════════════════

export type DiscoveryErrorKind =
  | 'timeout'
  | 'http'
  | 'network'
  | 'parse'
  | 'malformed'
  | 'policy-denied'
  | 'unknown';

export interface DiscoveryError {
  step: string;
  kind: DiscoveryErrorKind;
  status?: number;
  message: string;
  at: number;
}

// ═══════════════════════════════════════════════════════════════════════
// DiscoveredRouter — نتيجة جلسة استكشاف داخلية
// ═══════════════════════════════════════════════════════════════════════

export interface DiscoveredRouter {
  /** العنوان المحلي (لا يُصدَّر خارجيًا بدون تعمية) */
  host: string;
  /** البروتوكولات التي استجابت */
  protocols: Array<'http' | 'https'>;
  /** الشركة/الموديل/الإصدار — كلها Evidence */
  manufacturer: Evidence<string>;
  model: Evidence<string>;
  firmware: Evidence<string>;
  hardwareVersion: Evidence<string>;
  /** بصمات مساعدة في التطابق */
  fingerprints: RouterFingerprint[];
  /** نقاط الوصول المكتشفة */
  endpoints: DiscoveredEndpoint[];
  /** القدرات المستنتجة */
  capabilities: CapabilityEvidence;
  /** حقول الإشارة المكتشفة (اسم الحقل → Evidence) */
  signalFields: FieldEvidence;
  /** حقول النطاقات */
  bandFields: FieldEvidence;
  /** حقول الخلايا */
  cellFields: FieldEvidence;
  /** أخطاء حدثت أثناء الاستكشاف */
  errors: DiscoveryError[];
  /** مستوى التوافق النهائي */
  compatLevel: CompatibilityLevel;
  /** وقت بدء الجلسة */
  at: number;
}

// ═══════════════════════════════════════════════════════════════════════
// RouterDiagnosticPackage — الحزمة القابلة للتصدير
// ═══════════════════════════════════════════════════════════════════════

export interface ScreenshotEvidence {
  /** معرّف الخطوة (device-info | signal | cells | bands...) */
  step: string;
  /** مسار محلي فقط — لا يُرفع الخام أبدًا */
  localUri: string;
  /** مناطق أُخفيت (اختياري) */
  redactedRegions?: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  /** الحقول المستخرجة يدويًا من الصورة */
  extracted: FieldEvidence;
  at: number;
}

export interface ConsentRecord {
  at: string;
  /** ما وافق عليه المستخدم — قائمة معرفات */
  scopes: string[];
  /** نسخة صيغة الموافقة */
  version: 1;
}

export interface RouterDiagnosticPackage {
  /** نسخة schema — تسمح بالتوافق المستقبلي */
  schema: DiscoverySchemaVersion;
  generatedAt: string;
  appVersion: string;
  device: {
    manufacturer: Evidence<string>;
    model: Evidence<string>;
    firmware: Evidence<string>;
    hardwareVersion: Evidence<string>;
  };
  discovery: {
    protocols: Array<'http' | 'https'>;
    /** نمط العنوان بعد التعمية: "192.168.x.x" */
    hostPattern: string;
    fingerprints: RouterFingerprint[];
  };
  endpoints: DiscoveredEndpoint[];
  capabilities: CapabilityEvidence;
  signalFields: FieldEvidence;
  bandFields: FieldEvidence;
  cellFields: FieldEvidence;
  screenshots: ScreenshotEvidence[];
  errors: DiscoveryError[];
  compatLevel: CompatibilityLevel;
  /** إقرار الموافقة — إلزامي قبل التصدير */
  userConsent: ConsentRecord;
}

// ═══════════════════════════════════════════════════════════════════════
// Read-Only Safety Policy
// ═══════════════════════════════════════════════════════════════════════

/**
 * قرار السياسة لأي طلب Discovery.
 *   - ALLOW                    : آمن، نفّذه
 *   - DENY                     : ممنوع، ارفضه بلا نقاش
 *   - REQUIRE_USER_CONFIRMATION: مشكوك، اطلب موافقة صريحة
 */
export type PolicyDecision =
  | 'ALLOW'
  | 'DENY'
  | 'REQUIRE_USER_CONFIRMATION';

/**
 * رمز داخلي منظّم لقرار السياسة — للتسجيل والاختبار.
 * لا تُستخدم رسائل عربية داخل المنطق.
 */
export type PolicyCode =
  | 'SAFE_READ'
  | 'SAFE_DISCOVERY_PAGE'
  | 'NON_GET_METHOD'
  | 'UNSAFE_HOST'
  | 'INVALID_URL'
  | 'PATH_TRAVERSAL'
  | 'DANGEROUS_PATH'
  | 'DANGEROUS_QUERY'
  | 'WRITE_GOFORM'
  | 'UNKNOWN_ZTE_CMD'
  | 'UNKNOWN_ENDPOINT'
  | 'AUTH_CONTEXT'
  | 'AUTH_ENDPOINT';

export interface PolicyResult {
  decision: PolicyDecision;
  /** رمز داخلي منظّم */
  code: PolicyCode;
  /** سبب إنجليزي تقني — لا عربي */
  reason: string;
  /** اسم القاعدة التي طُبِّقت (اختياري، للتشخيص) */
  rule?: string;
}

/**
 * سياق اختياري للطلب — يُوسَّع لاحقًا عند الحاجة.
 * PHASE 2 لا يستخدمه إلا لتمييز طلبات المصادقة.
 */
export interface PolicyContext {
  /** هل يحمل الطلب Authorization/Cookie/Credentials؟ */
  hasAuth?: boolean;
  /** هل هذا الطلب نتيجة redirect؟ */
  afterRedirect?: boolean;
  /** العنوان الأصلي قبل redirect (للمقارنة) */
  originalUrl?: string;
}

/**
 * مدخل السياسة — الحد الأدنى المطلوب.
 * method + url + سياق اختياري.
 */
export interface PolicyInput {
  method: string;
  url: string;
  context?: PolicyContext;
}
