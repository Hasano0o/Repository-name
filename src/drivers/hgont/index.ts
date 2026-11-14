/**
 * هواوي فايبر (ONT): DG8245V (STC) · HG8245W5 · HG8245X6-8Ne («Mobily Fiber») · LG8245X6 — راوترات ألياف بدون شريحة.
 * المرحلة ١ (٧ نوفمبر ٢٠٢٦): التعرّف + الدخول + كرت FULL (صفحات ما بعد الدخول) — بدون أي أمر كتابة.
 * المرحلة ٢ (بعد أول FULL): قوة الإشارة الضوئية (Rx/Tx dBm) · الأجهزة · إعادة التشغيل.
 *
 * الدخول من كود صفحاتهم (parse.ts): رمز (من الصفحة أو /asp/GetRandCount.asp) ← POST /login.cgi بكلمة base64.
 * ⚠️ DG8245V يقفل بعد ٣ محاولات غلط (errloginlockNum='3'، LockTime 60) ← محاولة وحدة لكل دخول،
 *    والكلمة المرفوضة تنحفظ وما نعيدها لحالنا (نفس ZTE).
 */
import { RouterDriver, Capability, DeviceDetails, NetworkInfo, ConnectedDevice, OpticReading } from '../types';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import type { ModelProfile } from '../models';
import { isOntLoginPage, tokenFromPage, tokenFromReply, productName, loginLanguage, lockInfo, loginBody, pageSendsLanguage, cookieFrom, deviceInfo, userDevices, uplinkState, opticInfo } from './parse';

export class HuaweiOntDriver implements RouterDriver {
  // ⚠️ المعرّف بدون كلمة «huawei»: قاعدة كرت FULL تعامل أي «huawei» كراوتر شريحة (ما يطلع إلا لموديل مجهول)
  readonly id = 'hgont';
  name = 'هواوي فايبر';
  readonly capabilities: Capability[] = ['devices'];

  private host = '';
  private model = '';
  private logged = false;

