import type { NetStandard } from './huawei/netStandard';
export type { NetStandard } from './huawei/netStandard';
export type Capability =
  'signal' | 'devices' | 'reboot' | 'bandLock' | 'sms' | 'usage'
  | 'block' | 'traffic' | 'cells';

export interface Signal {
  network?: string; band?: string; cellId?: string; pci?: string; earfcn?: string;
  dlBandwidth?: string; ulBandwidth?: string;
  rsrp?: number; rsrq?: number; sinr?: number; rssi?: number;
  nrBand?: string; nrPci?: string; nrArfcn?: string; nrDlBandwidth?: string;
  nrRsrp?: number; nrRsrq?: number; nrSinr?: number;
  /** قوة تغطية 5G المتاحة (0–5) حتى لو الوصلة خاملة */
  nrAvailable?: number;
  /** الراوتر يقول 5G نشط (NSA/SA) حسب CurrentNetworkTypeEx — حتى لو nrRsrp فاضي */
  nrActiveFromStatus?: boolean;
  /** صحة الوصلة: CQI (0–15) وسرعة الترميز MCS وقوة الإرسال وعدد المسارات */
  cqi?: number; dlMcs?: number; ulMcs?: number; txPower?: number; dlStreams?: number;
  nrCqi?: number; nrDlMcs?: number; nrTxPower?: number; nrRank?: number;
  /** رقم موقع البرج الفعلي */
  enodebId?: string;
  /** عدد النواقل المدموجة (CA) حين يكشفها الجهاز بعرض النطاقات بدل خلايا منفصلة */
  caCount?: number;
  /** مجموع عرض النطاق المدموج بالـ MHz */
  caBandwidthMhz?: number;
}

export interface NetworkInfo {
  operator?: string; connected?: boolean; mode?: string;
  /** true = الراوتر يدعم 5G، false = 4G فقط (مؤكد)، undefined = ما نعرف */
  supports5g?: boolean;
}
export interface Traffic { downBytesPerSec: number; upBytesPerSec: number; connectedSecs: number; }
/** راديو واي فاي واحد (2.4 أو 5) وقناته الحالية — '0' = تلقائي */
export interface WifiRadio {
  band: '2.4' | '5';
  channel: string;
  /** القنوات المسموحة لو الراوتر يعطينا قائمة */
  allowed?: string[];
  /** نقدر نغيّرها من التطبيق؟ */
  writable: boolean;
}

/** إعدادات «مركز التحكم» — كل حقل موجود بس لو الراوتر يدعمه */
export interface RouterExtras {
  /** cone = مفتوح (أفضل للألعاب)، symmetric = مقيّد */
  nat?: 'cone' | 'symmetric';
  upnp?: boolean;
  dmz?: { on: boolean; ip: string };
  /** إطفاء أنوار الراوتر بالليل — الوقت HH:MM */
  ledNight?: { on: boolean; start: string; end: string };
  /** إعادة تشغيل تلقائية — from/to بالدقائق من منتصف الليل */
  autoReboot?: { on: boolean; everyDays: number; from: number; to: number };
  /** منافذ فتحتها الألعاب/الأجهزة عبر UPnP */
  upnpMaps?: { app: string; ip: string; port: string; proto: string }[];
  /** شبكة الضيوف — offHours: 0 = بدون إطفاء، 4 ساعات، 24 = يوم */
  guest?: { on: boolean; name: string; open: boolean; offHours: number; remainSecs?: number; noTimer?: boolean };
  /** تشغيل/إطفاء كل شبكة واي فاي */
  bands?: { band: '2.4' | '5'; on: boolean }[];
  /** مدة تشغيل الراوتر كما يرجعها (مثل 3:12:05 أو 2 يوم) */
  uptime?: string;
  /** أوقات النت للأجهزة — الجهاز يشتغل عليه النت بس داخل الوقت. days: ٧ خانات تبدأ بالاثنين */
  timeRules?: TimeRule[];
  timeRuleMax?: number;
  /** حجب المواقع — macs فاضية = على كل الأجهزة */
  urlBlocks?: { url: string; macs: string[] }[];
  /** يرجّع الاتصال لحاله لو طاحت الخدمة (No Service) */
  autoRecover?: boolean;
  /** الواي فاي ينام بعد كذا دقيقة بدون أجهزة — -1 = دايماً شغّال (راوترات البطارية) */
  wifiSleep?: number;
  /** صحة الجهاز: البطارية والحرارة (°م) — throttle = الراوتر قاعد يخفّف قوته بسبب الحرارة */
  health?: { battery?: number; charging?: boolean; tempC?: number; throttle?: boolean };
}

