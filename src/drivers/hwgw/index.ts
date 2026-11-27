/**
 * هواوي البوابة القديمة — LTE CPE E5172 (s-927 وأخواته، فيرموير V200R001، عنوانه غالباً 192.168.1.1 و admin/admin).
 * ما يشبه هواوي HiLink (ما فيه /api/) ولا هواوي فايبر (ما فيه X_HW_Token) — واجهة ASP بنطاقات TR-069.
 * المرحلة ١ (١٧ نوفمبر ٢٠٢٦، من ملفات «مو مدعوم؟» لثلاث أعضاء): التعرّف + الدخول + الحالة (الشركة · أعمدة الإشارة · الاتصال)
 * + كرت FULL (صفحات ما بعد الدخول) — بدون أي أمر كتابة. الأرقام (RSRP/SINR) والترددات بعد ما نشوف صفحاته من FULL.
 * ⚠️ المعرّف بدون «huawei»: قاعدة كرت FULL تعامل «huawei» كراوتر HiLink (ما يطلع الكرت إلا لموديل مجهول).
 */
import { RouterDriver, Capability, DeviceDetails, NetworkInfo, Signal } from '../types';
import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import type { ModelProfile } from '../models';
import { isGwLoginPage, isGwBounce, gwModelLikeUser, gwLoginError, gwVersion, gwRsaB64, gwLoginBody, gwStatus, GwStatus } from './parse';

/** صفحات تغيّر شي — الجامع ما يفتحها أبداً */
const GW_DANGER = /reset|reboot|restore|factory|firmware\.asp|upgrade|logout|cfgfile/i;

export class HuaweiGwDriver implements RouterDriver {
  readonly id = 'hwgw';
  name = 'هواوي E5172';
  readonly capabilities: Capability[] = [];

  private host = '';
  private version = '';
  private creds: { user: string; password: string } | null = null;
  private reloginAt = 0;
  private last: GwStatus | null = null;

