/**
 * TP-Link 4G/5G (نسخة «GDPR» المشفّرة — Archer NX200 v2 وأمثاله). من ملفات صفحة الراوتر نفسه (١٥ نوفمبر ٢٠٢٦، SSID B116).
 * المرحلة ١ (FULL ١٥ نوفمبر ٤:١٦ م — الدخول اشتغل عند العضو): الإشارة 4G/5G والدمج والأبراج من gl DEV2_LTE_SERVING_CELL_INFO،
 *   ومعلومات الجهاز والشريحة — قراءة بس. بدون أي أمر كتابة.
 * المرحلة ٢: الترددات (DEV2_LTE_BAND_SEARCH في advanceLte.htm) · وضع الشبكة (DEV2_LTE_WAN_CFG.networkPreferredModeSelected) · تثبيت البرج.
 *   ⚠️ الصفحة تقفل الحفظ لحساب «User» لين unlocked — نتأكد قبل أي كتابة.
 *
 * الدخول من index.html (https) + tpEncrypt.js + gdprProxy.js:
 *   ١. POST /cgi/getGDPRParm ← var nn/ee/seq (مفتاح RSA-512 عام)
 *   ٢. المستخدم = adminType في الصفحة ('admin' أو 'user') — الصفحة ما فيها خانة اسم
 *   ٣. hash = md5(user+pwd) · مفتاح AES عشوائي · POST /cgi_gdpr?9 «sign=…\r\ndata=…» لـ
 *      {"data":{"UserName":b64(user),"Passwd":b64(pwd),"Action":"1",stack,pstack},"operation":"cgi","oid":"/cgi/login"}
 *   ٤. الرد مشفّر ← «$.ret=0;» نجاح · 71233 الكلمة غلط. الجلسة كوكي.
 *   ٥. باقي الأوامر JSON بنفس التشفير (توقيع بدون key/iv) + رأس TokenID (من الصفحة الرئيسية بعد الدخول).
 */
import { RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, DeviceDetails, Carrier, BandConfig, ActiveLock } from '../types';
import { noChange } from '../noChange';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import type { ModelProfile } from '../models';
import { scrubLive } from '../../services/routerDump';
import { TpState, tpGenKeys, tpHash, tpBody, tpAesDecrypt, tpParm, tpJson, tpB64 } from './crypto';
import { tpIsWelcome, tpIsLoginPage, tpPageVars, tpLoginUser, tpBusy, tpRet, tpToken, TP_ERR_PWD, TP_READ_OIDS, TpCell, tpCells, tpSignal, tpTowers, tpCarriers, TpBands, tpBands, tpLocked, tpBandPlan, tpModeLabel, tpModeHas } from './parse';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const OK_STACK = '0,0,0,0,0,0';
/** stack واجهة الشريحة (advanceLte.htm: lteStack) */
const LTE_STACK = '1,0,0,0,0,0';
/** آخر بروتوكول اشتغل لكل عنوان (بالذاكرة) */
const PROTO = new Map<string, 'http' | 'https'>();
/** نوع الحساب (admin/user) من صفحة الدخول لكل عنوان */
const ADMIN = new Map<string, string>();

export class TplinkDriver implements RouterDriver {
  readonly id = 'tplink-gdpr';
  name = 'TP-Link';
  readonly capabilities: Capability[] = ['signal', 'cells', 'bandLock'];

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

  /** نختار http/https: صفحة http «ترحيب» ← https. آخر اختيار ناجح ينحفظ لكل عنوان (الجلسة الجاية تبدأ فيه) */
  private async pickProto(): Promise<string> {
    const known = PROTO.get(this.host);
    if (known) {
      this.proto = known;
      try { const t = (await this.raw('/', {}, 5000)).text; if (t && !tpIsWelcome(t)) return t; } catch {}
    }
    this.proto = 'http';
    let t = '';
    try { t = (await this.raw('/', {}, 4000)).text; } catch {}
    if (!t || tpIsWelcome(t)) {
      this.proto = 'https';
      try { t = (await this.raw('/', {}, 5000)).text; } catch { if (!t) throw new Error('الراوتر ما رد'); }
    }
    return t;
  }

