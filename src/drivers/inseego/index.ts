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
 *    بدونه: نوع الشبكة والشركة والبطارية من /srv/status (ما فيه RSRP) — الأرقام بعد ما يوصل FULL (/diagnostics/).
 *
 * ⚠️ الكتابة (ترددات/برج/وضع) مقفولة: Verizon تقفلها في الفيرموير الأصلي، والموجود عند الأعضاء تعديلات خارجية
 *    («MONDO» على /cgi/mapi.cgi برمز من شاشة الجهاز · «Band Manager» على /cgi/bandset.cgi) — تنفتح ميزة ميزة بعد الدليل.
 */
import { RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, DeviceDetails, RouterExtras } from '../types';
import { sha1 } from '@noble/hashes/legacy';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import type { ModelProfile } from '../models';
import {
  InseegoStatus, InseegoSignalStat, statusFrom, signalFrom, networkFrom, healthFrom, loginTokens, modelFromHtml,
} from './parse';

export const inseegoSha = (pw: string, secToken: string) => bytesToHex(sha1(utf8ToBytes(pw + secToken)));

export class InseegoDriver implements RouterDriver {
  readonly id = 'inseego';
  name = 'Inseego MiFi';
  readonly capabilities: Capability[] = ['signal'];

  private host = '';
  private model = '';
  /** null = ما جرّبنا · false = الجهاز ما فيه signalstat.cgi (فيرموير أصلي) */
  private hasStat: boolean | null = null;
  private logged = false;

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
    await this.readModel();
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
    ];
  }

  async isConnected(): Promise<boolean> {
    try { return !!(await this.status()); } catch { return false; }
  }

  /** software = نسخة قائمة الصفحات — نرفعها لو أضفنا صفحات للجامع عشان يرجع كرت FULL مرة */
  async getDeviceDetails(): Promise<DeviceDetails> {
    await this.readModel();
    const st = await this.status().catch(() => null);
    return { model: this.name, operator: String(st?.statusBarNetwork ?? '').trim() || undefined, software: 'inseego-pages-2' };
  }

  async getSignal(): Promise<Signal> {
    const [st, ss] = await Promise.all([this.status().catch(() => null), this.stat()]);
    if (!st && !ss) throw new Error('الراوتر ما رد (/srv/status)');
    return signalFrom(st, ss);
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const [st, ss] = await Promise.all([this.status().catch(() => null), this.stat()]);
    return networkFrom(st, ss, this.model);
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    return buildSnapshot(sig, [], cellsOf(sig), { driverId: this.id, driverName: this.name });
  }

  async getCells(): Promise<CellTower[]> {
    return cellsOf(await this.getSignal());
  }

  async getExtras(): Promise<RouterExtras> {
    const [st, ss] = await Promise.all([this.status().catch(() => null), this.stat()]);
    const h = healthFrom(st, ss);
    return h ? { health: h } : {};
  }
}

function cellsOf(s: Signal): CellTower[] {
  if (s.rsrp === undefined && !s.cellId) return [];
  return [{
    kind: 'serving', tech: 'LTE', band: s.band ? Number(s.band) : undefined, cellId: s.cellId,
    rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr, rssi: s.rssi,
  }];
}
