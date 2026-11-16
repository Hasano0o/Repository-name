/**
 * درايفر عائلة فيرموير JRD/webapi (الواجهة Vue، كل الأوامر POST JSON على /jrd/webapi — JSON-RPC).
 * أول موديل مؤكد: HH10E (مشروع HH10E / custom E1) — ملفات صفحة عضو (١٦ نوفمبر).
 * نفس الـ SDK يشغّل موديلات OEM كثيرة؛ نتعرّف على العائلة من buildInfo.js + رد /jrd/webapi.
 *
 * ⚠️ المرحلة ١: دخول + قراءة (إشارة، أجهزة، تفاصيل، ترافيك) + إعادة تشغيل + آي بي جديد.
 * ما فيه تثبيت ترددات ولا برج — نضيفها بعد ما نتأكد من أسماء أوامرها من كود صفحة عضو ونجرّبها ميداني.
 *
 * البروتوكول (من كود الصفحة):
 *  • POST http://<host>/jrd/webapi?name=<Method>
 *    body: {_:ts, id:jsonrpcId, jsonrpc:"2.0", method:<Method>, params:{...}}
 *    ترويسات: _RequestVerificationKey (ثابت) + device_name/custom_id (من buildInfo) + بعد الدخول _RequestVerificationToken
 *  • الرد: {result:{...}} نجاح · {error:{code,message,remaintime}} فشل
 *  • الدخول (loginAuthType 2): Login {UserName:scramble(user), Password:scramble(pass)} ← result.token ← الترويسة = scramble(token)
 *  • أوامر بدون توكن (تتعرّف بها قبل الدخول): GetSystemStatus · GetSystemInfo … (NoTokenMethodArray في الكود)
 */
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower,
  DeviceDetails, ConnectedDevice, Traffic,
} from '../types';
import { http } from '../http';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import { JRD_KEY, JRD_VERIFY_KEY, jrdScramble, jrdJsonrpcId, parseBuildInfo } from './crypto';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const num = (v: unknown, lo: number, hi: number) => {
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/);
  const x = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(x) && x >= lo && x <= hi ? x : undefined;
};
const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s && s !== '--' && s !== '- -' && s !== '0.0.0.0' ? s : undefined;
};
/** رقم التردد من نص مثل «LTE BAND 3» أو «n78» أو «3» */
const bandNum = (v: unknown): number | undefined => {
  const m = String(v ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
};
/** NetworkType (رقم) ← تقنية — من networkTypeMap في كود الصفحة */
function techOf(nt: unknown): { label?: string; is5g: boolean } {
  const n = parseInt(String(nt ?? ''), 10);
  if (n === 16 || n === 17) return { label: '5G', is5g: true };
  if (n === 8) return { label: '4G', is5g: false };
  if (n === 9) return { label: '4G+', is5g: false };
  if (n >= 3 && n <= 7 || n === 10) return { label: '3G', is5g: false };
  if (n === 1 || n === 2 || n === 11) return { label: '2G', is5g: false };
  const s = String(nt ?? '').toUpperCase();
  if (/5G|NR/.test(s)) return { label: '5G', is5g: true };
  if (/LTE|4G/.test(s)) return { label: '4G', is5g: false };
  if (s) return { label: s, is5g: false };
  return { is5g: false };
}

export function jrdSignal(info: Record<string, any>, status: Record<string, any>): Signal {
  const t = techOf(status.NetworkType);
  const band = bandNum(info.Band);
  const sig: Signal = {
    network: t.label,
    cellId: str(info.CellId),
    rsrp: num(info.RSRP, -150, -30),
    rsrq: num(info.RSRQ, -40, 0),
    sinr: num(info.SINR, -30, 50),
    rssi: num(info.RSSI, -130, -10),
    earfcn: str(info.DL_channel) ?? str(info.DlFreq),
    enodebId: str(info.eNBID),
  };
  // على 5G نحط التردد في خانة 5G، وإلا 4G
  if (t.is5g) { if (band) sig.nrBand = 'N' + band; sig.nrRsrp = sig.rsrp; sig.nrSinr = sig.sinr; sig.nrRsrq = sig.rsrq; }
  else if (band) sig.band = 'B' + band;
  return sig;
}

export class JrdDriver implements RouterDriver {
  id = 'jrd';
  name = 'راوتر 4G/5G';
  capabilities: Capability[] = ['signal', 'cells', 'devices', 'reboot'];

  private host = '';
  private token = '';
  private project = 'HH10E';
  private custom = 'E1';
  private model = '';

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json;charset=UTF-8',
      _RequestVerificationKey: JRD_VERIFY_KEY,
      device_name: this.project,
      custom_id: this.custom,
    };
    if (this.token) h._RequestVerificationToken = this.token;
    return h;
  }

  /** POST /jrd/webapi?name=Method — يرجّع result أو يرمي برسالة فيها اسم الأمر */
  private async call(method: string, params: Record<string, any> = {}, timeout = 10000): Promise<any> {
    const body = JSON.stringify({ _: Date.now(), id: jrdJsonrpcId(), jsonrpc: '2.0', method, params });
    const r = await http(`${this.base()}/jrd/webapi?name=${encodeURIComponent(method)}`, {
      method: 'POST', headers: this.headers(), body,
    }, timeout);
    const txt = await r.text();
    let j: any;
    try { j = JSON.parse(txt); } catch { throw new Error(`${method}: رد غير متوقع من الراوتر`); }
    if (j && Object.prototype.hasOwnProperty.call(j, 'result')) return j.result;
    const code = String(j?.error?.code ?? '');
    const e: any = new Error(`${method}: ${j?.error?.message || 'رفض الراوتر'} (${code || '؟'})`);
    e.code = code;
    e.remaintime = j?.error?.remaintime;
    throw e;
  }

  markStale() { this.token = ''; }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    // بصمة العائلة: buildInfo.js فيه versionInfo + مشروع، والـ API يرد على /jrd/webapi
    try {
      const r = await http(`${this.base()}/dist/buildInfo.js?_=${Date.now()}`, {}, 6000);
      if (!r.ok) return false;
      const bi = parseBuildInfo(await r.text());
      if (!bi.project) return false;
      // نتأكد إن /jrd/webapi حي (أمر بدون توكن)
      const st = await this.call('GetSystemStatus', {}, 6000).catch(() => null);
      if (st == null || typeof st !== 'object') return false;
      this.project = bi.project; this.custom = bi.custom || ''; this.model = bi.project;
      return true;
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    try {
      if (!this.model) {
        const bi = parseBuildInfo(await (await http(`${this.base()}/dist/buildInfo.js?_=${Date.now()}`, {}, 6000)).text());
        this.model = bi.project || ''; this.project = bi.project || this.project; this.custom = bi.custom || this.custom;
      }
      const m = this.model || 'JRD';
      return { id: 'jrd-' + m.toLowerCase(), label: m + ' (4G/5G)', brand: 'jrd', tech: '5G', nrLock: false };
    } catch { return null; }
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    this.host = host;
    if (!this.project || this.project === 'HH10E') {
      // نتأكد من المشروع/custom من buildInfo (ترويسات الطلب)
      try {
        const bi = parseBuildInfo(await (await http(`${this.base()}/dist/buildInfo.js?_=${Date.now()}`, {}, 6000)).text());
        if (bi.project) { this.project = bi.project; this.custom = bi.custom || ''; this.model = bi.project; }
      } catch {}
    }
    // جلسة قايمة؟ (ما نثق فيها إلا لو عندنا توكن من قبل) — ما نرسل كلمة لو مانها fresh/lastTry
    if (this.token && !opts?.fresh && !opts?.lastTry) {
      try { await this.call('GetModemSystemInfo'); return; } catch {}
    }
    this.token = '';
    const res = await this.call('Login', {
      UserName: jrdScramble((username || 'admin').trim()),
      Password: jrdScramble(password),
    }, 12000).catch((e: any) => {
      const c = String(e?.code ?? '');
      if (c === '010101') throw new Error('كلمة المرور غلط — تأكد منها من الملصق أو اللي غيّرتها');
      if (c === '010103') throw new Error('الراوتر قفل الدخول بعد محاولات غلط — جرّب بعد شوي');
      throw e;
    });
    const tok = res?.token != null ? String(res.token) : '';
    if (!tok) throw new Error('الدخول: الراوتر ما رجّع توكن');
    this.token = jrdScramble(tok);
  }

  async logout(): Promise<void> {
    try { await this.call('Logout'); } catch {}
    this.token = '';
  }

  // ═══ القراءة ═══
  private async status(): Promise<Record<string, any>> {
    return (await this.call('GetSystemStatus').catch(() => ({}))) || {};
  }
  private async netinfo(): Promise<Record<string, any>> {
    return (await this.call('GetNetworkInfo').catch(() => ({}))) || {};
  }

  async getSignal(): Promise<Signal> {
    const [info, st] = await Promise.all([this.netinfo(), this.status()]);
    return jrdSignal(info, st);
  }
  async getCells(): Promise<CellTower[]> {
    const s = await this.getSignal();
    const band = s.nrBand ? bandNum(s.nrBand) : s.band ? bandNum(s.band) : undefined;
    const tech: 'LTE' | 'NR' = s.nrBand ? 'NR' : 'LTE';
    return (s.rsrp !== undefined || s.cellId)
      ? [{ kind: 'serving', tech, band, cellId: s.cellId, arfcn: s.earfcn,
           rsrp: s.nrRsrp ?? s.rsrp, rsrq: s.nrRsrq ?? s.rsrq, sinr: s.nrSinr ?? s.sinr, rssi: s.rssi }]
      : [];
  }
  async getSnapshot(): Promise<SignalSnapshot> {
    const s = await this.getSignal();
    return buildSnapshot(s, [], await this.getCells(), { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const st = await this.status();
    const t = techOf(st.NetworkType);
    const connected = /CONNECT/i.test(String(st.ConnectionStatus ?? '')) && !/DISCONNECT/i.test(String(st.ConnectionStatus ?? ''));
    return { operator: str(st.NetworkName), connected, mode: t.label, supports5g: true };
  }
  async isConnected(): Promise<boolean> {
    const st = await this.status();
    return /CONNECT/i.test(String(st.ConnectionStatus ?? '')) && !/DISCONNECT/i.test(String(st.ConnectionStatus ?? ''));
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const [sys, conn, st] = await Promise.all([
      this.call('GetSystemInfo').catch(() => ({})),
      this.call('GetConnectionState').catch(() => ({})),
      this.status(),
    ]);
    return {
      model: this.model || str(sys?.DeviceName),
      imei: str(sys?.IMEI),
      software: str(sys?.SwVersion),
      hardware: str(sys?.HwVersion),
      wanIp: str(conn?.IPv4Adrress) ?? str(conn?.IPv4Address),
      operator: str(st.NetworkName),
    };
  }
  async getTraffic(): Promise<Traffic> {
    const c = (await this.call('GetConnectionState').catch(() => ({}))) || {};
    return {
      downBytesPerSec: num(c.DlRate, 0, 1e12) ?? num(c.Speed_Dl, 0, 1e12) ?? 0,
      upBytesPerSec: num(c.UlRate, 0, 1e12) ?? num(c.Speed_Ul, 0, 1e12) ?? 0,
      connectedSecs: num(c.ConnectionTime, 0, 1e10) ?? 0,
      sessionDownBytes: num(c.DlBytes, 0, 1e15),
      sessionUpBytes: num(c.UlBytes, 0, 1e15),
    };
  }
  async getDevices(): Promise<ConnectedDevice[]> {
    const r = await this.call('GetConnectedDeviceList').catch(() => null);
    const list: any[] = Array.isArray(r) ? r : Array.isArray(r?.DeviceList) ? r.DeviceList : [];
    return list
      .filter(d => String(d?.DeviceType ?? '') !== '0') // 0 = الراوتر نفسه
      .map(d => ({
        mac: String(d.MacAddress ?? '').toUpperCase(),
        ip: str(d.IpAddress),
        name: str(d.DeviceName) ?? str(d.HostName),
      }))
      .filter(d => d.mac);
  }

  async reboot(): Promise<void> {
    try { await this.call('SetDeviceReboot', {}, 12000); } catch {}
    this.token = '';
  }
  /** آي بي جديد: فصل البيانات ورجوعها (نفس زر الاتصال في الصفحة) بدون إعادة تشغيل */
  async reconnectData(opts?: { holdSecs?: number }): Promise<void> {
    await this.call('DisConnect', {}, 12000);
    await sleep(Math.max(2, opts?.holdSecs ?? 3) * 1000);
    await this.call('Connect', {}, 12000);
  }
}