export interface TimeRule { id: string; mac: string; on: boolean; days: string; start: string; end: string; raw?: string }

export interface ConnectedDevice { mac: string; ip?: string; name?: string; blocked?: boolean; }
export interface Usage { downloadBytes: number; uploadBytes: number; }
export interface NetworkModeOption { value: string; label: string; }
export interface DeviceDetails {
  model?: string; imei?: string; software?: string; hardware?: string;
  wanIp?: string; dns?: string; operator?: string; simStatus?: string;
}

export interface CellTower {
  kind: 'serving' | 'secondary' | 'neighbor';
  tech: 'LTE' | 'NR';
  arfcn?: string;
  band?: number;
  pci?: string;
  cellId?: string;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  rssi?: number;
}

export interface DataPlan {
  startDay: number;
  limitBytes: number;
  monthThreshold: number;
}
export interface CellLockTarget {
  tech: 'LTE' | 'NR';
  band?: number;
  arfcn?: string;
  pci: string;
}
export interface ActiveLock {
  bands: number[];
  nrBands: number[];
  pci?: string;
}
export interface CellLockState {
  pci?: string;
  band?: number;
  arfcn?: string;
  tech?: 'LTE' | 'NR';
}
export interface BandConfig {
  supported: number[];
  locked: number[];
  nrSupported: number[];
  nrLocked: number[];
  mode: string;
  modes: NetworkModeOption[];
  /**
   * false = الراوتر فيه 5G بس ما يقبل تثبيت تردد 5G معيّن (مثل H158: بدون lock-freq) —
   * nrSupported يكون فاضي (ما فيه شي تختاره) والشاشات توضّح إن 5G يبقى تلقائي.
   * undefined = يقبل (أو الراوتر 4G بس).
   */
  nrLockable?: boolean;
  /**
   * الراوتر يدعم دور لكل تردد: «أساسي + ثانوي» أو «ثانوي بس» (هواوي lock-freq).
   * locked/nrLocked = كل الترددات المسموحة، و lteScell/nrScell = اللي منها ثانوي بس.
   */
  bandRoles?: boolean;
  lteScell?: number[];
  nrScell?: number[];
  /** نوع القفل الحالي لكل تقنية (للعرض) */
  lockKinds?: { lte: 'none' | 'band' | 'channel' | 'cell'; nr: 'none' | 'band' | 'channel' | 'cell' };
}

/** ترددات «ثانوي بس» (لازم تكون ضمن الترددات المسموحة) — للراوترات اللي bandRoles عندها true */
export interface BandRoles {
  lteScell?: number[];
  nrScell?: number[];
}
export interface SmsMessage { index: string; phone: string; content: string; date: string; unread: boolean; }

/** ملف اتصال APN */
export interface ApnProfile {
  index: string;
  name: string;
  apn: string;
  username?: string;
  authMode?: string;
  ipType?: string;
  current: boolean;
  readOnly?: boolean;
}

/** ناقل نشط — أساسي (PCC) أو إضافي مدموج (SCC) */
export interface Carrier {
  tech: 'LTE' | 'NR';
  band: number;
  role: 'PCC' | 'SCC';
  arfcn?: string;
  pci?: string;
  bandwidth?: number;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
}

/** إعداد DNS للشبكة المحلية */
export interface DnsConfig { manual: boolean; primary?: string; secondary?: string; }

/* ============================================================
 * SignalSnapshot — واجهة موحّدة للإشارة عبر كل الدرايفرات
 * ============================================================ */

