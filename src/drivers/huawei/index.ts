import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2';
import { hmac } from '@noble/hashes/hmac';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import {
  RouterDriver, Capability, Signal, ConnectedDevice, Usage, NetworkInfo, Traffic,
  BandConfig, SmsMessage, DeviceDetails, CellTower, CellLockTarget, CellLockState, DataPlan, ActiveLock,
  ApnProfile, DnsConfig, Carrier, SignalSnapshot,
} from '../types';
import { http } from '../http';
import { trafficBurst } from '../../utils/nrprobe';
import { getApnProfiles, setApn, selectApn, getDns, setDns } from './apn-dns';
import { carriersFrom } from './carriers';
import { parseTxPower, parseDlMcs, parseUlMcs } from '../../utils/linkHealth';
import { buildSnapshot } from '../../utils/snapshot';

const tag = (xml: string, t: string) =>
  xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1];
const tagsAll = (xml: string, t: string) =>
  [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map(m => m[1]);
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s = '') =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const sha256Hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));
const num = (v?: string) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : undefined;
};
const ALL_LTE = '7FFFFFFFFFFFFFFF';

function parseDataLimit(v?: string): number {
  if (!v) return 0;
  const m = v.trim().match(/^([\d.]+)\s*([KMGT]?B)?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] ?? 'MB').toUpperCase();
  const mult: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  return Math.round(n * (mult[unit] ?? 1e6));
}
function formatDataLimit(bytes: number): string {
  if (bytes <= 0) return '0MB';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(bytes % 1e9 === 0 ? 0 : 2) + 'GB';
  return Math.round(bytes / 1e6) + 'MB';
}
function arfcnOf(v?: string): string {
  if (!v) return '';
  const dl = v.match(/DL[:\s]*(\d+)/i);
  if (dl) return dl[1];
  const n = v.match(/\d+/);
  return n ? n[0] : '';
}
const DEFAULT_NR_BANDS = [1, 3, 5, 20, 28, 40, 41, 77, 78, 79];

function big(hex: string): bigint {
  try { return BigInt('0x' + hex.trim().replace(/^0x/i, '')); } catch { return 0n; }
}
function bandsFromMask(mask: bigint): number[] {
  const out: number[] = [];
  let m = mask;
  let i = 0;
  while (m > 0n && i < 128) {
    if (m & 1n) out.push(i + 1);
    m >>= 1n;
    i++;
  }
  return out;
}
function maskFromBands(bands: number[]): string {
  let m = 0n;
  for (const b of bands) if (b > 0) m |= 1n << BigInt(b - 1);
  return m.toString(16).toUpperCase();
}

const MODE_NAMES: Record<string, string> = { '01': '2G', '02': '3G', '03': '4G', '08': '5G' };
function modeLabel(v: string): string {
  if (v === '00') return 'تلقائي';
  const parts = v.match(/../g) ?? [v];
  return parts.map(p => MODE_NAMES[p] ?? p).join(' + ');
}

const NET_TYPES: Record<string, string> = {
  // 4G LTE
  '19': '4G LTE', '101': '4G LTE',
  // 4G+ (CA نشط)
  '1011': '4G+',
  // 4G+ مع 5G NSA (بعض فيرمويرات H138/H155)
  '1111': '4G+', '1112': '4G+',
  // 5G NSA
  '111': '5G NSA',
  // 5G SA
  '112': '5G SA',
  // 5G NSA + 4G CA
  '1021': '5G NSA', '1022': '5G SA',
  // قديم
  '2': '2G', '3': '3G', '4': '3G+', '41': '3G+',
};

const ERRORS: Record<string, string> = {
  '-1': 'الراوتر رفض الطلب',
  '100002': 'الراوتر ما يدعم هذي الخاصية',
  '100003': 'ما عندك صلاحية — سجل دخول',
  '100005': 'الراوتر رفض الإعداد',
  '108001': 'اسم المستخدم غير صحيح',
  '108002': 'كلمة المرور غير صحيحة',
  '108003': 'فيه مستخدم ثاني داخل حالياً',
  '108006': 'اسم المستخدم أو كلمة المرور غلط',
  '108007': 'محاولات كثيرة، انتظر شوي وحاول',
  '112003': 'الترددات المختارة غير مدعومة',
  '113018': 'ذاكرة الرسائل ممتلئة',
  '125002': 'انتهت الجلسة',
  '125003': 'رمز الجلسة غير صالح',
};

export class HuaweiError extends Error {
  constructor(public code: string) {
    super(ERRORS[code] ?? `خطأ من الراوتر (${code})`);
  }
}
const isTokenError = (e: unknown) =>
  e instanceof HuaweiError && (e.code === '125002' || e.code === '125003');

export class HuaweiDriver implements RouterDriver {
  id = 'huawei-lte';
  // بعض الموديلات (H138/H155/H165) 5G-capable — نكشفها ديناميكياً
  name = 'Huawei LTE/5G';
  capabilities: Capability[] = ['signal', 'devices', 'reboot', 'bandLock', 'sms', 'usage', 'block', 'traffic', 'cells'];
  private host = '';
  private queue: string[] = [];
  private allLte = ALL_LTE;
  private lockFreq: boolean | null = null;
  private cellLockMode: string | null = null;

