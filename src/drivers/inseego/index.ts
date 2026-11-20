/**
 * Inseego MiFi — 8000 / 8800L (نفس جهاز Verizon «Jetpack») و M2000 (جيب 5G). العنوان 192.168.1.1.
 * المرحلة ١ (٧ نوفمبر ٢٠٢٦): التعرّف + الدخول + القراءة بس، وكرت FULL يطلع (مو verified) عشان نجيب صفحات ما بعد الدخول.
 *
 * من ملفات صفحة ٣ أعضاء (ليبيانا):
 *  • التعرّف: GET /srv/status ← JSON { statusData: { statusBar… } } بدون دخول (شريط الحالة في كل صفحة)
 *  • الدخول (فيرموير Inseego الأصلي — نفس اللي يسويه band_manager.html على الجهاز):
 *      GET /login/ ← secToken + gSecureToken ← POST /submitLogin/ shaPassword=sha1(الكلمة + secToken)&gSecureToken
 *      200/302 = تمام · 500 + {authError} = كلمة غلط · 429 = محاولات كثيرة
 *  • الإشارة بالأرقام: /cgi/signalstat.cgi — موجود بس لو الجهاز عليه تعديل «Band Manager».
 *    بدونه (الفيرموير الأصلي): صفحة /diagnostics/ بعد الدخول ← RSRP و SNR والتردد (١٦ نوفمبر — من AUTH عضو، ليبيانا).
 *    ما فيها RSRQ ولا رقم البرج ولا PCI.
 *
 * ⚠️ الكتابة (ترددات/برج/وضع) مقفولة: Verizon تقفلها في الفيرموير الأصلي، والموجود عند الأعضاء تعديلات خارجية
 *    («MONDO» على /cgi/mapi.cgi برمز من شاشة الجهاز · «Band Manager» على /cgi/bandset.cgi) — تنفتح ميزة ميزة بعد الدليل.
 */
import { RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, DeviceDetails, RouterExtras, Usage, Carrier, BandConfig, CellLockTarget, CellLockState } from '../types';
import { noChange } from '../noChange';
import { MondoClient, MondoSession, mondoForm, mondoSignal, mondoCarriers, mondoCells, mondoLock, mondoMessage, mondoRestored, isMondoCodeError, MONDO_BANDS, MONDO_MODES } from './mondo';
import { sha1 } from '@noble/hashes/legacy';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import type { ModelProfile } from '../models';
import {
  InseegoStatus, InseegoSignalStat, InseegoDiag, diagFrom, statusFrom, signalFrom, networkFrom, healthFrom, loginTokens, modelFromHtml, usageFrom,
} from './parse';

export const inseegoSha = (pw: string, secToken: string) => bytesToHex(sha1(utf8ToBytes(pw + secToken)));

/** جلسة MONDO لكل عنوان — تعيش بين نسخ الدرايفر (الجلسات تنشأ من جديد) */
const MONDO_SESS = new Map<string, MondoSession | null>();
/** آخر ترددات طبّقناها لكل عنوان — الأداة ما تعطي قراءة للاختيار الحالي */
const MONDO_BANDS_SET = new Map<string, number[]>();

export class InseegoDriver implements RouterDriver {
  readonly id = 'inseego';
  name = 'Inseego MiFi';
  readonly capabilities: Capability[] = ['signal', 'usage'];

  // ═══ أداة MONDO (لو الجهاز معدّل) — تنضاف بعد الدخول لو لقينا mondo-secure-client.js ═══
  private mondo: MondoClient | null = null;
  private mondoChecked = false;
  private mst: { at: number; v: any } | null = null;
  getCarriers?: () => Promise<Carrier[]>;
  getBandConfig?: () => Promise<BandConfig>;
  setBand?: (bands: number[] | 'keep', nrBands?: number[]) => Promise<void>;
  lockCell?: (t: CellLockTarget) => Promise<void>;
  unlockCell?: (tech?: 'LTE' | 'NR') => Promise<void>;
  getCellLock?: () => Promise<CellLockState | null>;
  setNetworkMode?: (mode: string) => Promise<void>;
  codePair?: RouterDriver['codePair'];