  private base(host = this.host) { return 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private async req(path: string, init: RequestInit = {}, timeout = 8000) {
    const r = await http(this.base() + path, init, timeout);
    let sc = '';
    try { sc = r.headers?.get?.('set-cookie') || ''; } catch {}
    return { status: r.status, text: await r.text(), setCookie: sc, url: (r as any).url as string | undefined };
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    this.host = host;
    try {
      const r = await this.req('/', { method: 'GET' }, 4000);
      if (!isGwLoginPage(r.text)) return false;
      this.version = gwVersion(r.text) ?? '';
      return true;
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    return {
      id: 'hwgw-e5172', label: 'هواوي E5172 (4G)', brand: 'hwgw', tech: '4G',
      writeUnverified: true,
      note: 'راوتر هواوي قديم (E5172). الدعم للحين: الدخول والشركة وقوة الإشارة بالأعمدة. أرسل ملفات راوترك (الكرت تحت) عشان نضيف الأرقام والترددات.',
    };
  }

  /** الحالة بالجلسة (POST مثل الصفحة) — null لو رجعنا لصفحة الدخول */
  private async status(): Promise<GwStatus | null> {
    const r = await this.req(`/index/getStatusByAjax.cgi?rid=${Math.floor(Math.random() * 1000)}`, {
      method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: this.base() + '/html/index.asp' },
    }, 8000);
    const s = gwStatus(r.text);
    if (s) this.last = s;
    return s;
  }

  /**
   * فيه جلسة؟ «/html/index.asp» بدون جلسة يرد صفحة «ارجع لـ /» (٢٥٧ بايت — ملف عضو ٢٧ نوفمبر)، ومع الجلسة يرد الصفحة الرئيسية.
   * (getStatusByAjax.cgi يرد بدون دخول، فما يثبت شي.)
   */
  private async authed(): Promise<{ ok: boolean; len: number }> {
    try {
      const t = (await this.req('/html/index.asp', { method: 'GET', headers: { Referer: this.base() + '/' } }, 8000)).text;
      return { ok: t.length > 0 && !isGwBounce(t) && !isGwLoginPage(t), len: t.length };
    } catch { return { ok: false, len: 0 }; }
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    const user = (username || '').trim() || 'admin';
    const fp = bytesToHex(sha256(utf8ToBytes(`hwgw:${user}:${password}`)));
    const key = 'hwgw:' + host;
    if (!opts?.fresh && !opts?.lastTry && await isBadPassword(key, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل. عدّلها من إعدادات الراوتر.');
    }
    if (gwModelLikeUser(user)) {
      throw new Error(`«${user}» هذا اسم الموديل مو اسم المستخدم — اكتب admin في خانة اسم المستخدم، والكلمة اللي على الملصق (غالباً admin).`);
    }
    // جلسة شغالة ← ما نصرف محاولة (إلا لو المستخدم كتب الكلمة بنفسه)
    if (!opts?.fresh && (await this.authed()).ok) { this.creds = { user, password }; return; }

    const page = (await this.req('/', { method: 'GET' }, 10000)).text;
    if (!isGwLoginPage(page)) throw new Error('صفحة الدخول في راوترك مختلفة عن اللي نعرفه — اضغط «أرسل الخطأ للمطوّر»');
    this.version = gwVersion(page) ?? this.version;
    const before = gwLoginError(page);
    // الصفحة تحذّر من ٣ محاولات غلط متتالية — ما نزيدها
    if ((before?.times ?? 0) >= 3 && !opts?.lastTry) {
      throw new Error('الراوتر سجّل ٣ محاولات دخول غلط — انتظر ٥ دقايق (أو طفّه وشغّله) وجرّب مرة وحدة بالكلمة اللي على الملصق (غالباً admin).');
    }
    let r: Awaited<ReturnType<HuaweiGwDriver['req']>>;
    try {
      r = await this.req('/index/login.cgi', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: this.base() + '/',
          // الصفحة تكتب كوكي اللغة قبل الإرسال
          Cookie: 'Language=en_us',
        },
        body: gwLoginBody(user, gwRsaB64(password, n => Crypto.getRandomBytes(n))),
      }, 15000);
    } catch (e: any) {
      throw new Error(`الراوتر ما رد على الدخول — ${String(e?.message ?? e).slice(0, 60)}`);
    }
    // الرد صفحة «ارجع لـ /» نجح أو فشل ← الحكم من html/index.asp، والعدّاد من «/»
    const au = await this.authed();
    let after: { times: number; code: string } | null = isGwLoginPage(r.text) ? gwLoginError(r.text) : null;
    if (!au.ok && !after) { try { after = gwLoginError((await this.req('/', { method: 'GET' }, 10000)).text); } catch {} }
    diag(`[hwgw] login.cgi (${user}) → ${r.status} · ${r.text.length}B${isGwBounce(r.text) ? ' (ارجع لـ /)' : ''} · set-cookie ${r.setCookie ? r.setCookie.split('=')[0].slice(0, 20) : '✗'} · html/index.asp: ${au.ok ? `✓ (${au.len}B)` : `✗ (${au.len}B)`} · محاولات ${before?.times ?? '؟'}→${after?.times ?? '-'} · ${this.version || '؟'}`);
    if (au.ok) {
      await markBadPassword(key, null);
      this.creds = { user, password };
      try { const st = await this.status(); diag(`[hwgw] الحالة: ${st ? `SIG ${st.sig} · Mode ${st.mode} · Connect ${st.connect} · SIM ${st.sim}` : '✗'}`); } catch {}
      return;
    }
    // رجعنا لصفحة الدخول والعدّاد زاد ← الراوتر رفض الاسم/الكلمة فعلاً
    if ((after?.times ?? 0) > (before?.times ?? 0)) {
      await markBadPassword(key, fp);
      throw new Error(`الراوتر رفض اسم المستخدم أو الكلمة (محاولة ${after!.times} من ٣). اسم المستخدم admin، والكلمة اللي على الملصق (غالباً admin).`);
    }
    throw new Error('ما قدرنا نتأكد من الدخول — اضغط «أرسل الخطأ للمطوّر» عشان نشوف رد راوترك.');
  }

