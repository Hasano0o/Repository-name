/**
 * زين 5G Indoor CPE SRT858M (WiFi 7) — واجهة «5G Device» (goform/action + JSON، تشفير MG اختياري).
 * الأرقام (٢٨ نوفمبر): RSRP/RSRQ/SINR/RSSI والتردد والبرج و5G في NSA — بتحويل صفحة rfparamters.js نفسها.
 * المرحلة ١ (١٧ نوفمبر ٢٠٢٦، من ملفات «مو مدعوم؟» لعدة أعضاء): التعرّف + الدخول + الحالة (الشركة · الشبكة 4G/5G ·
 * أعمدة الإشارة · الشريحة · الاتصال) + كرت FULL — بدون أي أمر كتابة. الأرقام (RSRP/SINR) والترددات/البرج
 * (صفحاته فيها bandlock · celllock · rfparamters) بعد ما نشوف صفحاتها من FULL.
 * الدخول: admin + الكلمة اللي على الملصق (admin@5GCPE غالباً) — الراوتر يقفل بعد ٥ محاولات غلط.
 */
import { RouterDriver, Capability, DeviceDetails, NetworkInfo, Signal } from '../types';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import type { ModelProfile } from '../models';
import { isSrtPage, srtLoginBody, srtEncryptOn, parseMgKey, mgEncode, mgDecode, srtNetwork, MgKey, srtSignal, SRT_RF_KEYS } from './parse';

/** صفحات تغيّر شي — الجامع ما يفتحها */
const SRT_DANGER = /reboot|reset|restore|upgrade|logout|backup|factory/i;
const READ_KEYS = ['mnet_sig_level', 'mnet_sysmode', 'mnet_operator_name', 'mnet_sim_status', 'dialup_dial_status', 'mnet_roam_status', 'rt_internet_mode'];
const now = () => Math.floor(Date.now() / 1000);

export class SrtDriver implements RouterDriver {
  readonly id = 'srt';
  name = 'زين SRT858M';
  readonly capabilities: Capability[] = [];

  private host = '';
  private enc: boolean | null = null;
  private key: MgKey | null = null;
  private creds: { user: string; password: string } | null = null;
  private reloginAt = 0;
  private last: Record<string, any> | null = null;

