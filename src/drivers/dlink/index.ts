/**
 * D-Link DWR-2000M (4G) و DWR-3000M (5G) — 192.168.0.1، صفحة React («cpe-webui»)، واجهة JSON على /acfun/.
 * كل شي من ملفات صفحة الراوتر الحقيقية (ملفين DWR-2000M/MOB + ملف DWR-3000M، ٣١ أكتوبر):
 *   الطلب: GET بالخانات في الرابط · POST بجسم JSON · Content-Type: application/json · الجلسة بالكوكي (-goahead-session-)
 *   الرد: {errcode, msg, info, waitime?} — errcode 0/فاضي = تمام · 6 = الجلسة راحت · 22 = قفل بعد ٥ محاولات غلط
 *   الدخول: getLoginKey?username ← PublicKey + Challenge ← HMAC-MD5 مرتين (./crypto) ← POST /acfun/login {username, password}
 *
 * المبني (قراءة): الإشارة 4G/5G والدمج · الأبراج اللي متصل عليها · الشركة والحالة · معلومات الجهاز · الأجهزة المتصلة · إعادة التشغيل.
 * موجود في صفحته وما انفتح للحين: تثبيت الترددات (bandLockSetup) · تثبيت البرج (cellLockSetup) · وضع الشبكة (mobileNetworkBasicSetting).
 * الكتابة تنفتح بعد ما يدخل عضو ويقرأ بنجاح — setBand يوقف قبل أي أمر (noChange).
 */
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, Carrier, ConnectedDevice, DeviceDetails, BandConfig,
} from '../types';
import { http } from '../http';
import { noChange } from '../noChange';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import { dlLoginHash } from './crypto';
import { signalFrom, carriersFrom, cellsFrom, connectedFrom, devicesFrom, bandConfigFrom } from './parse';

const NET_ERR = /تعذر الاتصال|ما رد|timeout|network|abort/i;

export class DlinkDriver implements RouterDriver {
  id = 'dlink';
  name = 'D-Link';
  capabilities: Capability[] = ['signal', 'cells', 'reboot', 'devices'];

