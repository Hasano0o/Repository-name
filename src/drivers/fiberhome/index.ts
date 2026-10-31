/**
 * FiberHome 5G CPE (واجهة Vue — LG6121/LG6851… بيعت مع STC وغيرها). عنوانه غالباً 192.168.8.1.
 *
 * كل الطلبات من ملفات صفحة الراوتر الحقيقية (تقرير ٢٦ أكتوبر) — مو تخمين:
 *   POST /api/tmp/FHAPIS (بعد الدخول) · /api/tmp/FHNCAPIS (بدون دخول) · /api/sign/DO_WEB_LOGIN
 *   الجسم {dataObj, ajaxmethod, sessionid} بتشفير AES (./crypto)، والرد مشفّر (إلا الدخول).
 *   أسماء الإعدادات من get_xmlnode_js_file (./nodes).
 *
 * الفيرموير الجديد لـ LG6851F (مسارات /fh_api/، تشفير مختلف — ./fhapi): يتحدد تلقائي (api = 'v2').
 *   القديم ما يتغيّر. في v2: الدخول والقراءة بس — أي أمر يغيّر الراوتر محجوب لين يتأكد على جهاز حقيقي.
 *
 * النسخة الأولى: الإشارة، الأبراج المجاورة، تثبيت الترددات (4G/5G)، وضع الشبكة، تثبيت البرج، إعادة التشغيل.
 * مركز التحكم (./extras): NAT، UPnP، DMZ، الأنوار، إعادة التشغيل المجدولة، شبكات 2.4/5، اسم الواي فاي وكلمته، ضبط المصنع.
 * كل تغيير نتأكد منه بإعادة القراءة، وفيه لقطة + إرجاع متحقق منه (مثل هواوي و ZTE).
 * لسا ما انجرّب على راوتر حقيقي — أي رد غريب يطلع برسالة فيها اسم الأمر عشان يوصلنا في التقرير.
 */
import { RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, BandConfig, ActiveLock, CellLockTarget, CellLockState, DeviceDetails, RouterExtras, WifiRadio, Carrier, ConnectedDevice, Usage, SmsMessage, ApnProfile, DnsConfig, AntennaInfo } from '../types';
import { carriersFromCA, devicesFrom, blockedFrom, smsFrom, smsRef, smsSchema, apnsFrom, dnsFrom, DNS_OPERATORS, antennaFrom, antennaValues, FhCellRaw, FhHost } from './v2extra';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { noChange } from '../noChange';
import { http } from '../http';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import { fhBody, fhDecrypt, fhKey } from './crypto';
import { FHAPI_TMP, FHAPI_SIGN, fhapiUnmaskGet, fhapiSecret, fhapiIsEncryptData, fhapiBody, fhapiReply } from './fhapi';
import {
  parseNodeFile, missing, NEED, paths, RF_FIELDS, signalFrom, neighborsFrom,
  LTE_BANDS, NR_BANDS, parseBands, joinBands, FH_TO_CODE, CODE_TO_FH, MODES, loginError,
} from './nodes';
import { EX_FIELDS, EX_NEED, WEEK, wlanRows, extrasFrom, has5g, main5Index, ssidError, wifiPassError, isIPv4, WlanRow } from './extras';

/** v2: القراءة والدخول/الخروج دايماً */
const V2_ALLOWED = (m: string) => /^get_/.test(m) || m === 'DO_WEB_LOGIN' || m === 'DO_WEB_LOGOUT' || m === 'web_get_wifi_possible_channels';
/**
 * v2 — الكتابة لكل ميزة لحالها (opts.v2): بس اللي طابقت صفحات الراوتر نفسها بالأمر والخانات والقيم
 * (ملف AUTH من عضو LG6851F، ٣١ أكتوبر: frequencyLockSet / networkSet / cellLockSet / reboot / restore / natSet / upnpSet / led).
 * DMZ والواي فاي خاناتها مختلفة في الفيرموير الجديد (x_DMZ_* و x_wifi_SSID_obj…) ← تبقى محجوبة.
 */
/**
 * operator_name من get_device_info = كود فيرموير مو اسم شركة: «COMMON» (عام — اللي طلع للعضو «برج COMMON»)،
 * أو «SA_STC» / «PH_GLOBE» (دولة_شركة). العام ما نعرضه، والباقي نشيل كود الدولة.
 */
export function fhOperator(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  if (!s || /^(COMMON|LEISHEN|TRUNK|DEFAULT|GENERAL)$/i.test(s)) return undefined;
  return s.replace(/^[A-Z]{2}_/, '').replace(/_/g, ' ').trim() || undefined;
}
const V2_WRITE = /^(set_value_by_xmlnode|set_single_by_xmlnode|add_set_xmlnode|add_xmlnode|del_xmlnode|do_cmd_web|send_msg)$/;
/**
 * ميزات الفيرموير الجديد بس (صفحاتها وصلت منه) — على الفيرموير القديم نخفيها من الكائن نفسه،
 * عشان التطبيق (اللي يقرّر الأزرار من وجود الدالة) ما يعرض شي ما نعرف صفحته.
 */
const V2_ONLY = ['getCarriers', 'getDevices', 'getBlockedDevices', 'blockDevice', 'getUsage', 'listSms', 'markSmsRead', 'deleteSms', 'sendSms',
  'getApnProfiles', 'setApn', 'selectApn', 'getDns', 'setDns', 'getAntenna', 'setAntenna', 'reconnectData', 'reattach', 'wakeRadio'] as const;