  /**
   * المفتاح العام — نجرّب البروتوكول الحالي وبعده الثاني.
   * تقرير حسن ١٥ نوفمبر ٣:٥٧: انضاف وبعدها «getGDPRParm» فشل: بعد الدخول http «/» ما يرجّع صفحة الترحيب
   * (يحوّل لـ https والجرة تتبعه) فبقينا على http، و POST http://…/cgi/getGDPRParm يرجّع صفحة الترحيب.
   */
  private async parm(): Promise<{ nn: string; ee: string; seq: number } | null> {
    const order: ('http' | 'https')[] = this.proto === 'https' ? ['https', 'http'] : ['http', 'https'];
    // فيرموير مختلف يجيب المفتاح من مسار مختلف:
    //   • getGDPRParm — نسخة العضو (١٥ نوفمبر)
    //   • getParm — فيرموير NX200 EU/2.20 (حسن ١٦ نوفمبر): getGDPRParm يرد 406، وصفحته تستخدم /cgi/getParm
    // الاثنين يرجّعون نفس الصيغة (var nn/ee/seq) — tpParm يشترط الثلاثة فما نمشي بمفتاح ناقص.
    const endpoints = ['/cgi/getGDPRParm', '/cgi/getParm'];
    for (const pr of order) {
      this.proto = pr;
      for (const ep of endpoints) {
        try {
          const r = await this.raw(ep, { method: 'POST' }, 6000);
          const p = tpParm(r.text);
          diag(`[tplink] ${pr} ${ep.slice(5)} → ${r.status} · ${r.text.length}B · ${p ? '✓' : r.text.replace(/\s+/g, ' ').slice(0, 60)}`);
          if (p) { PROTO.set(this.host, pr); return p; }
        } catch (e: any) { diag(`[tplink] ${pr} ${ep.slice(5)} ✗ ${String(e?.message ?? e).slice(0, 60)}`); }
      }
    }
    return null;
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
      return !!(await this.parm());
    } catch { return false; }
  }

  private setModel(m: string) { this.model = m; this.name = /tp-?link/i.test(m) ? m : `TP-Link ${m}`; }

  async identify(): Promise<ModelProfile | null> {
    const key = this.model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      id: 'tplink' + (key ? '-' + key : ''), label: this.name, brand: 'tplink', tech: /\b5G\b|NX\d/i.test(this.model) ? '5G' : '4G',
      nrLock: true,
      note: 'TP-Link — الإشارة 4G/5G والدمج والأبراج، وتثبيت الترددات ووضع الشبكة (من صفحة الراوتر — كل تغيير نتأكد منه بالقراءة). تثبيت البرج لسا ما انضاف.',
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
    const parm = await this.parm();
    // نوع الحساب من صفحة الدخول — لو الصفحة الحين الرئيسية (جلسة قديمة) ناخذ آخر نوع شفناه لهالعنوان
    let adminType = v.adminType;
    if (!adminType) { try { adminType = tpPageVars((await this.raw('/', {}, 6000)).text).adminType; } catch {} }
    adminType = adminType || ADMIN.get(this.host);
    if (adminType) ADMIN.set(this.host, adminType);
    const user = tpLoginUser(adminType, username);
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
  private async call(op: 'go' | 'gl' | 'so', oid: string, stack = OK_STACK, again = true, data: Record<string, unknown> = {}): Promise<{ text: string; json: any }> {
    if (!this.st) {
      if (!this.creds) throw new Error('ما دخلنا الراوتر');
      await this.login(this.host, this.creds.user, this.creds.password);
    }
    const st = this.st!;
    const body = tpBody(tpJson(op, oid, { ...data, stack, pstack: OK_STACK }), st, false);
    const r = await this.raw('/cgi_gdpr?9', { method: 'POST', headers: { 'Content-Type': 'text/plain', ...(this.token ? { TokenID: this.token } : {}) }, body }, 10000);
    let text = '';
    try { text = tpAesDecrypt(r.text, st.keys); } catch {}
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    // الجلسة انتهت (الراوتر يرد صفحة/فاضي/403) ← دخول جديد مرة وحدة
    if (!json && again && this.creds && (r.status === 403 || r.status === 401 || !text)) {
      diag(`[tplink] ${op} ${oid} → ${r.status} بدون رد مفهوم — دخول جديد`);
      this.st = null;
      return this.call(op, oid, stack, false, data);
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

  // ═══ الإشارة (FULL ١٥ نوفمبر: gl DEV2_LTE_SERVING_CELL_INFO + LINK_CFG — نفس frame/top.htm) ═══
  private async list(oid: string): Promise<any[]> {
    const { json } = await this.call('gl', oid, OK_STACK);
    if (json?.success && Array.isArray(json.data)) return json.data;
    throw new Error(`الراوتر ما رجّع ${oid}${json?.errorcode ? ` (${json.errorcode})` : ''}`);
  }
  private async read(): Promise<{ cells: TpCell[]; link: Record<string, unknown> | null }> {
    const [list, link] = await Promise.all([this.list('DEV2_LTE_SERVING_CELL_INFO'), this.first('DEV2_LTE_LINK_CFG', [LTE_STACK]).catch(() => null)]);
    return { cells: tpCells(list), link };
  }
  async getSignal(): Promise<Signal> { const { cells, link } = await this.read(); return tpSignal(cells, link); }
  async getCells(): Promise<CellTower[]> { return tpTowers((await this.read()).cells); }
  async getCarriers(): Promise<Carrier[]> { return tpCarriers((await this.read()).cells); }
  async getSnapshot(): Promise<SignalSnapshot> {
    const { cells, link } = await this.read();
    return buildSnapshot(tpSignal(cells, link), tpCarriers(cells), tpTowers(cells), { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const [{ cells, link }, prof] = await Promise.all([this.read(), this.first('DEV2_LTE_PROF_STAT', [LTE_STACK]).catch(() => null)]);
    const s = tpSignal(cells, link);
    return { connected: s.rsrp !== undefined || s.nrRsrp !== undefined, mode: s.network, operator: prof?.spn ? String(prof.spn) : undefined, supports5g: /NX\d|5G/i.test(this.model) || undefined };
  }
  async isConnected(): Promise<boolean> {
    try { const s = await this.getSignal(); return s.rsrp !== undefined || s.nrRsrp !== undefined; } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const [d, link, prof] = await Promise.all([
      this.first('DEV2_DEV_INFO', [OK_STACK]), this.first('DEV2_LTE_LINK_CFG', [LTE_STACK]).catch(() => null), this.first('DEV2_LTE_PROF_STAT', [LTE_STACK]).catch(() => null),
    ]);
    const g = (o: Record<string, unknown> | null, k: string) => { const v = o?.[k]; return v === undefined || v === null || v === '' ? undefined : String(v); };
    if (g(d, 'modelName')) this.setModel(g(d, 'modelName')!);
    const sim = g(link, 'simStatus');
    return {
      model: g(d, 'X_TP_DeviceModel') ?? g(d, 'modelName') ?? (this.model || 'TP-Link'), software: g(d, 'softwareVersion'), hardware: g(d, 'hardwareVersion'),
      wanIp: g(link, 'ipv4'), dns: g(link, 'dns1v4'), operator: g(prof, 'spn') ?? g(prof, 'ispName'),
      simStatus: sim === '3' ? 'جاهزة' : sim,
    };
  }

  // ═══ الترددات ووضع الشبكة (advanceLte.htm — نفس حفظ الصفحة، وبعده نقرأ ونتأكد) ═══
  private async bands(): Promise<TpBands> {
    const [bs, wan] = await Promise.all([this.first('DEV2_LTE_BAND_SEARCH', [LTE_STACK]), this.first('DEV2_LTE_WAN_CFG', [LTE_STACK])]);
    if (!bs || !wan) throw new Error('ما قدرنا نقرأ إعداد الترددات من الراوتر');
    return tpBands(bs, wan);
  }
  /** set ("so") — الراوتر يرد {success, errorcode} */
  private async set(oid: string, data: Record<string, unknown>): Promise<void> {
    const { json, text } = await this.call('so', oid, LTE_STACK, true, data);
    diag(`[tplink] so ${oid} ${JSON.stringify(data)} ← ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
    if (!json?.success) {
      const code = json?.errorcode;
      throw new Error(code ? `الراوتر رفض التغيير (رمز ${code})${/^(9|7)\d{3,4}$/.test(String(code)) ? ' — يمكن حساب «user» ما عنده صلاحية' : ''}` : 'الراوتر ما رد على التغيير');
    }
  }
  private async verify(check: (b: TpBands) => boolean, what: string): Promise<void> {
    let last: TpBands | null = null;
    for (let i = 0; i < 4; i++) {
      if (i) await sleep(1500);
      try { last = await this.bands(); if (check(last)) return; } catch {}
    }
    throw new Error(`الراوتر قبل الأمر بس ${what} ما تغيّر${last ? ` (الحين: ${last.manual ? last.raw || 'يدوي' : 'تلقائي'} · ${last.mode})` : ''}`);
  }

  async getBandConfig(): Promise<BandConfig> {
    const b = await this.bands();
    const lk = tpLocked(b);
    const has = tpModeHas(b.mode);
    return {
      supported: b.supLte, nrSupported: has.nr ? b.supNr : [],
      locked: lk.lte, nrLocked: lk.nr,
      mode: b.mode, modes: b.modes.map(m => ({ value: m, label: tpModeLabel(m) })),
      nrLockable: has.nr,
    };
  }
  async getActiveLock(): Promise<ActiveLock | null> {
    const lk = tpLocked(await this.bands());
    return lk.lte.length || lk.nr.length ? { bands: lk.lte, nrBands: lk.nr } : null;
  }

  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const b = await this.bands();
    const cur = tpLocked(b);
    const lte = bands === 'keep' ? cur.lte : bands;
    const nr = nrBands === undefined ? cur.nr : nrBands;
    const plan = tpBandPlan(b, lte, nr);
    if ('error' in plan) throw noChange(plan.error);
    const same = plan.mode === '1' ? !b.manual : b.manual && plan.band.split(';').sort().join(';') === [...b.lte.map(n => 'B' + n), ...b.nr.map(n => 'N' + n)].sort().join(';');
    if (same) return;
    await this.set('DEV2_LTE_BAND_SEARCH', plan.mode === '1' ? { selectedMode: '1' } : { selectedMode: '2', selectedBand: plan.band });
    const want = plan.band.split(';').filter(Boolean).sort().join(';');
    await this.verify(n => plan.mode === '1' ? !n.manual : n.manual && [...n.lte.map(x => 'B' + x), ...n.nr.map(x => 'N' + x)].sort().join(';') === want, 'الترددات');
  }

  async setNetworkMode(mode: string): Promise<void> {
    const b = await this.bands();
    if (!b.modes.includes(mode)) throw noChange(`راوترك ما فيه وضع «${mode}» — ما غيّرنا شي.`);
    if (b.mode === mode) return;
    // نفس فحص الصفحة: الترددات اليدوية لازم يكون فيها تقنية الوضع الجديد
    if (b.manual && ((mode === '4G Only' && !b.lte.length) || (mode === '5G Only' && !b.nr.length))) {
      throw noChange(`الترددات المثبّتة ما فيها ${mode === '4G Only' ? '4G' : '5G'} — فك تثبيت الترددات أول. ما غيّرنا شي.`);
    }
    await this.set('DEV2_LTE_WAN_CFG', { networkPreferredModeSelected: mode });
    await this.verify(n => n.mode === mode, 'وضع الشبكة');
    // ترددات يدوية بدون أي 5G والوضع الجديد فيه 5G (عند العضو: «B1;B3» على «4G Only») ← 5G بيبقى مطفي فعلياً.
    // نفتح ترددات 5G كلها (تلقائي) ونخلي تثبيت 4G مثل ما هو.
    const nb = await this.bands();
    if (nb.manual && tpModeHas(mode).nr && !nb.nr.length) await this.setBand(tpLocked(nb).lte, []);
  }

  // لقطة + إرجاع متحقق منه
  async readLockState(): Promise<LockSnapshot> {
    const b = await this.bands();
    const lk = tpLocked(b);
    const summary = `4G: ${lk.lte.map(x => 'B' + x).join('+') || 'تلقائي'} · 5G: ${lk.nr.map(x => 'n' + x).join('+') || 'تلقائي'} · ${tpModeLabel(b.mode)}`;
    return { driver: this.id, at: Date.now(), summary, data: { manual: b.manual, raw: b.raw, mode: b.mode } };
  }
  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    const d = snap.data as { manual: boolean; raw: string; mode: string };
    const miss: string[] = [];
    let b = await this.bands();
    if (d.mode && b.mode !== d.mode) {
      try { await this.set('DEV2_LTE_WAN_CFG', { networkPreferredModeSelected: d.mode }); } catch { miss.push('وضع الشبكة'); }
    }
    b = await this.bands();
    const wantRaw = d.raw.split(';').filter(Boolean).sort().join(';');
    const ok = (n: TpBands) => d.manual ? n.manual && n.raw.split(';').filter(Boolean).sort().join(';') === wantRaw : !n.manual;
    if (!ok(b)) {
      try {
        await this.set('DEV2_LTE_BAND_SEARCH', d.manual ? { selectedMode: '2', selectedBand: d.raw } : { selectedMode: '1' });
        await this.verify(ok, 'الترددات');
      } catch { miss.push('الترددات'); }
    }
    try { if (d.mode && (await this.bands()).mode !== d.mode) miss.push('وضع الشبكة'); } catch {}
    if (miss.length) throw restoreMismatch([...new Set(miss)]);
  }
  async restoreAll(): Promise<void> {
    try { await this.setBand([], []); } catch {}
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
