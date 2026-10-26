/**
 * OPPO 5G CPE (T1a — زين، 192.168.0.1) — واجهة Vue: POST /api/<خدمة>/<أمر> مشفّر (./crypto).
 * كل الأوامر وأسماء الخانات من ملفات صفحة الراوتر الحقيقية (تقرير ٢٦ أكتوبر) — مو تخمين.
 *
 * الموجود في صفحة الراوتر وبنيناه:
 *   الإشارة 4G/5G + رقم البرج + الترددات والدمج · وضع الشبكة (تلقائي/SA/NSA/4G) · إعادة التشغيل وضبط المصنع
 *   الأجهزة وحظرها (MacFilter) · الاستهلاك · الرسائل · معلومات الجهاز
 *   مركز التحكم: الأنوار، UPnP والمنافذ، DMZ، الواي فاي (الاسم/الكلمة/تشغيل كل شبكة)، شبكة الضيوف · قناة الواي فاي
 * مو موجود في صفحته (فما نرسله): تثبيت الترددات وتثبيت البرج — setBand يوقف برسالة قبل أي أمر.
 *
 * لسا ما انجرّب على راوتر حقيقي — أي رد غريب يطلع برسالة فيها اسم الأمر عشان يوصلنا في التقرير.
 */
import * as Crypto from 'expo-crypto';
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, BandConfig, ConnectedDevice, Usage,
  DeviceDetails, Carrier, SmsMessage, RouterExtras, WifiRadio,
} from '../types';
import { noChange } from '../noChange';
import { http } from '../http';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import { newKeys, oppoBody, oppoDecrypt, passHash, OppoKeys } from './crypto';
import {
  OppoRaw, signalFrom, cellsFrom, carriersFrom, modesFrom, modeOptions, codeOfValue, ModeEntry, devicesFrom,
  smsFrom, smsIndex, uptimeFrom, ifacePayload, radioPayload, wifiPassError, ssidError, isIPv4,
} from './parse';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand = (n: number) => Crypto.getRandomBytes(n);
type Job = { apiService: string; apiName: string; data?: unknown; name: string };

export class OppoDriver implements RouterDriver {
  id = 'oppo';
  name = 'OPPO';
  capabilities: Capability[] = ['signal', 'cells', 'reboot', 'devices', 'block', 'sms', 'usage'];

  private host = '';
  private user = 'admin';
  private pem = '';
  private keys: OppoKeys | null = null;
  /** node-rsa الافتراضي OAEP — لو الراوتر ما فهم المفتاح نجرّب PKCS#1 */
  private scheme: 'oaep' | 'pkcs1' = 'oaep';
  private keyOk = false;
  private token = '';
  private modes: ModeEntry[] | null = null;

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  private async getPem(): Promise<string> {
    const r = await http(`${this.base()}/api/webCgi/GetPemKey`, { headers: { Accept: 'application/json, text/plain, */*' } }, 8000);
    const t = await r.text();
    let j: any; try { j = JSON.parse(t); } catch { j = null; }
    const pem = String(j?.data?.pem ?? j?.pem ?? '');
    if (!/BEGIN/.test(pem)) throw new Error('GetPemKey: الراوتر ما أعطى مفتاح التشفير');
    return pem;
  }

