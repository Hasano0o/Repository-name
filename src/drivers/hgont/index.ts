/**
 * هواوي فايبر (ONT): DG8245V (STC) · HG8245W5 · HG8245X6-8Ne («Mobily Fiber») · LG8245X6 — راوترات ألياف بدون شريحة.
 * المرحلة ١ (٧ نوفمبر ٢٠٢٦): التعرّف + الدخول + كرت FULL (صفحات ما بعد الدخول) — بدون أي أمر كتابة.
 * المرحلة ٢ (بعد أول FULL): قوة الإشارة الضوئية (Rx/Tx dBm) · الأجهزة · إعادة التشغيل.
 *
 * الدخول من كود صفحاتهم (parse.ts): رمز (من الصفحة أو /asp/GetRandCount.asp) ← POST /login.cgi بكلمة base64.
 * ⚠️ DG8245V يقفل بعد ٣ محاولات غلط (errloginlockNum='3'، LockTime 60) ← محاولة وحدة لكل دخول،
 *    والكلمة المرفوضة تنحفظ وما نعيدها لحالنا (نفس ZTE).
 */
import { RouterDriver, Capability, DeviceDetails, NetworkInfo } from '../types';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import type { ModelProfile } from '../models';
import { isOntLoginPage, tokenFromPage, tokenFromReply, productName, loginLanguage, lockInfo, loginBody } from './parse';

export class HuaweiOntDriver implements RouterDriver {
  // ⚠️ المعرّف بدون كلمة «huawei»: قاعدة كرت FULL تعامل أي «huawei» كراوتر شريحة (ما يطلع إلا لموديل مجهول)
  readonly id = 'hgont';
  name = 'هواوي فايبر';
  readonly capabilities: Capability[] = [];

  private host = '';
  private model = '';
  private logged = false;

  private base(host = this.host) { return 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private async get(path: string, timeout = 8000) {
    const r = await http(this.base() + path, { method: 'GET' }, timeout);
    return { status: r.status, text: await r.text() };
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
        const r = await http(this.base() + '/asp/GetRandCount.asp', {
          method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: '',
        }, 8000);
        token = tokenFromReply(await r.text());
      } catch {}
    }
    diag(`[ont] الرمز: ${token ? (tokenFromPage(page) ? 'من الصفحة' : 'GetRandCount') : 'ما لقيناه'} · ${this.model || '؟'} · القفل بعد ${lk.maxTries ?? '؟'}`);
    if (!token) throw new Error('صفحة الدخول في راوترك مختلفة عن اللي نعرفه — اضغط «أرسل الخطأ للمطوّر» عشان نضيفها');
    const lang = loginLanguage(page);
    let res: { status: number; text: string };
    try {
      const r = await http(this.base() + '/login.cgi', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // نفس صفحة الجهاز: document.cookie = "Cookie=body:Language:<لغة>:id=-1"
          Cookie: `Cookie=body:Language:${lang}:id=-1`,
          Referer: this.base() + '/',
        },
        body: loginBody(user, password, lang, token),
      }, 15000);
      res = { status: r.status, text: await r.text() };
    } catch (e) {
      throw new Error(`الراوتر ما رد على الدخول (POST /login.cgi) — ${String((e as any)?.message ?? e).slice(0, 60)}`);
    }
    // بعد الدخول: «/» يرجع الصفحة الرئيسية — لو رجع فورم الدخول = ما دخلنا
    let after = res.text;
    if (!isOntLoginPage(after)) { try { after = (await this.get('/', 10000)).text; } catch {} }
    const ok = !isOntLoginPage(after);
    const lk2 = lockInfo(after);
    diag(`[ont] login.cgi → ${res.status} · ${res.text.length}B · ${ok ? 'دخلنا ✓' : `رفض${lk2.times !== undefined ? ` (محاولات ${lk2.times})` : ''}${lk2.leftSecs ? ` · قفل ${lk2.leftSecs}ث` : ''}`}`);
    if (!ok) {
      await markBadPassword(key, fp);
      if (lk2.leftSecs > 0) throw new Error(`الراوتر قفل الدخول ${lk2.leftSecs} ثانية بعد محاولات غلط — انتظر وجرّب بالكلمة اللي على الملصق`);
      throw new Error(`الراوتر رفض اسم المستخدم أو الكلمة. أجهزة الفايبر غالباً اسم المستخدم مو admin — شوف الملصق (مثل «user» عند STC) واكتبه مع الكلمة اللي جنبه. انتبه: الراوتر يقفل بعد ${lk.maxTries ?? 3} محاولات غلط.`);
    }
    await markBadPassword(key, null);
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
    ];
  }

  async isConnected(): Promise<boolean> {
    try { await this.get('/', 4000); return true; } catch { return false; }
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    return { connected: true, mode: 'فايبر' };
  }

  /** software = نسخة قائمة الصفحات — نرفعها لو أضفنا صفحات عشان يرجع كرت FULL */
  async getDeviceDetails(): Promise<DeviceDetails> {
    return { model: this.name, software: 'hgont-pages-1' };
  }
}