export interface SignalSnapshotLte {
  pci?: string;
  cellId?: string;
  earfcn?: string;
  band?: number;
  bandwidth?: number;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  rssi?: number;
  cqi?: number;
  dlMcs?: number;
  ulMcs?: number;
  txPower?: number;
  dlStreams?: number;
  enodebId?: string;
}
export interface SignalSnapshotNr {
  pci?: string;
  arfcn?: string;
  band?: number;
  bandwidth?: number;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  cqi?: number;
  dlMcs?: number;
  txPower?: number;
  rank?: number;
  /** قوة تغطية 5G المتاحة (0–5) */
  available?: number;
}
export interface SignalSnapshotHealth {
  /** 0–100 */
  score?: number;
  quality?: 'ممتاز' | 'جيد' | 'متوسط' | 'ضعيف';
  cqi?: number;
  dlMcs?: number;
  ulMcs?: number;
}
export interface SignalSnapshotSource {
  driverId: string;
  driverName: string;
  tech?: string;
  at: number;
}
export interface SignalSnapshot {
  lte?: SignalSnapshotLte;
  nr?: SignalSnapshotNr;
  ca?: Carrier[];
  neighbors?: CellTower[];
  health?: SignalSnapshotHealth;
  source: SignalSnapshotSource;
}