  private log(...a: unknown[]) {
    if (__DEV__) console.log('[huawei]', ...a);
  }
  private url(p: string) {
    return `http://${this.host}/api/${p}`;
  }
  private headers(extra: Record<string, string> = {}) {
    return {
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `http://${this.host}/html/home.html`,
      ...extra,
    };
  }
  private captureTokens(r: Response) {
    const one = r.headers.get('__requestverificationtokenone');
    const two = r.headers.get('__requestverificationtokentwo');
    const single = r.headers.get('__requestverificationtoken');
    if (one) this.queue = two ? [one, two] : [one];
    else if (single) this.queue = single.split('#').filter(Boolean);
  }
  private async freshToken(): Promise<string> {
    try {
      const r = await http(this.url('webserver/token'), { headers: this.headers() });
      const t = tag(await r.text(), 'token');
      if (t) return t.length > 32 ? t.slice(32) : t;
    } catch {}
    const r = await http(this.url('webserver/SesTokInfo'), { headers: this.headers() });
    return tag(await r.text(), 'TokInfo') ?? '';
  }
  private async get(p: string) {
    const r = await http(this.url(p), { headers: this.headers() });
    const xml = await r.text();
    if (xml.includes('<error>')) {
      const code = tag(xml, 'code') ?? '0';
      this.log('GET', p, 'error', code);
      throw new HuaweiError(code);
    }
    return xml;
  }
  private async post(p: string, body: string, token?: string, retry = true): Promise<string> {
    const tok = token ?? (this.queue.shift() || await this.freshToken());
    const r = await http(this.url(p), {
      method: 'POST',
      headers: this.headers({
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        __RequestVerificationToken: tok,
      }),
      body: `<?xml version="1.0" encoding="UTF-8"?><request>${body}</request>`,
    });
    this.captureTokens(r);
    const xml = await r.text();
    if (xml.includes('<error>')) {
      const code = tag(xml, 'code') ?? '0';
      this.log('POST', p, 'error', code);
      if (retry && !token && (code === '125002' || code === '125003')) {
        this.queue = [];
        return this.post(p, body, undefined, false);
      }
      throw new HuaweiError(code);
    }
    return xml;
  }
  async detect(host: string) {
    const r = await http(`http://${host}/api/webserver/SesTokInfo`, {}, 3000);
    return (await r.text()).includes('<TokInfo>');
  }
  async login(host: string, username: string, password: string) {
    this.host = host;
    this.queue = [];
    try { await http(`http://${host}/html/home.html`, { headers: this.headers() }); } catch {}
    const state = await this.get('user/state-login');
    const type = tag(state, 'password_type');
    this.log('state', tag(state, 'State'), 'password_type', type);
    if (tag(state, 'State') === '0') return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (type === '4') await this.loginSha256(username, password);
        else await this.loginBase64(username, password);
        this.log('login ok');
        return;
      } catch (e) {
        if (isTokenError(e) && attempt === 0) continue;
        if (e instanceof HuaweiError && e.code === '100002') break;
        throw e;
      }
    }
    await this.loginScram(username, password);
    this.log('login ok (SCRAM)');
  }
  private async loginBase64(username: string, password: string) {
    await this.post('user/login',
      `<Username>${esc(username)}</Username><Password>${btoa(password)}</Password><password_type>0</password_type>`);
  }
  private async loginSha256(username: string, password: string) {
    const token = await this.freshToken();
    const hashed = btoa(sha256Hex(username + btoa(sha256Hex(password)) + token));
    await this.post('user/login',
      `<Username>${esc(username)}</Username><Password>${hashed}</Password><password_type>4</password_type>`,
      token);
  }
  private async loginScram(username: string, password: string) {
    const firstNonce = bytesToHex(Crypto.getRandomBytes(32));
    const ch = await this.post('user/challenge_login',
      `<username>${esc(username)}</username><firstnonce>${firstNonce}</firstnonce><mode>1</mode>`);
    const salt = tag(ch, 'salt');
    const serverNonce = tag(ch, 'servernonce');
    const iterations = parseInt(tag(ch, 'iterations') ?? '0', 10);
    if (!salt || !serverNonce || !iterations) throw new Error('الراوتر ما رجّع بيانات تسجيل الدخول');
    const msg = `${firstNonce},${serverNonce},${serverNonce}`;
    const salted = pbkdf2(sha256, utf8ToBytes(password), hexToBytes(salt), { c: iterations, dkLen: 32 });
    const clientKey = hmac(sha256, utf8ToBytes('Client Key'), salted);
    const storedKey = sha256(clientKey);
    const signature = hmac(sha256, utf8ToBytes(msg), storedKey);
    const proof = clientKey.map((b, i) => b ^ signature[i]);
    await this.post('user/authentication_login',
      `<clientproof>${bytesToHex(proof)}</clientproof><finalnonce>${serverNonce}</finalnonce>`);
  }
  async logout() {
    try { await this.post('user/logout', '<Logout>1</Logout>'); } catch {}
    this.queue = [];
  }
  async getSignal(): Promise<Signal> {
    const xml = await this.get('device/signal');
    let network: string | undefined;
    let nrAvailable: number | undefined;
    let nrActiveFromStatus: boolean | undefined;
    try {
      const st = await this.get('monitoring/status');
      const ntEx = tag(st, 'CurrentNetworkTypeEx') ?? '';
      const nt = tag(st, 'CurrentNetworkType') ?? '';
      // 🔍 تشخيص مؤقت: نسجّل القيم الفعلية عشان نعرف أكواد الفيرموير
      this.log('hw-status: NTEx=', JSON.stringify(ntEx), 'NT=', JSON.stringify(nt), 'NrIcon=', tag(st, 'SignalIconNr'));
      network = NET_TYPES[ntEx] ?? NET_TYPES[nt];
      // كشف 5G من CurrentNetworkTypeEx (أكواد متعددة عبر الفيرمويرات)
      // 111 = 5G NSA | 112 = 5G SA | 1021/1022 = 5G جديد
      const nrActiveCodes = ['111', '112', '1021', '1022'];
      if (nrActiveCodes.includes(ntEx)) nrActiveFromStatus = true;
      // بعض فيرمويرات H138 ترجع 1111/1112 لما 4G+ CA نشط مع إمكانية 5G
      // — نتأكد من حقل NR منفصل
      try {
        const nrType = tag(st, 'CurrentNrNetworkType');
        if (nrType && (nrType === '1' || nrType === '2')) nrActiveFromStatus = true;
      } catch {}
      const icon = num(tag(st, 'SignalIconNr'));
      if (icon !== undefined && icon > 0) nrAvailable = icon;
    } catch {}
    const nrBandRaw = tag(xml, 'nrband') || tag(xml, 'nrBand') || '';
    const nrFromBand = (tag(xml, 'band') ?? '').match(/\bn(\d+)/i);
    return {
      network,
      band: tag(xml, 'band'),
      cellId: tag(xml, 'cell_id'),
      pci: tag(xml, 'pci'),
      earfcn: tag(xml, 'earfcn'),
      dlBandwidth: tag(xml, 'dlbandwidth'),
      ulBandwidth: tag(xml, 'ulbandwidth'),
      rsrp: num(tag(xml, 'rsrp')),
      rsrq: num(tag(xml, 'rsrq')),
      sinr: num(tag(xml, 'sinr')),
      rssi: num(tag(xml, 'rssi')),
      nrBand: nrBandRaw || (nrFromBand ? 'n' + nrFromBand[1] : undefined),
      nrPci: tag(xml, 'nrpci') || undefined,
      nrArfcn: tag(xml, 'nrarfcn') || tag(xml, 'nrearfcn') || undefined,
      nrDlBandwidth: tag(xml, 'nrdlbandwidth') || undefined,
      nrRsrp: num(tag(xml, 'nrrsrp')),
      nrRsrq: num(tag(xml, 'nrrsrq')),
      nrSinr: num(tag(xml, 'nrsinr')),
      nrAvailable,
      nrActiveFromStatus,
      cqi: num(tag(xml, 'cqi0')),
      dlMcs: parseDlMcs(tag(xml, 'dl_mcs')).mcs,
      dlStreams: parseDlMcs(tag(xml, 'dl_mcs')).streams,
      ulMcs: parseUlMcs(tag(xml, 'ul_mcs')),
      txPower: parseTxPower(tag(xml, 'txpower')),
      nrCqi: num(tag(xml, 'nrcqi0')),
      nrDlMcs: parseDlMcs(tag(xml, 'nrdlmcs')).mcs ?? num(tag(xml, 'nrdlmcs')),
      nrTxPower: parseTxPower(tag(xml, 'nrtxpower')),
      nrRank: num(tag(xml, 'nrrank')),
      enodebId: (tag(xml, 'enodeb_id') ?? '').replace(/^0+(?=\d)/, '') || undefined,
    };
  }
  async getCarriers(): Promise<Carrier[]> {
    const xml = await this.get('device/signal');
    const sig = await this.getSignal();
    // نفس مصدر صفحة "معلومات الخلية" في الراوتر
    let sec = '';
    try { sec = await this.get('device/seccellinfo'); } catch {}
    return carriersFrom(xml, sig, sec);
  }
  async getSnapshot(): Promise<SignalSnapshot> {
    let signal = await this.getSignal().catch(() => null);

    // ═══ لو الراوتر يقول 5G نشط لكن nrRsrp فاضي: نحمّل 3 ثواني ونقرأ مرة ثانية ═══
    // هواوي يكشف 5G في device/signal فقط وقت النشاط الفعلي (NSA)
    if (signal && signal.nrActiveFromStatus && signal.nrRsrp === undefined) {
      try {
        const burst = trafficBurst(3000, 8_000_000, () => false);
        await new Promise(r => setTimeout(r, 1500));
        const fresh = await this.getSignal().catch(() => null);
        await burst.catch(() => 0);
        if (fresh && fresh.nrRsrp !== undefined) {
          // دمج: ناخذ قيم 5G من القراءة الجديدة، والباقي من الأصلية
          signal = {
            ...signal,
            nrRsrp: fresh.nrRsrp,
            nrRsrq: fresh.nrRsrq ?? signal.nrRsrq,
            nrSinr: fresh.nrSinr ?? signal.nrSinr,
            nrBand: fresh.nrBand ?? signal.nrBand,
            nrPci: fresh.nrPci ?? signal.nrPci,
            nrArfcn: fresh.nrArfcn ?? signal.nrArfcn,
            nrDlBandwidth: fresh.nrDlBandwidth ?? signal.nrDlBandwidth,
          };
        }
      } catch { /* ما نجحنا نجيب قيم 5G — نكمل بالبيانات الحالية */ }
    }

    const carriers = await this.getCarriers().catch(() => [] as Carrier[]);
    const cells = await this.getCells().catch(() => [] as CellTower[]);
    return buildSnapshot(signal, carriers, cells, { driverId: this.id, driverName: this.name });
  }
  async isConnected() {
    const st = await this.get('monitoring/status');
    return tag(st, 'ConnectionStatus') === '901';
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    let operator: string | undefined;
    try {
      const plmn = await this.get('net/current-plmn');
      operator = unesc(tag(plmn, 'FullName') || tag(plmn, 'ShortName') || '') || undefined;
    } catch {}
    let connected: boolean | undefined;
    try { connected = await this.isConnected(); } catch {}
    let mode: string | undefined;
    try { mode = tag(await this.get('net/net-mode'), 'NetworkMode'); } catch {}
    return { operator, connected, mode };
  }
  async getTraffic(): Promise<Traffic> {
    const xml = await this.get('monitoring/traffic-statistics');
    return {
      downBytesPerSec: num(tag(xml, 'CurrentDownloadRate')) ?? 0,
      upBytesPerSec: num(tag(xml, 'CurrentUploadRate')) ?? 0,
      connectedSecs: num(tag(xml, 'CurrentConnectTime')) ?? 0,
    };
  }
  async getDevices(): Promise<ConnectedDevice[]> {
    try {
      const xml = await this.get('wlan/host-list');
      return tagsAll(xml, 'Host').map(h => ({
        mac: (tag(h, 'MacAddress') ?? '').toUpperCase(),
        ip: tag(h, 'IpAddress')?.split(';')[0],
        name: unesc(tag(h, 'HostName')),
      })).filter(d => d.mac);
    } catch {
      const xml = await this.get('lan/HostInfo');
      return tagsAll(xml, 'Host')
        .filter(h => tag(h, 'Active') !== '0')
        .map(h => ({
          mac: (tag(h, 'MacAddress') ?? '').toUpperCase(),
          ip: tag(h, 'IpAddress')?.split(';')[0],
          name: unesc(tag(h, 'HostName') || tag(h, 'ActualName')),
        })).filter(d => d.mac);
    }
  }
  private async readMacFilter() {
    const xml = await this.get('wlan/multi-macfilter-settings');
    const ssids = tagsAll(xml, 'Ssid');
    if (!ssids.length) throw new Error('الراوتر ما يدعم حظر الأجهزة');
    const first = ssids[0];
    const entries: { mac: string; name: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const mac = (tag(first, `WifiMacFilterMac${i}`) ?? '').trim().toUpperCase();
      if (mac) entries.push({ mac, name: unesc(tag(first, `wifihostname${i}`) ?? '') });
    }
    return {
      status: tag(first, 'WifiMacFilterStatus') ?? '0',
      indexes: ssids.map((s, i) => tag(s, 'Index') ?? String(i)),
      entries,
    };
  }
  async getBlockedDevices(): Promise<ConnectedDevice[]> {
    const f = await this.readMacFilter();
    if (f.status !== '2') return [];
    return f.entries.map(e => ({ mac: e.mac, name: e.name, blocked: true }));
  }
  async blockDevice(mac: string, block: boolean, name = '') {
    const f = await this.readMacFilter();
    if (f.status === '1') {
      throw new Error('فلتر الأجهزة في الراوتر مضبوط على "السماح فقط" — غيّره من لوحة الراوتر أولاً');
    }
    const target = mac.toUpperCase();
    let entries = (f.status === '2' ? f.entries : []).filter(e => e.mac !== target);
    if (block) {
      if (entries.length >= 10) throw new Error('وصلت الحد الأقصى: 10 أجهزة محظورة');
      entries = [...entries, { mac: target, name }];
    }
    const status = entries.length ? '2' : '0';
    const slots = Array.from({ length: 10 }, (_, i) =>
      `<WifiMacFilterMac${i}>${entries[i]?.mac ?? ''}</WifiMacFilterMac${i}>` +
      `<wifihostname${i}>${esc(entries[i]?.name ?? '')}</wifihostname${i}>`).join('');
    const body = f.indexes
      .map(idx => `<Ssid><Index>${idx}</Index><WifiMacFilterStatus>${status}</WifiMacFilterStatus>${slots}</Ssid>`)
      .join('');
    await this.post('wlan/multi-macfilter-settings', `<Ssids>${body}</Ssids>`);
  }
  async getUsage(): Promise<Usage> {
    const xml = await this.get('monitoring/month_statistics');
    return {
      downloadBytes: num(tag(xml, 'CurrentMonthDownload')) ?? 0,
      uploadBytes: num(tag(xml, 'CurrentMonthUpload')) ?? 0,
    };
  }
  async getDataPlan(): Promise<DataPlan> {
    const xml = await this.get('monitoring/start_date');
    return {
      startDay: num(tag(xml, 'StartDay')) ?? 1,
      limitBytes: parseDataLimit(tag(xml, 'DataLimit')),
      monthThreshold: num(tag(xml, 'MonthThreshold')) ?? 90,
    };
  }
  async setDataPlan(plan: DataPlan) {
    const cur = await this.get('monitoring/start_date');
    const inner = cur.match(/<response>([\s\S]*?)<\/response>/)?.[1] ?? '';
    const fields = [...inner.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
    const setF = (k: string, v: string) => {
      const x = fields.find(f => f[0] === k);
      if (x) x[1] = v; else fields.push([k, v]);
    };
    setF('StartDay', String(Math.min(31, Math.max(1, Math.round(plan.startDay)))));
    setF('DataLimit', formatDataLimit(plan.limitBytes));
    setF('MonthThreshold', String(Math.min(100, Math.max(1, Math.round(plan.monthThreshold)))));
    setF('SetMonthData', plan.limitBytes > 0 ? '1' : '0');
    const body = fields.map(([k, v]) => '<' + k + '>' + v + '</' + k + '>').join('');
    this.log('start_date sending', body);
    await this.post('monitoring/start_date', body);
    await new Promise(r => setTimeout(r, 1200));
    const after = await this.getDataPlan();
    this.log('start_date readback', JSON.stringify(after));
    if (plan.limitBytes > 0 && after.limitBytes === 0) {
      throw new Error('الراوتر ما حفظ حجم الباقة');
    }
  }
  async reboot() {
    await this.post('device/control', '<Control>1</Control>');
  }
  async getBandConfig(): Promise<BandConfig> {
    const cur = await this.get('net/net-mode');
    let supported: number[] = [];
    let modes: string[] = [];
    try {
      const list = await this.get('net/net-mode-list');
      modes = tagsAll(tag(list, 'AccessList') ?? '', 'Access');
      let union = 0n;
      for (const b of tagsAll(tag(list, 'LTEBandList') ?? '', 'LTEBand')) {
        const v = big(tag(b, 'Value') ?? '');
        if (v === big(ALL_LTE)) continue;
        union |= v;
      }
      if (union > 0n) {
        supported = bandsFromMask(union);
        this.allLte = union.toString(16).toUpperCase();
      }
    } catch (e) {
      this.log('net-mode-list failed:', (e as any)?.message ?? String(e));
    }
    if (!supported.length) supported = [1, 3, 7, 8, 20, 28, 38, 40, 41];
    if (!modes.length) modes = ['00', '03', '02'];
    try {
      const fsw = await this.get('net/net-feature-switch');
      this.lockFreq = (num(tag(fsw, 'lock_freq_switch')) ?? 0) > 0;
      this.log('feature lock_freq', tag(fsw, 'lock_freq_switch'), 'lteband', tag(fsw, 'lteband_switch'));
    } catch {
      this.lockFreq = false;
    }
    let locked: number[] = [];
    let nrLocked: number[] = [];
    if (this.lockFreq) {
      const lf = await this.readLockFreq();
      locked = lf.lte;
      nrLocked = lf.nr;
    } else {
      const opt = tag(cur, 'LTEBandOption');
      const active = bandsFromMask(big(tag(cur, 'LTEBand') ?? ALL_LTE)).filter(b => supported.includes(b));
      locked = opt === '0' || active.length === 0 || active.length >= supported.length ? [] : active;
    }
    this.log('bands supported', supported.join(','), 'locked', locked.join(',') || 'auto', 'lockFreq', this.lockFreq);
    // ═══ نعرض ترددات 5G دائماً — لأن كل هواوي CPE حديث (5G CPE Pro/Pro 3) يدعمها.
    // لو الراوتر ما يدعم 5G فعلاً، الراوتر نفسه سيرفض الأمر بدون أي ضرر.
    const nrSupported = DEFAULT_NR_BANDS;
    return {
      supported,
      locked,
      nrSupported,
      nrLocked,
      mode: tag(cur, 'NetworkMode') ?? '00',
      modes: modes.map(v => ({ value: v, label: modeLabel(v) })),
    };
  }
  private async readNetModeFields(): Promise<[string, string][]> {
    const cur = await this.get('net/net-mode');
    const inner = cur.match(/<response>([\s\S]*?)<\/response>/)?.[1] ?? '';
    return [...inner.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
  }
  private async writeNetMode(patch: { mode?: string; bands?: number[] }) {
    const fields = await this.readNetModeFields();
    const has = (k: string) => fields.some(f => f[0] === k);
    const setF = (k: string, v: string) => {
      const x = fields.find(f => f[0] === k);
      if (x) x[1] = v; else fields.push([k, v]);
    };
    if (patch.mode !== undefined) {
      setF('NetworkMode', patch.mode);
    }
    if (patch.bands !== undefined) {
      const lock = patch.bands.length > 0;
      setF('LTEBand', lock ? maskFromBands(patch.bands) : this.allLte);
      if (has('LTEBandOption')) setF('LTEBandOption', lock ? '1' : '0');
      if (lock && patch.mode === undefined && has('LTEBandOption')) {
        setF('NetworkMode', '03');
      }
    }
    const body = fields.map(([k, v]) => `<${k}>${v}</${k}>`).join('');
    this.log('net-mode sending', body);
    await this.post('net/net-mode', body);
    await new Promise(r => setTimeout(r, 1500));
    const after = await this.readNetModeFields();
    const getA = (k: string) => after.find(f => f[0] === k)?.[1];
    this.log('net-mode readback', after.map(([k, v]) => `${k}=${v}`).join(' '));
    if (patch.mode !== undefined && getA('NetworkMode') !== patch.mode) {
      throw new Error('الراوتر قبل الطلب لكن ما غيّر نوع الشبكة');
    }
    if (patch.bands && patch.bands.length && big(getA('LTEBand') ?? '') !== big(maskFromBands(patch.bands))) {
      throw new Error(getA('NetworkMode') === '00'
        ? 'الراوتر ما طبّق القفل — جرّب تحول نوع الشبكة إلى 4G ثم أعد القفل'
        : 'الراوتر قبل الطلب لكن ما غيّر التردد');
    }
  }
  private async readLockFreq(): Promise<{ lte: number[]; nr: number[] }> {
    const parse = (section: string) => {
      if (!section || (tag(section, 'lock_mode') ?? '0') === '0') return [];
      const list = [...section.matchAll(/<band>(\d+)<\/band>/g)].map(m => parseInt(m[1], 10));
      const all = (tag(section, 'all_bands') ?? '').split(/[,;\s]+/).map(x => parseInt(x, 10));
      return [...new Set((list.length ? list : all).filter(n => Number.isFinite(n) && n > 0))];
    };
    try {
      const xml = await this.get('net/lock-freq');
      this.log('lock-freq raw:', xml.replace(/\s+/g, ' ').slice(0, 300));
      return { lte: parse(tag(xml, 'lte_info') ?? ''), nr: parse(tag(xml, 'nr_info') ?? '') };
    } catch (e) {
      this.log('lock-freq read failed:', (e as any)?.message ?? String(e));
      return { lte: [], nr: [] };
    }
  }
  private async readLockedBands(): Promise<number[]> {
    return (await this.readLockFreq()).lte;
  }
  private async lockFreqBands(bands: number[], nrBands: number[]) {
    const section = (name: string, list: number[]) => {
      const lock = list.length > 0;
      return '<' + name + '><lock_mode>' + (lock ? '3' : '0') + '</lock_mode><freq_infos>' +
        list.map(b => '<freq_info><band>' + b + '</band></freq_info>').join('') +
        '</freq_infos><all_bands>' + list.join(',') + '</all_bands></' + name + '>';
    };
    const body = section('lte_info', bands) + section('nr_info', nrBands);
    this.log('lock-freq sending', body);
    await this.post('net/lock-freq', body);
    await new Promise(r => setTimeout(r, 2500));
    const after = await this.readLockFreq();
    this.log('lock-freq readback lte', after.lte.join(',') || 'auto', 'nr', after.nr.join(',') || 'auto');
    const ok = (want: number[], got: number[]) => !want.length || want.every(b => got.includes(b));
    if (!ok(bands, after.lte) || !ok(nrBands, after.nr)) {
      throw new Error('الراوتر قبل الطلب لكن ما طبّق القفل');
    }
    if (!bands.length && after.lte.length) throw new Error('ما قدرنا نرجع الوضع التلقائي');
    if (!nrBands.length && after.nr.length) throw new Error('ما قدرنا نرجع وضع 5G للتلقائي');
  }
  async setBand(bands: number[], nrBands?: number[]) {
    if (this.lockFreq === null) {
      try {
        const fsw = await this.get('net/net-feature-switch');
        this.lockFreq = (num(tag(fsw, 'lock_freq_switch')) ?? 0) > 0;
      } catch {
        this.lockFreq = false;
      }
    }
    if (this.lockFreq) {
      const nr = nrBands ?? (await this.readLockFreq()).nr;
      return this.lockFreqBands(bands, nr);
    }
    await this.writeNetMode({ bands });
  }
  private sectionXml(name: string, mode: string, entries: string[], allBands: string) {
    return '<' + name + '><lock_mode>' + mode + '</lock_mode><freq_infos>' +
      entries.join('') + '</freq_infos><all_bands>' + allBands + '</all_bands></' + name + '>';
  }
  private async readCellLockRaw(): Promise<{ lte: string; nr: string }> {
    try {
      const xml = await this.get('net/lock-freq');
      return { lte: tag(xml, 'lte_info') ?? '', nr: tag(xml, 'nr_info') ?? '' };
    } catch {
      return { lte: '', nr: '' };
    }
  }
  async getCellLock(): Promise<CellLockState | null> {
    const raw = await this.readCellLockRaw();
    for (const sec of [raw.lte, raw.nr]) {
      if (!sec || (tag(sec, 'lock_mode') ?? '0') === '0') continue;
      const pci = (tag(sec, 'pci') ?? '').trim();
      if (!pci) continue;
      const band = parseInt(tag(sec, 'band') ?? '', 10);
      return { pci, band: Number.isFinite(band) ? band : undefined, arfcn: (tag(sec, 'freq') ?? '').trim() || undefined };
    }
    return null;
  }
  async getActiveLock(): Promise<ActiveLock | null> {
    const lf = await this.readLockFreq();
    const cell = await this.getCellLock();
    if (!lf.lte.length && !lf.nr.length && !cell) return null;
    return { bands: lf.lte, nrBands: lf.nr, pci: cell?.pci };
  }
  async lockCell(target: CellLockTarget) {
    const pci = (target.pci ?? '').trim();
    if (!pci) throw new Error('ما عندنا رقم الخلية (PCI) لهذا البرج');
    const arfcn = arfcnOf(target.arfcn);
    const band = target.band;
    const isNr = target.tech === 'NR';
    const name = isNr ? 'nr_info' : 'lte_info';
    const other = isNr ? 'lte_info' : 'nr_info';
    const entry = '<freq_info>' +
      (band ? '<band>' + band + '</band>' : '<band></band>') +
      '<freq>' + arfcn + '</freq><pci>' + pci + '</pci></freq_info>';
    const candidates = this.cellLockMode ? [this.cellLockMode] : ['2', '4', '1', '5'];
    let lastErr: unknown;
    for (const mode of candidates) {
      const body = this.sectionXml(name, mode, [entry], band ? String(band) : '') +
        this.sectionXml(other, '0', [], '');
      this.log('cell-lock try mode', mode, body);
      try {
        await this.post('net/lock-freq', body);
      } catch (e) {
        lastErr = e;
        continue;
      }
      await new Promise(r => setTimeout(r, 2500));
      const now = await this.getCellLock();
      this.log('cell-lock readback', JSON.stringify(now));
      if (now && now.pci === pci) {
        this.cellLockMode = mode;
        return;
      }
    }
    try { await this.unlockCell(); } catch {}
    if (lastErr) throw lastErr;
    throw new Error('الراوتر ما قبل قفل الخلية على هذا البرج');
  }
  async unlockCell() {
    const body = this.sectionXml('lte_info', '0', [], '') + this.sectionXml('nr_info', '0', [], '');
    this.log('cell-lock clearing');
    await this.post('net/lock-freq', body);
    await new Promise(r => setTimeout(r, 2000));
  }
  async setNetworkMode(mode: string) {
    await this.writeNetMode({ mode });
  }
  // ───── APN و DNS (منفصلة في apn-dns.ts) ─────
  private io() {
    return {
      get: (p: string) => this.get(p),
      post: (p: string, b: string) => this.post(p, b),
      log: (...a: unknown[]) => this.log(...a),
    };
  }
  getApnProfiles() { return getApnProfiles(this.io()); }
  setApn(p: { index: string; name: string; apn: string; username?: string; password?: string; authMode?: string }) {
    return setApn(this.io(), p);
  }
  selectApn(index: string) { return selectApn(this.io(), index); }
  getDns() { return getDns(this.io()); }
  setDns(cfg: DnsConfig) { return setDns(this.io(), cfg); }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const out: DeviceDetails = {};
    try {
      const xml = await this.get('device/information');
      out.model = unesc(tag(xml, 'DeviceName')) || undefined;
      out.imei = tag(xml, 'Imei');
      out.software = tag(xml, 'SoftwareVersion');
      out.hardware = tag(xml, 'HardwareVersion');
      out.wanIp = tag(xml, 'WanIPAddress');
    } catch (e) {
      this.log('device/information failed');
    }
    try {
      const st = await this.get('monitoring/status');
      out.wanIp = out.wanIp || tag(st, 'WanIPAddress');
      const dns = [tag(st, 'PrimaryDns'), tag(st, 'SecondaryDns')].filter(Boolean);
      if (dns.length) out.dns = dns.join('  ·  ');
      const sim = tag(st, 'SimStatus');
      if (sim) out.simStatus = sim === '1' ? 'جاهزة' : `الحالة ${sim}`;
    } catch (e) {
      this.log('monitoring/status failed');
    }
    try {
      const plmn = await this.get('net/current-plmn');
      out.operator = unesc(tag(plmn, 'FullName') || tag(plmn, 'ShortName') || '') || undefined;
    } catch (e) {
      this.log('net/current-plmn failed');
    }
    return out;
  }
  private parseCellList(raw: string, tech: 'LTE' | 'NR', kind: 'neighbor' | 'secondary'): CellTower[] {
    const out: CellTower[] = [];
    for (const rec of raw.split(';')) {
      const f = rec.trim().split(',').map(x => x.trim());
      if (f.length < 5) continue;
      const off = f.length >= 8 ? 1 : 0;
      const bandDigits = (f[1] ?? '').replace(/[^0-9]/g, '');
      const t: CellTower = {
        kind,
        tech,
        arfcn: f[0] || undefined,
        band: bandDigits ? parseInt(bandDigits, 10) : undefined,
        pci: f[2 + off] || undefined,
        rsrp: num(f[3 + off]),
        rsrq: num(f[4 + off]),
        rssi: num(f[5 + off]),
        sinr: num(f[6 + off]),
      };
      if (t.rsrp === undefined && t.pci === undefined) continue;
      out.push(t);
    }
    return out;
  }
  private scanCellXml(xml: string, kind: 'neighbor' | 'secondary'): CellTower[] {
    const out: CellTower[] = [];
    for (const m of xml.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) {
      const name = m[1];
      const val = (m[2] ?? '').trim();
      if (!val.includes(',') || !/cell|list/i.test(name)) continue;
      const tech: 'LTE' | 'NR' = /nr|5g/i.test(name) ? 'NR' : 'LTE';
      out.push(...this.parseCellList(val, tech, kind));
    }
    return out;
  }
  async getCells(): Promise<CellTower[]> {
    const out: CellTower[] = [];
    try {
      const sig = await this.getSignal();
      if (sig.nrRsrp !== undefined || sig.nrBand) {
        const nb = (sig.nrBand ?? '').match(/(\d+)/);
        out.push({
          kind: 'serving',
          tech: 'NR',
          arfcn: sig.nrArfcn,
          band: nb ? parseInt(nb[1], 10) : undefined,
          pci: sig.nrPci,
          rsrp: sig.nrRsrp,
          rsrq: sig.nrRsrq,
          sinr: sig.nrSinr,
        });
      }
      const bm = (sig.band ?? '').match(/B(\d+)/i);
      out.push({
        kind: 'serving',
        tech: 'LTE',
        arfcn: arfcnOf(sig.earfcn) || undefined,
        band: bm ? parseInt(bm[1], 10) : undefined,
        pci: sig.pci,
        cellId: sig.cellId,
        rsrp: sig.rsrp,
        rsrq: sig.rsrq,
        sinr: sig.sinr,
        rssi: sig.rssi,
      });
    } catch (e) {
      this.log('serving cell failed');
    }
    const sources: [string, 'secondary' | 'neighbor'][] = [
      ['device/seccellinfo', 'secondary'],
      ['device/nbrcellinfo', 'neighbor'],
    ];
    for (const [path, kind] of sources) {
      try {
        const xml = await this.get(path);
        this.log(path, 'raw:', xml.replace(/\s+/g, ' ').slice(0, 700));
        out.push(...this.scanCellXml(xml, kind));
      } catch (e) {
        this.log(path, 'failed:', (e as any)?.message ?? String(e));
      }
    }
    return out;
  }
  async listSms(box: 'inbox' | 'sent' = 'inbox'): Promise<SmsMessage[]> {
    const xml = await this.post('sms/sms-list',
      `<PageIndex>1</PageIndex><ReadCount>50</ReadCount><BoxType>${box === 'inbox' ? 1 : 2}</BoxType>` +
      `<SortType>0</SortType><Ascending>0</Ascending><UnreadPreferred>0</UnreadPreferred>`);
    return tagsAll(xml, 'Message').map(m => ({
      index: tag(m, 'Index') ?? '',
      phone: unesc(tag(m, 'Phone') ?? ''),
      content: unesc(tag(m, 'Content') ?? ''),
      date: tag(m, 'Date') ?? '',
      unread: tag(m, 'Smstat') === '0',
    })).filter(m => m.index);
  }
  async markSmsRead(index: string) {
    await this.post('sms/set-read', `<Index>${esc(index)}</Index>`);
  }
  async deleteSms(index: string) {
    await this.post('sms/delete-sms', `<Index>${esc(index)}</Index>`);
  }
  async sendSms(phone: string, text: string) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    await this.post('sms/send-sms',
      `<Index>-1</Index><Phones><Phone>${esc(phone)}</Phone></Phones><Sca></Sca>` +
      `<Content>${esc(text)}</Content><Length>${text.length}</Length><Reserved>1</Reserved><Date>${date}</Date>`);
  }
}
