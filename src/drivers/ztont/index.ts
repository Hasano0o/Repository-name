/**
 * ZTE فايبر (ONT): F660 وعائلته — راوترات ألياف بدون شريحة (ما فيه ترددات ولا أبراج).
 * المرحلة ١ (١٥ نوفمبر ٢٠٢٦، من ملفات عضو): التعرّف + الدخول + كرت FULL (صفحات ما بعد الدخول) — بدون أي أمر كتابة.
 * المرحلة ٢ (بعد FULL): الإشارة الضوئية (Rx/Tx) · الأجهزة · الواي فاي · إعادة التشغيل.
 * الدخول (parse.ts): POST / بكلمة sha256(الكلمة+رقم عشوائي) + رمز الصفحة. القفل ٦٠ ثانية بعد محاولات غلط ← محاولة وحدة،
 * والكلمة المرفوضة تنحفظ وما نعيدها لحالنا (نفس فايبر هواوي).
 */
import { RouterDriver, Capability, DeviceDetails, NetworkInfo } from '../types';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import type { ModelProfile } from '../models';
import { isZtOntLogin, ztOntModel, ztOntCheckToken, ztOntLoginToken, ztOntLocked, ztOntError, ztOntBody, ZT_DANGER } from './parse';

export class ZteOntDriver implements RouterDriver {
  readonly id = 'ztont';
  name = 'ZTE فايبر';
  readonly capabilities: Capability[] = [];

  private host = '';
  private model = '';
  private creds: { user: string; password: string } | null = null;
  private reloginAt = 0;

  private base(host = this.host) { return 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private async req(path: string, init: RequestInit = {}, timeout = 8000) {
    const r = await http(this.base() + path, init, timeout);
    return { status: r.status, text: await r.text() };
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    this.host = host;
    try {
      const r = await this.req('/', { method: 'GET' }, 4000);
      if (!isZtOntLogin(r.text)) return false;
      const m = ztOntModel(r.text); if (m) this.setModel(m);
      return true;
    } catch { return false; }
  }
  private setModel(m: string) { this.model = m; this.name = `ZTE فايبر ${m}`; }

  async identify(): Promise<ModelProfile | null> {
    const key = this.model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      id: 'ztont' + (key ? '-' + key : ''), label: this.name, brand: 'ont', tech: '4G',
      writeUnverified: true,
      note: 'راوتر فايبر (ألياف) — ما فيه شريحة ولا ترددات. الدعم للحين: الدخول بس. أرسل ملفات راوترك (الكرت تحت) عشان نضيف قوة الإشارة الضوئية والأجهزة والواي فاي.',
    };
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    const user = (username || '').trim() || 'admin';
    const fp = bytesToHex(sha256(utf8ToBytes(`ztont:${user}:${password}`)));
    const key = 'ztont:' + host;
    if (!opts?.fresh && !opts?.lastTry && await isBadPassword(key, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل. عدّلها من إعدادات الراوتر.');
    }
    const page = (await this.req('/', { method: 'GET' }, 10000)).text;
    if (!isZtOntLogin(page)) {
      diag('[ztont] / مو صفحة دخول — نعتبر الجلسة شغالة');
      this.creds = { user, password };
      return;
    }
    const m = ztOntModel(page); if (m) this.setModel(m);
    if (ztOntLocked(page)) throw new Error('الراوتر قافل الدخول بعد محاولات غلط — انتظر دقيقة وجرّب');
    const tok = ztOntCheckToken(page);
    if (!tok) throw new Error('صفحة الدخول في راوترك مختلفة عن اللي نعرفه — اضغط «أرسل الخطأ للمطوّر»');
    let r: { status: number; text: string };
    try {
      r = await this.req('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: this.base() + '/' },
        body: ztOntBody(user, password, tok, ztOntLoginToken(page)),
      }, 15000);
    } catch (e: any) {
      throw new Error(`الراوتر ما رد على الدخول — ${String(e?.message ?? e).slice(0, 60)}`);
    }
    // الحكم: الرد (أو «/» بعده) يرجع فورم الدخول = ما دخلنا
    let ok = !isZtOntLogin(r.text);
    if (ok) {
      try { const h = await this.req('/', { method: 'GET' }, 10000); ok = !isZtOntLogin(h.text); diag(`[ztont] / بعد الدخول → ${h.status} · ${h.text.length}B · ${ok ? 'الرئيسية ✓' : 'فورم دخول ⚠️'}`); } catch {}
    }
    const err = ztOntError(r.text);
    diag(`[ztont] login (${user}) → ${r.status} · ${r.text.length}B · ${ok ? 'دخلنا ✓' : `رفض${err ? ` «${err.slice(0, 80)}»` : ''}${ztOntLocked(r.text) ? ' · قفل' : ''}`}`);
    if (!ok) {
      if (ztOntLocked(r.text)) throw new Error('الراوتر قفل الدخول دقيقة بعد محاولات غلط — انتظر وجرّب بالكلمة اللي على الملصق');
      // ما نعلّمها غلط إلا لو الراوتر قال كذا صراحة (ممكن المشكلة في طريقة الدخول)
      if (err) { await markBadPassword(key, fp); throw new Error(`الراوتر رفض اسم المستخدم أو الكلمة («${err.slice(0, 60)}»). أجهزة الفايبر غالباً اسم المستخدم مو admin — شوف الملصق.`); }
      throw new Error('ما قدرنا ندخل — الراوتر رجّع صفحة الدخول بدون سبب. تأكد من اسم المستخدم والكلمة (اللي على الملصق) أو اضغط «أرسل الخطأ للمطوّر».');
    }
    await markBadPassword(key, null);
    this.creds = { user, password };
  }

