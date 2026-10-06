import {
  RouterDriver, Capability, Signal, SignalSnapshot, CellTower, Carrier, NetworkInfo,
  DeviceDetails, Traffic, ConnectedDevice, Usage, BandConfig, CellLockTarget, CellLockState,
  ActiveLock, DataPlan, SmsMessage, ApnProfile, DnsConfig,
} from '../types';
import { buildSnapshot } from '../../utils/snapshot';
import { listRouters, saveRouter } from '../../store/routers';

/**
 * «راوتر تجريبي» — يعرض التطبيق كامل بدون راوتر حقيقي:
 * لمراجعي المتاجر، ولأي أحد يبي يشوف التطبيق قبل ما يربطه براوتره.
 * كل شي في الذاكرة: القراءات تتحرك شوي مع الوقت، والتثبيت/الترددات تتغير فعلاً داخل الوضع التجريبي.
 */
export const DEMO_HOST = 'demo';
export const DEMO_DRIVER_ID = 'demo';
export const isDemoHost = (host?: string) => host === DEMO_HOST;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** تذبذب ناعم حسب الوقت — نفس القيمة لكل الشاشات بنفس اللحظة */
const wave = (seed: number, amp: number) => {
  const t = Date.now() / 1000;
  return Math.round((Math.sin(t / 7 + seed) * 0.6 + Math.sin(t / 2.3 + seed * 3) * 0.4) * amp * 10) / 10;
};

interface DemoCell { tech: 'LTE' | 'NR'; band: number; arfcn: string; pci: string; cellId: string; rsrp: number; rsrq: number; sinr: number }

const CELLS: DemoCell[] = [
  { tech: 'LTE', band: 3, arfcn: '1300', pci: '214', cellId: '28411905', rsrp: -82, rsrq: -8, sinr: 19 },
  { tech: 'LTE', band: 1, arfcn: '100', pci: '214', cellId: '28411906', rsrp: -86, rsrq: -9, sinr: 16 },
  { tech: 'LTE', band: 40, arfcn: '38950', pci: '87', cellId: '28411907', rsrp: -90, rsrq: -10, sinr: 13 },
  { tech: 'LTE', band: 3, arfcn: '1300', pci: '318', cellId: '28399112', rsrp: -103, rsrq: -14, sinr: 3 },
  { tech: 'LTE', band: 28, arfcn: '9410', pci: '45', cellId: '28399113', rsrp: -88, rsrq: -13, sinr: 5 },
  { tech: 'LTE', band: 1, arfcn: '100', pci: '402', cellId: '28420051', rsrp: -108, rsrq: -16, sinr: 0 },
  { tech: 'NR', band: 78, arfcn: '636666', pci: '401', cellId: '', rsrp: -86, rsrq: -9, sinr: 17 },
  { tech: 'NR', band: 78, arfcn: '636666', pci: '122', cellId: '', rsrp: -106, rsrq: -14, sinr: 4 },
  { tech: 'NR', band: 41, arfcn: '504990', pci: '77', cellId: '', rsrp: -110, rsrq: -15, sinr: 2 },
];

const LTE_ALL = [1, 3, 7, 8, 20, 28, 38, 40, 41];
const NR_ALL = [1, 3, 28, 41, 78];

const MODES = [
  { value: '00', label: 'تلقائي' },
  { value: '0803', label: '4G + 5G' },
  { value: '03', label: '4G فقط' },
  { value: '08', label: '5G فقط (SA)' },
];

const DEVICES: ConnectedDevice[] = [
  { mac: 'A4:C3:F0:12:9B:01', ip: '192.168.8.100', name: 'جوال أبو محمد' },
  { mac: '3C:22:FB:7E:10:42', ip: '192.168.8.101', name: 'آيباد العيال' },
  { mac: 'F0:9F:C2:44:AA:13', ip: '192.168.8.102', name: 'بلايستيشن 5' },
  { mac: '58:D5:6E:01:C9:77', ip: '192.168.8.103', name: 'تلفزيون المجلس' },
  { mac: '9C:B6:D0:5A:2E:08', ip: '192.168.8.104', name: 'لابتوب' },
];

export class DemoDriver implements RouterDriver {
  id = DEMO_DRIVER_ID;
  name = 'راوتر تجريبي';
  capabilities: Capability[] = ['signal', 'devices', 'reboot', 'bandLock', 'sms', 'usage', 'block', 'traffic', 'cells'];

