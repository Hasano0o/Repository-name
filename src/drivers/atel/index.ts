/**
 * Asiatelco «/schd/» — سلام HomeFi Max الخارجي (JW515، شريحة Qualcomm فيرموير QC50Q). العنوان 192.168.100.1،
 * الدخول admin + كلمة الملصق (٦ خانات). ⚠️ مو نسخة JW515 حق ZTE goform (192.168.0.1) — هذيك تمشي على درايفر ZTE.
 *
 * المرحلة ١ (٢٠ نوفمبر ٢٠٢٦، من ملفات «مو مدعوم؟» لعضو في جدة): التعرّف + الدخول + القراءة + كرت FULL. بدون أي أمر كتابة.
 *  • «/» = صفحة صغيرة تسأل GET /rest/1.0/WebHeader/ ← Login true/false ← /schd/html/home.html أو login-admin.html
 *  • الدخول (login-admin.html):
 *      GET /rest/1.0/AccessControl/ ← { SessionIdentifier, SecureToken }
 *      POST /rest/1.0/AccessControl/ JSON { Action:"Invoke", Username, Password: sha1(الكلمة + SecureToken) }
 *      200 ← رمز وجلسة جديدة (الصفحة تحطها كوكي mifisess + rsource=browser، أو بالرابط لو الكوكي مقفول)
 *      403 ← lockout.html (بعد ٥ محاولات غلط) · غيرها = الكلمة غلط
 *  • القراءة: WebHeader ← RSRP · RSRQ · SINR · RSSI · SignalLevel (0–5) · Technology · PLMN · ConnectStatus · UsimStatus
 *    DeviceInfo ← DeviceInfoModelNumber · DeviceInfoIMEI · DeviceInfoModemFwVersion
 *  • ما شفنا في صفحاته لا ترددات ولا برج (ملفات bengalSettings/*.js فاضية ~١٣٠ بايت) — ننتظر FULL بعد الدخول.
 */
import { RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, DeviceDetails, Usage } from '../types';
import { sha1 } from '@noble/hashes/legacy';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import type { ModelProfile } from '../models';
import { isSchdPage, isWebHeader, schdLoginBody, signalFrom, mergeService, usageFrom, connectedOf, techOf, str, scrubRest } from './parse';

export const schdSha = (pw: string, token: string) => bytesToHex(sha1(utf8ToBytes(pw + token)));

/** صفحات/أوامر تغيّر شي — الجامع ما يفتحها */
const SCHD_DANGER = /reboot|reset|restore|factory|upload|upgrade|logout|sysbackup|update/i;

type Res = { status: number; text: string };

export class AtelSchdDriver implements RouterDriver {
  readonly id = 'atel';
  name = 'سلام HomeFi Max (JW515)';
  readonly capabilities: Capability[] = ['signal', 'usage'];

  private host = '';
  private sid = '';
  private creds: { user: string; password: string } | null = null;
  private reloginAt = 0;
  private info: { model?: string; imei?: string; fw?: string } | null = null;
  private loggedKeys = false;

