/**
 * ZLT / SIMCom «war» — راوترات ZLT الداخلية (X10 · X21 · X28 Pro · VN007+، وغالباً X300A). العنوان غالباً 192.168.0.1.
 *
 * المرحلة ١ (٢١ نوفمبر ٢٠٢٦، من ملفات «مو مدعوم؟» لـ ٤ أعضاء): التعرّف + الدخول + الإشارة + كرت FULL. بدون أي أمر كتابة.
 *  • كل شي POST JSON على /cgi-bin/http.cgi: { cmd, method, language, sessionId, … } (Page.postJSON في main.js)
 *  • الدخول (login.js):
 *      1) { cmd:232 GET_NEXT_LOGIN_TIME, method:"GET", sessionId:"" } ← token
 *      2) { cmd:100 LOGIN, method:"POST", sessionId:<عشوائي ٦٤ hex>, username, passwd: sha256_hex(token + الكلمة) }
 *         ← نجاح: sessionId جديد (الصفحة تحطه sessionStorage وترسله مع كل طلب) · فشل: login_fail="fail" + login_times (الباقي)
 *  • الإشارة: { cmd:205 SYS_INFO_NETWORK } ← RSRP/RSRQ/SINR/RSSI/PCI/CELL_ID/FREQ/ENODEBID/currentband (+ نفسها _5G)
 *  • الجهاز: { cmd:43 DEVICE_VERSION_INFO } ← module · modversion · imei
 *  • «NO_AUTH» بالرد = الجلسة راحت ← دخول جديد (مرة كل دقيقتين بالكثير)
 *  • صفحاتهم فيها LOCK_BAND 161 · LOCK_PHY_CELL 160 · NETWORKSET_MODE 218 · GET_SUPPORT_BANDS 157 — الكتابة بعد FULL من عضو (كود الصفحات بالجلسة).
 */
import { RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, DeviceDetails, BandConfig } from '../types';
import { noChange } from '../noChange';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import type { ModelProfile } from '../models';
import { ZLT_CGI, ZCMD, isZltPage, parseZlt, isNoAuth, zltBody, signalFrom, caCellsFrom, loginFailMsg, str, zltModes, zltModeCode } from './parse';

export const zltPass = (token: string, pw: string) => bytesToHex(sha256(utf8ToBytes(token + pw)));

/** أوامر/صفحات تغيّر شي — الجامع ما يفتحها */
const ZLT_DANGER = /reboot|reset|restore|factory|upload|upgrade|logout/i;

export class ZltDriver implements RouterDriver {
  readonly id = 'zlt';
  name = 'ZLT';
  readonly capabilities: Capability[] = ['signal'];

  private host = '';
  private sid = '';
  private creds: { user: string; password: string } | null = null;
  private reloginAt = 0;
  private info: { model?: string; fw?: string; imei?: string } | null = null;
  private loggedKeys = false;