  private lteLocked: number[] = [];
  private nrLocked: number[] = [];
  private mode = '00';
  private locks: CellLockState[] = [];
  private blocked = new Set<string>();
  private rebootUntil = 0;
  private startedAt = Date.now() - 3 * 3600 * 1000 - 17 * 60 * 1000;
  private plan: DataPlan = { startDay: 1, limitBytes: 500 * 1024 ** 3, monthThreshold: 90 };
  private sms: SmsMessage[] = [
    { index: '3', phone: 'STC', content: 'عميلنا العزيز، تم تجديد باقة الإنترنت المنزلي بنجاح. شكراً لاختيارك.', date: '2026-10-05 09:12', unread: true },
    { index: '2', phone: '900', content: 'رصيد باقتك المتبقي: 312 جيجابايت. صالحة حتى 2026-11-01.', date: '2026-10-02 18:40', unread: false },
    { index: '1', phone: 'STC', content: 'مرحباً بك، تم تفعيل الشريحة بنجاح.', date: '2026-09-28 14:03', unread: false },
  ];
  private sent: SmsMessage[] = [];
  private apns: ApnProfile[] = [{ index: '1', name: 'STC Internet', apn: 'jawalnet.com.sa', current: true, readOnly: true }];
  private dns: DnsConfig = { manual: false };

  async detect(host: string) { return isDemoHost(host); }
  async login() { await sleep(250); }
  async logout() { /* ما فيه جلسة */ }

  private async alive() {
    await sleep(120 + Math.random() * 180);
    if (Date.now() < this.rebootUntil) throw new Error('تعذر الاتصال بالراوتر — يعيد التشغيل');
  }

  /** الأبراج المسموحة حسب التثبيت والترددات والوضع */
  private allowed(c: DemoCell): boolean {
    if (c.tech === 'LTE' && this.mode === '08') return false;
    if (c.tech === 'NR' && this.mode === '03') return false;
    const bands = c.tech === 'LTE' ? this.lteLocked : this.nrLocked;
    if (bands.length && !bands.includes(c.band)) return false;
    const lk = this.locks.find(l => l.tech === c.tech);
    if (lk && (lk.pci !== c.pci || (lk.band && lk.band !== c.band))) return false;
    return true;
  }

  private live(c: DemoCell, i: number): DemoCell {
    return { ...c, rsrp: Math.round(c.rsrp + wave(i, 2.5)), rsrq: Math.round(c.rsrq + wave(i + 9, 1)), sinr: Math.round((c.sinr + wave(i + 4, 2)) * 10) / 10 };
  }

  private pick() {
    const all = CELLS.map((c, i) => this.live(c, i));
    const best = (tech: 'LTE' | 'NR') => all.filter(c => c.tech === tech && this.allowed(c)).sort((a, b) => b.rsrp - a.rsrp)[0];
    // الأساسي: أفضل برج 4G ليس على 700 (مثل الراوترات الحقيقية تفضّل السعة على المدى)
    const lteCands = all.filter(c => c.tech === 'LTE' && this.allowed(c));
    const pcc = lteCands.find(c => c.band !== 28) ?? lteCands[0];
    const scc = pcc ? lteCands.filter(c => c !== pcc && c.cellId.slice(0, 6) === pcc.cellId.slice(0, 6) && c.band !== pcc.band) : [];
    const nr = best('NR');
    return { all, pcc, scc, nr };
  }