/** الواي فاي في الفيرموير الجديد (wifiBasic.js / wifiBasic_5g.js): Radio.1/2.Enable · SSID.<n>.SSID · AccessPoint.<n>.PreSharedKey */
const V2_WIFI = ['x_wifi_Radio_obj', 'x_wifi_SSID_obj', 'x_wifi_AccessPoint_obj', 'x_wifi_Enable', 'x_wifi_SSID', 'x_wifi_ModeEnabled'];
/** DMZ في الفيرموير الجديد (dmzSet.js): قائمة تحت اتصال INTERNET_R_ (WANDevice.x.WANConnectionDevice.y.WANIPConnection.z.DMZ) */
const V2_DMZ = ['x_WANDevice_obj', 'x_WANConnectionDevice', 'x_WANIPConnection', 'x_WANPPPConnection', 'x_wan_Enable', 'x_wan_Name', 'x_DMZ_obj', 'x_DMZ_Enable', 'x_DMZ_DMZHostIP'];
const listOf = (r: any): any[] => (Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : []);
/** في صفحة الراوتر: هذي الثلاث GET على مسار باسمها (مو FHAPIS?ajaxmethod=) */
const V2_PATH_GET = ['heartbeat', 'refresh_timeout', 'other_logged'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
interface CellRow { idx: string; act: string; arfcn: string; pci: string }
interface FhLockData { band4: string; band5: string; enable: string; mode: string; endc: string; cellEnable: string; cells: CellRow[] }

export class FiberhomeDriver implements RouterDriver {
  id = 'fiberhome';
  name = 'FiberHome';
  capabilities: Capability[] = ['signal', 'cells', 'reboot', 'bandLock'];

  private host = '';
  private user = 'admin';
  private password = '';
  private encrypt = true;
  private nodes: Record<string, string> | null = null;
  private info: Record<string, any> | null = null;
  /** v1 = /api/ (فيرموير ٢٦ أكتوبر) · v2 = /fh_api/ (LG6851F الجديد) */
  private api: 'v1' | 'v2' | null = null;
  /** v2: السر (٥ حروف) من is_encrypt — يدخل في مفتاح كل طلب */
  private secret = '';

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private hdr(extra: Record<string, string> = {}) {
    return { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01', Referer: this.base() + '/main.html', ...extra };
  }
  private log(...a: unknown[]) { if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[fiberhome]', ...a); }

  /** GET /api/tmp/<FHAPIS|FHNCAPIS>?ajaxmethod=… (الردود هنا مو مشفّرة — مثل $get) */
  private async getQ(method: string, nocheck = false): Promise<any> {
    if ((await this.whichApi()) === 'v2') return this.getQ2(method, nocheck);
    const r = await http(`${this.base()}/api/tmp/${nocheck ? 'FHNCAPIS' : 'FHAPIS'}?ajaxmethod=${method}&_=${Math.random()}`, { headers: this.hdr() }, 8000);
    if (r.status === 418) throw new Error('انتهت الجلسة');
    if (r.status === 417) throw new Error('فيه أحد داخل صفحة الراوتر من جهاز ثاني — سكّرها وجرّب');
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  }

  /** مثل $post: رمز جديد لكل طلب (get_refresh_sessionid)، والمفتاح أول ١٦ حرف منه */
  private async post(method: string, dataObj: unknown, opts: { nocheck?: boolean; sign?: boolean; timeout?: number; v2?: boolean } = {}): Promise<any> {
    if ((await this.whichApi()) === 'v2') return this.post2(method, dataObj, opts);
    const tok = await this.getQ('get_refresh_sessionid', true);
    const sid = String(tok?.sessionid ?? '');
    if (this.encrypt && sid.length < 16) throw new Error(`${method}: الراوتر ما أعطى رمز جلسة`);
    const path = opts.sign ? `/api/sign/${method}` : `/api/tmp/${opts.nocheck ? 'FHNCAPIS' : 'FHAPIS'}`;
    const r = await http(`${this.base()}${path}?_${Math.random()}`, {
      method: 'POST',
      headers: this.hdr({ 'Content-Type': 'application/json; charset=utf-8' }),
      body: fhBody({ dataObj: dataObj ?? null, ajaxmethod: method }, sid, this.encrypt),
    }, opts.timeout ?? 15000);
    if (r.status === 418) throw new Error('انتهت الجلسة');
    if (r.status === 417) throw new Error('فيه أحد داخل صفحة الراوتر من جهاز ثاني — سكّرها وجرّب');
    const t = await r.text();
    if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
    // الدخول والخروج ردهم نص عادي (polyfill: ما نفك loginoutPath)
    if (opts.sign) return t;
    let plain = t;
    if (this.encrypt) {
      try { plain = fhDecrypt(t, fhKey(sid)); } catch { throw new Error(`${method}: ما قدرنا نفك رد الراوتر`); }
    }
    try { return JSON.parse(plain); } catch { return plain; }
  }

  // ═══ v2: الفيرموير الجديد (/fh_api/) ═══
  /** نفس getToken في الصفحة: GET بدون أي معالجة للرد */
  private async sessionV2(): Promise<{ ok: boolean; status: number; sid: string }> {
    const r = await http(`${this.base()}${FHAPI_TMP}FHNCAPIS?ajaxmethod=get_refresh_sessionid`, { headers: this.hdr(), cache: 'no-store' } as RequestInit, 8000);
    const t = await r.text();
    let sid = '';
    try { const j = JSON.parse(t); if (j && typeof j.sessionid === 'string') sid = j.sessionid; } catch {}
    return { ok: r.ok, status: r.status, sid };
  }
  /**
   * أي بروتوكول عند هالراوتر — القديم أول: لو /api/tmp is_encrypt رد {enable} فهو v1 بالضبط مثل قبل (ما يتغيّر عليه شي).
   * v2 بس لو القديم ما رد صح (LG6851F الجديد يرد 403) و /fh_api/ أعطى sessionid.
   */
  private async whichApi(): Promise<'v1' | 'v2'> {
    if (this.api) return this.api;
    let v1 = false;
    try {
      const r = await http(`${this.base()}/api/tmp/FHNCAPIS?ajaxmethod=is_encrypt&_=${Math.random()}`, { headers: this.hdr() }, 8000);
      const j = JSON.parse(await r.text());
      v1 = r.ok && !!j && typeof j === 'object' && 'enable' in j;
    } catch {}
    let v2 = false;
    if (!v1) { try { v2 = (await this.sessionV2()).sid.length > 0; } catch {} }
    this.api = v2 ? 'v2' : 'v1';
    this.log('api', this.api);
    this.applyApi();
    return this.api;
  }
  /** v1: نخفي ميزات v2 من هالكائن (تظليل للـ prototype) · v2: نرجّعها */
  private applyApi() {
    for (const k of V2_ONLY) {
      if (this.api === 'v1') (this as any)[k] = undefined;
      else delete (this as any)[k];
    }
  }
  /** v2 GET مثل $get: FHAPIS/FHNCAPIS?ajaxmethod=… (أو مسار باسم الأمر)، والرد يتنظّف برأس content-len لو موجود */
  private async getQ2(method: string, nocheck = false): Promise<any> {
    const url = V2_PATH_GET.includes(method)
      ? `${this.base()}${FHAPI_TMP}${method}`
      : `${this.base()}${FHAPI_TMP}${nocheck ? 'FHNCAPIS' : 'FHAPIS'}?ajaxmethod=${method}`;
    const r = await http(url, { headers: this.hdr(), cache: 'no-store' } as RequestInit, 8000);
    if (r.status === 418) throw new Error('انتهت الجلسة');
    if (r.status === 417) throw new Error('فيه أحد داخل صفحة الراوتر من جهاز ثاني — سكّرها وجرّب');
    const raw = await r.text();
    if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
    let t = raw;
    try { t = fhapiUnmaskGet(raw, r.headers?.get?.('content-len')) ?? raw; } catch { throw new Error(`${method}: ما قدرنا نقرأ رد الراوتر`); }
    try { return JSON.parse(t); } catch { return t; }
  }
  /** v2: السر من is_encrypt (مرة وحدة؛ ينعاد لو الراوتر غيّره) */
  private async secretV2(): Promise<string> {
    if (this.secret.length === 5) return this.secret;
    const t = await this.getQ2('is_encrypt', true);
    const data = fhapiIsEncryptData(t);
    const { secret } = fhapiSecret(data);
    if (!secret || secret.length !== 5) {
      throw new Error(`is_encrypt: ما قدرنا نفك سر الراوتر (${data ? `طول data ${data.length}` : `الرد بدون data: ${typeof t === 'string' ? t.slice(0, 40) : Object.keys(t ?? {}).join(',').slice(0, 60)}`})`);
    }
    this.secret = secret;
    return secret;
  }
  /** v2 POST مثل $post: رمز جديد لكل طلب، الجسم مشفّر دايماً؛ الرد مشفّر إلا الدخول/الخروج */
  private async post2(method: string, dataObj: unknown, opts: { nocheck?: boolean; sign?: boolean; timeout?: number; v2?: boolean } = {}): Promise<any> {
    if (!V2_ALLOWED(method) && !(opts.v2 && V2_WRITE.test(method))) {
      throw noChange('هالإعداد في فيرموير FiberHome الجديد مختلف عن القديم (الواي فاي / DMZ) — لسا ما فتحناه. الترددات ووضع الشبكة والبرج ومركز التحكم شغّالة — ما غيّرنا شي.');
    }
    const secret = await this.secretV2();
    const tok = await this.sessionV2();
    if (!tok.sid) throw new Error(`${method}: الراوتر ما أعطى رمز جلسة${tok.ok ? '' : ` (HTTP ${tok.status})`}`);
    const path = opts.sign ? `${FHAPI_SIGN}${method}` : `${FHAPI_TMP}${opts.nocheck ? 'FHNCAPIS' : 'FHAPIS'}`;
    const r = await http(`${this.base()}${path}?_${Math.random()}`, {
      method: 'POST',
      // مثل الصفحة بالضبط: POST فيه Content-Type بس (بدون X-Requested-With/Accept)، والمتصفح يضيف Referer
      headers: { 'Content-Type': 'application/json; charset=utf-8', Referer: this.base() + '/login.html' },
      body: fhapiBody(method, dataObj, tok.sid, secret),
    }, opts.timeout ?? 15000);
    if (r.status === 418) throw new Error('انتهت الجلسة');
    if (r.status === 417) throw new Error('فيه أحد داخل صفحة الراوتر من جهاز ثاني — سكّرها وجرّب');
    const t = await r.text();
    if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
    if (opts.sign) { try { return JSON.parse(t); } catch { return t; } }
    // الصفحة تفك كل رد هنا (_0x336985_) — رد ما ينفك = خطأ، ونذكر أوله في الرسالة عشان يوصلنا في التقرير
    try { return fhapiReply(t, tok.sid, secret); } catch {
      this.secret = '';   // يمكن الراوتر غيّر السر (إعادة تشغيل) — الطلب الجاي يجيبه من جديد
      throw new Error(`${method}: ما قدرنا نفك رد الراوتر (${t.length} حرف: ${t.slice(0, 40).replace(/\s+/g, ' ')})`);
    }
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    this.api = null;
    this.secret = '';
    try { if ((await this.whichApi()) === 'v2') return true; } catch {}
    try {
      const j = await this.getQ('is_encrypt', true);
      if (j && typeof j === 'object' && 'enable' in j) return true;
    } catch {}
    // احتياط (LG6851F — تقرير ٢٦ أكتوبر: التطبيق قال «مو مدعوم»): بصمة صفحة الدخول نفسها
    // checkBrowser.js + lang/login_res.js + المحمّل المخفي اللي يجيب polyfill.min.js
    try {
      const r = await http(`${this.base()}/login.html?${Math.random().toString().slice(-4)}`, { headers: { Accept: 'text/html,*/*' } }, 6000);
      const t = await r.text();
      return /checkBrowser\.js/.test(t) && (/_0xdx2m04ej1p623_|login_res\.js/.test(t));
    } catch { return false; }
  }
  /** is_encrypt — لو ما رد بشكل مفهوم نفترض التشفير شغّال (الافتراضي في polyfill) */
  private async readEncrypt(): Promise<boolean> {
    if ((await this.whichApi()) === 'v2') return true;
    try {
      const enc = await this.getQ('is_encrypt', true);
      if (enc && typeof enc === 'object' && 'enable' in enc) return String(enc.enable) === '1';
    } catch {}
    return true;
  }

  private async deviceInfo(): Promise<Record<string, any>> {
    if (this.info) return this.info;
    const d = await this.post('get_device_info', null, { nocheck: true });
    this.info = d && typeof d === 'object' ? d : {};
    return this.info!;
  }

  async identify(): Promise<ModelProfile | null> {
    try {
      this.encrypt = await this.readEncrypt();
      const m = String((await this.deviceInfo()).model_name ?? '').trim();
      return { id: 'fiberhome' + (m ? '-' + m.toLowerCase() : ''), label: 'FiberHome' + (m ? ' ' + m : ''), brand: 'fiberhome', tech: '5G' };
    } catch { return null; }
  }

  async login(host: string, username: string, password: string): Promise<void> {
    if (host !== this.host) { this.api = null; this.secret = ''; }
    this.host = host;
    this.user = (username || '').trim() || 'admin';
    this.password = password;
    this.encrypt = await this.readEncrypt();
    const res = await this.post('DO_WEB_LOGIN', { username: this.user, password }, { sign: true });
    // v2 (login.js): الرد {result: 0..4}؛ v1: نص "0|…"
    const err = loginError(res && typeof res === 'object' && 'result' in res ? String((res as any).result) : typeof res === 'string' ? res : JSON.stringify(res));
    if (err) throw new Error(err);
    // نفس صفحة الدخول بعد النجاح
    try { await this.getQ('set_developer_mode'); } catch {}
    await this.loadNodes();
  }

  private async loadNodes(): Promise<Record<string, string>> {
    if (this.nodes) return this.nodes;
    const r = await this.post('get_xmlnode_js_file', null, { nocheck: true });
    const xml = typeof r?.xml === 'string' ? r.xml : '';
    if (!xml) throw new Error('get_xmlnode_js_file: الراوتر ما أعطى أسماء الإعدادات');
    const n = parseNodeFile(xml);
    if (!Object.keys(n).length) throw new Error('get_xmlnode_js_file: ما قدرنا نقرأ أسماء الإعدادات من الراوتر');
    this.nodes = n;
    return n;
  }
  /** الأسماء اللازمة لميزة — لو ناقص نوقف قبل أي أمر ونقول وش ناقص (يوصلنا في التقرير) */
  private async need(keys: string[], what: string): Promise<Record<string, string>> {
    const n = await this.loadNodes();
    const miss = missing(n, keys);
    if (miss.length) throw noChange(`${what} لسا ما يشتغل على راوترك — ما لقينا ${miss.slice(0, 3).join('، ')} في إعداداته. ما غيّرنا شي.`);
    return n;
  }

  /**
   * الفيرموير الجديد: صفحات الإعدادات وصلت كاملة (ملف AUTH ٣١ أكتوبر — ٩١ ملف) ومنها فتحنا الكتابة (V2_WRITE).
   * ما نحتاج شي ثاني الحين ← الكرت يختفي. (لو احتجنا صفحات ثانية بعدين: نرجّع ['/main.html'])
   */
  afterLoginPages(): string[] {
    return [];
  }
  /** النوعين وصلتنا صفحاتهم كاملة (v1 من «جهاز جديد»، v2 من ملف AUTH) */
  pageFilesKnown(): boolean { return true; }
  async logout(): Promise<void> {
    try { await this.post('DO_WEB_LOGOUT', null, { sign: true }); } catch {}
  }

  // ═══ القراءة ═══
  private async rf(): Promise<Record<string, any>> {
    const n = await this.need(NEED.rf, 'قراءة الإشارة');
    const r = await this.post('get_value_by_xmlnode', paths(n, RF_FIELDS));
    if (!r || typeof r !== 'object') throw new Error('get_value_by_xmlnode: رد غير متوقع');
    return r;
  }
  async getSignal(): Promise<Signal> { return signalFrom(await this.rf()); }

  async getCells(): Promise<CellTower[]> {
    const rf = await this.rf();
    const s = signalFrom(rf);
    const out: CellTower[] = [];
    if (s.pci || s.rsrp !== undefined) out.push({ kind: 'serving', tech: 'LTE', pci: s.pci, band: s.band ? parseInt(s.band.slice(1), 10) : undefined, rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr, cellId: s.cellId } as CellTower);
    if (s.nrPci || s.nrRsrp !== undefined) out.push({ kind: s.network === '5G SA' ? 'serving' : 'secondary', tech: 'NR', pci: s.nrPci, band: s.nrBand ? parseInt(s.nrBand.slice(1), 10) : undefined, rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr } as CellTower);
    return [...out, ...neighborsFrom(rf)];
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const rf = await this.rf();
    const s = signalFrom(rf);
    const ca = this.api === 'v2' ? await this.getCarriers().catch(() => [] as Carrier[]) : [];
    return buildSnapshot(s, ca, neighborsFrom(rf), { driverId: this.id, driverName: this.name });
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    let operator: string | undefined;
    try { operator = fhOperator((await this.deviceInfo()).operator_name); } catch {}
    let mode = '';
    try { mode = String((await this.rf()).WorkMode ?? '').trim(); } catch {}
    return { operator, connected: /LTE|NSA|SA/i.test(mode), mode: mode || undefined, supports5g: true };
  }
  async isConnected(): Promise<boolean> {
    try { return /LTE|NSA|SA/i.test(String((await this.rf()).WorkMode ?? '')); } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const d = await this.deviceInfo().catch(() => ({} as Record<string, any>));
    const out: DeviceDetails = { model: d.model_name, software: d.software_version ?? d.sw_version, operator: fhOperator(d.operator_name) };
    // simInfo.js: اسم الشركة الحقيقي من الشريحة (بدل كود الفيرموير) + حالة الشريحة والـ IMEI — ما نقرأ IMSI/ICCID/الرقم
    if (this.api === 'v2') {
      try {
        const n = await this.loadNodes();
        if (!missing(n, ['x_SIM_1_obj', 'x_SIM_1_CarrierName']).length) {
          const q: Record<string, string> = { carrier: n.x_SIM_1_obj + n.x_SIM_1_CarrierName };
          if (n.x_SIM_1_SIMStatus) q.sim = n.x_SIM_1_obj + n.x_SIM_1_SIMStatus;
          if (n.x_SIM_1_IMEI) q.imei = n.x_SIM_1_obj + n.x_SIM_1_IMEI;
          const v = await this.readMany(q);
          const c = String(v.carrier ?? '').trim();
          if (c) out.operator = c;
          if (v.sim !== undefined) out.simStatus = String(v.sim);
          if (v.imei) out.imei = String(v.imei);
        }
      } catch {}
    }
    return out;
  }

  async reboot(): Promise<void> {
    // نفس reboot.js: نسجّل الرسالة ثم نعيد التشغيل
    try { await this.post('do_cmd_web', { key: 'RECORD_MESSAGE_WEB' }, { v2: true }); } catch {}
    try { await this.post('do_cmd_web', { key: 'REBOOT_WEB' }, { v2: true }); } catch (e) {
      // الراوتر يقطع الاتصال وهو يطفي — هذا نجاح غالباً
      if (!/تعذر الاتصال|ما رد/.test(String((e as any)?.message ?? e))) throw e;
    }
  }

  // ═══ الترددات ووضع الشبكة ═══
  private async readBand() {
    const n = await this.need([...NEED.band, ...NEED.mode], 'تثبيت الترددات');
    const o = n.x_NetworkSettings_obj;
    const r = await this.post('get_value_by_xmlnode', {
      band4: o + n.x_NetworkSet_LTELockBAND, band5: o + n.x_NetworkSet_NRLockBAND, enable: o + n.x_NetworkSet_LockBandEnable,
      mode: o + n.x_NetworkSet_NetworkMode, endc: o + n.x_NetworkSet_ENDC,
    });
    if (!r || typeof r !== 'object') throw new Error('get_value_by_xmlnode: رد غير متوقع (الترددات)');
    return { n, band4: String(r.band4 ?? ''), band5: String(r.band5 ?? ''), enable: String(r.enable ?? ''), mode: String(r.mode ?? ''), endc: String(r.endc ?? '') };
  }
  /** v2: true = الميزة طابقت صفحة الفيرموير الجديد (V2_WRITE) */
  private async setValues(url: Record<string, string>, value: Record<string, string>, v2 = false) {
    const r = await this.post('set_value_by_xmlnode', { url, value }, { v2 });
    if (r && typeof r === 'object' && (r.success === 'false' || r.success === false)) throw new Error('set_value_by_xmlnode: الراوتر رفض');
  }

  async getBandConfig(): Promise<BandConfig> {
    const b = await this.readBand();
    const on = b.enable === '1';
    return {
      supported: LTE_BANDS,
      locked: on ? parseBands(b.band4) : [],
      nrSupported: NR_BANDS,
      nrLocked: on ? parseBands(b.band5) : [],
      nrPreferred: NR_BANDS,
      mode: FH_TO_CODE[b.mode] ?? b.mode,
      modes: MODES,
    };
  }

  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const b = await this.readBand();
    const on = b.enable === '1';
    const curL = on ? parseBands(b.band4) : [], curN = on ? parseBands(b.band5) : [];
    let lte = bands === 'keep' ? curL : bands.filter(x => LTE_BANDS.includes(x));
    let nr = nrBands === undefined ? curN : nrBands.filter(x => NR_BANDS.includes(x));
    if (bands !== 'keep' && bands.length && !lte.length) throw noChange('الترددات اللي اخترتها ما تطلع في صفحة راوترك — ما غيّرنا شي.');
    // الصفحة تمنع B32 لحاله (تردد تنزيل بس — ما فيه اتصال)
    if (lte.length === 1 && lte[0] === 32) throw noChange('B32 لحاله ما يشتغل (تردد تنزيل بس) — ما غيّرنا شي.');
    const lock = lte.length > 0 || nr.length > 0;
    // تقنية بدون اختيار وهو مقفول = كل تردداتها (القائمة الفاضية ممكن تعني «ولا شي» عند الراوتر)
    if (lock && !lte.length) lte = LTE_BANDS.filter(x => x !== 32);
    if (lock && !nr.length) nr = NR_BANDS;
    const want = { band4: lock ? joinBands(lte) : b.band4, band5: lock ? joinBands(nr) : b.band5, enable: lock ? '1' : '0' };
    if (want.enable === b.enable && (!lock || (want.band4 === joinBands(parseBands(b.band4)) && want.band5 === joinBands(parseBands(b.band5))))) return;
    const o = b.n.x_NetworkSettings_obj;
    await this.setValues(
      { band4: o + b.n.x_NetworkSet_LTELockBAND, band5: o + b.n.x_NetworkSet_NRLockBAND, enable: o + b.n.x_NetworkSet_LockBandEnable },
      want,
      true,
    );
    await sleep(3000); // الصفحة نفسها تعيد القراءة بعد ٣ ثواني
    const a = await this.readBand();
    if (a.enable !== want.enable || (lock && (joinBands(parseBands(a.band4)) !== want.band4 || joinBands(parseBands(a.band5)) !== want.band5))) {
      throw new Error('الراوتر قبل أمر الترددات بس القراءة بعده مختلفة');
    }
  }

  async setNetworkMode(mode: string): Promise<void> {
    const v = CODE_TO_FH[mode] ?? mode;
    const b = await this.readBand();
    if (b.mode === v) return;
    const o = b.n.x_NetworkSettings_obj;
    await this.setValues({ NetworkMode: o + b.n.x_NetworkSet_NetworkMode, ENDC: o + b.n.x_NetworkSet_ENDC }, { NetworkMode: v, ENDC: b.endc }, true);
    await sleep(3000);
    if ((await this.readBand()).mode !== v) throw new Error('الراوتر قبل أمر وضع الشبكة بس ما تغيّر');
  }

  async getActiveLock(): Promise<ActiveLock | null> {
    const c = await this.getBandConfig();
    const cell = (await this.getCellLocks().catch(() => []))[0];
    if (!c.locked.length && !c.nrLocked.length && !cell) return null;
    return { bands: c.locked, nrBands: c.nrLocked, pci: cell?.pci };
  }

  // ═══ تثبيت البرج (cellLockSet.js) ═══
  private async readCells(): Promise<{ n: Record<string, string>; enable: string; rows: CellRow[] }> {
    const n = await this.need(NEED.cell, 'تثبيت البرج');
    const list = await this.post('get_xml_childnode_value', {
      url: n.x_LockCellList_obj + n.x_LockCellList_LockCell,
      node: { act: n.x_LockCellList_act, arfcn: n.x_LockCellList_arfcn, pci: n.x_LockCellList_pci },
    });
    const en = await this.post('get_value_by_xmlnode', { LockEnable: n.x_LockCellList_obj + n.x_LockCellList_LockEnable });
    const arr: any[] = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : [];
    return {
      n, enable: String(en?.LockEnable ?? ''),
      rows: arr.map(e => ({ idx: String(e.child_node_idx ?? ''), act: String(e.act ?? ''), arfcn: String(e.arfcn ?? ''), pci: String(e.pci ?? '') })),
    };
  }
  private async setCellEnable(n: Record<string, string>, on: boolean) {
    await this.setValues({ Enable: n.x_LockCellList_obj + n.x_LockCellList_LockEnable }, { Enable: on ? '1' : '0' }, true);
  }

  async getCellLocks(): Promise<CellLockState[]> {
    const c = await this.readCells();
    if (c.enable !== '1') return [];
    return c.rows.map(r => ({ tech: r.act === '1' ? 'LTE' as const : 'NR' as const, pci: r.pci, arfcn: r.arfcn }));
  }
  async getCellLock(): Promise<CellLockState | null> { return (await this.getCellLocks())[0] ?? null; }

  async lockCell(t: CellLockTarget): Promise<void> {
    const pci = String(t.pci ?? '').trim();
    const arfcn = String(t.arfcn ?? '').trim();
    if (!pci) throw noChange('ما عندنا رقم البرج (PCI) — ما نقدر نثبّت عليه');
    if (!arfcn) throw noChange('الراوتر ما أعطانا رقم قناة هذا البرج — ثبّت التردد بدلاً منه');
    const c = await this.readCells();
    const act = t.tech === 'NR' ? '2' : '1';
    if (!c.rows.some(r => r.act === act && r.arfcn === arfcn && r.pci === pci)) {
      await this.post('add_set_xmlnode', {
        url: c.n.x_LockCellList_obj + c.n.x_LockCellList_LockCell,
        setNode: {
          url: { act: c.n.x_LockCellList_act, arfcn: c.n.x_LockCellList_arfcn, pci: c.n.x_LockCellList_pci },
          value: { act, arfcn, pci },
        },
      }, { v2: true });
    }
    if (c.enable !== '1') await this.setCellEnable(c.n, true);
    await sleep(3000);
    const a = await this.readCells();
    if (a.enable !== '1' || !a.rows.some(r => r.act === act && r.arfcn === arfcn && r.pci === pci)) {
      throw new Error('الراوتر قبل أمر تثبيت البرج بس القراءة بعده مختلفة');
    }
  }
  async unlockCell(): Promise<void> {
    const c = await this.readCells();
    if (c.enable === '1') await this.setCellEnable(c.n, false);
  }

  // ═══ لقطة قبل التجربة + إرجاع متحقق منه ═══
  async readLockState(): Promise<LockSnapshot> {
    const b = await this.readBand();
    let cellEnable = '', cells: CellRow[] = [];
    try { const c = await this.readCells(); cellEnable = c.enable; cells = c.rows; } catch {}
    const data: FhLockData = { band4: b.band4, band5: b.band5, enable: b.enable, mode: b.mode, endc: b.endc, cellEnable, cells };
    const on = b.enable === '1';
    const summary = `4G: ${on ? parseBands(b.band4).map(x => 'B' + x).join('+') || '—' : 'تلقائي'} · 5G: ${on ? parseBands(b.band5).map(x => 'n' + x).join('+') || '—' : 'تلقائي'} · الشبكة: ${MODES.find(m => m.value === FH_TO_CODE[b.mode])?.label ?? (b.mode || '—')}${cellEnable === '1' ? ` · برج ${cells.map(c => c.pci).join('+')}` : ''}`;
    return { driver: this.id, at: Date.now(), summary, data };
  }

  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    const d = snap.data as FhLockData;
    const b = await this.readBand();
    const o = b.n.x_NetworkSettings_obj;
    const url: Record<string, string> = {}, value: Record<string, string> = {};
    if (b.enable !== d.enable || joinBands(parseBands(b.band4)) !== joinBands(parseBands(d.band4)) || joinBands(parseBands(b.band5)) !== joinBands(parseBands(d.band5))) {
      Object.assign(url, { band4: o + b.n.x_NetworkSet_LTELockBAND, band5: o + b.n.x_NetworkSet_NRLockBAND, enable: o + b.n.x_NetworkSet_LockBandEnable });
      Object.assign(value, { band4: d.band4, band5: d.band5, enable: d.enable });
    }
    if (d.mode && b.mode !== d.mode) Object.assign(url, { NetworkMode: o + b.n.x_NetworkSet_NetworkMode, ENDC: o + b.n.x_NetworkSet_ENDC }) && Object.assign(value, { NetworkMode: d.mode, ENDC: d.endc || b.endc });
    if (Object.keys(url).length) await this.setValues(url, value, true);
    // البرج: نشيل الأبراج اللي انضافت بعد اللقطة، ونرجّع حالة التفعيل
    if (d.cellEnable !== '') {
      try {
        const c = await this.readCells();
        const extra = c.rows.filter(r => !d.cells.some(x => x.act === r.act && x.arfcn === r.arfcn && x.pci === r.pci));
        for (const r of extra.sort((x, y) => Number(y.idx) - Number(x.idx))) {
          await this.post('del_xmlnode', { url: c.n.x_LockCellList_obj + c.n.x_LockCellList_LockCell, index: r.idx }, { v2: true });
        }
        if (c.enable !== d.cellEnable) await this.setCellEnable(c.n, d.cellEnable === '1');
      } catch {}
    }
    await sleep(3000);
    const a = await this.readBand();
    const miss: string[] = [];
    if (a.enable !== d.enable || (d.enable === '1' && (joinBands(parseBands(a.band4)) !== joinBands(parseBands(d.band4)) || joinBands(parseBands(a.band5)) !== joinBands(parseBands(d.band5))))) miss.push('الترددات');
    if (d.mode && a.mode !== d.mode) miss.push('وضع الشبكة');
    if (d.cellEnable !== '') {
      try {
        const c = await this.readCells();
        if (c.enable !== d.cellEnable) miss.push('تثبيت البرج');
      } catch { miss.push('تثبيت البرج'); }
    }
    if (miss.length) throw restoreMismatch(miss);
  }

  /** إنقاذ: فك قفل الترددات والبرج + تلقائي */
  async restoreAll(): Promise<void> {
    const b = await this.readBand();
    const o = b.n.x_NetworkSettings_obj;
    await this.setValues(
      { enable: o + b.n.x_NetworkSet_LockBandEnable, NetworkMode: o + b.n.x_NetworkSet_NetworkMode, ENDC: o + b.n.x_NetworkSet_ENDC },
      { enable: '0', NetworkMode: '3', ENDC: b.endc },
      true,
    );
    try { await this.unlockCell(); } catch {}
  }

  // ═══ مركز التحكم (./extras — من صفحات الراوتر نفسها) ═══
  private async setSingle(url: string, value: string, v2 = false) {
    const r = await this.post('set_single_by_xmlnode', { url, value }, { v2 });
    if (r && typeof r === 'object' && (r.success === 'false' || r.success === false)) throw new Error('set_single_by_xmlnode: الراوتر رفض');
  }
  /** قراءة كم خانة — لو الطلب المجمّع فشل نقرأها وحدة وحدة (خانة مو موجودة في موديل ما تطيّح الباقي) */
  private async readMany(q: Record<string, string>): Promise<Record<string, unknown>> {
    if (!Object.keys(q).length) return {};
    try {
      const r = await this.post('get_value_by_xmlnode', q);
      if (r && typeof r === 'object') return r;
    } catch {}
    const out: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(q)) {
      try { const r = await this.post('get_value_by_xmlnode', { [k]: p }); if (r && typeof r === 'object' && k in r) out[k] = r[k]; } catch {}
    }
    return out;
  }
  private async wlan(n: Record<string, string>): Promise<WlanRow[]> {
    const r = await this.post('get_xml_childnode_value', {
      url: n.x_WLANConfiguration_obj,
      node: { RadioEnabled: n.x_wifi_RadioEnabled, SSID: n.x_wifi_SSID, BeaconType: n.x_wifi_BeaconType, Enable: n.x_wifi_Enable },
    });
    return wlanRows(r);
  }
  /** الفيرموير الجديد بخانات الواي فاي الجديدة؟ */
  private wifiV2(n: Record<string, string>) { return this.api === 'v2' && !missing(n, V2_WIFI).length; }
  /** wifiBasic.js: الشبكات من SSID و AccessPoint (بالترقيم نفسه)، والتشغيل من Radio.1 (٢.٤) / Radio.2 (٥) */
  private async wlanV2(n: Record<string, string>, main5: string, ssidNum: number): Promise<WlanRow[]> {
    const rad = await this.readMany({ r1: n.x_wifi_Radio_obj + '1.' + n.x_wifi_Enable, r2: n.x_wifi_Radio_obj + '2.' + n.x_wifi_Enable });
    const index = `1-${ssidNum}`;
    const ss = listOf(await this.post('get_xml_childnode_value', { url: n.x_wifi_SSID_obj, index, node: { Enable: n.x_wifi_Enable, SSID: n.x_wifi_SSID } }));
    // ModeEnabled بس (محمية ولا لا) — ما نقرأ الكلمة نفسها
    const ap = listOf(await this.post('get_xml_childnode_value', { url: n.x_wifi_AccessPoint_obj, index, node: { ModeEnabled: n.x_wifi_ModeEnabled } }));
    return ss.map(e => {
      const idx = String(e?.child_node_idx ?? '');
      const a = ap.find(x => String(x?.child_node_idx ?? '') === idx);
      return { idx, radio: String((Number(idx) >= Number(main5) ? rad.r2 : rad.r1) ?? ''), ssid: String(e?.SSID ?? ''), beacon: String(a?.ModeEnabled ?? ''), enable: String(e?.Enable ?? '') };
    }).filter(r => r.idx !== '');
  }
  private async wifiCtx() {
    const v2n = this.api === 'v2' ? await this.loadNodes() : null;
    const v2 = !!v2n && this.wifiV2(v2n);
    const n = v2 ? v2n! : await this.need(EX_NEED.wifi, 'إعدادات الواي فاي');
    const info = await this.deviceInfo().catch(() => ({} as Record<string, any>));
    const extra: Record<string, string> = {};
    if (n.x_MainSSIDIndex_58G_obj) extra.main5 = n.x_MainSSIDIndex_58G_obj;
    // دمج الشبكتين: القديم BandSteering.Enable · الجديد WifiBandSteering + x_wifi_Enable (wifiBasic.js: BandSEnable)
    if (n.x_wifi_WifiBandSteering_obj && (v2 ? n.x_wifi_Enable : n.x_BandSteering_Enable)) extra.steer = n.x_wifi_WifiBandSteering_obj + (v2 ? n.x_wifi_Enable : n.x_BandSteering_Enable);
    const v = await this.readMany(extra);
    const main5 = main5Index(v.main5);
    const ssidNum = Number(info.ssid_num) > 0 ? Number(info.ssid_num) : Number(main5) * 2 - 2;
    return { n, v2, model: String(info.model_name ?? ''), wifi5: info.wifi5, main5, steer: String(v.steer ?? ''), rows: v2 ? await this.wlanV2(n, main5, ssidNum) : await this.wlan(n) };
  }

  async getExtras(): Promise<RouterExtras> {
    const n = await this.loadNodes();
    const info = await this.deviceInfo().catch(() => ({} as Record<string, any>));
    const q = paths(n, EX_FIELDS);
    if (n.x_MainSSIDIndex_58G_obj) q.main5 = n.x_MainSSIDIndex_58G_obj;
    const v = await this.readMany(q);
    let rows: WlanRow[] | null = null;
    if (this.wifiV2(n)) { try { rows = (await this.wifiCtx()).rows; } catch {} }
    else if (!missing(n, EX_NEED.wifi).length) { try { rows = await this.wlan(n); } catch {} }
    let uptime: unknown;
    try { uptime = (await this.post('get_cmd_result_web', { key: 'UPTIME' }))?.result; } catch {}
    const ex = extrasFrom(v, rows, { model: String(info.model_name ?? ''), wifi5: info.wifi5, main5: v.main5, uptime });
    if (this.api === 'v2' && !missing(n, V2_DMZ).length) {
      try { const z = await this.dmzV2(n); if (z) ex.dmz = { on: z.entry?.on === '1', ip: z.entry?.ip ?? '' }; } catch {}
    }
    // المنافذ المفتوحة: الصفحة تكتب Request أول (تحديث الجدول) ثم تقرأ
    if (ex.upnp && !missing(n, EX_NEED.upnpRules).length) {
      try {
        await this.setValues({ Request: n.x_DeviceInfo_obj + n.x_UPNP_Request }, { Request: 'Request' }, true);
        const r = await this.post('get_xml_childnode_value', {
          url: n.x_DeviceInfo_obj + n.x_UPNPRULE_Obj,
          node: { IPAddress: n.x_UPNPRULE_IPAddress, Protocol: n.x_UPNPRULE_Protocol, ExternalPort: n.x_UPNPRULE_ExternalPort, Description: n.x_UPNPRULE_Description },
        });
        const arr: any[] = Array.isArray(r?.data) ? r.data : [];
        ex.upnpMaps = arr.filter(e => e?.IPAddress).map(e => ({ app: String(e.Description ?? ''), ip: String(e.IPAddress), port: String(e.ExternalPort ?? ''), proto: String(e.Protocol ?? '') }));
      } catch {}
    }
    return ex;
  }

  async setNat(t: 'cone' | 'symmetric'): Promise<void> {
    const n = await this.need(EX_NEED.nat, 'نوع الـ NAT');
    await this.setValues({ NATType: n.x_Firewall_obj + n.x_Firewall_NATType }, { NATType: t === 'cone' ? '2' : '1' }, true);
  }
  async setUpnp(on: boolean): Promise<void> {
    const n = await this.need(EX_NEED.upnp, 'UPnP');
    await this.setValues({ upnp: n.x_DeviceInfo_obj + n.x_UPNP_Enable }, { upnp: on ? '1' : '0' }, true);
  }
  /**
   * dmzSet.js (الفيرموير الجديد): نقرأ اتصالات WAN بنفس الطلب المتداخل، والـ DMZ قائمة تحت اتصال الإنترنت الموجّه
   * (اسمه فيه INTERNET و _R_). نفضّل اتصال 5G (WANDevice 1) مثل ترتيب الصفحة.
   */
  private async dmzV2(n: Record<string, string>): Promise<{ path: string; entry?: { idx: string; on: string; ip: string } } | null> {
    const dmzNode = { url: n.x_DMZ_obj, node: { Enable: n.x_DMZ_Enable, DMZHostIP: n.x_DMZ_DMZHostIP } };
    const r = await this.post('get_xml_childnode_value', {
      url: n.x_WANDevice_obj, num: 2,
      node: {
        wanenable: n.x_wan_WANEnable, waninterface: n.x_wan_WanInterface,
        wanconnection: {
          url: n.x_WANConnectionDevice,
          node: {
            ipoe: { url: n.x_WANIPConnection, node: { Enable: n.x_wan_Enable, Name: n.x_wan_Name, dmz: dmzNode } },
            pppoe: { url: n.x_WANPPPConnection, node: { Enable: n.x_wan_Enable, Name: n.x_wan_Name, dmz: dmzNode } },
          },
        },
      },
    });
    const found: { dev: string; path: string; dmz: any[] }[] = [];
    for (const dev of listOf(r)) {
      for (const wc of Array.isArray(dev?.wanconnection) ? dev.wanconnection : []) {
        for (const [kind, obj] of [['ipoe', n.x_WANIPConnection], ['pppoe', n.x_WANPPPConnection]] as const) {
          for (const c of Array.isArray(wc?.[kind]) ? wc[kind] : []) {
            const name = String(c?.Name ?? '');
            if (!(name.includes('INTERNET') && name.includes('_R_'))) continue;
            found.push({ dev: String(dev.child_node_idx), path: n.x_WANDevice_obj + dev.child_node_idx + '.' + n.x_WANConnectionDevice + wc.child_node_idx + '.' + obj + c.child_node_idx + '.DMZ', dmz: Array.isArray(c?.dmz) ? c.dmz : [] });
          }
        }
      }
    }
    const w = found.find(f => f.dev === '1') ?? found[0];
    if (!w) return null;
    const e = w.dmz[0];
    return { path: w.path, entry: e ? { idx: String(e.child_node_idx), on: String(e.Enable ?? ''), ip: String(e.DMZHostIP ?? '') } : undefined };
  }
  async setDmz(on: boolean, ip: string): Promise<void> {
    const a = String(ip ?? '').trim();
    if (on && !isIPv4(a)) throw noChange('عنوان الجهاز غير صحيح — ما غيّرنا شي.');
    if (this.api === 'v2') {
      const n = await this.need(V2_DMZ, 'DMZ');
      const z = await this.dmzV2(n);
      if (!z) throw noChange('ما لقينا اتصال الإنترنت في إعدادات راوترك عشان نحط عليه DMZ — ما غيّرنا شي.');
      if (!on && (!z.entry || z.entry.on !== '1')) return;
      let idx = z.entry?.idx;
      if (!idx) {
        // نفس الصفحة: add_xmlnode يرجّع رقم العنصر الجديد ← نكتب فيه Enable و DMZHostIP
        const add = await this.post('add_xmlnode', { dmz: z.path }, { v2: true });
        idx = String(add?.dmz ?? '');
        if (!idx) throw new Error('add_xmlnode: الراوتر ما رجّع رقم عنصر DMZ الجديد');
      }
      const base = z.path + '.' + idx + '.';
      await this.setValues({ Enable: base + n.x_DMZ_Enable, DMZHostIP: base + n.x_DMZ_DMZHostIP }, { Enable: on ? '1' : '0', DMZHostIP: on ? a : (z.entry?.ip ?? '') }, true);
      await sleep(1500);
      const b = await this.dmzV2(n);
      if ((b?.entry?.on === '1') !== on || (on && b?.entry?.ip !== a)) throw new Error('الراوتر قبل أمر DMZ بس القراءة بعده مختلفة');
      return;
    }
    const n = await this.need(EX_NEED.dmz, 'DMZ');
    await this.setValues(
      { DMZEnable: n.x_Firewall_obj + n.x_Firewall_DMZEnable, DMZIP: n.x_Firewall_obj + n.x_Firewall_DMZIP },
      { DMZEnable: on ? '1' : '0', DMZIP: a },
    );
  }
  async setLed(on: boolean): Promise<void> {
    const n = await this.need(EX_NEED.led, 'أنوار الراوتر');
    await this.setSingle(n.x_DeviceInfo_obj + n.x_DeviceInfo_LedSwitch, on ? '1' : '0', true);
  }
  async setAutoReboot(on: boolean): Promise<void> {
    const n = await this.need(EX_NEED.reboot, 'إعادة التشغيل التلقائية');
    const o = n.x_TimedReboot_obj;
    if (!on) { await this.setValues({ Enable: o + n.x_TimedReboot_enable }, { Enable: '0' }, true); return; }
    const cur = await this.readMany({ days: o + n.x_TimedReboot_repeatdays, time: o + n.x_TimedReboot_time });
    const days = String(cur.days ?? '').split(',').map(x => x.trim()).filter(x => WEEK.includes(x));
    const time = String(cur.time ?? '').trim();
    // الافتراضي في الصفحة كل يوم 00:00 — وقت سهر عندنا، فنخليه ٤ الفجر لو ما اختار المستخدم وقت
    await this.setValues(
      { Enable: o + n.x_TimedReboot_enable, repeatDays: o + n.x_TimedReboot_repeatdays, time: o + n.x_TimedReboot_time },
      { Enable: '1', repeatDays: (days.length ? days : WEEK).join(','), time: /^\d{1,2}:\d{2}$/.test(time) && time !== '00:00' ? time : '04:00' },
      true,
    );
  }
  async setBandOn(band: '2.4' | '5', on: boolean): Promise<void> {
    const c = await this.wifiCtx();
    if (band === '5' && !has5g(c.model, c.wifi5)) throw noChange('راوترك ما فيه واي فاي ٥ جيجا.');
    if (c.steer === '1') throw noChange('«دمج الشبكتين» شغّال في راوترك — صفحة الراوتر نفسها ما تسمح تطفي شبكة وهو شغّال. ما غيّرنا شي.');
    const idx = band === '2.4' ? '1' : c.main5;
    if (!c.rows.some(r => r.idx === idx)) throw noChange(`ما لقينا شبكة ${band === '5' ? '٥' : '٢.٤'} جيجا في إعدادات راوترك — ما غيّرنا شي.`);
    if (c.v2) {
      // wifiBasic(_5g).js onApplyEnable: Radio.1 = ٢.٤ · Radio.2 = ٥
      await this.setSingle(c.n.x_wifi_Radio_obj + (band === '2.4' ? '1.' : '2.') + c.n.x_wifi_Enable, on ? '1' : '0', true);
      return;
    }
    await this.setSingle(c.n.x_WLANConfiguration_obj + idx + '.' + c.n.x_wifi_RadioEnabled, on ? '1' : '0');
  }
  async setWifiNames(names: { index: string; name: string }[], password?: string): Promise<void> {
    const c = await this.wifiCtx();
    if (c.v2) return this.setWifiNamesV2(c, names, password);
    const w = c.n.x_WLANConfiguration_obj;
    const url: Record<string, string> = {}, value: Record<string, string> = {};
    for (const x of names) {
      const r = c.rows.find(y => y.idx === String(x.index));
      if (!r) throw noChange('ما لقينا هالشبكة في راوترك — ما غيّرنا شي.');
      const nm = x.name.trim();
      if (nm === r.ssid) continue;
      const err = ssidError(nm);
      if (err) throw noChange(err + ' ما غيّرنا شي.');
      url['SSID' + r.idx] = w + r.idx + '.' + c.n.x_wifi_SSID;
      value['SSID' + r.idx] = nm;
    }
    if (password) {
      const err = wifiPassError(password);
      if (err) throw noChange(err + ' ما غيّرنا شي.');
      if (!c.n.x_wifi_PreSharedKey) throw noChange('ما لقينا خانة كلمة مرور الواي فاي في إعدادات راوترك — ما غيّرنا شي.');
      const sec = names.map(x => c.rows.find(y => y.idx === String(x.index))).filter((r): r is WlanRow => !!r && !!r.beacon && r.beacon !== 'None');
      if (!sec.length) throw noChange('شبكتك مفتوحة بدون حماية — فعّل الحماية من صفحة الراوتر أول، وبعدها غيّر كلمة المرور من هنا. ما غيّرنا شي.');
      for (const r of sec) { url['PSK' + r.idx] = w + r.idx + '.' + c.n.x_wifi_PreSharedKey; value['PSK' + r.idx] = password; }
    }
    if (!Object.keys(url).length) return;
    await this.setValues(url, value);
  }

  // ═══════════ الفيرموير الجديد: ميزات من صفحاته (ملف AUTH ٣١ أكتوبر) ═══════════
  private async v2Nodes(keys: string[], what: string): Promise<Record<string, string>> {
    if (this.api !== 'v2') throw noChange(`${what} لسا ما تشتغل على راوترك — ما غيّرنا شي.`);
    return this.need(keys, what);
  }
  /** وضع الطيران أو قفل الشركة شغّال ← الصفحة تقفل الإعدادات (configManage/pccLock/smsInbox) */
  private async airplaneOn(n: Record<string, string>): Promise<boolean> {
    if (!n.x_NetworkSet_AirplaneEnable) return false;
    const v = await this.readMany({ a: n.x_NetworkSettings_obj + n.x_NetworkSet_AirplaneEnable });
    return String(v.a ?? '') === '1';
  }

  /** carrierAggregation.js: PCC + PCC2 (get_value_by_xmlnode) و SCC×4 (get_xml_childnode_value num:4) */
  async getCarriers(): Promise<Carrier[]> {
    const n = await this.v2Nodes(['x_PCCInfo_obj', 'x_PCCInfo_Type', 'x_PCCInfo_Band', 'x_SCCInfo_obj', 'x_SCCInfo_Type', 'x_SCCInfo_State', 'x_SCCInfo_Band'], 'الدمج');
    const cell = (o: string): Record<string, string> => {
      const q: Record<string, string> = { Type: o + n.x_PCCInfo_Type, Band: o + n.x_PCCInfo_Band, RSRP: o + 'RSRP', RSRQ: o + 'RSRQ', SINR: o + 'SINR' };
      if (n.x_PCCInfo_Pci) q.Pci = o + n.x_PCCInfo_Pci;
      if (n.x_PCCInfo_Arfcn) q.Arfcn = o + n.x_PCCInfo_Arfcn;
      if (n.x_PCCInfo_DlBandWidth) q.DlBandWidth = o + n.x_PCCInfo_DlBandWidth;
      return q;
    };
    const pcc = await this.readMany(cell(n.x_PCCInfo_obj)) as FhCellRaw;
    const pcc2 = n.x_PCCInfo2_obj ? await this.readMany(cell(n.x_PCCInfo2_obj)) as FhCellRaw : null;
    const node: Record<string, string> = { Type: n.x_SCCInfo_Type, State: n.x_SCCInfo_State, Band: n.x_SCCInfo_Band, RSRP: 'RSRP', RSRQ: 'RSRQ', SINR: 'SINR' };
    if (n.x_SCCInfo_Pci) node.Pci = n.x_SCCInfo_Pci;
    if (n.x_SCCInfo_Arfcn) node.Arfcn = n.x_SCCInfo_Arfcn;
    if (n.x_SCCInfo_DlBandWidth) node.DlBandWidth = n.x_SCCInfo_DlBandWidth;
    let scc: FhCellRaw[] = [];
    try { scc = listOf(await this.post('get_xml_childnode_value', { url: n.x_SCCInfo_obj, num: 4, node })) as FhCellRaw[]; } catch {}
    return carriersFromCA(pcc, pcc2, scc);
  }

  // ─── الأجهزة (device.js) ───
  private async hosts(): Promise<{ n: Record<string, string>; rows: (FhHost & { child_node_idx: string })[] }> {
    const n = await this.v2Nodes(['x_Hosts_Host_obj', 'x_Host_MacAddress', 'x_Host_IPAddress', 'x_Host_Active', 'x_Host_InternetAccess'], 'الأجهزة المتصلة');
    const node: Record<string, string> = { MACAddress: n.x_Host_MacAddress, IPAddress: n.x_Host_IPAddress, Active: n.x_Host_Active, InternetAccess: n.x_Host_InternetAccess };
    if (n.x_Host_HostName) node.HostName = n.x_Host_HostName;
    if (n.x_Host_DevName) node.DevName = n.x_Host_DevName;
    const rows = listOf(await this.post('get_xml_childnode_value', { url: n.x_Hosts_Host_obj, node })).map((r: any) => ({ ...r, child_node_idx: String(r?.child_node_idx ?? '') }));
    return { n, rows };
  }
  async getDevices(): Promise<ConnectedDevice[]> { return devicesFrom((await this.hosts()).rows); }
  async getBlockedDevices(): Promise<ConnectedDevice[]> { return blockedFrom((await this.hosts()).rows); }
  /** device.js FBlacklist: Hosts.Host.<n>.InternetAccess = "1" مسموح / "2" محظور */
  async blockDevice(mac: string, block: boolean): Promise<void> {
    const { n, rows } = await this.hosts();
    const m = String(mac ?? '').toUpperCase();
    const h = rows.find(r => String(r.MACAddress ?? '').toUpperCase() === m);
    if (!h || !h.child_node_idx) throw noChange('ما لقينا هالجهاز في قائمة الراوتر — ما غيّرنا شي.');
    await this.setSingle(n.x_Hosts_Host_obj + h.child_node_idx + '.' + n.x_Host_InternetAccess, block ? '2' : '1', true);
    await sleep(1500);
    const a = (await this.hosts()).rows.find(r => r.child_node_idx === h.child_node_idx);
    if (a && (Number(a.InternetAccess) >= 2) !== block) throw new Error('الراوتر قبل أمر الحظر بس القراءة بعده مختلفة');
  }

  /** trafficStat.js: استهلاك الشهر (Rx = تحميل · Tx = رفع) */
  async getUsage(): Promise<Usage> {
    const n = await this.v2Nodes(['x_TrafficStats_obj', 'x_MonthRxBytes', 'x_MonthTxBytes'], 'الاستهلاك');
    const v = await this.readMany({ rx: n.x_TrafficStats_obj + n.x_MonthRxBytes, tx: n.x_TrafficStats_obj + n.x_MonthTxBytes });
    const b = (x: unknown) => { const k = Number(String(x ?? '').trim()); return Number.isFinite(k) && k >= 0 ? k : 0; };
    return { downloadBytes: b(v.rx), uploadBytes: b(v.tx) };
  }

  // ─── الرسائل (smsInbox.js) ───
  async listSms(box: 'inbox' | 'sent' = 'inbox'): Promise<SmsMessage[]> {
    if (this.api !== 'v2') return [];
    return smsFrom(await this.post('get_sms_data', null), box);
  }
  async markSmsRead(index: string): Promise<void> {
    const ref = smsRef(index);
    if (!ref || ref.box !== 'recv') return;
    const n = await this.v2Nodes(['x_SMS_recv_msg_obj', 'x_SMS_recv_isOpened_obj'], 'الرسائل');
    await this.setValues({ smsIsopend: n.x_SMS_recv_msg_obj + ref.idx + '.' + n.x_SMS_recv_isOpened_obj }, { smsIsopend: '1' }, true);
  }
  async deleteSms(index: string): Promise<void> {
    const ref = smsRef(index);
    if (!ref) throw noChange('رسالة غير معروفة — ما حذفنا شي.');
    const n = await this.v2Nodes(['x_SMS_recv_msg_obj', 'x_SMS_send_msg_obj'], 'الرسائل');
    await this.post('del_xmlnode', { url: ref.box === 'recv' ? n.x_SMS_recv_msg_obj : n.x_SMS_send_msg_obj, index: ref.idx }, { v2: true });
  }
  async sendSms(phone: string, text: string): Promise<void> {
    if (this.api !== 'v2') throw noChange('الرسائل لسا ما تشتغل على راوترك — ما أرسلنا شي.');
    const to = String(phone ?? '').replace(/[\s-]/g, '');
    if (!/^\+?\d{3,20}$/.test(to)) throw noChange('رقم الجوال غير صحيح — ما أرسلنا شي.');
    const content = String(text ?? '');
    if (!content.trim()) throw noChange('الرسالة فاضية — ما أرسلنا شي.');
    const n = await this.loadNodes();
    if (await this.airplaneOn(n).catch(() => false)) throw noChange('وضع الطيران شغّال في راوترك — الرسائل ما تنرسل. ما أرسلنا شي.');
    const r = await this.post('send_msg', { recv_number: to, encode_schema: smsSchema(content), content }, { v2: true });
    // الصفحة: result 0 أو "" = نجاح
    const res = r && typeof r === 'object' ? String((r as any).result ?? '') : '';
    if (res !== '' && res !== '0') throw new Error(`الراوتر ما أرسل الرسالة (${res})`);
  }

  // ─── APN (configManage.js) ───
  private async apnRows(n: Record<string, string>) {
    return apnsFrom(listOf(await this.post('get_xml_childnode_value', {
      url: n.x_Configuration_Management_obj,
      node: { ProfileName: n.x_Management_ProfileName, Enable: n.x_Management_Enable, AuthenticationType: n.x_Management_AuthenticationType, APN: n.x_Management_APN, UserName: n.x_Management_UserName },
    })));
  }
  private apnNeed = ['x_Configuration_Management_obj', 'x_Management_ProfileName', 'x_Management_Enable', 'x_Management_AuthenticationType', 'x_Management_APN', 'x_Management_UserName', 'x_Management_Password'];
  async getApnProfiles(): Promise<ApnProfile[]> { return this.apnRows(await this.v2Nodes(this.apnNeed, 'APN')); }
  async setApn(p: { index: string; name: string; apn: string; username?: string; password?: string; authMode?: string }): Promise<void> {
    const n = await this.v2Nodes(this.apnNeed, 'APN');
    if (await this.airplaneOn(n)) throw noChange('وضع الطيران شغّال — صفحة الراوتر نفسها تقفل APN وهو شغّال. ما غيّرنا شي.');
    const rows = await this.apnRows(n);
    const cur = rows.find(r => r.index === String(p.index));
    if (!cur) throw noChange('ما لقينا ملف الاتصال هذا في راوترك — ما غيّرنا شي.');
    // الملف الافتراضي (١): الصفحة تعرضه بدون تعديل ← نسوي ملف جديد بنفس الطريقة (add_xmlnode) ونفعّله
    let idx = cur.index;
    if (cur.readOnly) {
      const add = await this.post('add_xmlnode', { Management: n.x_Configuration_Management_obj }, { v2: true });
      idx = String(add?.Management ?? '');
      if (!idx) throw new Error('add_xmlnode: الراوتر ما رجّع رقم ملف الاتصال الجديد');
    }
    const auth = /^[0-3]$/.test(String(p.authMode ?? '')) ? String(p.authMode) : '0';
    const head = n.x_Configuration_Management_obj + idx + '.';
    const url: Record<string, string> = { Enable: head + n.x_Management_Enable, ProfileName: head + n.x_Management_ProfileName, AuthenticationType: head + n.x_Management_AuthenticationType, APN: head + n.x_Management_APN };
    const value: Record<string, string> = { Enable: cur.current || cur.readOnly ? '1' : '0', ProfileName: (p.name || p.apn).trim().slice(0, 32), AuthenticationType: auth, APN: p.apn.trim() };
    if (auth === '1' || auth === '3') { url.UserName = head + n.x_Management_UserName; value.UserName = String(p.username ?? ''); }
    if (auth !== '0' && p.password) { url.Password = head + n.x_Management_Password; value.Password = p.password; }
    await this.setValues(url, value, true);
  }
  /** configManage.js: الملف النشط = Enable "1" */
  async selectApn(index: string): Promise<void> {
    const n = await this.v2Nodes(this.apnNeed, 'APN');
    if (await this.airplaneOn(n)) throw noChange('وضع الطيران شغّال — صفحة الراوتر نفسها تقفل APN وهو شغّال. ما غيّرنا شي.');
    const rows = await this.apnRows(n);
    if (!rows.some(r => r.index === String(index))) throw noChange('ما لقينا ملف الاتصال هذا — ما غيّرنا شي.');
    await this.setValues({ Enable: n.x_Configuration_Management_obj + index + '.' + n.x_Management_Enable }, { Enable: '1' }, true);
  }

  // ─── DNS (ipv4Settings.js) ───
  private dnsNeed = ['x_LANHostConfigManagement_obj', 'x_LANHost_DNSManualEnable', 'x_LANHost_DNSServers'];
  async getDns(): Promise<DnsConfig> {
    const n = await this.v2Nodes(this.dnsNeed, 'DNS');
    const v = await this.readMany({ t: n.x_LANHostConfigManagement_obj + n.x_LANHost_DNSManualEnable, s: n.x_LANHostConfigManagement_obj + n.x_LANHost_DNSServers });
    return dnsFrom(v.t, v.s);
  }
  async setDns(cfg: DnsConfig): Promise<void> {
    const n = await this.v2Nodes([...this.dnsNeed, 'x_LANHost_IPInterface_1', 'x_LANHost_IPInterfaceIPAddress'], 'DNS');
    const op = String((await this.deviceInfo().catch(() => ({} as Record<string, any>))).operator_name ?? '');
    if (!DNS_OPERATORS.test(op)) throw noChange('صفحة راوترك ما تسمح بتغيير DNS في نسخة شركتك — ما غيّرنا شي.');
    const L = n.x_LANHostConfigManagement_obj;
    if (cfg.manual) {
      const a = String(cfg.primary ?? '').trim(), b = String(cfg.secondary ?? '').trim();
      if (!isIPv4(a) || (b && !isIPv4(b))) throw noChange('عنوان DNS غير صحيح — ما غيّرنا شي.');
      await this.setValues({ DNSConfigType: L + n.x_LANHost_DNSManualEnable, DNSServers: L + n.x_LANHost_DNSServers }, { DNSConfigType: '1', DNSServers: b ? `${a},${b}` : a }, true);
    } else {
      // التلقائي في الصفحة = عنوان الراوتر نفسه
      const ip = String((await this.readMany({ ip: L + n.x_LANHost_IPInterface_1 + n.x_LANHost_IPInterfaceIPAddress })).ip ?? '').trim();
      if (!isIPv4(ip)) throw new Error('ما قدرنا نقرأ عنوان الراوتر عشان نرجّع DNS للتلقائي');
      await this.setValues({ DNSConfigType: L + n.x_LANHost_DNSManualEnable, DNSServers: L + n.x_LANHost_DNSServers }, { DNSConfigType: '0', DNSServers: ip }, true);
    }
    await sleep(1500);
    const now = await this.getDns();
    if (now.manual !== !!cfg.manual || (cfg.manual && now.primary !== String(cfg.primary).trim())) throw new Error('الراوتر قبل تغيير DNS بس القراءة بعده مختلفة');
  }

  // ─── الأنتنا (antennaSet.js) — النوع (n41 / n78) في LG6851F بس ───
  private async antennaCtx() {
    const n = await this.v2Nodes(['x_NetworkSettings_obj', 'x_NetworkSet_AntennaOutterSwitch'], 'الأنتنا');
    const model = String((await this.deviceInfo().catch(() => ({} as Record<string, any>))).model_name ?? '');
    return { n, withType: /LG6851F/i.test(model) && !!n.x_NetworkSet_AntennaOutterType };
  }
  async getAntenna(): Promise<AntennaInfo | null> {
    const { n, withType } = await this.antennaCtx();
    const q: Record<string, string> = { sw: n.x_NetworkSettings_obj + n.x_NetworkSet_AntennaOutterSwitch };
    if (withType) q.type = n.x_NetworkSettings_obj + n.x_NetworkSet_AntennaOutterType;
    const v = await this.readMany(q);
    if (v.sw === undefined) return null;
    return antennaFrom(v.sw, v.type, withType);
  }
  async setAntenna(mode: number): Promise<void> {
    const { n, withType } = await this.antennaCtx();
    const want = antennaValues(mode, withType);
    if (!want) throw noChange('وضع أنتنا غير معروف لراوترك — ما غيّرنا شي.');
    const o = n.x_NetworkSettings_obj;
    const url: Record<string, string> = { AntennaOutterSwitch: o + n.x_NetworkSet_AntennaOutterSwitch };
    const value: Record<string, string> = { AntennaOutterSwitch: want.sw };
    if (want.type !== undefined) { url.AntennaOutterType = o + n.x_NetworkSet_AntennaOutterType; value.AntennaOutterType = want.type; }
    await this.setValues(url, value, true);
  }

  // ─── آي بي جديد (networkSet.js) ───
  /** اتصال البيانات: WANDevice.<أول مفعّل>.WANConnectionDevice.1.WANIPConnection.1.Enable — نفس onApplyDataNetwork */
  private async dataWanPath(): Promise<string> {
    const n = await this.v2Nodes(['x_WANDevice_obj', 'x_wan_WANEnable', 'x_WANConnectionDevice', 'x_WANIPConnection', 'x_wan_Enable'], 'آي بي جديد');
    const r = await this.post('get_xml_childnode_value', { url: n.x_WANDevice_obj, num: 2, node: { wanenable: n.x_wan_WANEnable } });
    const dev = listOf(r).find((d: any) => String(d?.wanenable ?? '') === '1');
    if (!dev) throw noChange('ما لقينا اتصال البيانات في إعدادات راوترك — ما غيّرنا شي.');
    return n.x_WANDevice_obj + dev.child_node_idx + '.' + n.x_WANConnectionDevice + '1.' + n.x_WANIPConnection + '1.' + n.x_wan_Enable;
  }
  async reconnectData(opts?: { holdSecs?: number }): Promise<void> {
    const path = await this.dataWanPath();
    await this.setSingle(path, '0', true);
    try { await sleep(Math.max(3, Math.min(30, opts?.holdSecs ?? 8)) * 1000); }
    finally { await this.setSingle(path, '1', true); }
  }
  /** وضع الطيران (networkSet.js AirplaneEnable) = فصل كامل عن البرج ورجوع */
  async reattach(holdSecs = 10): Promise<void> {
    const n = await this.v2Nodes(['x_NetworkSettings_obj', 'x_NetworkSet_AirplaneEnable'], 'الفصل عن البرج');
    const p = n.x_NetworkSettings_obj + n.x_NetworkSet_AirplaneEnable;
    await this.setSingle(p, '1', true);
    try { await sleep(Math.max(3, Math.min(30, holdSecs)) * 1000); }
    finally { await this.setSingle(p, '0', true); }
  }
  /** يطفي وضع الطيران لو علق شغّال — آمن ينادى أي وقت */
  async wakeRadio(): Promise<void> {
    if (this.api !== 'v2') return;
    const n = await this.loadNodes();
    if (!n.x_NetworkSet_AirplaneEnable) return;
    if (await this.airplaneOn(n)) await this.setSingle(n.x_NetworkSettings_obj + n.x_NetworkSet_AirplaneEnable, '0', true);
  }

  // ═══ قناة الواي فاي — الفيرموير الجديد بس (wifiAdvanced.js / wifiAdvanced_5g.js) ═══
  //   Radio.1 = ٢.٤ (band "0") · Radio.2 = ٥ (band "1") · القنوات المسموحة من web_get_wifi_possible_channels
  async getWifiRadios(): Promise<WifiRadio[]> {
    const n = await this.loadNodes();
    // الفيرموير القديم: ما عندنا صفحته ← قائمة فاضية (الشاشة والضبط التلقائي يتخطونها بهدوء)
    if (!(this.api === 'v2' && !missing(n, [...V2_WIFI, 'x_wifi_Channel']).length)) return [];
    const info = await this.deviceInfo().catch(() => ({} as Record<string, any>));
    const out: WifiRadio[] = [];
    for (const [band, ri, b] of [['2.4', '1', '0'], ['5', '2', '1']] as const) {
      if (band === '5' && !has5g(String(info.model_name ?? ''), info.wifi5)) continue;
      const q: Record<string, string> = { ch: n.x_wifi_Radio_obj + ri + '.' + n.x_wifi_Channel };
      if (n.x_wifi_OperatingChannelBandwidth) q.bw = n.x_wifi_Radio_obj + ri + '.' + n.x_wifi_OperatingChannelBandwidth;
      if (n.x_wifi_RegulatoryDomain) q.rd = n.x_wifi_Radio_obj + ri + '.' + n.x_wifi_RegulatoryDomain;
      const v = await this.readMany(q);
      if (v.ch === undefined || v.ch === null || v.ch === '') continue;
      let allowed: string[] | undefined;
      try {
        const r = await this.post('web_get_wifi_possible_channels', { band: b, bandwidth: String(v.bw ?? ''), regdomain: String(v.rd ?? '') });
        if (Array.isArray(r?.channels) && r.channels.length) allowed = r.channels.map((x: unknown) => String(x));
      } catch {}
      out.push({ band, channel: String(v.ch), allowed, writable: true });
    }
    return out;
  }
  async setWifiChannel(band: '2.4' | '5', channel: string): Promise<void> {
    const r = (await this.getWifiRadios()).find(x => x.band === band);
    if (!r) throw noChange(`ما لقينا شبكة ${band === '5' ? '٥' : '٢.٤'} جيجا في راوترك — ما غيّرنا شي.`);
    const ch = String(channel ?? '').trim();
    if (!/^\d{1,3}$/.test(ch)) throw noChange('رقم القناة غير صحيح — ما غيّرنا شي.');
    // "0" = تلقائي (الصفحة ترجع له لو القناة الحالية مو بالقائمة)
    if (ch !== '0' && r.allowed && !r.allowed.includes(ch)) throw noChange(`القناة ${ch} مو مسموحة في راوترك — ما غيّرنا شي.`);
    if (r.channel === ch) return;
    const n = await this.loadNodes();
    await this.setValues({ Channel: n.x_wifi_Radio_obj + (band === '2.4' ? '1.' : '2.') + n.x_wifi_Channel }, { Channel: ch }, true);
  }

  /** wifiBasic.js onSubmit: SSID.<n>.SSID و AccessPoint.<n>.PreSharedKey (الكلمة بس للشبكة المحمية — ModeEnabled ≠ None) */
  private async setWifiNamesV2(c: Awaited<ReturnType<FiberhomeDriver['wifiCtx']>>, names: { index: string; name: string }[], password?: string): Promise<void> {
    const url: Record<string, string> = {}, value: Record<string, string> = {};
    const want: Record<string, string> = {};
    for (const x of names) {
      const r = c.rows.find(y => y.idx === String(x.index));
      if (!r) throw noChange('ما لقينا هالشبكة في راوترك — ما غيّرنا شي.');
      // الصفحة تقفل شبكة الـ٥ الرئيسية لما «دمج الشبكتين» شغّال
      if (c.steer === '1' && r.idx === c.main5) throw noChange('«دمج الشبكتين» شغّال — صفحة الراوتر نفسها تقفل تعديل شبكة الـ٥ جيجا وهو شغّال. ما غيّرنا شي.');
      const nm = x.name.trim();
      if (nm === r.ssid) continue;
      const err = ssidError(nm);
      if (err) throw noChange(err + ' ما غيّرنا شي.');
      url['SSID' + r.idx] = c.n.x_wifi_SSID_obj + r.idx + '.' + c.n.x_wifi_SSID;
      value['SSID' + r.idx] = nm;
      want[r.idx] = nm;
    }
    if (password) {
      const err = wifiPassError(password);
      if (err) throw noChange(err + ' ما غيّرنا شي.');
      if (!c.n.x_wifi_PreSharedKey) throw noChange('ما لقينا خانة كلمة مرور الواي فاي في إعدادات راوترك — ما غيّرنا شي.');
      const sec = names.map(x => c.rows.find(y => y.idx === String(x.index))).filter((r): r is WlanRow => !!r && !!r.beacon && r.beacon !== 'None');
      if (!sec.length) throw noChange('شبكتك مفتوحة بدون حماية — فعّل الحماية من صفحة الراوتر أول، وبعدها غيّر كلمة المرور من هنا. ما غيّرنا شي.');
      if (c.steer === '1' && sec.some(r => r.idx === c.main5)) throw noChange('«دمج الشبكتين» شغّال — صفحة الراوتر نفسها تقفل تعديل شبكة الـ٥ جيجا وهو شغّال. ما غيّرنا شي.');
      for (const r of sec) { url['PSK' + r.idx] = c.n.x_wifi_AccessPoint_obj + r.idx + '.' + c.n.x_wifi_PreSharedKey; value['PSK' + r.idx] = password; }
    }
    if (!Object.keys(url).length) return;
    await this.setValues(url, value, true);
    // الاسم نتأكد منه بالقراءة (الكلمة ما نقرأها)
    if (Object.keys(want).length) {
      await sleep(1500);
      const rows = await this.wlanV2(c.n, c.main5, Math.max(...c.rows.map(r => Number(r.idx)), 1));
      for (const [i, nm] of Object.entries(want)) if (rows.find(r => r.idx === i)?.ssid !== nm) throw new Error('الراوتر قبل تغيير اسم الشبكة بس القراءة بعده مختلفة');
    }
  }
  async factoryReset(): Promise<void> {
    try { await this.post('do_cmd_web', { key: 'RECORD_MESSAGE_WEB' }, { v2: true }); } catch {}
    const r = await this.post('do_cmd_web', { key: 'UBUS_RESTORE_MODE_2' }, { v2: true });
    if (r && typeof r === 'object' && (r.success === 'false' || r.success === false)) throw new Error('UBUS_RESTORE_MODE_2: الراوتر رفض ضبط المصنع');
  }
}