  /** طلب مشفّر مثل P في الصفحة (b775) — يرجّع .data من الرد */
  private async api(path: string, data?: unknown, timeout = 10000, tries = 0): Promise<any> {
    if (!this.keys) {
      if (!this.pem) this.pem = await this.getPem();
      this.keys = newKeys(this.pem, rand, this.scheme);
      this.keyOk = false;
    }
    const k = this.keys;
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json, text/plain, */*' };
    if (this.token) headers['Access-Token'] = this.token;
    const r = await http(`${this.base()}/api${path}`, { method: 'POST', headers, body: oppoBody(data, k, Date.now(), Math.random()) }, timeout);
    if (r.status === 401) throw new Error('انتهت الجلسة');
    this.grabToken(r);
    const t = (await r.text()).trim();
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    let j: any = t;
    try { j = JSON.parse(t); } catch {}
    // ErrorCode 5 = الراوتر ما فك مفتاحنا ← مفتاح جديد (ولو ما اشتغل ولا مرة: نجرّب طريقة RSA الثانية)
    if (j && typeof j === 'object' && Number(j.ErrorCode) === 5) {
      if (tries >= 2) throw new Error(`${path}: الراوتر رفض مفتاح التشفير`);
      if (!this.keyOk) this.scheme = this.scheme === 'oaep' ? 'pkcs1' : 'oaep';
      this.keys = null;
      return this.api(path, data, timeout, tries + 1);
    }
    const enc = typeof j === 'string' ? j : typeof j?.data === 'string' ? j.data : null;
    if (enc === null) return j && typeof j === 'object' && 'data' in j ? j.data : j;
    let obj: any;
    try { obj = JSON.parse(oppoDecrypt(enc, k)); } catch {
      if (!this.keyOk && tries < 2) {
        this.scheme = this.scheme === 'oaep' ? 'pkcs1' : 'oaep';
        this.keys = null;
        return this.api(path, data, timeout, tries + 1);
      }
      throw new Error(`${path}: ما قدرنا نفك رد الراوتر`);
    }
    this.keyOk = true;
    return obj && typeof obj === 'object' && 'data' in obj ? obj.data : obj;
  }
  private grabToken(r: Response) {
    try {
      const sc = r.headers.get('set-cookie') || '';
      const m = sc.match(/Access-Token=([^;,\s]+)/);
      if (m) this.token = decodeURIComponent(m[1]);
    } catch {}
  }
  /** أمر لازم يرجّع ErrorCode 0 */
  private async must(path: string, data?: unknown, what = path): Promise<any> {
    const r = await this.api(path, data);
    if (r && typeof r === 'object' && r.ErrorCode !== undefined && Number(r.ErrorCode) !== 0) throw new Error(`${what}: الراوتر رفض (${r.ErrorCode})`);
    return r;
  }
  private async batch(jobs: Job[]): Promise<Record<string, any>> {
    const r = await this.api('/webCgi/BatchRequest', jobs.map(j => ({ data: {}, ...j })));
    const res = r?.results ?? r?.Results;
    if (!res || typeof res !== 'object') throw new Error('BatchRequest: رد غير متوقع');
    return res;
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try { this.pem = await this.getPem(); return true; } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    try {
      const d = await this.api('/ommng/GetDeviceInfo', {});
      const m = String(d?.deviceName ?? '').trim();
      return { id: 'oppo' + (m ? '-' + m.toLowerCase().replace(/\s+/g, '-') : ''), label: 'OPPO' + (m ? ' ' + m.replace(/^OPPO\s*/i, '') : ' 5G CPE'), brand: 'oppo', tech: '5G' };
    } catch { return null; }
  }

  async login(host: string, username: string, password: string): Promise<void> {
    this.host = host;
    this.user = (username || '').trim() || 'admin';
    this.keys = null; this.token = '';
    const r = await this.api('/userLoginCgi/userLogin', { username: this.user, password: passHash(password) });
    if (r?.isCheckedPass) {
      const t = r.token ?? r.Token ?? r.result?.token;
      if (t) this.token = String(t);
      return;
    }
    if (Number(r?.ErrorCode) === 2) {
      if (Number(r.LeftCount) > 0) throw new Error(`كلمة المرور غلط — باقي ${r.LeftCount} ${Number(r.LeftCount) === 1 ? 'محاولة' : 'محاولات'} قبل ما يقفل الدخول`);
      const mins = Number(r.LockTime) > 0 ? Number(r.LockTime) : Math.ceil(Number(r.LeftTime ?? 60) / 60);
      throw new Error(`الراوتر قفل الدخول بعد محاولات غلط — جرّب بعد ${mins} دقيقة`);
    }
    throw new Error(`userLogin: الراوتر رفض الدخول${r?.ErrorCode !== undefined ? ` (${r.ErrorCode})` : ''}`);
  }
  async logout(): Promise<void> {
    try { await this.api('/userLogin/loginOut', {}); } catch {}
  }

  // ═══ الإشارة ═══
  private async raw(): Promise<OppoRaw> {
    const r = await this.batch([
      { apiService: 'NasMng', apiName: 'GetSysInfo', name: 'sys' },
      { apiService: 'NasMng', apiName: 'GetSignal', name: 'sig' },
      { apiService: 'NasService', apiName: 'GetSignal', data: { Type: 1 }, name: 'nsig' },
      { apiService: 'NasMng', apiName: 'GetCellInfo', name: 'cell' },
      { apiService: 'NasService', apiName: 'GetCellInfo', name: 'ncell' },
      { apiService: 'NasMng', apiName: 'GetBandInfo', name: 'band' },
      { apiService: 'NasMng', apiName: 'GetCaInfo', name: 'ca' },
    ]);
    const ok = (x: any) => (x && typeof x === 'object' && (x.ErrorCode === undefined || Number(x.ErrorCode) === 0) ? x : undefined);
    return { sys: ok(r.sys), sig: ok(r.sig), nsig: ok(r.nsig), cell: ok(r.cell), ncell: ok(r.ncell), band: ok(r.band), ca: ok(r.ca) };
  }
  async getSignal(): Promise<Signal> { return signalFrom(await this.raw()); }
  async getCells(): Promise<CellTower[]> { return cellsFrom(signalFrom(await this.raw())); }
  async getCarriers(): Promise<Carrier[]> {
    const r = await this.raw();
    return carriersFrom(r.band, String(r.sys?.NetMode ?? '').toUpperCase() === 'NR5G');
  }
  async getSnapshot(): Promise<SignalSnapshot> {
    const r = await this.raw();
    const s = signalFrom(r);
    return buildSnapshot(s, carriersFrom(r.band, s.network === '5G SA'), cellsFrom(s), { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const r = await this.raw();
    const s = signalFrom(r);
    return { operator: r.sys?.Plmn ? String(r.sys.Plmn) : undefined, connected: Number(r.sys?.SrvStatus) === 2, mode: s.network, supports5g: true };
  }
  async isConnected(): Promise<boolean> {
    try { return Number((await this.raw()).sys?.SrvStatus) === 2; } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const r = await this.batch([
      { apiService: 'ommng', apiName: 'GetDeviceInfo', name: 'dev' },
      { apiService: 'UpgMng', apiName: 'QueryVersion', name: 'ver' },
      { apiService: 'DialupMng', apiName: 'GetStatus', data: { CId: 1 }, name: 'wan' },
      { apiService: 'NasMng', apiName: 'GetSysInfo', name: 'sys' },
    ]).catch(() => ({} as Record<string, any>));
    return {
      model: r.dev?.deviceName, software: r.ver?.DisplayVersion, hardware: r.ver?.HardwareVersion,
      wanIp: r.wan?.IpAddr, operator: r.sys?.Plmn,
    };
  }
  async getUsage(): Promise<Usage> {
    const r = await this.batch([{ apiService: 'NetStats', apiName: 'GetStats', name: 'st' }]);
    const s = Array.isArray(r.st?.Stats) ? r.st.Stats[0] ?? {} : {};
    return { downloadBytes: Number(s.BytesReceived ?? s.TotalBytesReceived ?? 0) || 0, uploadBytes: Number(s.BytesSent ?? s.TotalBytesSent ?? 0) || 0 };
  }

  async reboot(): Promise<void> {
    try { await this.must('/ommng/Reboot', undefined, 'إعادة التشغيل'); } catch (e) {
      if (!/تعذر الاتصال|ما رد|timeout|network|abort/i.test(String((e as any)?.message ?? e))) throw e;
    }
  }
  async factoryReset(): Promise<void> {
    await this.must('/ommng/Reset', undefined, 'ضبط المصنع');
  }

  // ═══ وضع الشبكة (الترددات والبرج مو موجودة في صفحة هالراوتر) ═══
  private async modeList(): Promise<ModeEntry[]> {
    if (this.modes) return this.modes;
    const r = await this.api('/NasMng/GetNetModeList', {}).catch(() => null);
    this.modes = modesFrom(r);
    return this.modes;
  }
  async getBandConfig(): Promise<BandConfig> {
    const modes = await this.modeList();
    const cur = await this.api('/NasMng/GetNetMode', {});
    return {
      supported: [], locked: [], nrSupported: [], nrLocked: [], nrLockable: false,
      mode: codeOfValue(modes, cur?.NetMode), modes: modeOptions(modes),
    };
  }
  async setBand(): Promise<void> {
    throw noChange('راوتر OPPO ما يسمح بتثبيت الترددات — صفحته نفسها ما فيها هالخيار. تقدر تغيّر «وضع الشبكة» (4G فقط، 5G SA فقط …) من «التحكم المتقدم». ما غيّرنا شي.');
  }
  async setNetworkMode(mode: string): Promise<void> {
    const modes = await this.modeList();
    const m = modes.find(x => x.code === mode);
    if (!m) throw noChange('هالوضع مو موجود في قائمة راوترك — ما غيّرنا شي.');
    const cur = await this.api('/NasMng/GetNetMode', {});
    if (String(cur?.NetMode) === String(m.value)) return;
    await this.must('/NasMng/SetNetMode', { NetMode: m.value }, 'وضع الشبكة');
    await sleep(2000);
    const after = await this.api('/NasMng/GetNetMode', {});
    if (String(after?.NetMode) !== String(m.value)) throw new Error('الراوتر قبل أمر وضع الشبكة بس ما تغيّر');
  }

  // ═══ الأجهزة والحظر ═══
  async getDevices(): Promise<ConnectedDevice[]> {
    const [r, b] = await Promise.all([this.api('/TerminalMgr/GetOnlineTerminal'), this.blocked().catch(() => [])]);
    const blocked = new Set(b.map(x => x.mac));
    return devicesFrom(r).map(d => ({ ...d, blocked: blocked.has(d.mac) }));
  }
  private async filterState() {
    const [en, mode] = await Promise.all([this.api('/MacFilter/GetEnable'), this.api('/MacFilter/GetMode')]);
    return { on: Number(en?.Enable) === 1, mode: Number(mode?.Mode) };
  }
  private async blocked(): Promise<{ mac: string; id: string }[]> {
    const st = await this.filterState();
    if (!st.on || st.mode !== 0) return [];
    const l = await this.api('/MacFilter/GetMacList');
    return (Array.isArray(l?.BlackList) ? l.BlackList : []).map((x: any) => ({ mac: String(x.MacAddr ?? '').toUpperCase(), id: String(x.ID) }));
  }
  async getBlockedDevices(): Promise<ConnectedDevice[]> {
    return (await this.blocked()).map(x => ({ mac: x.mac, blocked: true }));
  }
  async blockDevice(mac: string, block: boolean): Promise<void> {
    const m = mac.toUpperCase();
    const st = await this.filterState();
    if (st.on && st.mode === 1) throw noChange('حظر الأجهزة في راوترك على «القائمة البيضاء» (يسمح لأجهزة معيّنة بس) — غيّرها من صفحة الراوتر لو تبي تحظر من هنا. ما غيّرنا شي.');
    const l = await this.api('/MacFilter/GetMacList');
    const list: any[] = Array.isArray(l?.BlackList) ? l.BlackList : [];
    const row = list.find(x => String(x.MacAddr ?? '').toUpperCase() === m);
    if (block) {
      if (!st.on && st.mode !== 0) await this.must('/MacFilter/ModeChange', { Mode: 0 }, 'حظر الأجهزة');
      if (!row) await this.must('/MacFilter/AddMac', { MacAddr: m }, 'حظر الجهاز');
      if (!st.on) await this.must('/MacFilter/SetEnable', { Enable: 1 }, 'حظر الأجهزة');
    } else if (row) {
      await this.must('/MacFilter/DelMac', { ID: row.ID }, 'فك الحظر');
    }
  }

  // ═══ الرسائل ═══
  private async sessions(): Promise<any[]> {
    const out: any[] = [];
    for (let p = 1; p <= 5; p++) {
      const r = await this.api('/Sms/GetSmsSession', { PageIndex: p, PageSize: 20 });
      const l: any[] = Array.isArray(r?.SessionList) ? r.SessionList : [];
      out.push(...l);
      if (l.length < 20 || out.length >= Number(r?.SessionNum ?? 0)) break;
    }
    return out;
  }
  async listSms(box: 'inbox' | 'sent' = 'inbox'): Promise<SmsMessage[]> {
    const out: SmsMessage[] = [];
    for (const s of await this.sessions()) {
      const src = String(s.SrcAddr ?? '');
      if (!src) continue;
      const d = await this.api('/Sms/GetSessionContext', { SrcAddr: src, ListIndex: 1, ListSize: 50 }).catch(() => null);
      out.push(...smsFrom(src, Number(s.UnReadNum ?? 0), d?.SmsList ?? s.SmsList ?? [], box));
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }
  async markSmsRead(index: string): Promise<void> {
    const { src } = smsIndex(index);
    if (src) await this.must('/Sms/SetReadStatus', { SrcAddr: [src] }, 'قراءة الرسالة');
  }
  async deleteSms(index: string): Promise<void> {
    const { src, sn } = smsIndex(index);
    await this.must('/Sms/DelSms', { SrcAddr: src, SmsSn: [isNaN(Number(sn)) ? sn : Number(sn)] }, 'حذف الرسالة');
  }
  async sendSms(phone: string, text: string): Promise<void> {
    const full = await this.api('/Sms/GetStorageStatus').catch(() => null);
    if (full && Number(full.StorageStatus) === 1) throw noChange('ذاكرة الرسائل في الراوتر ممتلئة — احذف رسائل قديمة وجرّب. ما انرسل شي.');
    await this.must('/Sms/SendSms', { PhoneNum: phone, Data: text, Hide: 0 }, 'إرسال الرسالة');
  }

  // ═══ مركز التحكم ═══
  private async wifiRead() {
    const r = await this.batch([
      { apiService: 'Wifi', apiName: 'Get5gPerfConfig', name: 'perf' },
      { apiService: 'Wifi', apiName: 'GetIfaceConfig', name: 'iface' },
      { apiService: 'Wifi', apiName: 'GetGuestConfig', name: 'guest' },
    ]);
    const ok = (x: any) => (x && Number(x.ErrorCode ?? 0) === 0 ? x : null);
    return { perf: ok(r.perf), iface: ok(r.iface), guest: ok(r.guest) };
  }

  async getExtras(): Promise<RouterExtras> {
    const [r, w] = await Promise.all([
      this.batch([
        { apiService: 'LedMng', apiName: 'GetEnable', name: 'led' },
        { apiService: 'Upnp', apiName: 'GetConfig', name: 'upnp' },
        { apiService: 'Dmz', apiName: 'GetConfig', name: 'dmz' },
        { apiService: 'ommng', apiName: 'GetSysInfo', name: 'sys' },
      ]).catch(() => ({} as Record<string, any>)),
      this.wifiRead().catch(() => ({ perf: null, iface: null, guest: null })),
    ]);
    const ok = (x: any) => x && Number(x.ErrorCode ?? 0) === 0;
    const ex: RouterExtras = {};
    if (ok(r.led) && r.led.Enable !== undefined) ex.led = Number(r.led.Enable) === 1;
    if (ok(r.upnp) && r.upnp.Enable !== undefined) ex.upnp = Number(r.upnp.Enable) === 1;
    if (ok(r.dmz) && r.dmz.Enable !== undefined) ex.dmz = { on: Number(r.dmz.Enable) === 1, ip: String(r.dmz.IpAddr ?? '') };
    const up = uptimeFrom(r.sys?.CumulationUptime);
    if (up) ex.uptime = up;
    if (ex.upnp) {
      try {
        const l = await this.api('/Upnp/GetRuleList');
        const arr: any[] = Array.isArray(l?.UpnpPortMap) ? l.UpnpPortMap : [];
        ex.upnpMaps = arr.slice(0, 32).map(x => ({ app: String(x.AppDesp ?? ''), ip: String(x.LocalIP ?? ''), port: String(x.WanPort ?? ''), proto: String(x.Protocol ?? '') }));
      } catch {}
    }
    if (w.perf && Number(w.perf['5GPerf']) === 1) {
      if (w.perf.SSID) ex.wifiNets = [{ index: 'perf', band: '5', name: String(w.perf.SSID), secured: String(w.perf.Encryption ?? 'none') !== 'none' }];
    } else if (w.iface) {
      const bands: NonNullable<RouterExtras['bands']> = [];
      const nets: NonNullable<RouterExtras['wifiNets']> = [];
      for (const [k, band] of [['iface10', '2.4'], ['iface00', '5']] as const) {
        const x = w.iface[k];
        if (!x) continue;
        bands.push({ band, on: Number(x.Enable) === 1 });
        if (x.SSID) nets.push({ index: k, band, name: String(x.SSID), secured: String(x.Encryption ?? 'none') !== 'none' });
      }
      if (bands.length) ex.bands = bands;
      if (nets.length) ex.wifiNets = nets;
    }
    if (w.guest && w.guest.Enable !== undefined) {
      ex.guest = { on: Number(w.guest.Enable) === 1, name: String(w.guest.SSID ?? ''), open: String(w.guest.Encryption ?? 'none') === 'none', offHours: 0, noTimer: true };
    }
    return ex;
  }

  async setLed(on: boolean): Promise<void> { await this.must('/LedMng/SetEnable', { Enable: on ? 1 : 0 }, 'الأنوار'); }
  async setUpnp(on: boolean): Promise<void> { await this.must('/Upnp/SetConfig', { Enable: on ? 1 : 0 }, 'UPnP'); }
  async setDmz(on: boolean, ip: string): Promise<void> {
    const a = String(ip ?? '').trim();
    if (on && !isIPv4(a)) throw noChange('عنوان الجهاز غير صحيح — ما غيّرنا شي.');
    if (!on) {
      // الصفحة تفضّي العنوان لما تطفي
      await this.must('/Dmz/SetConfig', { Enable: 0, IpAddr: '' }, 'DMZ');
      return;
    }
    await this.must('/Dmz/SetConfig', { Enable: 1, IpAddr: a }, 'DMZ');
  }
  async setGuest(on: boolean): Promise<void> {
    const g = await this.api('/Wifi/GetGuestConfig');
    if (!g || Number(g.ErrorCode ?? 0) !== 0) throw new Error('GetGuestConfig: رد غير متوقع');
    const payload: Record<string, unknown> = {
      SSID: String(g.SSID ?? ''), Key: String(g.Key ?? ''), Enable: on ? 1 : 0, Hide: Number(g.Hide ?? 1), Encryption: String(g.Encryption ?? 'none'),
      GuestList: Array.isArray(g.GuestList) && g.GuestList.length ? [g.GuestList[0]] : ['iface11'],
    };
    await this.must('/Wifi/SetGuestConfig', payload, 'شبكة الضيوف');
    await this.applyWait();
  }
  /** بعد تغيير الواي فاي الصفحة تنتظر ApplyOver = 1 */
  private async applyWait(ms = 20000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { const r = await this.api('/Wifi/ApplyOver'); if (Number(r?.ErrorCode ?? 0) === 0 && Number(r?.Over) === 1) return; } catch {}
      await sleep(2000);
    }
  }
  async setBandOn(band: '2.4' | '5', on: boolean): Promise<void> {
    const w = await this.wifiRead();
    if (w.perf && Number(w.perf['5GPerf']) === 1) throw noChange('راوترك على «شبكة وحدة للنطاقين» — ما فيه إطفاء لنطاق لحاله. ما غيّرنا شي.');
    if (!w.iface?.iface10 || !w.iface?.iface00) throw new Error('GetIfaceConfig: رد غير متوقع');
    const k = band === '2.4' ? 'iface10' : 'iface00';
    if ((Number(w.iface[k].Enable) === 1) === on) return;
    const a = ifacePayload(w.iface.iface10), b = ifacePayload(w.iface.iface00);
    (k === 'iface10' ? a : b).Enable = on ? 1 : 0;
    await this.must('/Wifi/SetIfaceConfig', { iface10: a, iface00: b }, 'الواي فاي');
    await this.applyWait();
  }
  async setWifiNames(names: { index: string; name: string }[], password?: string): Promise<void> {
    for (const n of names) { const e = ssidError(n.name.trim()); if (e) throw noChange(e + ' ما غيّرنا شي.'); }
    if (password) { const e = wifiPassError(password); if (e) throw noChange(e + ' ما غيّرنا شي.'); }
    const w = await this.wifiRead();
    const fix = (x: any, name?: string) => {
      const p = ifacePayload(x);
      if (name !== undefined) p.SSID = name;
      if (password) {
        if (p.Encryption === 'none') throw noChange('شبكتك مفتوحة بدون حماية — فعّل الحماية من صفحة الراوتر أول، وبعدها غيّر كلمة المرور من هنا. ما غيّرنا شي.');
        p.Key = password;
      }
      return p;
    };
    const nameOf = (k: string) => names.find(n => n.index === k)?.name.trim();
    if (w.perf && Number(w.perf['5GPerf']) === 1) {
      await this.must('/Wifi/Set5gPerfConfig', fix(w.perf, nameOf('perf')), 'الواي فاي');
      return;
    }
    if (!w.iface?.iface10 || !w.iface?.iface00) throw new Error('GetIfaceConfig: رد غير متوقع');
    await this.must('/Wifi/SetIfaceConfig', { iface10: fix(w.iface.iface10, nameOf('iface10')), iface00: fix(w.iface.iface00, nameOf('iface00')) }, 'الواي فاي');
  }

  // ═══ قناة الواي فاي (wifi0 = 5G، wifi1 = 2.4G — مثل صفحة الإعدادات) ═══
  async getWifiRadios(): Promise<WifiRadio[]> {
    const r = await this.batch([
      { apiService: 'Wifi', apiName: 'GetDevConfig', name: 'dev' },
      { apiService: 'Wifi', apiName: 'GetAllChannelList', name: 'ch' },
    ]);
    const lists: any[] = Array.isArray(r.ch?.Channel) ? r.ch.Channel : [];
    const allowed = (t: string) => (lists.find(x => String(x.Type) === t)?.ChannelList ?? []).map((c: unknown) => String(c));
    const out: WifiRadio[] = [];
    if (r.dev?.wifi1) out.push({ band: '2.4', channel: String(r.dev.wifi1.Channel ?? '0'), allowed: allowed('24G'), writable: true });
    if (r.dev?.wifi0) out.push({ band: '5', channel: String(r.dev.wifi0.Channel ?? '0'), allowed: allowed('5G'), writable: true });
    return out;
  }
  async setWifiChannel(band: '2.4' | '5', channel: string): Promise<void> {
    const d = await this.api('/Wifi/GetDevConfig');
    if (!d?.wifi0 || !d?.wifi1) throw new Error('GetDevConfig: رد غير متوقع');
    const w0 = radioPayload(d.wifi0), w1 = radioPayload(d.wifi1);
    const ch = Number(channel) || 0;
    if (band === '5') w0.Channel = ch; else w1.Channel = ch;
    await this.must('/Wifi/SetDevConfig', { wifi0: w0, wifi1: w1 }, 'قناة الواي فاي');
    await this.applyWait();
  }
}