  async getSignal(): Promise<Signal> {
    await this.alive();
    const { pcc, scc, nr } = this.pick();
    const network = pcc && nr ? '5G NSA' : nr ? '5G SA' : pcc ? (scc.length ? 'LTE-A' : 'LTE') : undefined;
    return {
      network,
      band: pcc ? String(pcc.band) : undefined, cellId: pcc?.cellId, pci: pcc?.pci, earfcn: pcc?.arfcn,
      dlBandwidth: pcc ? '20MHz' : undefined, ulBandwidth: pcc ? '20MHz' : undefined,
      rsrp: pcc?.rsrp, rsrq: pcc?.rsrq, sinr: pcc?.sinr, rssi: pcc ? pcc.rsrp + 22 : undefined,
      nrBand: nr ? String(nr.band) : undefined, nrPci: nr?.pci, nrArfcn: nr?.arfcn, nrDlBandwidth: nr ? '100MHz' : undefined,
      nrRsrp: nr?.rsrp, nrRsrq: nr?.rsrq, nrSinr: nr?.sinr, nrAvailable: nr ? 4 : 0, nrActiveFromStatus: !!nr,
      cqi: pcc ? 11 + Math.round(wave(2, 1)) : undefined, dlMcs: pcc ? 22 : undefined, ulMcs: pcc ? 16 : undefined,
      txPower: pcc ? 8 : undefined, dlStreams: pcc ? 2 : undefined,
      nrCqi: nr ? 10 : undefined, nrDlMcs: nr ? 20 : undefined, nrRank: nr ? 4 : undefined,
      enodebId: pcc ? String(Math.floor(Number(pcc.cellId) / 256)) : undefined,
      caCount: pcc ? 1 + scc.length : undefined,
    };
  }

  async getCarriers(): Promise<Carrier[]> {
    await this.alive();
    const { pcc, scc, nr } = this.pick();
    const out: Carrier[] = [];
    if (pcc) out.push({ tech: 'LTE', band: pcc.band, role: 'PCC', arfcn: pcc.arfcn, pci: pcc.pci, bandwidth: 20, rsrp: pcc.rsrp, rsrq: pcc.rsrq, sinr: pcc.sinr });
    for (const c of scc) out.push({ tech: 'LTE', band: c.band, role: 'SCC', arfcn: c.arfcn, pci: c.pci, bandwidth: c.band === 40 ? 20 : 15, rsrp: c.rsrp, rsrq: c.rsrq, sinr: c.sinr });
    if (nr) out.push({ tech: 'NR', band: nr.band, role: pcc ? 'SCC' : 'PCC', arfcn: nr.arfcn, pci: nr.pci, bandwidth: 100, rsrp: nr.rsrp, rsrq: nr.rsrq, sinr: nr.sinr });
    return out;
  }

  async getCells(): Promise<CellTower[]> {
    await this.alive();
    const { all, pcc, scc, nr } = this.pick();
    return all.map(c => ({
      kind: c === pcc || c === nr ? 'serving' : scc.includes(c) ? 'secondary' : 'neighbor',
      tech: c.tech, arfcn: c.arfcn, band: c.band, pci: c.pci, cellId: c.cellId || undefined,
      rsrp: c.rsrp, rsrq: c.rsrq, sinr: c.sinr,
    }));
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const [sig, ca, cells] = await Promise.all([this.getSignal(), this.getCarriers(), this.getCells()]);
    return buildSnapshot(sig, ca, cells, { driverId: this.id, driverName: this.name });
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    await this.alive();
    const { pcc, nr } = this.pick();
    return { operator: 'STC', connected: !!(pcc || nr), mode: this.mode, supports5g: true };
  }

  async isConnected() {
    try { return !!(await this.getNetworkInfo()).connected; } catch { return false; }
  }

  async getDeviceDetails(): Promise<DeviceDetails> {
    await this.alive();
    return {
      model: 'راوتر تجريبي 5G', imei: '860000000000000', software: '11.0.2.1', hardware: 'DEMO-5G',
      wanIp: '10.84.21.17', dns: '212.26.18.41', operator: 'STC', simStatus: 'جاهزة',
    };
  }