export interface RouterDriver {
  readonly id: string;
  readonly name: string;
  readonly capabilities: Capability[];
  detect(host: string): Promise<boolean>;
  login(host: string, username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  getSignal?(): Promise<Signal>;
  getSnapshot?(): Promise<SignalSnapshot>;
  getNetworkInfo?(): Promise<NetworkInfo>;
  getDeviceDetails?(): Promise<DeviceDetails>;
  getCells?(): Promise<CellTower[]>;
  isConnected?(): Promise<boolean>;
  getTraffic?(): Promise<Traffic>;
  getDevices?(): Promise<ConnectedDevice[]>;
  getBlockedDevices?(): Promise<ConnectedDevice[]>;
  blockDevice?(mac: string, block: boolean, name?: string): Promise<void>;
  getUsage?(): Promise<Usage>;
  reboot?(): Promise<void>;
  /** يقطع اتصال البيانات ويرجّعه (آي بي جديد من الشركة) بدون إعادة تشغيل */
  reconnectData?(opts?: { holdSecs?: number }): Promise<void>;
  /** فصل كامل عن البرج ورجوع (مثل وضع الطيران) — الشركة تعطي آي بي جديد مثل إعادة التشغيل بس أسرع */
  reattach?(holdSecs?: number): Promise<void>;
  /** يطلّع الراوتر من وضع الطيران / وضع شبكة مؤقت لو علق بعد reattach — آمن ينادى في أي وقت */
  wakeRadio?(): Promise<void>;
  /** فحص المكان من الراوتر نفسه (ZTE «الموقع المقترح»): يبدأ القياس */
  placeCheckStart?(): Promise<void>;
  /** حالة الفحص: step من ٠ لـ ٤ (٤ = خلص) — quality من ١ (ضعيفة) لـ ٤ (مثالية) لما يخلص */
  placeCheckStatus?(): Promise<{ step: number; quality?: number }>;
  placeCheckCancel?(): Promise<void>;
  getBandConfig?(): Promise<BandConfig>;
  /** roles: اختياري — أي تردد فيه يصير «ثانوي بس» (الراوترات اللي ما تدعمه تتجاهله) */
  setBand?(bands: number[], nrBands?: number[], roles?: BandRoles): Promise<void>;
  lockCell?(target: CellLockTarget): Promise<void>;
  /**
   * لو موجود: التثبيت على برج خطر على هذا النوع (مثلاً ZTE يطيح بدون خدمة/واي فاي لين ضبط المصنع)
   * — الشاشات تخفي «ثبّت على برج» و«فحص بنق الأبراج» وتعرض هذا السبب. فك التثبيت يبقى متاح.
   */
  cellLockRisk?: string;
  /**
   * قفل قناة: التردد + رقم القناة بدون رقم برج — الراوتر يختار أفضل برج على هالقناة.
   * (هواوي lock-freq: lock_mode 1)
   */
  lockChannel?(target: { tech: 'LTE' | 'NR'; band?: number; arfcn: string }): Promise<void>;
  /**
   * «وضع الشبكة» الدقيق (هواوي WebUI 4.0): SA / NSA / SA+NSA / 4G / 4G FDD / 4G TDD.
   * يرجع null لو الراوتر ما يدعمه.
   */
  getNetStandard?(): Promise<NetStandard | null>;
  setNetStandard?(s: NetStandard): Promise<void>;
  /** بدون tech = يفك كل التثبيتات. مع tech = يفك تثبيت 4G أو 5G بس */
  unlockCell?(tech?: 'LTE' | 'NR'): Promise<void>;
  getCellLock?(): Promise<CellLockState | null>;
  /** كل التثبيتات الحالية (بعض الراوترات تثبّت 4G و 5G مع بعض) */
  getCellLocks?(): Promise<CellLockState[]>;
  getActiveLock?(): Promise<ActiveLock | null>;
  /**
   * إعدادات الراوتر الأصلية (ترددات، وضع الشبكة) — ترجع null لو الراوتر حالياً مقفول على شي
   * (ما نبي نحفظ وضع مقفول كأنه الأصلي). تنحفظ مرة وحدة لكل راوتر.
   */
  readBaseline?(): Promise<Record<string, string> | null>;
  /** يعطي الدرايفر الإعدادات الأصلية المحفوظة — «فك التثبيت» يرجع لها بدل قائمة تخمينية */
  useBaseline?(b: Record<string, string> | null): void;
  /**
   * إنقاذ: يفك كل الأقفال (أبراج، ترددات، وضع الشبكة) ويرجع الإعدادات الأصلية ويعيد التشغيل.
   * كل خطوة مستقلة — لو وحدة فشلت يكمل الباقي. ما يلمس الواي فاي ولا كلمة المرور.
   */
  restoreAll?(baseline: Record<string, string> | null): Promise<void>;
  getDataPlan?(): Promise<DataPlan>;
  setDataPlan?(plan: DataPlan): Promise<void>;
  setNetworkMode?(mode: string): Promise<void>;
  listSms?(box?: 'inbox' | 'sent'): Promise<SmsMessage[]>;
  markSmsRead?(index: string): Promise<void>;
  deleteSms?(index: string): Promise<void>;
  sendSms?(phone: string, text: string): Promise<void>;
  getApnProfiles?(): Promise<ApnProfile[]>;
  setApn?(p: { index: string; name: string; apn: string; username?: string; password?: string; authMode?: string }): Promise<void>;
  selectApn?(index: string): Promise<void>;
  getDns?(): Promise<DnsConfig>;
  setDns?(cfg: DnsConfig): Promise<void>;
  getCarriers?(): Promise<Carrier[]>;
  /** قنوات الواي فاي */
  getWifiRadios?(): Promise<WifiRadio[]>;
  setWifiChannel?(band: '2.4' | '5', channel: string): Promise<void>;
  /** نص خام للدعم لو الراوتر ما قبل التغيير */
  wifiDebug?(): Promise<string>;
  /** مركز التحكم */
  getExtras?(): Promise<RouterExtras>;
  setNat?(t: 'cone' | 'symmetric'): Promise<void>;
  setUpnp?(on: boolean): Promise<void>;
  setDmz?(on: boolean, ip: string, mac?: string): Promise<void>;
  setLedNight?(on: boolean, start: string, end: string): Promise<void>;
  setAutoReboot?(on: boolean): Promise<void>;
  setGuest?(on: boolean, offHours: number): Promise<void>;
  setBandOn?(band: '2.4' | '5', on: boolean): Promise<void>;
  addTimeRule?(r: { mac: string; name: string; days: string; start: string; end: string }): Promise<void>;
  updateTimeRule?(r: TimeRule, action: 'update' | 'delete', on?: boolean): Promise<void>;
  setUrlBlocks?(list: { url: string; macs: string[] }[]): Promise<void>;
  setAutoRecover?(on: boolean): Promise<void>;
  setWifiSleep?(mins: number): Promise<void>;
}
