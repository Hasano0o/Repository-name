/**
 * TP-Link 4G/5G (نسخة «GDPR» المشفّرة — Archer NX200 v2 وأمثاله). من ملفات صفحة الراوتر نفسه (١٥ نوفمبر ٢٠٢٦، SSID B116).
 * المرحلة ١: التعرّف + الدخول + قراءة أولية + كرت FULL (يسحب ردود أوامر القراءة عشان نعرف أسماء الخانات) — بدون أي أمر كتابة.
 * المرحلة ٢ (بعد FULL): الإشارة كاملة · الترددات · تثبيت البرج (DEV2_LTE_4G/5G_CELL_LOCK موجودة في صفحته) · الرسائل.
 *
 * الدخول من index.html (https) + tpEncrypt.js + gdprProxy.js:
 *   ١. POST /cgi/getGDPRParm ← var nn/ee/seq (مفتاح RSA-512 عام)
 *   ٢. المستخدم = adminType في الصفحة ('admin' أو 'user') — الصفحة ما فيها خانة اسم
 *   ٣. hash = md5(user+pwd) · مفتاح AES عشوائي · POST /cgi_gdpr?9 «sign=…\r\ndata=…» لـ
 *      {"data":{"UserName":b64(user),"Passwd":b64(pwd),"Action":"1",stack,pstack},"operation":"cgi","oid":"/cgi/login"}
 *   ٤. الرد مشفّر ← «$.ret=0;» نجاح · 71233 الكلمة غلط. الجلسة كوكي.
 *   ٥. باقي الأوامر JSON بنفس التشفير (توقيع بدون key/iv) + رأس TokenID (من الصفحة الرئيسية بعد الدخول).
 */
import { RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, DeviceDetails } from '../types';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import type { ModelProfile } from '../models';
import { scrubLive } from '../../services/routerDump';
import { TpState, tpGenKeys, tpHash, tpBody, tpAesDecrypt, tpParm, tpJson, tpB64 } from './crypto';
import { tpIsWelcome, tpIsLoginPage, tpPageVars, tpLoginUser, tpBusy, tpRet, tpToken, TP_ERR_PWD, tpSignalGuess, TP_READ_OIDS } from './parse';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const OK_STACK = '0,0,0,0,0,0';

export class TplinkDriver implements RouterDriver {
  readonly id = 'tplink-gdpr';
  name = 'TP-Link';
  readonly capabilities: Capability[] = ['signal'];

  private host = '';
  /** http أو https — NX200: http «ترحيب» بس والواجهة على https */
  private proto: 'http' | 'https' = 'http';
  private model = '';
  private st: TpState | null = null;
  private token = '';
  private creds: { user: string; password: string } | null = null;