  async getTraffic(): Promise<Traffic> {
    await this.alive();
    const base = this.pick().nr ? 9_500_000 : 3_200_000;
    return {
      downBytesPerSec: Math.max(0, Math.round(base * (1 + wave(5, 0.35)))),
      upBytesPerSec: Math.max(0, Math.round(base * 0.12 * (1 + wave(8, 0.4)))),
      connectedSecs: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  async getUsage(): Promise<Usage> {
    await this.alive();
    return { downloadBytes: 187.4 * 1024 ** 3, uploadBytes: 21.9 * 1024 ** 3 };
  }

  async getDevices(): Promise<ConnectedDevice[]> {
    await this.alive();
    return DEVICES.filter(d => !this.blocked.has(d.mac));
  }

  async getBlockedDevices(): Promise<ConnectedDevice[]> {
    await this.alive();
    return DEVICES.filter(d => this.blocked.has(d.mac)).map(d => ({ ...d, blocked: true }));
  }

  async blockDevice(mac: string, block: boolean) {
    await this.alive();
    if (block) this.blocked.add(mac); else this.blocked.delete(mac);
  }

  async reboot() {
    await this.alive();
    this.rebootUntil = Date.now() + 25_000;
    this.startedAt = this.rebootUntil;
  }

  async getBandConfig(): Promise<BandConfig> {
    await this.alive();
    return { supported: LTE_ALL, locked: [...this.lteLocked], nrSupported: NR_ALL, nrLocked: [...this.nrLocked], mode: this.mode, modes: MODES };
  }

  async setBand(bands: number[], nrBands?: number[]) {
    await this.alive();
    this.lteLocked = bands.filter(b => LTE_ALL.includes(b));
    if (nrBands) this.nrLocked = nrBands.filter(b => NR_ALL.includes(b));
    await sleep(600);
  }

  async setNetworkMode(mode: string) {
    await this.alive();
    if (MODES.some(m => m.value === mode)) this.mode = mode;
    await sleep(600);
  }

  async lockCell(t: CellLockTarget) {
    await this.alive();
    this.locks = [...this.locks.filter(l => l.tech !== t.tech), { tech: t.tech, pci: t.pci, band: t.band, arfcn: t.arfcn }];
    await sleep(600);
  }

  async unlockCell(tech?: 'LTE' | 'NR') {
    await this.alive();
    this.locks = tech ? this.locks.filter(l => l.tech !== tech) : [];
  }

  async getCellLock() { await this.alive(); return this.locks[0] ?? null; }
  async getCellLocks() { await this.alive(); return [...this.locks]; }

  async getActiveLock(): Promise<ActiveLock | null> {
    await this.alive();
    if (!this.lteLocked.length && !this.nrLocked.length && !this.locks.length) return null;
    return { bands: [...this.lteLocked], nrBands: [...this.nrLocked], pci: this.locks[0]?.pci };
  }

  async readBaseline() { return { mode: '00' }; }
  useBaseline() { /* لا شي */ }

  async restoreAll() {
    await this.alive();
    this.lteLocked = []; this.nrLocked = []; this.locks = []; this.mode = '00';
    this.rebootUntil = Date.now() + 15_000;
  }

  async getDataPlan() { await this.alive(); return { ...this.plan }; }
  async setDataPlan(p: DataPlan) { await this.alive(); this.plan = { ...p }; }

  async listSms(box: 'inbox' | 'sent' = 'inbox') {
    await this.alive();
    return box === 'sent' ? [...this.sent] : [...this.sms];
  }
  async markSmsRead(index: string) { this.sms = this.sms.map(m => (m.index === index ? { ...m, unread: false } : m)); }
  async deleteSms(index: string) {
    this.sms = this.sms.filter(m => m.index !== index);
    this.sent = this.sent.filter(m => m.index !== index);
  }
  async sendSms(phone: string, text: string) {
    await this.alive();
    this.sent = [{ index: `s${Date.now()}`, phone, content: text, date: new Date().toISOString().slice(0, 16).replace('T', ' '), unread: false }, ...this.sent];
  }

  async getApnProfiles() { await this.alive(); return this.apns.map(a => ({ ...a })); }
  async selectApn(index: string) { this.apns = this.apns.map(a => ({ ...a, current: a.index === index })); }
  async setApn(p: { index: string; name: string; apn: string; username?: string; authMode?: string }) {
    const i = this.apns.findIndex(a => a.index === p.index);
    const row: ApnProfile = { index: p.index || String(this.apns.length + 1), name: p.name, apn: p.apn, username: p.username, authMode: p.authMode, current: false };
    if (i >= 0) this.apns[i] = { ...this.apns[i], ...row, current: this.apns[i].current }; else this.apns.push(row);
  }

  async getDns() { await this.alive(); return { ...this.dns }; }
  async setDns(c: DnsConfig) { await this.alive(); this.dns = { ...c }; }
}

/** يضيف الراوتر التجريبي (أو يرجّع الموجود) */
export async function addDemoRouter(): Promise<string> {
  const have = (await listRouters()).find(r => r.driverId === DEMO_DRIVER_ID);
  if (have) return have.id;
  const r = await saveRouter({ name: 'راوتر تجريبي', host: DEMO_HOST, username: '', driverId: DEMO_DRIVER_ID, driverName: 'راوتر تجريبي' }, '');
  return r.id;
}