  private base(host = this.host) { return 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  /**
   * كوكي يدوي (credentials: 'omit') — جرة النظام كانت تغطي على «Cookie=body:Language:…:id=-1» حقت الدخول
   * (الصفحة تمسح الكوكيز وتكتب هذي قبل login.cgi). ١٤ نوفمبر: DG8245V بكلمة الملصق الصحيحة + LG8245X6 + HS8145C5 كلهم رفض.
   * الجلسة بعد الدخول من set-cookie، ونعطيها للجامع (authHeaders) عشان صفحات ما بعد الدخول.
   */
  private cookie = '';
  private async req(path: string, init: RequestInit = {}, timeout = 8000, cookieOverride?: string) {
    const ck = cookieOverride ?? this.cookie;
    const headers = { ...(init.headers as Record<string, string> | undefined), ...(ck ? { Cookie: ck } : {}) };
    const r = await http(this.base() + path, { ...init, headers, credentials: 'omit' } as RequestInit, timeout);
    let sc = '';
    try { sc = r.headers?.get?.('set-cookie') || ''; } catch {}
    const c = sc ? cookieFrom(sc) : '';
    if (c) this.cookie = c;
    return { status: r.status, text: await r.text(), setCookie: !!c };
  }
  private async get(path: string, timeout = 8000) {
    return this.req(path, { method: 'GET' }, timeout);
  }
  authHeaders(): Record<string, string> { return this.cookie ? { Cookie: this.cookie } : {}; }
  /** آخر دخول ناجح (بالذاكرة بس) — عشان نجدد الجلسة لو انتهت وقت سحب الصفحات */
  private creds: { user: string; password: string } | null = null;
  /**
   * صفحة بعد الدخول من خلال الدرايفر نفسه (نفس الكوكي) — الجامع يستخدمها بدل fetch حقه.
   * FULL ١٤ نوفمبر ٢٣:٠٣: كل الصفحات رجعت «Waiting… top.location.replace('/')» (530B) والدرايفر نفسه فتح /index.asp (21516B)
   * ← الجلسة راحت قبل الجامع. لو شفنا صفحة التحويل ندخل من جديد مرة وحدة ونعيد.
   */
  async fetchAuthPage(path: string): Promise<{ ok: boolean; status: number; text: string; type: string }> {
    const expired = (t: string) => t.length < 1500 && /top\.location\.replace\(\s*pageName\s*\)|<title>\s*Waiting/i.test(t) && /pageName\s*=\s*['"]\/['"]/.test(t);
    let r = await this.get(path, 10000);
    if (expired(r.text) && this.creds) {
      diag(`[ont] الجلسة انتهت عند ${path} — دخول جديد`);
      try { await this.login(this.host, this.creds.user, this.creds.password, { fresh: true }); r = await this.get(path, 10000); } catch {}
    }
    const type = /\.js(\?|$)/i.test(path) ? 'application/javascript' : /\.css(\?|$)/i.test(path) ? 'text/css' : 'text/html';
    return { ok: r.status >= 200 && r.status < 400, status: r.status, text: r.text, type };
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    this.host = host;
    try {
      const r = await this.get('/', 4000);
      if (!isOntLoginPage(r.text)) return false;
      const p = productName(r.text);
      if (p) this.setModel(p);
      return true;
    } catch { return false; }
  }

  private setModel(p: string) {
    this.model = p;
    this.name = /huawei/i.test(p) ? p : `هواوي فايبر ${p}`;
  }

  async identify(): Promise<ModelProfile | null> {
    if (!this.model) { try { const p = productName((await this.get('/')).text); if (p) this.setModel(p); } catch {} }
    const key = this.model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      id: 'hgont' + (key ? '-' + key : ''), label: this.name, brand: 'ont', tech: '4G',
      writeUnverified: true,
      note: 'راوتر فايبر (ألياف) — ما فيه شريحة ولا ترددات. الدعم للحين: الدخول بس. أرسل ملفات راوترك عشان نضيف قوة الإشارة الضوئية والأجهزة.',
    };
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    this.logged = false;
    this.cookie = '';
    const user = (username || '').trim() || 'admin';
    const fp = bytesToHex(sha256(utf8ToBytes(`ont:${user}:${password}`)));
    const key = 'ont:' + host;
    // كلمة انرفضت قبل ← ما نحرق محاولة (الجهاز يقفل بعد ٣) — إلا لو المستخدم كتبها بنفسه
    if (!opts?.fresh && !opts?.lastTry && await isBadPassword(key, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل. عدّلها من إعدادات الراوتر.');
    }
    const page = (await this.get('/', 10000)).text;
    if (!isOntLoginPage(page)) {
      // دخلنا قبل (الجلسة شغالة) — الصفحة الرئيسية بدل الدخول
      diag('[ont] / مو صفحة دخول — نعتبر الجلسة شغالة');
      this.logged = true;
      return;
    }
    const p = productName(page); if (p) this.setModel(p);
    const lk = lockInfo(page);
    if (lk.leftSecs > 0) throw new Error(`الراوتر قافل الدخول بعد محاولات غلط — انتظر ${lk.leftSecs} ثانية وجرّب`);
    let token = tokenFromPage(page);
    if (!token) {
      try {
        const r = await this.req('/asp/GetRandCount.asp', {
          method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: '',
        }, 8000);
        token = tokenFromReply(r.text);
      } catch {}
    }
    diag(`[ont] الرمز: ${token ? (tokenFromPage(page) ? 'من الصفحة' : 'GetRandCount') : 'ما لقيناه'} · ${this.model || '؟'} · القفل بعد ${lk.maxTries ?? '؟'}`);
    if (!token) throw new Error('صفحة الدخول في راوترك مختلفة عن اللي نعرفه — اضغط «أرسل الخطأ للمطوّر» عشان نضيفها');
    const lang = loginLanguage(page);
    const withLang = pageSendsLanguage(page);
    let res: { status: number; text: string; setCookie: boolean };
    try {
      // نفس صفحة الجهاز: تمسح الكوكيز وتكتب document.cookie = "Cookie=body:Language:<لغة>:id=-1" — ولا شي غيره
      res = await this.req('/login.cgi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: this.base() + '/' },
        body: loginBody(user, password, lang, token, withLang),
      }, 15000, `Cookie=body:Language:${lang}:id=-1`);
      diag(`[ont] login.cgi: Language ${withLang ? 'مع' : 'بدون'} · set-cookie ${res.setCookie ? '✓' : '✗'}`);
    } catch (e) {
      throw new Error(`الراوتر ما رد على الدخول (POST /login.cgi) — ${String((e as any)?.message ?? e).slice(0, 60)}`);
    }
    // بعد الدخول: «/» يرجع الصفحة الرئيسية — لو رجع فورم الدخول = ما دخلنا
    // الحكم من رد login.cgi نفسه: فشل = صفحة الدخول (فورم + عدّاد المحاولات). نجاح = رد صغير يحوّل للرئيسية + set-cookie.
    // تقرير ١٤ نوفمبر ٢٢:٣٧ (DG8245V): login.cgi → 200 · 538B · set-cookie ✓ وبعدها «/» رجّع فورم الدخول بـ «محاولات 0»
    // (يعني الراوتر ما حسبها غلط) ← كنا نحكم من «/» ونقول «الكلمة غلط» وهي صحيحة. «/» عند هالأجهزة يبقى صفحة الدخول.
    const after = res.text;
    const ok = !isOntLoginPage(after);
    diag(`[ont] رد login.cgi: ${after.replace(/\s+/g, ' ').replace(/[0-9a-f]{16,}/gi, '«…»').slice(0, 160)}`);
    if (ok) {
      // تأكيد للتشخيص بس (ما يغيّر الحكم): الرئيسية بالجلسة
      try {
        const h = await this.get('/index.asp', 10000);
        diag(`[ont] /index.asp بعد الدخول → ${h.status} · ${h.text.length}B · ${isOntLoginPage(h.text) ? 'فورم دخول ⚠️' : 'الرئيسية ✓'}`);
      } catch {}
    }
    const lk2 = lockInfo(after);
    diag(`[ont] login.cgi → ${res.status} · ${res.text.length}B · ${ok ? 'دخلنا ✓' : `رفض${lk2.times !== undefined ? ` (محاولات ${lk2.times})` : ''}${lk2.leftSecs ? ` · قفل ${lk2.leftSecs}ث` : ''}`}`);
    if (!ok) {
      await markBadPassword(key, fp);
      if (lk2.leftSecs > 0) throw new Error(`الراوتر قفل الدخول ${lk2.leftSecs} ثانية بعد محاولات غلط — انتظر وجرّب بالكلمة اللي على الملصق`);
      throw new Error(`الراوتر رفض اسم المستخدم أو الكلمة. أجهزة الفايبر غالباً اسم المستخدم مو admin — شوف الملصق (مثل «user» عند STC) واكتبه مع الكلمة اللي جنبه. انتبه: الراوتر يقفل بعد ${lk.maxTries ?? 3} محاولات غلط.`);
    }
    await markBadPassword(key, null);
    this.creds = { user, password };
    this.logged = true;
  }

  async logout(): Promise<void> {
    // ما نعرف أمر الخروج بدليل للحين — نخلي الجلسة تنتهي لحالها (ما نرسل شي ما شفناه)
    this.logged = false;
  }

  /** صفحات بعد الدخول للجامع (FULL/AUTH) — عرض GET بس. مسارات هواوي ONT المعروفة؛ اللي ما يرد يتسجّل «ما وصل» */
  afterLoginPages(): string[] {
    return [
      '/', '/index.asp', '/CustomApp/mainpage.asp', '/html/ssmp/default/default.asp',
      '/html/amp/opticinfo/opticinfo.asp', '/html/ssmp/deviceinfo/deviceinfo.asp',
      '/html/bbsp/waninfo/waninfo.asp', '/html/bbsp/userdevinfo/userdevinfo.asp',
      '/html/amp/wlaninfo/wlaninfo.asp', '/html/amp/wlanbasic/WlanBasic.asp', '/html/amp/wlanadv/WlanAdvance.asp',
      '/html/bbsp/dhcpinfo/dhcpinfo.asp', '/html/ssmp/devmanage/devmanage.asp', '/html/ssmp/reset/reset.asp',
      '/html/ssmp/accoutcfg/ontmngt.asp', '/html/ssmp/common/getmenu.asp', '/menu.asp', '/frame.asp',
      // DG8245V: الإشارة الضوئية — مسارات هواوي الثانية (opticinfo.asp ما وصل في FULL ١٤ نوفمبر)
      '/html/amp/opticinfo/opticinfo_ont.asp', '/html/amp/ponopticinfo/ponopticinfo.asp', '/html/bbsp/common/GetLanUserDevInfo.asp',
      '/html/ssmp/devmanage/cfgfile.asp', '/html/ssmp/reset/rebootdevice.asp',
    ];
  }

  async isConnected(): Promise<boolean> {
    try { await this.get('/', 4000); return true; } catch { return false; }
  }

  /** DG8245V ١٤ نوفمبر: PonMode='ge' ← النت داخل من كابل إيثرنت مو من الفايبر (ما فيه قراءة ضوئية أصلاً) */
  async getNetworkInfo(): Promise<NetworkInfo> {
    try {
      const u = uplinkState((await this.fetchAuthPage('/html/bbsp/common/ontstate.asp')).text);
      if (u) return { connected: u.online, mode: u.mode };
    } catch {}
    return { connected: true, mode: 'فايبر' };
  }

  /** software = نسخة قائمة الصفحات — نرفعها لو أضفنا صفحات عشان يرجع كرت FULL */
  async getDeviceDetails(): Promise<DeviceDetails> {
    // software = نسخة قائمة الصفحات (كرت FULL يرجع لو تغيّرت) — نخليها لو الصفحة ما قرت
    let info: ReturnType<typeof deviceInfo> = null;
    try { info = deviceInfo((await this.fetchAuthPage('/html/ssmp/deviceinfo/deviceinfo.asp')).text); } catch {}
    if (!info) return { model: this.name, software: 'hgont-pages-2' };
    return { model: info.model || this.name, software: info.software, hardware: info.hardware, imei: info.serial };
  }

  /** الإشارة الضوئية — opticinfo.asp (موبايلي فايبر HG8245X6 ١٤ نوفمبر). على GE (DG8245V) الصفحة ما ترد ← null */
  async getOptic(): Promise<OpticReading | null> {
    const r = await this.fetchAuthPage('/html/amp/opticinfo/opticinfo.asp');
    if (!r.ok) return null;
    return opticInfo(r.text);
  }

  /** الأجهزة المتصلة (Online بس) — GetLanUserDevInfo.asp (قراءة بس؛ الحظر ما شفنا أمره) */
  async getDevices(): Promise<ConnectedDevice[]> {
    const r = await this.fetchAuthPage('/html/bbsp/common/GetLanUserDevInfo.asp');
    return userDevices(r.text).filter(d => d.online).map(d => ({ mac: d.mac, ip: d.ip, name: d.name }));
  }
}
