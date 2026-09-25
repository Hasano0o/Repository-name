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
}

export interface NetworkInfo {
  operator?: string; connected?: boolean; mode?: string;
  /** true = الراوتر يدعم 5G، false = 4G فقط (مؤكد)، undefined = ما نعرف */
  supports5g?: boolean;
}
export interface Traffic { downBytesPerSec: number; upBytesPerSec: number; connectedSecs: number; }
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
}
export interface BandConfig {
  supported: number[];
  locked: number[];
  nrSupported: number[];
  nrLocked: number[];
  mode: string;
  modes: NetworkModeOption[];
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
  getBandConfig?(): Promise<BandConfig>;
  setBand?(bands: number[], nrBands?: number[]): Promise<void>;
  lockCell?(target: CellLockTarget): Promise<void>;
  unlockCell?(): Promise<void>;
  getCellLock?(): Promise<CellLockState | null>;
  getActiveLock?(): Promise<ActiveLock | null>;
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
}