  /** X300A (du — ٢١ نوفمبر) يفتح https بس (http = «تعذر الاتصال») — نتذكر اللي رد في detect */
  private scheme: 'http' | 'https' = 'http';
  private base(host = this.host) { return this.scheme + '://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  private async cmd(cmd: number, method: 'GET' | 'POST' = 'GET', extra: Record<string, unknown> = {}, sid = this.sid, timeout = 8000): Promise<{ status: number; text: string; j: any }> {
    try {
      return await this.cmdOnce(cmd, method, extra, sid, timeout);
    } catch (e) {
      // نسخة جديدة من الدرايفر (فتح التطبيق/صفحة الراوتر) تبدأ http بدون detect — X300A (du) https بس:
      // «تعذر الاتصال» على http ← نحوّل https مرة ونكمل عليه (٢١ نوفمبر: انضاف وبعدها كل قراءة «ما رد»)
      if (this.scheme !== 'http') throw e;
      this.scheme = 'https';
      try { return await this.cmdOnce(cmd, method, extra, sid, timeout); }
      catch (e2) { this.scheme = 'http'; throw e; }
    }
  }
  private async cmdOnce(cmd: number, method: 'GET' | 'POST', extra: Record<string, unknown>, sid: string, timeout: number): Promise<{ status: number; text: string; j: any }> {
    const r = await http(this.base() + ZLT_CGI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'text/plain, */*', 'X-Requested-With': 'XMLHttpRequest', Referer: this.base() + '/index.html' },
      body: zltBody(cmd, method, sid, extra),
    }, timeout);
    const text = await r.text();
    return { status: r.status, text, j: parseZlt(text) };
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    this.host = host;
    for (const sc of ['http', 'https'] as const) {
      this.scheme = sc;
      try {
        const r = await http(this.base() + '/', { method: 'GET' }, 3000);
        const t = await r.text();
        // http يحوّل لـ https بنفسه؟ نكمل على https
        try { if (/^https:/i.test((r as any).url ?? '')) this.scheme = 'https'; } catch {}
        if (isZltPage(t)) return true;
        if (sc === 'http') return false; // http رد بصفحة ثانية = مو ZLT (ما نضيّع وقت على https)
      } catch { /* http ما رد ← نجرّب https */ }
    }
    this.scheme = 'http';
    return false;
  }

  async identify(): Promise<ModelProfile | null> {
    // الموديل من DEVICE_VERSION_INFO (بالجلسة) — id لكل موديل عشان كرت «أرسل ملفات راوترك» يطلع لكل موديل ZLT جديد
    // (كان «zlt» للكل: أول FULL من أي ZLT يخفي الكرت عن X300A وغيره)
    if (!this.info && this.sid) {
      try { const j = await this.read(ZCMD.DEVICE_VERSION_INFO); this.info = { model: str(j.module), fw: str(j.modversion), imei: str(j.imei) }; } catch {}
    }
    const m = (this.info?.model ?? '').replace(/^zlt[\s_-]*/i, '').trim();
    return {
      id: m ? 'zlt-' + m.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'zlt', label: m ? `ZLT ${m}` : 'ZLT', brand: 'zlt', tech: '5G',
      writeUnverified: true,
      note: 'راوتر ZLT. الدعم للحين: الدخول وقوة الإشارة والدمج ووضع الشبكة. صفحته ما فيها تثبيت ترددات ولا برج.',
    };
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    const user = (username || '').trim() || 'admin';
    const fp = bytesToHex(sha256(utf8ToBytes(`zlt:${user}:${password}`)));
    const key = 'zlt:' + host;
    if (!opts?.fresh && !opts?.lastTry && await isBadPassword(key, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل. عدّلها من إعدادات الراوتر.');
    }
    // جلسة شغالة؟ ما نصرف محاولة (الراوتر يقفل بعد ٣)
    if (!opts?.fresh && this.sid) {
      try { const r = await this.cmd(ZCMD.SYS_INFO_NETWORK); if (r.j && !isNoAuth(r.text, r.j)) { this.creds = { user, password }; return; } } catch {}
    }

    this.sid = '';
    const t = await this.cmd(ZCMD.GET_NEXT_LOGIN_TIME, 'GET', {}, '', 10000)
      .catch((e: any) => { throw new Error(`الراوتر ما رد (http.cgi) — ${String(e?.message ?? e).slice(0, 60)}`); });
    const token = String(t.j?.token ?? '');
    diag(`[zlt] next_login_time → ${t.status} · token ${token ? token.length + ' خانة' : '✗'} · netx_login_time=${t.j?.netx_login_time ?? '—'}`);
    if (!token) throw new Error('صفحة الدخول في راوترك ما أعطت الرمز — اضغط «أرسل الخطأ للمطوّر» عشان نشوف ردها');

    // مثل الصفحة: رقم عشوائي ٦٤ hex (Md5(random)+Md5(random)) — الراوتر يرجّع الجلسة الحقيقية
    const tmpSid = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    let r: { status: number; text: string; j: any };
    try {
      r = await this.cmd(ZCMD.LOGIN, 'POST', { username: user, passwd: zltPass(token, password), isAutoUpgrade: '0' }, tmpSid, 15000);
    } catch (e: any) {
      throw new Error(`الراوتر ما رد على الدخول — ${String(e?.message ?? e).slice(0, 60)}`);
    }
    const keys = r.j && typeof r.j === 'object' ? Object.keys(r.j).slice(0, 10).join(',') : '—';
    diag(`[zlt] login (${user}, طول الكلمة ${password.length}) → ${r.status} · مفاتيح الرد: ${keys} · login_fail=${r.j?.login_fail ?? '—'} · login_times=${r.j?.login_times ?? '—'}`);
    if (r.j?.login_fail === 'fail') {
      await markBadPassword(key, fp);
      throw new Error(loginFailMsg(r.j?.login_times));
    }
    const sid = str(r.j?.sessionId);
    if (!sid) throw new Error('الراوتر ما رجّع جلسة بعد الدخول — اضغط «أرسل الخطأ للمطوّر» عشان نصلحها');
    this.sid = sid;
    // نتأكد: قراءة بالجلسة ما ترجع NO_AUTH
    let ok = false;
    try { const c = await this.cmd(ZCMD.SYS_INFO_NETWORK); ok = !!c.j && !isNoAuth(c.text, c.j); } catch {}
    diag(`[zlt] بعد الدخول: SYS_INFO_NETWORK ${ok ? '✓' : '✗'}`);
    if (!ok) {
      this.sid = '';
      throw new Error('الراوتر قبل الكلمة بس رفض القراءة — اضغط «أرسل الخطأ للمطوّر» عشان نصلحها');
    }
    await markBadPassword(key, null);
    this.creds = { user, password };
  }

  async logout(): Promise<void> { /* ما نرسل خروج — الجلسة تنتهي لحالها */ }

  /** أمر قراءة بجلسة — لو NO_AUTH ندخل مرة وحدة كل دقيقتين بالكثير */
  private async read(cmd: number): Promise<any> {
    let r = await this.cmd(cmd);
    if (isNoAuth(r.text, r.j) && this.creds && Date.now() - this.reloginAt > 120_000) {
      this.reloginAt = Date.now();
      diag('[zlt] الجلسة انتهت — دخول جديد');
      try { await this.login(this.host, this.creds.user, this.creds.password, { fresh: true }); r = await this.cmd(cmd); }
      catch (e: any) { diag(`[zlt] إعادة الدخول ✗ ${String(e?.message ?? e).slice(0, 80)}`); }
    }
    if (!r.j || isNoAuth(r.text, r.j)) throw new Error('الراوتر ما رد على القراءة');
    return r.j;
  }

  async isConnected(): Promise<boolean> {
    try { await this.read(ZCMD.SYS_INFO_NETWORK); return true; } catch { return false; }
  }

  async getSignal(): Promise<Signal> {
    const j = await this.read(ZCMD.SYS_INFO_NETWORK);
    // مرة وحدة: كل الحقول بقيمها (ما فيها أسرار) — نعرف منها صيغة التردد والخلية عند كل موديل
    if (!this.loggedKeys) {
      this.loggedKeys = true;
      diag(`[zlt] SYS_INFO_NETWORK: ${Object.entries(j).filter(([k]) => !/imei|imsi|iccid|mac|ssid|pass|key/i.test(k)).map(([k, v]) => `${k}=${String(v).slice(0, 20)}`).join(' · ').slice(0, 1200)}`);
    }
    this.lastRaw = j;
    return signalFrom(j);
  }
  private lastRaw: any = null;

  async getNetworkInfo(): Promise<NetworkInfo> {
    const j = await this.read(ZCMD.SYS_INFO_NETWORK);
    const mode = str(j.network_type_str);
    return { operator: str(j.network_operator), connected: !!mode && !/no ?service|limited/i.test(mode), mode, supports5g: undefined };
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    return buildSnapshot(sig, [], caCellsFrom(this.lastRaw, sig), { driverId: this.id, driverName: this.name });
  }

  async getCells(): Promise<CellTower[]> {
    const sig = await this.getSignal();
    return caCellsFrom(this.lastRaw, sig);
  }

  async getDeviceDetails(): Promise<DeviceDetails> {
    if (!this.info) {
      try {
        const j = await this.read(ZCMD.DEVICE_VERSION_INFO);
        this.info = { model: str(j.module), fw: str(j.modversion), imei: str(j.imei) };
      } catch {}
    }
    let op: string | undefined;
    try { op = str((await this.read(ZCMD.SYS_INFO_NETWORK)).network_operator); } catch {}
    const mm = (this.info?.model ?? '').replace(/^zlt[\s_-]*/i, '').trim();
    return { model: mm ? `ZLT ${mm}` : this.name, imei: this.info?.imei, operator: op, software: `${this.info?.fw ?? 'war'}|zlt-pages-1` };
  }

  /* ═══ وضع الشبكة (NETWORKSET_MODE_MT2731 = 256) — نفس صفحة networkSet.html ═══ */
  async getBandConfig(): Promise<BandConfig> {
    const j = await this.read(ZCMD.NETWORKSET_MODE_MT2731);
    const modes = zltModes(j.display_mode);
    return {
      supported: [], locked: [], nrSupported: [], nrLocked: [], nrLockable: false,
      mode: zltModeCode(modes, j.networkMode), modes: modes.map(m => ({ value: m.code, label: m.label })),
    };
  }
  async setBand(): Promise<void> {
    throw noChange('راوتر ZLT ما يسمح بتثبيت الترددات — صفحته نفسها ما فيها هالخيار. تقدر تغيّر «وضع الشبكة» (4G فقط، 5G SA فقط …). ما غيّرنا شي.');
  }
  async setNetworkMode(code: string): Promise<void> {
    const cur = await this.read(ZCMD.NETWORKSET_MODE_MT2731);
    const modes = zltModes(cur.display_mode);
    const m = modes.find(x => x.code === code) ?? modes.find(x => 'zlt:' + x.value === code);
    if (!m) throw noChange('هالوضع مو موجود في قائمة راوترك — ما غيّرنا شي.');
    if ((str(cur.networkMode) ?? '1C').toUpperCase() === m.value) return;
    const r = await this.cmd(ZCMD.NETWORKSET_MODE_MT2731, 'POST', { networkMode: m.value });
    diag(`[zlt] networkMode ${m.value} → message=${r.j?.message ?? '—'}`);
    if (isNoAuth(r.text, r.j)) throw new Error('الجلسة انتهت — جرّب مرة ثانية');
    if (String(r.j?.message ?? '') !== '0') throw new Error(`الراوتر رفض تغيير وضع الشبكة${r.j?.message ? ` (${r.j.message})` : ''}`);
    await new Promise(res => setTimeout(res, 2500));
    let after = '';
    try { after = (str((await this.read(ZCMD.NETWORKSET_MODE_MT2731)).networkMode) ?? '').toUpperCase(); } catch {}
    if (after && after !== m.value) throw new Error('الراوتر قبل أمر وضع الشبكة بس ما تغيّر');
  }

  /** الجامع (FULL/AUTH): صفحة ثابتة — GET بس، والخطرة ما تنفتح */
  async fetchAuthPage(path: string): Promise<{ ok: boolean; status: number; text: string; type: string }> {
    if (ZLT_DANGER.test(path)) return { ok: false, status: 0, text: '', type: '' };
    const r = await http(this.base() + path, { method: 'GET' }, 10000).then(async x => ({ status: x.status, text: await x.text() })).catch(() => ({ status: 0, text: '' }));
    const type = /\.js(\?|$)/i.test(path) ? 'application/javascript' : /\.css(\?|$)/i.test(path) ? 'text/css' : 'text/html';
    return { ok: r.status >= 200 && r.status < 400, status: r.status, text: r.text, type };
  }

  /** صفحات الترددات والبرج ووضع الشبكة (من MenuItem في main.js) — نحتاج كودها قبل أي كتابة */
  afterLoginPages(): string[] {
    const pages = ['html/config/lteLockFrequencyConfig', 'html/config/lteLockFrequencyConfigZTE', 'html/config/lteLockFrequencyConfigP500',
      'html/isp/lockCell', 'html/advance/networkSetIndex', 'html/info/sysInfo', 'html/dashboard/dashboardIndex', 'html/config/apnConfigIndex',
      'html/sms/smsInbox', 'html/info/deviceInfo', 'html/manage/sysAt'];
    const js = ['js/config/lteLockFrequencyConfig', 'js/config/lteLockFrequencyConfigZTE', 'js/isp/lockCell', 'js/advance/networkSetIndex',
      'js/info/sysInfo', 'js/dashboard/dashboardIndex', 'js/info/deviceInfo', 'js/sms/smsInbox', 'js/main', 'js/index'];
    return [...pages.map(p => `/${p}.html`), ...js.map(p => `/${p}.js`)].filter(p => !ZLT_DANGER.test(p));
  }
}