  private base(host = this.host) { return 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  /** الجلسة: بالرابط (مثل ما تسوي الصفحة لما الكوكي مقفول) + كوكي — الاثنين عشان أي واحد يمشي */
  private withSid(path: string) {
    if (!this.sid || !/^\/rest\//.test(path)) return path;
    return path + (path.includes('?') ? '&' : '?') + `mifisess=${encodeURIComponent(this.sid)}&rsource=browser`;
  }
  private async req(path: string, init: RequestInit = {}, timeout = 8000): Promise<Res> {
    const headers: Record<string, string> = { ...(init.headers as any ?? {}) };
    if (this.sid) headers.Cookie = `mifisess=${this.sid}; rsource=browser`;
    const r = await http(this.base() + this.withSid(path), { ...init, headers }, timeout);
    return { status: r.status, text: await r.text() };
  }
  private async json(path: string, init: RequestInit = {}, timeout = 8000): Promise<{ status: number; j: any }> {
    const r = await this.req(path, { ...init, headers: { Accept: 'application/json, text/javascript, */*', 'Content-Type': 'application/json', ...(init.headers as any ?? {}) } }, timeout);
    let j: any = null;
    try { j = JSON.parse(r.text); } catch {}
    return { status: r.status, j };
  }

  private async header(): Promise<any | null> {
    const { status, j } = await this.json(`/rest/1.0/WebHeader/?random=${Date.now()}`);
    if (status !== 200 || !isWebHeader(j)) return null;
    // مرة وحدة: كل حقول WebHeader بقيمها (ما فيها أسرار) — نعرف منها لو فيه تردد/برج بأسماء ما نعرفها
    if (!this.loggedKeys && j.Login === true) {
      this.loggedKeys = true;
      diag(`[atel] WebHeader: ${Object.entries(j).map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(' · ').slice(0, 900)}`);
    }
    return j;
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    this.host = host;
    try {
      const r = await this.req('/', { method: 'GET' }, 4000);
      if (isSchdPage(r.text)) return true;
      // ما نسأل WebHeader إلا لو الصفحة فيها /schd/ (عشان ما نبطّئ فحص بقية الراوترات)
      if (!/\/schd\//i.test(r.text)) return false;
      return !!(await this.header());
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    return {
      id: 'atel-jw515', label: 'سلام HomeFi Max (JW515)', brand: 'atel', tech: '5G',
      writeUnverified: true,
      note: 'راوتر سلام الخارجي (JW515). الدعم للحين: الدخول وقوة الإشارة والشركة. أرسل ملفات راوترك (الكرت تحت) عشان نضيف الترددات والأبراج.',
    };
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    const user = (username || '').trim() || 'admin';
    const fp = bytesToHex(sha256(utf8ToBytes(`atel:${user}:${password}`)));
    const key = 'atel:' + host;
    if (!opts?.fresh && !opts?.lastTry && await isBadPassword(key, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل. عدّلها من إعدادات الراوتر.');
    }
    // جلسة شغالة؟ ما نصرف محاولة (الراوتر يقفل بعد ٥)
    if (!opts?.fresh && this.sid) {
      try { const h = await this.header(); if (h?.Login === true) { this.creds = { user, password }; return; } } catch {}
    }

    this.sid = '';
    const t = await this.json(`/rest/1.0/AccessControl/?random=${Date.now()}`, { method: 'GET' }, 10000)
      .catch((e: any) => { throw new Error(`الراوتر ما رد (GET AccessControl) — ${String(e?.message ?? e).slice(0, 60)}`); });
    const token = String(t.j?.SecureToken ?? '');
    diag(`[atel] AccessControl → ${t.status} · token ${token ? token.length + ' خانة' : '✗'} · session ${t.j?.SessionIdentifier ? '✓' : '✗'}`);
    if (t.status === 403) throw new Error('الراوتر قافل الدخول بعد محاولات غلط كثيرة — انتظر ٥ دقايق (أو طفّه وشغّله) وجرّب مرة وحدة بكلمة الملصق.');
    if (!token) throw new Error('صفحة الدخول في راوترك ما أعطت الرمز — اضغط «أرسل الخطأ للمطوّر» عشان نشوف ردها');

    let r: { status: number; j: any };
    try {
      r = await this.json('/rest/1.0/AccessControl/', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: this.base() + '/schd/html/login-admin.html' },
        body: schdLoginBody(user, schdSha(password, token)),
      }, 15000);
    } catch (e: any) {
      throw new Error(`الراوتر ما رد على الدخول — ${String(e?.message ?? e).slice(0, 60)}`);
    }
    const keys = r.j && typeof r.j === 'object' ? Object.keys(r.j).slice(0, 8).join(',') : '—';
    diag(`[atel] login (${user}, طول الكلمة ${password.length}) → ${r.status} · مفاتيح الرد: ${keys}`);
    if (r.status === 403) {
      await markBadPassword(key, fp);
      throw new Error('الراوتر قفل الدخول (محاولات غلط كثيرة). انتظر ٥ دقايق وجرّب مرة وحدة: المستخدم admin والكلمة اللي على ملصق الجهاز (٦ خانات) — مو كلمة الواي فاي.');
    }
    if (r.status !== 200) {
      await markBadPassword(key, fp);
      throw new Error('اسم المستخدم أو الكلمة غلط. المستخدم admin والكلمة اللي على ملصق الجهاز تحت (٦ خانات) — مو كلمة الواي فاي. انتبه: بعد ٥ محاولات غلط ينقفل.');
    }
    this.sid = String(r.j?.SessionIdentifier ?? t.j?.SessionIdentifier ?? '');
    // نتأكد: WebHeader لازم يقول Login true
    let h: any = null;
    try { h = await this.header(); } catch {}
    diag(`[atel] بعد الدخول: WebHeader ${h ? `Login=${h.Login} · Technology=${h.Technology ?? '—'} · SignalLevel=${h.SignalLevel ?? '—'} · Usim=${h.UsimStatus ?? '—'}` : '✗ ما رد'}`);
    if (h && h.Login === false) {
      this.sid = '';
      throw new Error('الراوتر قبل الكلمة بس رجّعنا لصفحة الدخول — اضغط «أرسل الخطأ للمطوّر» عشان نصلحها');
    }
    await markBadPassword(key, null);
    this.creds = { user, password };
  }

  async logout(): Promise<void> { /* ما نرسل خروج — الجلسة تنتهي لحالها */ }

  /** WebHeader بجلسة — لو انتهت (Login false) ندخل مرة وحدة كل دقيقتين بالكثير */
  private async ensure(): Promise<any> {
    let h: any = null;
    try { h = await this.header(); } catch {}
    if (h && h.Login === false && this.creds && Date.now() - this.reloginAt > 120_000) {
      this.reloginAt = Date.now();
      diag('[atel] الجلسة انتهت — دخول جديد');
      try { await this.login(this.host, this.creds.user, this.creds.password, { fresh: true }); h = await this.header(); }
      catch (e: any) { diag(`[atel] إعادة الدخول ✗ ${String(e?.message ?? e).slice(0, 80)}`); }
    }
    if (!h) throw new Error('الراوتر ما رد (WebHeader)');
    return h;
  }

  async isConnected(): Promise<boolean> {
    try { return !!(await this.header()); } catch { return false; }
  }

  /** CellularServiceStatus (التردد ورقم الخلية) — مرة كل ٤ ثواني بالكثير، وفشله ما يوقف القراءة */
  private svc: { at: number; v: any } | null = null;
  private svcLogged = false;
  private async service(): Promise<any | null> {
    if (this.svc && Date.now() - this.svc.at < 4000) return this.svc.v;
    let v: any = null;
    try {
      const { status, j } = await this.json(`/rest/1.0/CellularServiceStatus/?random=${Date.now()}`);
      if (status === 200 && j && typeof j === 'object' && !Array.isArray(j)) v = j;
      if (!this.svcLogged) {
        this.svcLogged = true;
        diag(`[atel] CellularServiceStatus → ${status}${v ? ' · ' + Object.entries(v).map(([k, x]) => `${k}=${String(x).slice(0, 20)}`).join(' · ').slice(0, 900) : ''}`);
      }
    } catch {}
    this.svc = { at: Date.now(), v };
    return v;
  }

  async getSignal(): Promise<Signal> {
    const s = signalFrom(await this.ensure());
    return mergeService(s, await this.service());
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const h = await this.ensure();
    return { operator: str(h.PLMN), connected: connectedOf(h), mode: techOf(h), supports5g: true };
  }

  /** الاستهلاك من بداية دورة الراوتر (DataUsageStatisticsGetAll — AUTH ٢١ نوفمبر) */
  async getUsage(): Promise<Usage> {
    const { status, j } = await this.json(`/rest/1.0/DataUsageStatisticsGetAll/?random=${Date.now()}`);
    const u = status === 200 ? usageFrom(j) : null;
    if (!u) throw new Error('الراوتر ما أعطى عدّاد الاستهلاك');
    return u;
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    return buildSnapshot(sig, [], cellsOf(sig), { driverId: this.id, driverName: this.name });
  }

  async getCells(): Promise<CellTower[]> {
    return cellsOf(await this.getSignal());
  }

  async getDeviceDetails(): Promise<DeviceDetails> {
    if (!this.info) {
      try {
        const { j } = await this.json(`/rest/1.0/DeviceInfo/?random=${Date.now()}`);
        if (j && typeof j === 'object') this.info = { model: str(j.DeviceInfoModelNumber), imei: str(j.DeviceInfoIMEI), fw: str(j.DeviceInfoModemFwVersion) };
      } catch {}
    }
    let op: string | undefined;
    try { op = str((await this.header())?.PLMN); } catch {}
    const model = this.info?.model ? `سلام ${this.info.model}` : this.name;
    let wanIp: string | undefined;
    try { const { j } = await this.json(`/rest/1.0/CellularDataConnectionStatus/?random=${Date.now()}`); wanIp = str(j?.CurrentExternalIPv4Address); } catch {}
    return { model, imei: this.info?.imei, operator: op, wanIp, software: `${this.info?.fw ?? 'schd'}|atel-pages-3` };
  }

  /** الجامع (FULL/AUTH): صفحة بالجلسة — GET بس، والخطرة ما تنفتح */
  async fetchAuthPage(path: string): Promise<{ ok: boolean; status: number; text: string; type: string }> {
    if (SCHD_DANGER.test(path)) return { ok: false, status: 0, text: '', type: '' };
    const r = await this.req(path, { method: 'GET' }, 10000).catch(() => ({ status: 0, text: '' }));
    const type = /^\/rest\//.test(path) ? 'application/json' : /\.js(\?|$)/i.test(path) ? 'application/javascript' : /\.css(\?|$)/i.test(path) ? 'text/css' : 'text/html';
    return { ok: r.status >= 200 && r.status < 400, status: r.status, text: type === 'application/json' ? scrubRest(r.text) : r.text, type };
  }

  /**
   * صفحات ما بعد الدخول (GET بس): ردود REST المعروفة + المحتملة (أسماء MiFi المعتادة) + صفحات القائمة.
   * اللي ما يرد يتسجّل «ما وصل» — ما يضر.
   */
  afterLoginPages(): string[] {
    // أوامر الصفحة الحقيقية (addRequest في script.js — FULL ٢١ نوفمبر) أول، وبعدها المحتملة
    const rest = ['CellularServiceStatus', 'CellularServiceSettings', 'CellularDataConnectionStatus', 'SimStatus', 'RouterSettings',
      'DataUsageStatisticsGetAll', 'ConnectedDevicesStatus', 'AccountInfo', 'Notification', 'DisplayFormatSettings',
      'WebHeader', 'AccessControl', 'DeviceInfo', 'BoardInfo', 'SMSStatus', 'NetworkInfo', 'WWANStatus', 'WANStatus', 'WANInfo',
      'ModemInfo', 'ModemStatus', 'SignalInfo', 'RadioInfo', 'CellInfo', 'LTEInfo', 'NRInfo', 'BandInfo', 'BandLock', 'CellLock', 'NetworkMode',
      'NetworkSettings', 'SIMInfo', 'SIMStatus', 'ConnectedDevices', 'DataUsage', 'DeviceStatus', 'SystemInfo', 'APNSettings', 'WiFiSettings', 'LabTestInfo',
      // ٢١ نوفمبر: دوّرنا على تحكم بالترددات مخفي (الصفحة ما تعرضه) — أسماء بنفس أسلوب «Cellular*» وثوابت mifienums
      // (PREFERRED_TECHNOLOGY_* · MNSSTATUS_*). GET بس = قراءة؛ اللي ما يرد يتسجّل «ما وصل».
      'CellularNetworkSettings', 'CellularNetworkSelection', 'CellularTechnologySettings', 'CellularBandSettings', 'CellularBandSelection',
      'CellularBandLock', 'CellularCellLock', 'CellularRadioSettings', 'CellularProfiles', 'CellularProfileSettings', 'CellularServiceInfo',
      'NetworkSelection', 'ManualNetworkSelection', 'MNSStatus', 'MNSList', 'PreferredTechnology', 'TechnologySettings', 'TechnologyPreference',
      'BandSelection', 'BandSettings', 'LTEBandSettings', 'NRBandSettings', 'LTEBands', 'RFSettings', 'RadioSettings', 'EngineeringMode',
      'EngineeringInfo', 'DebugInfo', 'DiagInfo', 'Diagnostics', 'ModemSettings', 'CarrierAggregation', 'CAInfo', 'NeighborCells', 'CellScan']
      .map(n => `/rest/1.0/${n}/`);
    const html = ['home', 'apps_home', 'LabTestInfo', 'InvalidSIM', 'error', 'messages/messages', 'connectedDevices/connected_devices',
      'bengalSettings/bengal_settings', 'bengalSettings/advanced_settings', 'bengalSettings/adv_firewall_set', 'bengalSettings/vpn_settings',
      'bengalSettings/bengal_admin_mobile', 'bengalSettings/network_settings', 'bengalSettings/apn_settings', 'bengalSettings/band_settings',
      'bengalSettings/network_selection', 'bengalSettings/band_lock', 'bengalSettings/cell_lock', 'bengalSettings/lte_settings', 'engineering', 'engineer', 'debug', 'diag', 'labtest',
      'about/about_bengal', 'about/about']
      .map(n => `/schd/html/${n}.html`);
    const js = ['apps_home', 'bengalSettings/bengal_settings', 'bengalSettings/advanced_settings', 'bengalSettings/adv_firewall_set',
      'bengalSettings/vpn_settings', 'bengalSettings/bengal_admin_mobile', 'bengalSettings/network_settings', 'bengalSettings/apn_settings',
      'about/about_bengal', 'home', 'LabTestInfo']
      .map(n => `/schd/js/${n}.js`);
    return [...new Set([...rest, ...html, ...js])].filter(p => !SCHD_DANGER.test(p));
  }
}

function cellsOf(s: Signal): CellTower[] {
  if (s.rsrp === undefined) return [];
  const b = s.band ? Number(String(s.band).replace(/\D/g, '')) : undefined;
  const out: CellTower[] = [{ kind: 'serving', tech: 'LTE', band: b || undefined, cellId: s.cellId, pci: s.pci, rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr, rssi: s.rssi }];
  if (s.nrRsrp !== undefined) {
    const nb = s.nrBand ? Number(String(s.nrBand).replace(/\D/g, '')) : undefined;
    out.push({ kind: 'serving', tech: 'NR', band: nb || undefined, rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr });
  }
  return out;
}