  private base(host = this.host) { return 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  /** طلب بنفس tools.js: JSON أو x-mgdata مشفّر؛ updateKey = getAjaxJsonData/saveAjaxJsonData (commonAjax ما يحدّث المفتاح) */
  private async call(path: string, body: string | null, updateKey: boolean, timeout = 8000): Promise<any> {
    const enc = !!this.enc;
    const data = body === null ? undefined : enc && this.key ? mgEncode(body, this.key, now()) : body;
    const r = await http(this.base() + path, {
      method: 'POST',
      headers: { 'Content-Type': enc ? 'application/x-mgdata' : 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: this.base() + '/' },
      ...(data !== undefined ? { body: data } : {}),
    }, timeout);
    let text = await r.text();
    if (enc) {
      if (updateKey) { const k = parseMgKey(r.headers?.get?.('X-MG-Private'), now()); if (k) this.key = k; }
      if (this.key && text && !/^\s*[{[<]/.test(text)) { try { text = mgDecode(text, this.key.secret); } catch {} }
    }
    try { return JSON.parse(text); } catch {}
    // الرد المفكوك ممكن يبدأ بـ «<وقت hex>:» مثل طلبات الصفحة — نشيله ونجرّب
    const m = text.match(/^[0-9a-f]{1,16}:([\s\S]*)$/i);
    if (m) { try { return JSON.parse(m[1]); } catch {} }
    return { __raw: text.slice(0, 120), __status: r.status };
  }

  private async prepare(): Promise<void> {
    if (this.enc === null) {
      try {
        const r = await http(this.base() + '/config/global/config.xml', { method: 'POST', headers: { 'Content-Type': 'application/xml' } }, 4000);
        this.enc = srtEncryptOn(await r.text());
      } catch { this.enc = false; }
    }
    // getPrikey: المفتاح من /goform/sync (حتى بدون تشفير ما يضر — الصفحة تطلبه قبل الدخول)
    try {
      const r = await http(this.base() + '/goform/sync', { method: 'POST', headers: { 'Content-Type': 'application/x-mgdata' } }, 4000);
      const k = parseMgKey(r.headers?.get?.('X-MG-Private'), now());
      if (k) this.key = k;
      await r.text();
    } catch {}
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    this.host = host;
    try {
      const r = await http(this.base() + '/', { method: 'GET' }, 4000);
      return isSrtPage(await r.text());
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    return {
      id: 'srt-srt858m', label: 'زين SRT858M (5G)', brand: 'srt', tech: '5G',
      writeUnverified: true,
      note: 'الدعم للحين: الدخول والشركة ونوع الشبكة وقوة الإشارة بالأعمدة. أرسل ملفات راوترك (الكرت تحت) عشان نضيف الأرقام والترددات والأبراج.',
    };
  }

  private async loggedIn(): Promise<boolean> {
    const o = await this.call('/goform/get_login_info', null, true, 6000);
    return o?.retcode === 0 && Number(o?.loginStatus) === 1;
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    const user = (username || '').trim() || 'admin';
    const fp = bytesToHex(sha256(utf8ToBytes(`srt:${user}:${password}`)));
    const key = 'srt:' + host;
    if (!opts?.fresh && !opts?.lastTry && await isBadPassword(key, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل. عدّلها من إعدادات الراوتر.');
    }
    await this.prepare();
    if (!opts?.fresh) { try { if (await this.loggedIn()) { this.creds = { user, password }; return; } } catch {} }

    let o: any;
    try { o = await this.call('/goform/login', srtLoginBody(user, password), true, 15000); }
    catch (e: any) { throw new Error(`الراوتر ما رد على الدخول — ${String(e?.message ?? e).slice(0, 60)}`); }
    diag(`[srt] login (${user}) → retcode ${o?.retcode ?? '؟'}${o?.remain_times !== undefined ? ` · باقي ${o.remain_times}` : ''} · تشفير ${this.enc ? '✓' : '✗'} · مفتاح ${this.key ? '✓' : '✗'}${o?.__raw !== undefined ? ` · رد مو JSON (${o.__status}): ${o.__raw}` : ''}`);
    if (o?.retcode === 0) {
      let ok = false;
      try { ok = await this.loggedIn(); } catch {}
      diag(`[srt] get_login_info بعد الدخول → ${ok ? 'داخل ✓' : '✗'}`);
      await markBadPassword(key, null);
      this.creds = { user, password };
      return;
    }
    if (String(o?.retcode) === '203') throw new Error('الراوتر قافل الدخول (محاولات غلط كثيرة) — انتظر شوي وجرّب مرة وحدة بالكلمة اللي على الملصق.');
    if (String(o?.retcode) === '202') throw new Error('الراوتر رفض الدخول الحين (202) — غالباً فيه أحد داخل صفحة الراوتر من جهاز ثاني. سكّرها وجرّب.');
    if (typeof o?.remain_times === 'number') {
      await markBadPassword(key, fp);
      if (o.remain_times <= 0) throw new Error('الراوتر قفل الدخول مؤقتاً بعد محاولات غلط — انتظر وجرّب بالكلمة اللي على الملصق.');
      throw new Error(`الراوتر رفض اسم المستخدم أو الكلمة (باقي ${o.remain_times} محاولات). على الملصق: admin والكلمة اللي جنب «Password» (مثل admin@5GCPE).`);
    }
    throw new Error('ما قدرنا ندخل — رد الراوتر مختلف عن اللي نعرفه. اضغط «أرسل الخطأ للمطوّر».');
  }

  async logout(): Promise<void> { /* ما نطلع (الصفحة نفسها تخلي الجلسة لين تنتهي) */ }

  private async read(): Promise<Record<string, any>> {
    const get = () => this.call('/action/get_mgdb_params', JSON.stringify({ keys: READ_KEYS }), false);
    let o = await get().catch(() => null);
    if (!(o?.retcode === 0 && o?.data) && this.creds && Date.now() - this.reloginAt > 120_000) {
      this.reloginAt = Date.now();
      diag(`[srt] القراءة ما ردت (${o?.retcode ?? o?.__status ?? '؟'}) — دخول جديد`);
      await this.login(this.host, this.creds.user, this.creds.password);
      o = await get().catch(() => null);
    }
    if (!(o?.retcode === 0 && o?.data)) throw new Error('ما عندك صلاحية (الجلسة انتهت) — ادخل من جديد');
    if (!this.last) diag(`[srt] الحالة: ${READ_KEYS.map(k => `${k}=${String(o.data[k] ?? '').slice(0, 20)}`).join(' · ')}`);
    this.last = o.data;
    return o.data;
  }

  /** الأرقام من نفس طلب صفحة rfparamters.js (قراءة بس) — يرجع الحالة بس لو الطلب ما رد */
  async getSignal(): Promise<Signal> {
    const d = await this.read();
    const rf = await this.call('/action/get_mgdb_params', JSON.stringify({ keys: SRT_RF_KEYS }), false).catch(() => null);
    if (!(rf?.retcode === 0 && rf?.data)) return { network: srtNetwork(d.mnet_sysmode) };
    if (!this.rfLogged) { this.rfLogged = true; diag(`[srt] rf: ${SRT_RF_KEYS.map(k => `${k}=${String(rf.data[k] ?? '').slice(0, 12)}`).join(' · ')}`); }
    return srtSignal(rf.data, d.mnet_sysmode);
  }
  private rfLogged = false;

  async getNetworkInfo(): Promise<NetworkInfo> {
    const d = this.last ?? await this.read();
    const st = String(d.dialup_dial_status ?? '').toLowerCase();
    return {
      operator: d.mnet_operator_name || undefined,
      connected: st === 'connected' ? true : st === 'disconnected' ? false : undefined,
      mode: srtNetwork(d.mnet_sysmode), supports5g: true,
    };
  }

  async isConnected(): Promise<boolean> {
    try { await http(this.base() + '/', { method: 'GET' }, 4000); return true; } catch { return false; }
  }

  async fetchAuthPage(path: string): Promise<{ ok: boolean; status: number; text: string; type: string }> {
    if (SRT_DANGER.test(path)) return { ok: false, status: 0, text: '', type: '' };
    try {
      const r = await http(this.base() + path, { method: path.endsWith('.xml') ? 'POST' : 'GET' }, 10000);
      const text = await r.text();
      const type = /\.js(\?|$)/i.test(path) ? 'application/javascript' : /\.xml(\?|$)/i.test(path) ? 'application/xml' : /\.css(\?|$)/i.test(path) ? 'text/css' : 'text/html';
      return { ok: r.status >= 200 && r.status < 400, status: r.status, text, type };
    } catch { return { ok: false, status: 0, text: '', type: '' }; }
  }

  /** صفحات القوائم (settings.html#<اسم> ← /html/<اسم>.html) + ملفات js بنفس الاسم — GET بس */
  afterLoginPages(): string[] {
    const ids = ['status', 'deviceinfo', 'rfparamters', 'bandlock', 'celllock', 'antenna', 'networksetting', 'mobileconnection',
      'profilemanagement', 'statistics', 'wanstatus', 'nr5g', 'pinmanagement', 'shortmessage', 'wlansettings', 'wifiadvanced',
      'dhcp', 'diagnosis', 'systemsettings', 'gameacceleration', 'mesh', 'wanping', 'atswitch', 'logqxdm', 'modemlog'];
    const out = ['/config/global/config.xml', '/html/settings.html', '/html/leftmenu.html', '/html/home.html', '/html/quickguide.html'];
    for (const id of ids) out.push(`/html/${id}.html`, `/js/${id}.js`);
    return out.filter(p => !SRT_DANGER.test(p));
  }

  async getDeviceDetails(): Promise<DeviceDetails> {
    return { model: 'SRT858M', software: 'srt-pages-1' };
  }
}