  async logout(): Promise<void> { /* ما نرسل أمر الخروج (الجلسة تنتهي لحالها) */ }

  private async ensure(): Promise<GwStatus> {
    let s: GwStatus | null = null;
    try { s = await this.status(); } catch {}
    if (!s && this.creds && Date.now() - this.reloginAt > 120_000) {
      this.reloginAt = Date.now();
      diag('[hwgw] الجلسة انتهت — دخول جديد');
      await this.login(this.host, this.creds.user, this.creds.password);
      s = await this.status();
    }
    if (!s) throw new Error('ما عندك صلاحية (الجلسة انتهت) — ادخل من جديد');
    return s;
  }

  async getSignal(): Promise<Signal> {
    const s = await this.ensure();
    return { network: (s.sig ?? 0) > 0 ? '4G' : undefined };
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const s = this.last ?? await this.ensure();
    // قيم Connect/Mode ما نعرف معناها بالضبط للحين (التشخيص يسجّلها) — ما نخمّن «متصل»
    return { operator: s.operator, mode: '4G', supports5g: false };
  }

  async isConnected(): Promise<boolean> {
    try { await this.req('/', { method: 'GET' }, 4000); return true; } catch { return false; }
  }

  async fetchAuthPage(path: string): Promise<{ ok: boolean; status: number; text: string; type: string }> {
    if (GW_DANGER.test(path)) return { ok: false, status: 0, text: '', type: '' };
    let r = await this.req(path, { method: 'GET' }, 10000).catch(() => ({ status: 0, text: '', setCookie: '', url: '' }));
    if ((isGwLoginPage(r.text) || isGwBounce(r.text)) && this.creds && Date.now() - this.reloginAt > 120_000) {
      this.reloginAt = Date.now();
      diag(`[hwgw] الجلسة انتهت عند ${path} — دخول جديد`);
      try { await this.login(this.host, this.creds.user, this.creds.password); r = await this.req(path, { method: 'GET' }, 10000); } catch {}
    }
    const type = /\.js(\?|$)/i.test(path) ? 'application/javascript' : /\.css(\?|$)/i.test(path) ? 'text/css' : 'text/html';
    return { ok: r.status >= 200 && r.status < 400, status: r.status, text: r.text, type };
  }

  /**
   * صفحات ما بعد الدخول (GET بس) — أسماء القوائم من main.js (AdminMenuName). مجلدات بعضها معروفة من الكود
   * (ntwkall · management · main · ajaxref)، والباقي نجرّبه بأكثر من مجلد: اللي ما يرد يتسجّل «ما وصل».
   */
  afterLoginPages(): string[] {
    const pages = ['overview', 'systeminfo', 'deviceinfo', 'antenna', 'wan_settings', 'apnmng', 'pin', 'sim_lock', 'wlan', 'dhcp', 'dhcpinfo', 'message', 'diagnose', 'maintenance', 'account', 'advance'];
    const dirs = ['status', 'ntwkall', 'management', 'main', 'advance', 'wlan', 'security', 'sms'];
    const out = ['/html/index.asp', '/header.asp', '/footer.asp', '/html/main/refresh.asp', '/html/msgerrcode.asp',
      '/html/ntwkall/wan_settings.asp', '/html/ntwkall/simlock_hide.asp', '/html/management/firmwarecontent.asp'];
    for (const d of dirs) for (const p of pages) out.push(`/html/${d}/${p}.asp`);
    return [...new Set(out)].filter(p => !GW_DANGER.test(p));
  }

  /** software = نسخة الفيرموير + قائمة الصفحات — نرفعها لو أضفنا صفحات عشان يرجع كرت FULL */
  async getDeviceDetails(): Promise<DeviceDetails> {
    return { model: 'E5172', software: `${this.version || 'hwgw'}|hwgw-pages-2` };
  }
}