  private host = '';
  private model = '';
  private loggedIn = false;

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  /** نفس طبقة الطلبات في الصفحة (موديول 72) */
  private async req(method: 'GET' | 'POST', path: string, data?: unknown, opts: { raw?: boolean; timeout?: number } = {}): Promise<any> {
    let url = `${this.base()}/acfun/${path}`;
    const init: RequestInit = { method, headers: { 'content-type': 'application/json', lang: 'en' } };
    if (method === 'GET') {
      const q = Object.entries((data ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
      if (q) url += '?' + q;
    } else init.body = JSON.stringify(data ?? '');
    const r = await http(url, init, opts.timeout ?? 10000);
    if (r.status === 401 || r.status === 403) throw new Error('انتهت الجلسة');
    const t = (await r.text()).trim();
    if (r.status !== 200) throw new Error(`${path}: HTTP ${r.status}`);
    let j: any;
    try { j = JSON.parse(t); } catch {
      // الصفحة ترجّع index.html لأي رابط ما تعرفه
      throw new Error(/<html|<!doctype/i.test(t) ? `${path}: الراوتر رجّع صفحة بدل بيانات` : `${path}: رد غير متوقع`);
    }
    if (opts.raw) return j;
    const code = Number(j?.errcode ?? 0);
    if (code === 6) { this.loggedIn = false; throw new Error('انتهت الجلسة'); }
    if (code === 22) throw new Error('الراوتر قفل الدخول بعد ٥ محاولات غلط — انتظر شوي وجرّب');
    if (code) throw new Error(`${path}: الراوتر رفض (${code}${j?.msg ? ' ' + String(j.msg).slice(0, 60) : ''})`);
    return j?.info ?? {};
  }
  private get = (p: string, d?: Record<string, unknown>) => this.req('GET', p, d);

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const j = await this.req('GET', 'getProductModelInfo', undefined, { raw: true, timeout: 5000 });
      if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
      const m = String(j?.info?.model ?? '').trim();
      if (m) this.model = m;
      return 'errcode' in j && (!!m || (j.info && typeof j.info === 'object'));
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    if (!this.model) {
      try { this.model = String((await this.req('GET', 'getProductModelInfo', undefined, { raw: true, timeout: 5000 }))?.info?.model ?? '').trim(); } catch {}
    }
    const m = this.model;
    const five = /3000|5g/i.test(m);
    const label = m ? (/d-?link/i.test(m) ? m : 'D-Link ' + m) : 'D-Link DWR';
    const id = 'dlink' + (m ? '-' + m.toLowerCase().replace(/^d-?link\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '');
    return { id, label, brand: 'dlink', tech: five ? '5G' : '4G', writeUnverified: true };
  }

  async login(host: string, username: string, password: string): Promise<void> {
    this.host = host;
    this.loggedIn = false;
    const user = (username || '').trim() || 'admin';
    const k = await this.req('GET', 'getLoginKey', { username: user }, { raw: true });
    if (Number(k?.errcode ?? 0)) {
      if (Number(k.errcode) === 22) throw new Error('الراوتر قفل الدخول بعد ٥ محاولات غلط — انتظر شوي وجرّب');
      throw new Error(`getLoginKey: الراوتر رفض (${k.errcode}${k.msg ? ' ' + String(k.msg).slice(0, 60) : ''}) — تأكد من اسم المستخدم (غالباً admin)`);
    }
    const pub = String(k?.info?.PublicKey ?? ''), ch = String(k?.info?.Challenge ?? '');
    if (!pub || !ch) throw new Error('getLoginKey: الراوتر ما أعطى مفتاح الدخول');
    const { password: hash } = dlLoginHash(pub, password, ch);
    const r = await this.req('POST', 'login', { username: user, password: hash }, { raw: true });
    const code = Number(r?.errcode ?? 0);
    if (!code) { this.loggedIn = true; return; }
    if (code === 22) throw new Error('الراوتر قفل الدخول بعد ٥ محاولات غلط — انتظر شوي وجرّب');
    const msg = String(r?.msg ?? '');
    if (/password|passwd|pwd|incorrect|wrong|error/i.test(msg) || code === 20 || code === 21)
      throw new Error('كلمة المرور غلط — في D-Link اسم المستخدم غالباً admin والكلمة تحت الراوتر');
    throw new Error(`تعذّر تسجيل الدخول (login: ${code}${msg ? ' ' + msg.slice(0, 60) : ''})`);
  }
  async logout(): Promise<void> {
    try { await this.req('POST', 'logout', {}); } catch {}
    this.loggedIn = false;
  }

  // ═══ الإشارة ═══
  private async rf(): Promise<any> {
    const info = await this.get('getMobileNetStatusParams');
    if (!info || typeof info !== 'object' || (!info.rf && !info.basic)) throw new Error('getMobileNetStatusParams: رد غير متوقع');
    return info;
  }
  private mobile(): Promise<any> {
    return this.get('InternetStatus').then(i => i?.MobileNetwork ?? {}).catch(() => ({}));
  }
  async getSignal(): Promise<Signal> {
    const [info, mob] = await Promise.all([this.rf(), this.mobile()]);
    return signalFrom(info, mob);
  }
  async getCarriers(): Promise<Carrier[]> { return carriersFrom(await this.rf()); }
  async getCells(): Promise<CellTower[]> { return cellsFrom(await this.rf()); }
  async getSnapshot(): Promise<SignalSnapshot> {
    const [info, mob] = await Promise.all([this.rf(), this.mobile()]);
    return buildSnapshot(signalFrom(info, mob), carriersFrom(info), cellsFrom(info), { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const [info, mob] = await Promise.all([this.rf(), this.mobile()]);
    return {
      operator: mob.operators ? String(mob.operators) : undefined,
      connected: connectedFrom(mob, info),
      mode: signalFrom(info, mob).network,
      supports5g: /3000|5g/i.test(this.model) ? true : /2000/.test(this.model) ? false : undefined,
    };
  }
  async isConnected(): Promise<boolean> {
    try {
      const [info, mob] = await Promise.all([this.rf(), this.mobile()]);
      return connectedFrom(mob, info);
    } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const [info, mob] = await Promise.all([this.rf().catch(() => ({} as any)), this.mobile()]);
    const b = info?.basic ?? {};
    return {
      model: this.model || b.productType || undefined, imei: b.imei || mob.imei || undefined,
      software: b.softwareVersion || undefined, hardware: b.hardwareVersion || undefined,
      wanIp: mob.ipAddress || undefined, dns: mob.primary_dns_server || undefined, operator: mob.operators || undefined,
    };
  }

  async getDevices(): Promise<ConnectedDevice[]> { return devicesFrom(await this.get('ConnectedClients')); }

  async reboot(): Promise<void> {
    try { await this.req('POST', 'reboot', ''); } catch (e) {
      // الراوتر يطفي قبل ما يرد أحياناً — مو فشل
      if (!NET_ERR.test(String((e as any)?.message ?? e))) throw e;
    }
  }

  // ═══ الترددات: قراءة بس ═══
  async getBandConfig(): Promise<BandConfig> { return bandConfigFrom(await this.get('getBandLockInfo')); }
  async setBand(): Promise<void> {
    throw noChange('تثبيت الترددات في D-Link لسا ما انفتح — ننتظر أول تجربة دخول ناجحة. ما غيّرنا شي.');
  }
}