  private host = '';
  private model = '';
  /** null = ما جرّبنا · false = الجهاز ما فيه signalstat.cgi (فيرموير أصلي) */
  private hasStat: boolean | null = null;
  private logged = false;
  private password = '';
  /** آخر قراءة /diagnostics/ (الصفحة ~46KB والجهاز بطيء — ما نسحبها أكثر من مرة كل ٤ ثواني) */
  private dg: { at: number; v: InseegoDiag | null } | null = null;
  private dgBusy: Promise<InseegoDiag | null> | null = null;
  private reloginAt = 0;
  private reloginFailed = false;

  private base(host = this.host) { return 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  /**
   * طلب واحد بالمرة: سيرفر صفحة الـ MiFi يعلق مع الطلبات المتوازية (تقرير ٧ نوفمبر: GET / و /srv/status و
   * submitLogin كلها timeout لما تتداخل، وتمشي لما تجي ورا بعض). كل طلبات الدرايفر تمر من هنا.
   */
  private q: Promise<unknown> = Promise.resolve();
  private one<T>(f: () => Promise<T>): Promise<T> {
    const r = this.q.then(f, f);
    this.q = r.catch(() => {});
    return r;
  }
  private req(path: string, init: RequestInit = {}, timeout = 8000) {
    return this.one(async () => {
      const go = async () => { const r = await http(this.base() + path, init, timeout); return { status: r.status, text: await r.text() }; };
      if ((init.method ?? 'GET').toUpperCase() !== 'GET') return go();
      // الآيفون يعيد استخدام اتصال قديم والجهاز قفله ← «The request timed out / connection lost» بعد ~٨ث،
      // والطلب اللي بعده يمشي فوراً (ملف FULL ٧ نوفمبر: /srv/status يفشل ويرد ٢٠٠ ورا بعض). GET بس — مرة وحدة.
      try { return await go(); } catch (e) {
        diag(`[inseego] ${path.split('?')[0]} ✗ نعيد مرة: ${String((e as any)?.message ?? e).slice(0, 60)}`);
        return go();
      }
    });
  }

  private async json(path: string, timeout = 8000): Promise<any> {
    const r = await this.req(path, { method: 'GET', headers: { Accept: 'application/json, text/javascript, */*' } }, timeout);
    const t = r.text.trim();
    if (r.status !== 200) throw new Error(`${path}: HTTP ${r.status}`);
    try { return JSON.parse(t); } catch { throw new Error(/<html|<!doctype/i.test(t) ? `${path}: الراوتر رجّع صفحة بدل بيانات` : `${path}: رد غير متوقع`); }
  }

  private async status(): Promise<InseegoStatus | null> {
    return statusFrom(await this.json(`/srv/status?_=${Date.now()}`));
  }
  private async stat(): Promise<InseegoSignalStat | null> {
    if (this.hasStat === false) return null;
    try {
      const j = await this.json('/cgi/signalstat.cgi', 6000);
      const ok = !!j && typeof j === 'object' && 'rsrp' in j;
      if (this.hasStat === null) diag(`[inseego] signalstat: ${ok ? 'موجود (Band Manager)' : 'رد بدون rsrp'}`);
      this.hasStat = ok;
      return ok ? j : null;
    } catch (e) {
      if (this.hasStat === null) diag(`[inseego] signalstat: ما فيه (${String((e as any)?.message ?? e).slice(0, 60)})`);
      this.hasStat = false;
      return null;
    }
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    this.host = host;
    try {
      const st = statusFrom(await this.json(`/srv/status?_=${Date.now()}`, 4000));
      // الموديل من «/» (81KB وبطيئة) — في identify بعدين، مو هنا
      return !!st;
    } catch { return false; }
  }

  private async readModel() {
    if (this.model) return;
    try {
      const r = await this.req('/', {}, 15000);
      const m = modelFromHtml(r.text);
      if (m) this.model = m;
    } catch {}
    if (this.model) this.name = /inseego/i.test(this.model) ? this.model : `Inseego ${this.model}`;
  }

  async identify(): Promise<ModelProfile | null> {
    await this.readModel();
    const m = this.model;
    const key = m ? m.toLowerCase().replace(/^inseego\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
    const is5g = /M2000|M3000|5G/i.test(m);
    return {
      id: 'inseego' + (key ? '-' + key : ''), label: this.name, brand: 'inseego', tech: is5g ? '5G' : '4G',
      // الكتابة مقفولة لين الدليل (ملفات FULL + تجربة) — كرت FULL يطلع لأنه مو verified
      writeUnverified: true,
      note: 'جهاز Inseego (نفس Verizon Jetpack): القراءة بس للحين. أرسل ملفات راوترك من صفحة الراوتر عشان نفتح الباقي.',
    };
  }

  /** /login/ ← الرموز (طازجة لكل محاولة) */
  private async tokens() {
    let html = '';
    try {
      html = (await this.req('/login/', {}, 12000)).text;
    } catch (e) {
      throw new Error(`تعذر الاتصال بالراوتر (GET /login/) — ${(e as any)?.message ?? e}`);
    }
    const tok = loginTokens(html);
    if (!tok) {
      diag(`[inseego] /login/: ${html.length}B بدون secToken/gSecureToken`);
      throw new Error('صفحة الدخول في جهازك مختلفة عن اللي نعرفه — اضغط «أرسل الخطأ للمطوّر» عشان نضيفها');
    }
    return tok;
  }

  async login(host: string, _username: string, password: string): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    this.logged = false;
    this.password = password;
    let r: { status: number; text: string } | null = null;
    // الجهاز أحياناً يعلق على submitLogin (تقرير ٧ نوفمبر: timeout ٢٠–٣٠ث ثم يرد عادي) — مرة ثانية برموز جديدة.
    // انقطاع الشبكة مو محاولة غلط عند الجهاز، فما نخاطر بالقفل.
    for (let a = 0; a < 2 && !r; a++) {
      const tok = await this.tokens();
      const body = `shaPassword=${encodeURIComponent(inseegoSha(password, tok.secToken))}&gSecureToken=${encodeURIComponent(tok.gSecureToken)}`;
      try {
        r = await this.req('/submitLogin/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: this.base() + '/login/' },
          body,
        }, 25000);
      } catch (e) {
        diag(`[inseego] submitLogin ✗ محاولة ${a + 1}: ${String((e as any)?.message ?? e).slice(0, 80)}`);
        if (a === 1) throw new Error('الجهاز ما رد على الدخول (POST /submitLogin/) — قرّب من الجهاز وتأكد إن شاشته شغالة، وجرّب مرة ثانية');
      }
    }
    const t = r!.text;
    let authError = '', left: number | undefined;
    try {
      const j = JSON.parse(t);
      authError = String(j?.authError ?? '');
      const n = Number(j?.noOfRemainingLoginAttempts);
      if (Number.isFinite(n) && n >= 0) left = n;
    } catch {}
    // نص الرفض من الجهاز (بدون أي رمز) — يفرّق «كلمة غلط» عن «الرمز انتهى» وغيره
    const why = authError.replace(/<br\s*\/?>/gi, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
    diag(`[inseego] submitLogin → ${r!.status} · ${t.length}B${left !== undefined ? ` · باقي ${left} محاولات` : ''}${why ? ` · authError: «${why}»` : ''}${!why && r!.status !== 200 ? ` · ${t.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`);
    if (r!.status === 429 || left === 0 || /too many|locked/i.test(why)) throw new Error('الجهاز وقّف الدخول بعد محاولات كثيرة — انتظر شوي وجرّب');
    // صفحة الجهاز: 500 = «We don't recognize that password… admin password, not your Wi-Fi password» + noOfRemainingLoginAttempts
    if (r!.status === 500 || authError) {
      if (why && !/password|incorrect|invalid|recogni/i.test(why)) throw new Error(`الجهاز رفض الدخول: ${why}`);
      throw new Error('كلمة المرور غلط — اكتب «Admin Password» حقت الجهاز مو كلمة الواي فاي. تلقاها على شاشة الجهاز: Help ← MiFi Admin website'
        + (left !== undefined ? ` (باقي ${left} محاولات قبل ما يقفل)` : ''));
    }
    if (r!.status !== 200 && r!.status !== 302 && r!.status !== 303) throw new Error(`الدخول فشل (HTTP ${r!.status})`);
    // رجّع لنا فورم الدخول نفسه = ما دخلنا
    if (/name=["']gSecureToken["']/i.test(t) && /var\s+secToken/.test(t)) throw new Error('كلمة المرور غلط — الجهاز رجّع صفحة الدخول');
    this.logged = true;
    this.reloginFailed = false;
    this.dg = null;
    await this.readModel();
    await this.detectMondo();
  }

  /** الجهاز عليه أداة MONDO؟ (mondo-secure-client.js يرد وفيه mapi.cgi) — مرة وحدة لكل نسخة */
  private async detectMondo() {
    if (this.mondoChecked) return;
    this.mondoChecked = true;
    try {
      const r = await this.req('/assets/js/mondo-secure-client.js', {}, 8000);
      if (r.status !== 200 || !/mapi\.cgi/.test(r.text) || !/MondoAPI/.test(r.text)) return;
    } catch { return; }
    const host = this.host;
    this.mondo = new MondoClient(async form => {
      const r = await this.req('/cgi/mapi.cgi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json, */*', Referer: this.base() + '/celllock.html' },
        body: mondoForm(form),
      }, 20000);
      try { return JSON.parse(r.text); } catch { return { ok: false, e: 'bad_response', http: r.status }; }
    }, MONDO_SESS.get(host) ?? null, ss => MONDO_SESS.set(host, ss));
    diag(`[inseego] أداة MONDO موجودة — جلسة ${this.mondo.paired ? 'محفوظة' : 'ما فيه (تحتاج رمز الشاشة)'}`);
    this.attachMondo();
  }

  /** status من MONDO (كاش ٣ ثواني) — null لو ما فيه جلسة */
  private async mondoStatus(force = false): Promise<any | null> {
    if (!this.mondo) return null;
    if (!force && this.mst && Date.now() - this.mst.at < 3000) return this.mst.v;
    const r = await this.mondo.call('status', {});
    if (!r?.ok) { diag(`[inseego] MONDO status ✗ ${String(r?.e ?? r?.error ?? '').slice(0, 60)}`); return null; }
    if (!this.mst) diag(`[inseego] MONDO status: band ${r.current?.band ?? '—'} · ca ${r.current?.ca ?? '—'} · scells ${(r.ca_detail?.scells ?? []).length} · lock ${r.lock?.pci ?? '—'}/${r.lock?.earfcn ?? '—'} · mode ${r.radio_mode ?? '—'}`);
    this.mst = { at: Date.now(), v: r };
    return r;
  }

  /** أوامر التغيير: مهمة MONDO ← نتيجتها. فشل بدون تغيير (رفض/مشغول) = noChange · «restored» = رجع السابق */
  private async mondoJob(name: string, data: Record<string, unknown>, what: string): Promise<void> {
    if (!this.mondo) throw noChange('جهازك ما عليه أداة التثبيت');
    let r: any;
    try { r = await this.mondo.job(name, data, 150); }
    catch (e) { if (isMondoCodeError(e)) throw noChange((e as Error).message); throw e; }
    this.mst = null;
    diag(`[inseego] MONDO ${name} ${JSON.stringify(data)} → ok=${r?.ok} · ${String(r?.message ?? r?.e ?? '').slice(0, 80)}`);
    if (r?.ok === true || r?.ok === 1 || r?.ok === '1') return;
    const msg = `${what}: ${mondoMessage(r)}`;
    if (mondoRestored(r) || /Another_|request_rejected|bad_request|Unlock_cell_before/.test(String(r?.message ?? r?.e ?? ''))) throw noChange(msg);
    throw new Error(msg);
  }

  private attachMondo() {
    const host = this.host;
    this.codePair = {
      title: 'رمز MONDO',
      hint: 'جهازك عليه أداة MONDO للتثبيت. من شاشة الجهاز: القائمة ← MONDO ← رمز الويب، واكتب الرمز كما هو. الجلسة تبقى ١٥ دقيقة من آخر استخدام.',
      needed: async () => {
        if (!this.mondo) return false;
        if (this.mondo.paired) return false;
        try { return !(await this.mondo.resume()); } catch { return true; }
      },
      submit: async (code: string) => { await this.mondo!.pair(code); this.mst = null; await this.mondoStatus(true); },
    };
    this.getCarriers = async () => {
      const st = await this.mondoStatus().catch(() => null);
      return st ? mondoCarriers(st) : [];
    };
    this.getBandConfig = async () => {
      const st = await this.mondoStatus();
      if (!st) throw noChange('أدوات MONDO تحتاج رمز من شاشة الجهاز — اكتبه في صفحة الراوتر');
      const locked = MONDO_BANDS_SET.get(host) ?? MONDO_BANDS;
      return { supported: MONDO_BANDS, locked, nrSupported: [], nrLocked: [], mode: String(st.radio_mode ?? '0'), modes: MONDO_MODES };
    };
    this.setBand = async (bands: number[] | 'keep') => {
      if (bands === 'keep') return;
      const list = [...new Set(bands)].filter(b => MONDO_BANDS.includes(b)).sort((a, b) => a - b);
      if (!list.length) throw noChange('اختر تردد واحد على الأقل من ترددات جهازك');
      await this.mondoJob('band_apply', { b: list.join(',') }, 'تثبيت الترددات');
      MONDO_BANDS_SET.set(host, list.length === MONDO_BANDS.length ? MONDO_BANDS : list);
    };
    this.lockCell = async (t: CellLockTarget) => {
      if (t.tech !== 'LTE') throw noChange('جهازك 4G بس');
      if (!/^\d+$/.test(String(t.pci ?? ''))) throw noChange('رقم البرج (PCI) ناقص');
      let e = String(t.arfcn ?? '');
      if (!/^\d+$/.test(e)) {
        const st = await this.mondoStatus();
        if (st && String(st.current?.pci) === String(t.pci)) { await this.mondoJob('lock_current', {}, 'تثبيت البرج'); return; }
        throw noChange('رقم القناة (EARFCN) ناقص — اختار البرج من قائمة الأبراج');
      }
      await this.mondoJob('lock_manual', { p: t.pci, e }, 'تثبيت البرج');
    };
    this.unlockCell = async () => { await this.mondoJob('unlock', {}, 'فك تثبيت البرج'); };
    this.getCellLock = async () => { const st = await this.mondoStatus().catch(() => null); return st ? mondoLock(st) : null; };
    this.setNetworkMode = async (mode: string) => {
      if (!MONDO_MODES.some(m => m.value === mode)) throw noChange('وضع شبكة مو مدعوم');
      await this.mondoJob('radio_mode', { b: mode }, 'وضع الشبكة');
    };
  }

  async logout(): Promise<void> {
    // /logout/ ينهي جلسة المتصفح على الجهاز كمان — ما نرسله إلا لو دخلنا
    if (!this.logged || !this.host) return;
    this.logged = false;
    try { await this.req('/logout/', {}, 5000); } catch {}
  }

  /** صفحات بعد الدخول للجامع (FULL/AUTH) — كلها عرض GET من قائمة الجهاز نفسه. بدون /logout/ ولا /restarting/ */
  afterLoginPages(): string[] {
    // الأهم أول (أول FULL — ٧ نوفمبر: /diagnostics/ و /mifiinfo/ و /srv/status «ما رد»، والإشارة بالأرقام فيها غالباً)
    return [
      '/diagnostics/', '/mifiinfo/', '/srv/status', '/networks/', '/sim/', '/', '/internet/', '/login/',
      '/connecteddevices/', '/datausage/', '/advanced/', '/wifi/', '/wifisettings/', '/lan/', '/manualdns/',
      '/preferences/', '/softwareupdate/', '/sessions/', '/logs/', '/firewall/', '/macfilter/', '/portforwarding/', '/gps/',
      '/bandlock.html', '/celllock.html', '/realcelllock.html', '/band_manager.html',
      // تعديل «MONDO DEBO» (AUTH ٢١ نوفمبر — 8800L عضو): bandlock.html و celllock.html يطلبون كل شي من MondoAPI.call
      // في mondo-secure-client.js (الطلبات غالباً موقّعة) ← نحتاج كوده قبل أي قراءة/كتابة. cellscan.cgi?action=status قراءة بس.
      '/assets/js/mondo-secure-client.js?v=216', '/assets/js/mondo-secure-client.js', '/cgi/cellscan.cgi?action=status',
    ];
  }

  /**
   * الأرقام من صفحة «Diagnostics» (فيرموير Inseego الأصلي): RSRP و SNR والتردد. الجلسة انتهت (رجعت صفحة الدخول)
   * ← ندخل من جديد مرة وحدة بالكلمة المحفوظة (مرة كل دقيقتين بالكثير، وإذا رُفضت ما نعيد — عشان ما ينقفل الجهاز).
   */
  private async diag(): Promise<InseegoDiag | null> {
    if (this.dg && Date.now() - this.dg.at < 4000) return this.dg.v;
    if (this.dgBusy) return this.dgBusy;
    this.dgBusy = (async () => {
      const get = async () => diagFrom((await this.req('/diagnostics/', {}, 15000)).text);
      let v: InseegoDiag | null = null;
      try { v = await get(); } catch (e) { diag(`[inseego] /diagnostics/ ✗ ${String((e as any)?.message ?? e).slice(0, 60)}`); }
      if (!v && this.password && !this.reloginFailed && Date.now() - this.reloginAt > 120000) {
        this.reloginAt = Date.now();
        diag('[inseego] /diagnostics/ بدون أرقام — الجلسة انتهت؟ ندخل من جديد');
        try { await this.login(this.host, '', this.password); v = await get(); }
        catch (e) {
          if (/غلط|وقّف|رفض/.test(String((e as any)?.message ?? e))) this.reloginFailed = true;
          diag(`[inseego] إعادة الدخول ✗ ${String((e as any)?.message ?? e).slice(0, 80)}`);
        }
      }
      this.dg = { at: Date.now(), v };
      return v;
    })().finally(() => { this.dgBusy = null; });
    return this.dgBusy;
  }

  /** الإشارة بالأرقام: signalstat.cgi (لو الجهاز معدّل) وإلا صفحة Diagnostics */
  private async readAll() {
    const st = await this.status().catch(() => null);
    const ss = await this.stat();
    const dg = ss || !this.logged && !this.password ? null : await this.diag();
    return { st, ss, dg };
  }

  async isConnected(): Promise<boolean> {
    try { return !!(await this.status()); } catch { return false; }
  }

  /** software = نسخة قائمة الصفحات — نرفعها لو أضفنا صفحات للجامع عشان يرجع كرت FULL مرة */
  async getDeviceDetails(): Promise<DeviceDetails> {
    await this.readModel();
    const st = await this.status().catch(() => null);
    return { model: this.name, operator: String(st?.statusBarNetwork ?? '').trim() || undefined, software: 'inseego-pages-4' };
  }

  async getSignal(): Promise<Signal> {
    // أداة MONDO بجلسة ← قراءتها أدق (الأساسي والثانوي و PCI و EARFCN) — والقراءة تحافظ على الجلسة حية
    if (this.mondo?.paired) {
      const m = await this.mondoStatus().catch(() => null);
      if (m) { const s = mondoSignal(m); if (s.rsrp !== undefined) return s; }
    }
    const { st, ss, dg } = await this.readAll();
    if (!st && !ss && !dg) throw new Error('الراوتر ما رد (/srv/status)');
    return signalFrom(st, ss, dg);
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const { st, ss, dg } = await this.readAll();
    return networkFrom(st, ss, this.model, dg);
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    return buildSnapshot(sig, [], cellsOf(sig), { driverId: this.id, driverName: this.name });
  }

  async getCells(): Promise<CellTower[]> {
    if (this.mondo?.paired) {
      const m = await this.mondoStatus().catch(() => null);
      if (m) { const c = mondoCells(m); if (c.length) return c; }
    }
    return cellsOf(await this.getSignal());
  }

  /** الاستهلاك من عدّادات شريط الحالة (statusBarBytesReceived/Transmitted — من بداية الاتصال الحالي) */
  async getUsage(): Promise<Usage> {
    const st = await this.status();
    const u = usageFrom(st);
    if (!u) throw new Error('الجهاز ما أعطى عدّاد الاستهلاك');
    return u;
  }

  async getExtras(): Promise<RouterExtras> {
    const [st, ss] = await Promise.all([this.status().catch(() => null), this.stat()]);
    const h = healthFrom(st, ss);
    const x: RouterExtras = h ? { health: h } : {};
    const secs = Number(st?.statusBarConnectionDuration);
    if (Number.isFinite(secs) && secs > 0) x.uptime = fmtDur(secs);
    return x;
  }
}

/** مدة الاتصال الحالي (ثواني) ← «3:12:05» / «2 يوم 4:05:00» */
function fmtDur(t: number): string {
  const d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60);
  const hms = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return d ? `${d} يوم ${hms}` : hms;
}

function cellsOf(s: Signal): CellTower[] {
  if (s.rsrp === undefined && !s.cellId) return [];
  return [{
    kind: 'serving', tech: 'LTE', band: s.band ? Number(s.band) : undefined, cellId: s.cellId,
    rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr, rssi: s.rssi,
  }];
}