  async logout(): Promise<void> { /* أمر الخروج ما نرسله (ما يحتاج) */ }

  async fetchAuthPage(path: string): Promise<{ ok: boolean; status: number; text: string; type: string }> {
    if (ZT_DANGER.test(path)) return { ok: false, status: 0, text: '', type: '' };
    let r = await this.req(path, { method: 'GET' }, 10000).catch(() => ({ status: 0, text: '' }));
    if (isZtOntLogin(r.text) && this.creds && Date.now() - this.reloginAt > 120_000) {
      this.reloginAt = Date.now();
      diag(`[ztont] الجلسة انتهت عند ${path} — دخول جديد`);
      try { await this.login(this.host, this.creds.user, this.creds.password, { fresh: true }); r = await this.req(path, { method: 'GET' }, 10000); } catch {}
    }
    const type = /\.js(\?|$)/i.test(path) ? 'application/javascript' : /\.css(\?|$)/i.test(path) ? 'text/css' : 'text/html';
    return { ok: r.status >= 200 && r.status < 400, status: r.status, text: r.text, type };
  }

  /** صفحات ZTE ONT المعروفة (getpage.gch) — عرض GET بس؛ اللي ما يرد يتسجّل «ما وصل» */
  afterLoginPages(): string[] {
    const g = (p: string) => `/getpage.gch?pid=1002&nextpage=${p}`;
    return [
      '/', '/start.ghtml', '/template.gch', '/top.gch', '/left.gch', '/menuView.gch', '/getpage.gch?pid=1001',
      g('status_dev_info_t.gch'), g('pon_status_link_info_t.gch'), g('pon_status_lan_link_info_t.gch'), g('status_gpon_onu_t.gch'),
      g('status_ethwan_if_t.gch'), g('IPv46_status_wan_if_t.gch'), g('status_lan_info_t.gch'), g('status_wlanm_info1_t.gch'),
      g('net_dhcp_dynamic_t.gch'), g('net_wlanm_basic1_t.gch'), g('net_wlanm_conf1_t.gch'), g('net_wlanm_secrity1_t.gch'),
      g('net_wlan_basic_t.gch'), g('net_wlan_conf_t.gch'), g('app_dev_info_t.gch'), g('manager_dev_conf_t.gch'),
    ];
  }

  async isConnected(): Promise<boolean> {
    try { await this.req('/', { method: 'GET' }, 4000); return true; } catch { return false; }
  }
  async getNetworkInfo(): Promise<NetworkInfo> { return { connected: true, mode: 'فايبر' }; }
  /** software = نسخة قائمة الصفحات — نرفعها لو أضفنا صفحات عشان يرجع كرت FULL */
  async getDeviceDetails(): Promise<DeviceDetails> { return { model: this.name, software: 'ztont-pages-1' }; }
}