  private base(h = this.host) { return `${this.proto}://` + h.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private hdr(extra: Record<string, string> = {}) { return { Referer: this.base() + '/', ...extra }; }

  private async raw(path: string, init: RequestInit = {}, timeout = 8000) {
    const r = await http(this.base() + path, { ...init, headers: { ...this.hdr(), ...(init.headers as Record<string, string> | undefined) } }, timeout);
    return { status: r.status, text: await r.text() };
  }

  /** نختار http/https: صفحة http «ترحيب» ← https */
  private async pickProto(): Promise<string> {
    this.proto = 'http';
    let t = '';
    try { t = (await this.raw('/', {}, 4000)).text; } catch {}
    if (!t || tpIsWelcome(t)) {
      this.proto = 'https';
      try { t = (await this.raw('/', {}, 5000)).text; } catch { if (!t) throw new Error('الراوتر ما رد'); }
    }
    return t;
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    this.host = host;
    try {
      const t = await this.pickProto();
      if (!tpIsLoginPage(t) && !tpIsWelcome(t)) return false;
      const v = tpPageVars(t);
      if (v.model) this.setModel(v.model);
      // تأكيد: المفتاح العام يرد بدون دخول (قراءة)
      const p = tpParm((await this.raw('/cgi/getGDPRParm', { method: 'POST' }, 5000)).text);
      return !!p;
    } catch { return false; }
  }

  private setModel(m: string) { this.model = m; this.name = /tp-?link/i.test(m) ? m : `TP-Link ${m}`; }

  async identify(): Promise<ModelProfile | null> {
    const key = this.model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      id: 'tplink' + (key ? '-' + key : ''), label: this.name, brand: 'tplink', tech: /\b5G\b|NX\d/i.test(this.model) ? '5G' : '4G',
      writeUnverified: true,
      note: 'TP-Link — الدعم للحين: الدخول وقراءة أولية للإشارة. أرسل ملفات راوترك (الكرت تحت) عشان نضيف الترددات وتثبيت البرج.',
    };
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    this.st = null; this.token = '';
    const page = await this.pickProto().catch(() => '');
    const v = tpPageVars(page);
    if (v.model) this.setModel(v.model);
    if (v.forbidForever) throw new Error('الراوتر قافل الدخول نهائياً بعد محاولات غلط — يحتاج إعادة ضبط المصنع');
    if (v.forbidFlag) throw new Error(`الراوتر قافل الدخول بعد محاولات غلط — انتظر${v.forbidTime ? ` ${v.forbidTime} ثانية` : ' شوي'} وجرّب (محاولات كثيرة)`);
    const user = tpLoginUser(v.adminType, username);
    const parm = tpParm((await this.raw('/cgi/getGDPRParm', { method: 'POST' }, 8000)).text);
    if (!parm) throw new Error('صفحة الدخول في راوترك مختلفة عن اللي نعرفه (getGDPRParm) — اضغط «أرسل الخطأ للمطوّر»');
    // أحد داخل (المتصفح مثلاً) ومشغول ← الصفحة تنتظر شوي وبعدها تدخل على كل حال (نفس الطلب)
    try {
      const b = tpBusy((await this.raw('/cgi/getBusy', { method: 'POST' }, 5000)).text);
      if (b.logined) diag('[tplink] فيه أحد داخل — الدخول يطرده (نفس الصفحة)');
      for (let i = 0; i < 2 && b.busy; i++) { await sleep(1000); b.busy = tpBusy((await this.raw('/cgi/getBusy', { method: 'POST' }, 5000)).text).busy; }
    } catch {}
    const st: TpState = { keys: tpGenKeys(), hash: tpHash(user, password), seq: parm.seq, nn: parm.nn, ee: parm.ee };
    const body = tpBody(tpJson('cgi', '/cgi/login', { UserName: tpB64(user), Passwd: tpB64(password), Action: '1', stack: OK_STACK, pstack: OK_STACK }), st, true);
    const r = await this.raw('/cgi_gdpr?9', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body }, 15000);
    let plain = '';
    try { plain = tpAesDecrypt(r.text, st.keys); } catch {}
    const ret = tpRet(plain);
    diag(`[tplink] login (${user}) → ${r.status} · ${r.text.length}B · ret=${ret ?? '؟'} · ${plain ? plain.replace(/\s+/g, ' ').slice(0, 80) : 'ما انفك'}`);
    if (ret === TP_ERR_PWD) {
      throw new Error('كلمة المرور غلط — اكتب كلمة صفحة الإدارة (اللي تفتح فيها 192.168.1.1 بالمتصفح)، مو كلمة الواي فاي. انتبه: الراوتر يقفل بعد محاولات غلط');
    }
    if (ret !== 0) {
      if (r.status === 200 && !plain) throw new Error('الراوتر رد بشي ما قدرنا نفكه — اضغط «أرسل الخطأ للمطوّر»');
      throw new Error(`الراوتر رفض الدخول (رمز ${ret ?? r.status}) — اضغط «أرسل الخطأ للمطوّر»`);
    }
    this.st = st;
    this.creds = { user, password };
    // رمز TokenID من الصفحة الرئيسية (بالجلسة)
    try {
      const h = await this.raw('/', {}, 10000);
      this.token = tpToken(h.text) ?? '';
      diag(`[tplink] الرئيسية بعد الدخول → ${h.status} · ${h.text.length}B · token ${this.token ? '✓' : '✗'}`);
    } catch {}
  }

  async logout(): Promise<void> {
    // الخروج في صفحتهم $.act(ACT_CGI, "/cgi/logout") — ما شفناه بالشكل الجديد بدليل، فنخلي الجلسة تنتهي لحالها
    this.st = null;
  }

  /** أمر JSON مشفّر — قراءة بس في هالمرحلة (go / gl) */
  private async call(op: 'go' | 'gl', oid: string, stack = OK_STACK, again = true): Promise<{ text: string; json: any }> {
    if (!this.st) {
      if (!this.creds) throw new Error('ما دخلنا الراوتر');
      await this.login(this.host, this.creds.user, this.creds.password);
    }
    const st = this.st!;
    const body = tpBody(tpJson(op, oid, { stack, pstack: OK_STACK }), st, false);
    const r = await this.raw('/cgi_gdpr?9', { method: 'POST', headers: { 'Content-Type': 'text/plain', ...(this.token ? { TokenID: this.token } : {}) }, body }, 10000);
    let text = '';
    try { text = tpAesDecrypt(r.text, st.keys); } catch {}
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    // الجلسة انتهت (الراوتر يرد صفحة/فاضي/403) ← دخول جديد مرة وحدة
    if (!json && again && this.creds && (r.status === 403 || r.status === 401 || !text)) {
      diag(`[tplink] ${op} ${oid} → ${r.status} بدون رد مفهوم — دخول جديد`);
      this.st = null;
      return this.call(op, oid, stack, false);
    }
    return { text: text || `HTTP ${r.status} · ${r.text.slice(0, 200)}`, json };
  }

  /** أول stack يرجّع بيانات (success) */
  private async first(oid: string, stacks: string[]): Promise<Record<string, unknown> | null> {
    for (const s of stacks) {
      try {
        const { json } = await this.call('go', oid, s);
        if (json?.success && json.data && typeof json.data === 'object') return json.data;
      } catch {}
    }
    return null;
  }

  // ═══ الإشارة (أولية — أسماء الخانات تتأكد من FULL) ═══
  async getSignal(): Promise<Signal> {
    const objs: Record<string, unknown>[] = [];
    for (const o of ['DEV2_LTE_NET_STATUS', 'DEV2_LTE_SERVING_CELL_INFO']) {
      const d = await this.first(o, ['2,1,0,0,0,0', '1,0,0,0,0,0', OK_STACK]);
      if (d) objs.push(d);
    }
    const s = tpSignalGuess(objs);
    if (s.rsrp === undefined && s.nrRsrp === undefined) diag(`[tplink] ما لقينا خانات إشارة واضحة — مفاتيح: ${objs.map(o => Object.keys(o).join(',')).join(' | ').slice(0, 300)}`);
    return s;
  }
  async getCells(): Promise<CellTower[]> { return []; }
  async getSnapshot(): Promise<SignalSnapshot> {
    const s = await this.getSignal();
    return buildSnapshot(s, [], [], { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const s = await this.getSignal();
    return { connected: s.rsrp !== undefined || s.nrRsrp !== undefined, mode: s.network, supports5g: /NX\d|5G/i.test(this.model) || undefined };
  }
  async isConnected(): Promise<boolean> {
    try { const s = await this.getSignal(); return s.rsrp !== undefined || s.nrRsrp !== undefined; } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const d = await this.first('DEV2_DEV_INFO', [OK_STACK]);
    const g = (k: string) => { const v = d?.[k]; return v === undefined || v === null || v === '' ? undefined : String(v); };
    return { model: g('modelName') ?? (this.model || 'TP-Link'), software: g('softwareVersion'), hardware: g('hardwareVersion') };
  }

  // ═══ FULL: صفحات بعد الدخول + ردود أوامر القراءة (أسماء الخانات) ═══
  afterLoginPages(): string[] {
    const v: string[] = ['/'];
    for (const o of TP_READ_OIDS) for (const s of o.stacks) v.push(`/_bandly/oid/${o.op}/${o.oid}/${s.replace(/,/g, '-')}.json`);
    return v;
  }
  async fetchAuthPage(path: string): Promise<{ ok: boolean; status: number; text: string; type: string }> {
    const m = path.match(/^\/_bandly\/oid\/(go|gl)\/([A-Z0-9_]+)\/([\d-]+)\.json$/);
    if (m) {
      try {
        const { text } = await this.call(m[1] as 'go' | 'gl', m[2], m[3].replace(/-/g, ','));
        return { ok: true, status: 200, text: scrubLive(text), type: 'application/json' };
      } catch (e: any) {
        return { ok: true, status: 200, text: `خطأ: ${String(e?.message ?? e).slice(0, 120)}`, type: 'text/plain' };
      }
    }
    try {
      const r = await this.raw(path, this.token ? { headers: { TokenID: this.token } } : {}, 10000);
      const type = /\.js(\?|$)/i.test(path) ? 'application/javascript' : /\.css(\?|$)/i.test(path) ? 'text/css' : 'text/html';
      return { ok: r.status >= 200 && r.status < 400, status: r.status, text: r.text, type };
    } catch { return { ok: false, status: 0, text: '', type: '' }; }
  }
}
