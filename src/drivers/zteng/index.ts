/**
 * ZTE الجيل الجديد (U60 Pro / MU5250، وغالباً G5 Ultra وأجهزة zwrt الأحدث).
 * الصفحة ما فيها goform — كل شي عبر ubus JSON-RPC على /ubus/.
 *
 *  - القراءة: zte_nwinfo_api.nwinfo_get_netinfo مسموح بدون دخول (rpcd ACL «unauthenticated»).
 *  - الدخول: zwrt_web.web_login_info (salt) ثم web_login بـ SHA256(SHA256(pw).upper + salt).upper
 *    (مرجع: dklasens/MU5250-OpenUI، MIT). ما ندخل إلا لما نحتاج نكتب، ومرة وحدة بس:
 *    لو انرفضت الكلمة نتذكرها وما نعيدها (نفس حماية MU5001) — عشان ما ينقفل الدخول.
 *  - الكتابة (نفس أوامر صفحة الراوتر):
 *      4G: nwinfo_set_gwl_bandlock  lte_band_mask = قناع **عشري** كنص (MC8830/MU5250: lte_ext_band بقناع 0x hex — lteLock)
 *      5G: nwinfo_set_nrbandlock    nr5g_band = "78,41" (يطبّق على SA بس — في NSA ما له أثر)
 *      وضع الشبكة: nwinfo_set_netselect  net_select
 *      إعادة التشغيل: zwrt_mc.device.manager.device_reboot
 *  - تثبيت البرج: موقوف — فكّه ما يسري إلا بإعادة تشغيل أو تبديل وضع الشبكة.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import {
  RouterDriver, Capability, Signal, Carrier, SignalSnapshot, NetworkInfo, CellTower, DeviceTemp,
  Traffic, Usage, BandConfig, ActiveLock, CellLockState, DeviceDetails, WifiRadio, ConnectedDevice,
} from '../types';
import { http } from '../http';
import { noChange } from '../noChange';
import { opName } from '../fg360/parse';
import { buildSnapshot } from '../../utils/snapshot';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import { MODELS, ModelProfile } from '../models';
import { diag } from '../../services/diag';
import { u30NewKey } from '../zte/u30crypto';
const rnd = async () => { const C = await import('expo-crypto'); return (n: number) => C.getRandomBytes(n); };

const ZERO = '00000000000000000000000000000000';
const sha = (s: string) => bytesToHex(sha256(utf8ToBytes(s))).toUpperCase();
const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};
const neg = (v: unknown) => { const n = num(v); return n !== undefined && n < 0 ? n : undefined; };
const int = (v: unknown) => { const n = num(v); return n !== undefined && Number.isInteger(n) ? n : undefined; };
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const bandNum = (v: unknown) => { const m = str(v).match(/(\d+)/); return m ? parseInt(m[1], 10) : undefined; };

type NetInfo = Record<string, unknown>;

// قائمة U60 Pro (من MU5250-OpenUI)
const LTE_BANDS = [1, 2, 3, 4, 5, 7, 8, 18, 19, 20, 26, 28, 29, 32, 34, 38, 39, 40, 41, 42, 43, 48, 66, 71];
const NR_BANDS = [1, 2, 3, 5, 7, 8, 18, 20, 26, 28, 29, 38, 40, 41, 48, 66, 71, 75, 77, 78, 79];
const CODE_TO_NG: Record<string, string> = { '00': 'WL_AND_5G', '0803': 'LTE_AND_5G', '03': 'Only_LTE', '08': 'Only_5G' };
const NG_LABEL: Record<string, string> = { WL_AND_5G: 'تلقائي', LTE_AND_5G: '4G + 5G', Only_LTE: '4G فقط', Only_5G: '5G فقط' };
const NG_TO_CODE: Record<string, string> = Object.fromEntries(Object.entries(CODE_TO_NG).map(([k, v]) => [v, k]));
const maskOf = (bands: number[]) => bands.reduce((m, b) => (b > 0 ? m | (1n << BigInt(b - 1)) : m), 0n).toString();
const bandsOfMask = (v: unknown): number[] => {
  const t = str(v);
  if (!t || !/^(0x[0-9a-f]+|\d+)$/i.test(t)) return [];
  try {
    const m = BigInt(t);
    const out: number[] = [];
    for (let i = 0; i < 128; i++) if ((m >> BigInt(i)) & 1n) out.push(i + 1);
    return out;
  } catch { return []; }
};
const nrListOf = (v: unknown) => str(v).split(',').map(x => parseInt(x, 10)).filter(n => n > 0);
const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every(x => b.includes(x));
const LTE_EARFCN: [number, number, number][] = [
  [1, 0, 599], [3, 1200, 1949], [7, 2750, 3449], [8, 3450, 3799], [20, 6150, 6449],
  [28, 9210, 9659], [38, 37750, 38249], [40, 38650, 39649], [41, 39650, 41589], [42, 41590, 43589],
];
const lteBandOf = (e?: number) => (e === undefined ? undefined : LTE_EARFCN.find(([, a, b]) => e >= a && e <= b)?.[0]);

/** راوترات ZTE الجيل الجديد اللي الكتابة فيها تمشي على https بس (نفس أصل صفحتها) */
const httpsHosts = new Set<string>();
/** جرّبنا https مرة لهالراوتر (نجح أو لا) — ما نعيده مع كل أمر */
const httpsTried = new Set<string>();
/**
 * راوتر رفض الكتابة حتى بعد دخول جديد + خيارات المطوّر ← ما نعيد الدورة (دخول + مطوّر) مع كل تردد لمدة ٥ دقايق.
 * MU5252 (٨ نوفمبر): المحسّن سوّى ٨ دخولات كاملة في ٢٠ ثانية — يخاطر بقفل الدخول.
 */
const deniedHosts = new Map<string, number>();
const DENY_MS = 5 * 60_000;
/** راوترات ردّت gwl_bandlock بالرفض ونجح عندها lte_ext_band — نروح له مباشرة (بدون دورة دخول على gwl كل مرة) */
const extHosts = new Map<string, 'list' | 'hex'>();
export function _resetZteNgHttps() { httpsHosts.clear(); httpsTried.clear(); }

export class ZteNgDriver implements RouterDriver {
  id = 'zte-ng';
  name = 'ZTE (الجيل الجديد)';
  capabilities: Capability[] = ['signal', 'cells', 'bandLock', 'reboot', 'usage', 'traffic'];
  cellLockRisk = 'تثبيت البرج موقوف على هذا الجهاز للحين — فكّه ما يسري إلا بإعادة تشغيل الراوتر. استخدم تثبيت الترددات بداله.';

  private host = '';
  private session = ZERO;
  private password = '';
  private orig: Record<string, string> | null = null;

  /**
   * MU5250 (FULL ٧ نوفمبر ١:٤٩ م، SM-S938B): «GET / → 405» على http و https يرجّع الصفحة (25KB) — صفحة الراوتر
   * نفسها تشتغل على https، والقراءة على http تمشي بس كل كتابة Access denied حتى بعد دخول result=0 + التفاوض.
   * لو الكتابة انرفضت على http بعد دخول جديد وخيارات المطوّر ← نكمّل على https (نفس أصل الصفحة) ونتذكره للراوتر.
   */
  private base() { return `${httpsHosts.has(this.host) ? 'https' : 'http'}://` + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  /** نداء ubus واحد — يرجع الكائن (result[1]) أو يرمي لو الكود مو 0 */
  private async call(obj: string, method: string, params: Record<string, unknown> = {}, session?: string): Promise<Record<string, unknown>> {
    const body = JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'call', params: [session ?? this.session, obj, method, params] }]);
    const send = () => http(`${this.base()}/ubus/?t=${Date.now()}`, {
      method: 'POST',
      // نفس هيدرات صفحة الراوتر (G5/U60): Z-Mode 1 بعد الدخول، Z-Tag = اسم الأمر
      headers: {
        'Content-Type': 'application/json', Referer: this.base() + '/index.html', Origin: this.base(),
        'X-Requested-With': 'XMLHttpRequest', 'Z-Mode': (session ?? this.session) === ZERO ? '0' : '1', 'Z-Tag': method,
      },
      body,
    }, 6000);
    let res: Response;
    try {
      res = await send();
    } catch (e: any) {
      // أندرويد (OkHttp): «java.net.ProtocolException» على POST بين فترة وفترة — سيرفر الراوتر يسكّر الاتصال
      // المحفوظ (keep-alive) وOkHttp ما يعيد POST لحاله. كان يطلع «تعذر الاتصال بالراوتر» وقت الإضافة
      // (setup-login ٦ نوفمبر ١١:٥٢ — بعده بـ٣ ثواني نفس الطلب نجح). نعيد مرة وحدة — إلا الدخول (يعدّ المحاولات)
      if (method === 'web_login' || !/ProtocolException|unexpected end of stream|connection (reset|closed)/i.test(`${e?.raw ?? ''} ${e?.message ?? e}`)) throw e;
      await new Promise(r => setTimeout(r, 300));
      res = await send();
    }
    const j: any = await res.json();
    const r = Array.isArray(j) ? j[0] : j;
    const out = r?.result;
    if (!Array.isArray(out) || out[0] !== 0) {
      const e: any = new Error(`الراوتر رفض ${obj}.${method} (${JSON.stringify(r?.result ?? r?.error ?? '').slice(0, 60)})`);
      e.code = Array.isArray(out) ? out[0] : r?.error?.code;
      throw e;
    }
    return (out[1] ?? {}) as Record<string, unknown>;
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const info = await this.call('zte_nwinfo_api', 'nwinfo_get_netinfo', {}, ZERO);
      if (typeof info === 'object' && ('network_type' in info || 'lte_rsrp' in info || 'nr5g_rsrp' in info)) return true;
    } catch {}
    // MU5252 بثلاث شرايح (٨ نوفمبر): لو الشريحة الأساسية (5G) مطفية، netinfo يرجع بدون خانات الإشارة —
    // كان التعرّف يفشل («الراوتر ما يتعرّف»). الراوتر نفسه يرد: بصمة دخول ZTE (zte_web_sault) أو اللغة.
    try { const li = await this.call('zwrt_web', 'web_login_info', {}, ZERO); if (str(li.zte_web_sault)) return true; } catch {}
    try { await this.call('zwrt_web', 'web_language_get', {}, ZERO); return true; } catch { return false; }
  }

  async login(host: string, _u: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    this.host = host;
    this.password = password || '';
    // القراءة ما تحتاج دخول. نتحقق من الكلمة الحين بس لو المستخدم كتبها بنفسه
    if (password && (opts?.fresh || opts?.lastTry)) await this.doLogin(true);
  }

  /** محاولة دخول وحدة. user=true: المستخدم طلبها بنفسه (نتجاوز «انرفضت قبل») */
  private async doLogin(user = false): Promise<void> {
    if (!this.password) throw new Error('نحتاج كلمة مرور الراوتر عشان نغيّر الإعدادات — حطها من إعدادات الراوتر في التطبيق.');
    const fp = bytesToHex(sha256(utf8ToBytes('bandly-ng:' + this.password)));
    if (!user && await isBadPassword(this.host, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل الدخول. حدّثها من إعدادات الراوتر.');
    }
    const info = await this.call('zwrt_web', 'web_login_info', {}, ZERO);
    const salt = str(info.zte_web_sault);
    if (!salt) throw new Error('الراوتر ما عطانا بيانات الدخول — جرّب بعد شوي');
    let r: Record<string, unknown> | null = null;
    try { r = await this.call('zwrt_web', 'web_login', { password: sha(sha(this.password) + salt) }, ZERO); } catch {}
    const s2 = r ? str(r.ubus_rpc_session) : '';
    // MU5250: الراوتر يرجّع ubus_rpc_session حتى لو رفض الدخول (result ≠ 0) — جلسة بدون صلاحيات
    // ← كل أمر كتابة «Access denied (-32002)». صفحة الراوتر نفسها تشيك result === 0 (مثل MU5250-OpenUI).
    const res = r && r.result !== undefined && r.result !== null ? str(r.result) : '';
    // للتشخيص (FULL / «أرسل تشخيص»): رمز الدخول وأسماء الخانات بس — بدون الجلسة
    diag(`[zte-ng] web_login: result=${res || '—'} · جلسة=${s2 ? 'فيه' : 'لا'} · خانات=${r ? Object.keys(r).join(',') : '—'}`);
    if (!s2 || (res !== '' && res !== '0')) {
      await markBadPassword(this.host, fp);
      throw new Error(`الراوتر رفض الدخول${res ? ` (رمز ${res})` : ''} — غالباً كلمة المرور غلط. تأكد منها (الملصق تحت الراوتر أو اللي غيّرتها أنت)، واطلع من صفحة الراوتر لو فاتحها من جهاز ثاني — ما بنجرّب مرة ثانية لحالنا.`);
    }
    await markBadPassword(this.host, null);
    this.session = s2;
    this.devOk = false;
    await this.setEnstr();
  }

  /**
   * «خيارات المطوّر» — MU5250 / MC8830 (FULL ٦ نوفمبر): تثبيت الترددات (setBandSelect = nwinfo_set_lte_ext_band ·
   * gSaOrNsaBandSelect = nwinfo_set_nrbandlock) ما له مكان إلا في #developer_options، وrouter.js يحوّلها لـ
   * #developer_options_login لو web_info.developer_option_loginfo ≠ "1". حساب admin لحاله ← Access denied (-32002).
   * الدخول (service_rpc.js ua()): zwrt_web.web_developer_option_login {password: sha(sha(كلمة)+zte_web_sault)} بنفس الجلسة ← result "0".
   * في فيرمويرات كثيرة كلمة المطوّر = كلمة الدخول (G5B1 · MC888 فودافون إسبانيا)، وفي غيرها منفصلة ← نجرّب كلمة admin
   * **مرة وحدة** ولو انرفضت ما نعيدها لحالنا (ما نخمّن كلمات).
   */
  private devOk = false;
  private devRejected = false;
  private async devLogin(): Promise<boolean> {
    if (this.devOk) return true;
    try {
      const wi = await this.call('zwrt_web', 'web_info', {});
      if (str(wi.developer_option_loginfo) === '1') { this.devOk = true; diag('[zte-ng] خيارات المطوّر: مفتوحة أصلاً'); return true; }
    } catch {}
    const key = 'dev:' + this.base();   // لكل أصل (http/https) لحاله — رفض على http ما يحجب https
    const fp = bytesToHex(sha256(utf8ToBytes('bandly-ng-dev:' + this.password)));
    if (await isBadPassword(key, fp)) {
      this.devRejected = true;
      diag('[zte-ng] خيارات المطوّر: كلمة الدخول انرفضت قبل — ما نعيدها');
      return false;
    }
    let r: Record<string, unknown> | null = null;
    try {
      const info = await this.call('zwrt_web', 'web_login_info', {}, ZERO);
      const salt = str(info.zte_web_sault);
      if (!salt) return false;
      r = await this.call('zwrt_web', 'web_developer_option_login', { password: sha(sha(this.password) + salt) });
    } catch (e: any) {
      diag(`[zte-ng] web_developer_option_login: ${String(e?.message ?? e).slice(0, 80)}`);
      return false;
    }
    const res = r && r.result !== undefined && r.result !== null ? str(r.result) : '';
    diag(`[zte-ng] web_developer_option_login: result=${res || '—'} · خانات=${r ? Object.keys(r).join(',') : '—'}`);
    if (res === '0') { this.devOk = true; this.devRejected = false; await markBadPassword(key, null); return true; }
    // ما فيه result (فيرموير بدون خيارات المطوّر) ← مو رفض كلمة؛ ما نعلّمها
    if (res === '') return false;
    this.devRejected = true;
    await markBadPassword(key, fp);
    return false;
  }

  /**
   * بعد الدخول صفحة الراوتر تسوي he(): web_crt_get (مفتاح RSA) ← مفتاح AES عشوائي ← web_http_enstr_set.
   * MU5250 (FULL ٦ نوفمبر): الدخول result=0 والقراءة تمشي، بس كل كتابة Access denied — الجلسة ناقصها هالخطوة.
   * نفس تفاوض U30 (zte/u30crypto). لو الراوتر ما يعرفها (U60 Pro القديم) نكمّل عادي.
   */
  private async setEnstr(): Promise<void> {
    try {
      const c = await this.call('zwrt_web', 'web_crt_get', {});
      const pem = str(c.result ?? c.crt);
      if (pem.length < 100) { diag('[zte-ng] web_crt_get: ما فيه مفتاح'); return; }
      const { enstr } = u30NewKey(pem, await rnd());
      const o = await this.call('zwrt_web', 'web_http_enstr_set', { web_enstr: enstr });
      diag(`[zte-ng] web_http_enstr_set: ${str(o.result) || 'ok'}`);
    } catch (e: any) {
      diag(`[zte-ng] مفتاح الجلسة: ${String(e?.message ?? e).slice(0, 80)}`);
    }
  }

  /** أمر كتابة: يدخل لو ما دخلنا، ولو الجلسة انتهت (رفض صلاحية) يدخل مرة ثانية ويعيد */
  /** probe: أمر نجرّبه ونرجع لغيره لو رُفض (gwl_bandlock) — ما يستهلك تجربة https */
  private async write(obj: string, method: string, params: Record<string, unknown>, probe = false): Promise<Record<string, unknown>> {
    const den = deniedHosts.get(this.host);
    if (den && Date.now() - den < DENY_MS) {
      const x: any = new Error('الراوتر رفض الأمر حتى بعد الدخول (Access denied) قبل شوي — ما عدنا المحاولة عشان ما ينقفل الدخول. جرّب بعد ٥ دقايق.');
      x.code = -32002;
      throw x;
    }
    if (this.session === ZERO) await this.doLogin();
    try {
      return await this.callRetry(obj, method, params);
    } catch (e: any) {
      if (e?.code === 6 || e?.code === -32002) {
        this.session = ZERO;
        await this.doLogin();
        try {
          return await this.callRetry(obj, method, params);
        } catch (e2: any) {
          // الجلسة سليمة (دخلنا للتو) والأمر لسا مرفوض = صلاحية: أوامر «خيارات المطوّر» ← ندخلها ونعيد مرة
          if ((e2?.code === 6 || e2?.code === -32002) && await this.devLogin()) {
            try { return await this.callRetry(obj, method, params); } catch (e3: any) { e2 = e3; }
          }
          // لسا مرفوض على http ← صفحة الراوتر نفسها على https: ندخل هناك ونعيد مرة (مرة لكل راوتر)
          if (!probe && (e2?.code === 6 || e2?.code === -32002) && !httpsTried.has(this.host)) {
            diag('[zte-ng] الكتابة مرفوضة على http بعد الدخول — نجرّب https (أصل صفحة الراوتر)');
            httpsTried.add(this.host);
            httpsHosts.add(this.host);
            try {
              this.session = ZERO;
              await this.doLogin();
              try {
                const out = await this.callRetry(obj, method, params);
                diag('[zte-ng] https: الكتابة انقبلت ✓');
                return out;
              } catch (e3: any) {
                if ((e3?.code === 6 || e3?.code === -32002) && await this.devLogin()) return await this.callRetry(obj, method, params);
                throw e3;
              }
            } catch (e4: any) {
              diag(`[zte-ng] https ما نفع: ${String(e4?.message ?? e4).slice(0, 80)}`);
              // https ما يفرق (أو ما يرد) ← نرجع http للقراءة
              httpsHosts.delete(this.host);
              this.session = ZERO;
              if (e4?.code !== 6 && e4?.code !== -32002) throw e4;
              e2 = e4;
            }
          }
          if ((e2?.code === 6 || e2?.code === -32002) && this.devRejected) {
            const x: any = new Error('هالإعداد في راوترك داخل «خيارات المطوّر»، وكلمتها مو نفس كلمة الدخول — الراوتر رفضها. نفس الشي يصير من صفحة الراوتر نفسها؛ لو تعرف كلمة المطوّر من الشركة كلّمنا في قروب الدعم.');
            x.code = e2.code;
            x.devNeeded = true;
            if (!probe) deniedHosts.set(this.host, Date.now());
            throw x;
          }
          if (e2?.code === 6 || e2?.code === -32002) {
            if (!probe) deniedHosts.set(this.host, Date.now());
            const x: any = new Error('الراوتر رفض الأمر حتى بعد الدخول (Access denied) — اطلع من صفحة الراوتر لو فاتحها من جهاز ثاني، وتأكد إن كلمة المرور حق حساب المدير، وبعدها جرّب مرة ثانية.');
            x.code = e2.code;
            throw x;
          }
          throw e2;
        }
      }
      throw e;
    }
  }

  /** ويب ZTE (zwrt) أحياناً يرد Access denied على أمر مسموح — الصفحة نفسها تعيده لين ٥ مرات بنفس الجلسة */
  private async callRetry(obj: string, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    for (let i = 0; ; i++) {
      try {
        return await this.call(obj, method, params);
      } catch (e: any) {
        if (e?.code !== -32002 || i >= 3) throw e;
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  /**
   * صفحات إعدادات الشبكة (ملفات ثابتة — المسارات من js/router.js في ملف FULL ٦ نوفمبر):
   * فيرموير MU5250 يثبّت 4G بـ nwinfo_set_lte_ext_band (setBandSelect) مو gwl_bandlock، وخاناته في صفحة الشبكة.
   * GET بس — تطلع في FULL و«أرسل تشخيص».
   */
  afterLoginPages(): string[] {
    // من قائمة الصفحة نفسها (js/config/cpe/MC8830/menu.js في FULL ٦ نوفمبر) — الصفحات الموجودة فعلاً
    const pages = ['network/net_select', 'network/internet_setting', 'network/dial_setting', 'network/apn_setting',
      'adm/developer_options', 'adm/developer_options_login', 'adm/others'];
    return pages.flatMap(x => [`/tmpl/auth/${x}.html`, `/js/auth/${x}.js`]);
  }

  /** AUTH ٦ نوفمبر: بدون دخول كل /tmpl/auth ترد 405 و /js/auth ترد 404 — سيرفر الصفحة يعطي كوكي الجلسة مع web_login */
  async prepareAfterLogin(): Promise<void> {
    if (this.session === ZERO && this.password) await this.doLogin();
  }

  async logout(): Promise<void> {
    if (this.session !== ZERO) { try { await this.call('zwrt_web', 'web_logout', {}); } catch {} }
    this.session = ZERO;
  }

  private async net(): Promise<NetInfo> {
    let d: NetInfo;
    try { d = await this.call('zte_nwinfo_api', 'nwinfo_get_netinfo', {}); }
    catch { d = await this.call('zte_nwinfo_api', 'nwinfo_get_netinfo', {}, ZERO); }
    // MU5250/MU5252 (تشخيص ٨ نوفمبر ١:٢٦): بعد lte_ext_band بالقائمة، lte_band_lock (القناع) يتأخر كتابة وحدة
    // (كتبنا 3 ← القناع لسا B3+B8 من قبل)، و lte_band = المثبّت الحين بالضبط. لهالعائلة نبني القناع من lte_band —
    // وإلا التأكد والإرجاع يقولون «ما رجع» والراوتر راجع.
    if (extHosts.get(this.host) === 'list') {
      const l = str((d as any).lte_band).split(',').map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 129);
      if (l.length) (d as any).lte_band_lock = '0x' + BigInt(maskOf(l)).toString(16);
    }
    return d;
  }

  /** «pci,band,?,earfcn,bw;…» — أول سطر يطابق الأساسي نتخطاه */
  private lteScc(d: NetInfo, pci?: number, earfcn?: number) {
    const out: { pci?: number; band?: number; earfcn?: number; bw?: number }[] = [];
    let skip = false;
    for (const seg of str(d.lteca).split(';')) {
      const p = seg.split(',').map(x => x.trim());
      if (p.length < 5) continue;
      const ePci = int(p[0]), eArf = int(p[3]);
      if (!skip && ePci === pci && eArf === earfcn) { skip = true; continue; }
      out.push({ pci: ePci, band: bandNum(p[1]), earfcn: eArf, bw: num(p[4]) });
    }
    return out;
  }
  private pccBw(d: NetInfo, pci?: number, earfcn?: number) {
    for (const seg of str(d.lteca).split(';')) {
      const p = seg.split(',').map(x => x.trim());
      if (p.length >= 5 && int(p[0]) === pci && int(p[3]) === earfcn) return num(p[4]);
    }
    return undefined;
  }

  async getSignal(): Promise<Signal> {
    const d = await this.net();
    const bandStr = str(d.wan_active_band);
    const earfcn = int(d.wan_active_channel);
    const lteOk = !!bandStr && !/^n/i.test(bandStr) && !/^B?0?$/i.test(bandStr) && (earfcn ?? 0) > 0;
    const pci = int(d.lte_pci);
    const b = bandNum(bandStr);
    const parts: string[] = [];
    if (lteOk && b) {
      const bw = this.pccBw(d, pci, earfcn);
      parts.push(`${bw ?? ''}${bw ? 'MHz' : ''}@${earfcn}(B${b})`);
      for (const s of this.lteScc(d, pci, earfcn)) if (s.band) parts.push(`${s.bw ?? ''}${s.bw ? 'MHz' : ''}@${s.earfcn ?? ''}(B${s.band})`);
    }
    const nrBand = str(d.nr5g_action_band);
    const nrArfcn = int(d.nr5g_action_channel) ?? 0;
    const nrOk = !!nrBand && !/^n?0?$/i.test(nrBand) && nrArfcn > 0;
    return {
      network: str(d.network_type) || undefined,
      band: parts.length ? parts.join(' + ') : undefined,
      cellId: str(d.cell_id) || undefined,
      pci: lteOk && pci !== undefined ? String(pci) : undefined,
      earfcn: lteOk && earfcn ? String(earfcn) : undefined,
      dlBandwidth: lteOk ? (() => { const bw = this.pccBw(d, pci, earfcn); return bw ? bw + 'MHz' : undefined; })() : undefined,
      rsrp: lteOk ? neg(d.lte_rsrp) : undefined,
      rsrq: lteOk ? num(d.lte_rsrq) : undefined,
      sinr: lteOk ? num(d.lte_snr) : undefined,
      rssi: lteOk ? neg(d.lte_rssi) : undefined,
      nrBand: nrOk ? (/^n/i.test(nrBand) ? nrBand : 'n' + nrBand) : undefined,
      nrPci: nrOk && int(d.nr5g_pci) !== undefined ? String(int(d.nr5g_pci)) : undefined,
      nrArfcn: nrOk ? String(nrArfcn) : undefined,
      nrDlBandwidth: nrOk && num(d.nr5g_bandwidth) ? num(d.nr5g_bandwidth) + 'MHz' : undefined,
      nrRsrp: nrOk ? neg(d.nr5g_rsrp) : undefined,
      nrRsrq: nrOk ? num(d.nr5g_rsrq) : undefined,
      nrSinr: nrOk ? num(d.nr5g_snr) : undefined,
    };
  }

  async getCarriers(): Promise<Carrier[]> {
    const d = await this.net();
    const out: Carrier[] = [];
    const earfcn = int(d.wan_active_channel);
    const pci = int(d.lte_pci);
    const bandStr = str(d.wan_active_band);
    const b = bandNum(bandStr);
    if (b && !/^n/i.test(bandStr) && (earfcn ?? 0) > 0) {
      out.push({ tech: 'LTE', role: 'PCC', band: b, arfcn: String(earfcn), pci: pci !== undefined ? String(pci) : undefined,
        bandwidth: this.pccBw(d, pci, earfcn), rsrp: neg(d.lte_rsrp), rsrq: num(d.lte_rsrq), sinr: num(d.lte_snr) });
      const sigs = str(d.ltecasig).split(';').filter(Boolean).map(x => x.split(','));
      this.lteScc(d, pci, earfcn).forEach((s, i) => {
        if (!s.band) return;
        const g = sigs[i];
        out.push({ tech: 'LTE', role: 'SCC', band: s.band, arfcn: s.earfcn ? String(s.earfcn) : undefined,
          pci: s.pci !== undefined ? String(s.pci) : undefined, bandwidth: s.bw,
          rsrp: g ? neg(g[0]) : undefined, rsrq: g && num(g[1]) ? num(g[1]) : undefined, sinr: g ? num(g[2]) : undefined });
      });
    }
    const nb = bandNum(d.nr5g_action_band);
    const nArf = int(d.nr5g_action_channel) ?? 0;
    if (nb && nArf > 0) {
      const nPci = int(d.nr5g_pci);
      out.push({ tech: 'NR', role: out.length ? 'SCC' : 'PCC', band: nb, arfcn: String(nArf),
        pci: nPci !== undefined ? String(nPci) : undefined, bandwidth: num(d.nr5g_bandwidth),
        rsrp: neg(d.nr5g_rsrp), rsrq: num(d.nr5g_rsrq), sinr: num(d.nr5g_snr) });
      // «idx,pci,?,band,arfcn,bw,?,rsrp,rsrq,sinr,rssi» — RSRP -140 = مو مقاس
      for (const seg of str(d.nrca).split(';')) {
        const p = seg.split(',').map(x => x.trim());
        if (p.length < 6) continue;
        const sPci = int(p[1]), sArf = int(p[4]) ?? 0, sb = bandNum(p[3]);
        if (!sb || (sPci === nPci && sArf === nArf)) continue;
        const r = num(p[7]);
        const measured = r !== undefined && r > -140 && r < 0;
        out.push({ tech: 'NR', role: 'SCC', band: sb, arfcn: sArf ? String(sArf) : undefined,
          pci: sPci !== undefined ? String(sPci) : undefined, bandwidth: num(p[5]),
          rsrp: measured ? r : undefined, rsrq: measured ? num(p[8]) : undefined, sinr: measured ? num(p[9]) : undefined });
      }
    }
    return out;
  }

  async isConnected(): Promise<boolean> {
    try {
      const d = await this.net();
      const t = str(d.network_type).toUpperCase();
      return !!t && !/NO_?SERVICE|LIMITED|^NONE$/.test(t);
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    try {
      const i = await this.call('zwrt_web', 'web_info', {}, ZERO).catch(() => ({} as Record<string, unknown>));
      const txt = JSON.stringify(i);
      if (/MU5250/i.test(txt)) { this.lteExt = true; return MODELS.mu5250; }
      if (/MU5252|TOPFLOW/i.test(txt)) { this.lteExt = true; return MODELS.mu5252; }
      if (/U60/i.test(txt)) return MODELS.u60Pro;
    } catch {}
    return MODELS.zteNg;
  }

  // ─── قناة الواي فاي (نفس صفحة الراوتر: uci wireless/wifi0|wifi1 + zwrt_wlan.set) ───
  private async wifiSection(sec: 'wifi0' | 'wifi1'): Promise<Record<string, unknown>> {
    if (this.session === ZERO) await this.doLogin();
    const r = await this.call('uci', 'get', { config: 'wireless', section: sec });
    return ((r as any).values ?? r) as Record<string, unknown>;
  }

  async getWifiRadios(): Promise<WifiRadio[]> {
    const CH24 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
    const CH5 = ['36', '40', '44', '48', '52', '56', '60', '64', '100', '104', '108', '112', '116', '120', '124', '128', '132', '136', '140', '149', '153', '157', '161', '165'];
    const out: WifiRadio[] = [];
    for (const [sec, band] of [['wifi0', '2.4'], ['wifi1', '5']] as const) {
      try {
        const v = await this.wifiSection(sec);
        const ch = str(v.channel);
        if (!ch && !v.hwmode && !v.band) continue;
        out.push({ band, channel: !ch || /auto/i.test(ch) ? '0' : ch, allowed: ['0', ...(band === '5' ? CH5 : CH24)], writable: true });
      } catch {}
    }
    return out;
  }

  async setWifiChannel(band: '2.4' | '5', channel: string): Promise<void> {
    const sec = band === '5' ? 'wifi1' : 'wifi0';
    const val = channel === '0' ? 'auto' : channel;
    // الواي فاي يعيد التشغيل — الجوال ينفصل ثواني، وشاشة القنوات تنتظر وتتأكد
    await this.write('zwrt_wlan', 'set', { [sec]: { channel: val } });
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    const ca = await this.getCarriers().catch(() => [] as Carrier[]);
    const cells = await this.getCells().catch(() => [] as CellTower[]);
    return buildSnapshot(sig, ca, cells, { driverId: this.id, driverName: this.name });
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const d = await this.net();
    const t = str(d.network_type);
    return {
      operator: str(d.network_provider_fullname) || str(d.network_provider) || undefined,
      mode: t || undefined,
      connected: !!t && !/NO_?SERVICE|LIMITED|^NONE$/i.test(t),
    };
  }

  async getCells(): Promise<CellTower[]> {
    const d = await this.net();
    const out: CellTower[] = [];
    const ca = await this.getCarriers().catch(() => [] as Carrier[]);
    for (const c of ca) {
      out.push({ kind: c.role === 'PCC' || (c.tech === 'NR' && !out.some(x => x.tech === 'NR')) ? 'serving' : 'secondary',
        tech: c.tech, band: c.band, arfcn: c.arfcn, pci: c.pci, rsrp: c.rsrp, rsrq: c.rsrq, sinr: c.sinr });
    }
    // الأبراج المجاورة (لو الفيرموير يعطيها بنفس صيغة ZTE): "earfcn,pci,rsrq,rsrp,rssi;…"
    for (const row of str(d.ngbr_cell_info).split(';')) {
      const p = row.split(',').map(x => x.trim());
      if (p.length < 4 || !p[0]) continue;
      if (out.some(x => x.arfcn === p[0] && x.pci === p[1])) continue;
      out.push({ kind: 'neighbor', tech: 'LTE', arfcn: p[0], band: lteBandOf(num(p[0])), pci: p[1], rsrq: num(p[2]), rsrp: num(p[3]), rssi: num(p[4]) });
    }
    return out;
  }

  /** قراءات الصفحة تحتاج جلسة (uci / zwrt_router) — ندخل مرة لو عندنا كلمة */
  private async authRead<T>(f: () => Promise<T>): Promise<T> {
    try { return await f(); }
    catch (e: any) {
      if ((e?.code === 6 || e?.code === -32002) && this.password && this.session === ZERO) { await this.doLogin(); return await f(); }
      throw e;
    }
  }
  private async uciGet(config: string, section: string): Promise<Record<string, unknown>> {
    const r: any = await this.authRead(() => this.call('uci', 'get', { config, section }));
    return (r?.values ?? r ?? {}) as Record<string, unknown>;
  }

  /**
   * معلومات الجهاز — نفس getDeviceInfo في صفحة MU5250/MU5252 (service_rpc.js، FULL ٨ نوفمبر):
   *   uci zwrt_common_info.common_config ← model_name · device_market_name · wa_inner_version · hardware_version
   *   zwrt_data.get_wwaniface {source_module:"web", cid:1, subid:1|2} ← ipv4_address · ipv4_dns_prefer · ipv4_dns_standby
   * (كان zwrt_mc.device.manager.get_device_info — ما يرجع شي هنا، والاسم يطلع «ZTE U60 Pro» ثابت)
   */
  private infoLogged = false;
  async getDeviceDetails(): Promise<DeviceDetails> {
    const d = await this.net().catch(() => ({} as NetInfo));
    const pickS = (o: Record<string, unknown>, ...k: string[]) => { for (const x of k) { const v = str(o[x]); if (v) return v; } return undefined; };
    let c: Record<string, unknown> = {};
    try { c = await this.uciGet('zwrt_common_info', 'common_config'); } catch {}
    let w: Record<string, unknown> = {};
    for (const subid of [1, 2]) {
      try {
        w = await this.authRead(() => this.call('zwrt_data', 'get_wwaniface', { source_module: 'web', cid: 1, subid }));
        if (str(w.ipv4_address) || str(w.ipv4_dns_prefer)) break;
      } catch {}
    }
    let i: Record<string, unknown> = {};
    if (!pickS(c, 'model_name', 'device_market_name')) {
      try { i = await this.call('zwrt_mc.device.manager', 'get_device_info', {}); } catch {}
    }
    if (!this.infoLogged) {
      this.infoLogged = true;
      diag(`[zte-ng] common_config: ${pickS(c, 'device_market_name') ?? '—'} / ${pickS(c, 'model_name') ?? '—'} · wwaniface: ip=${str(w.ipv4_address) ? '✓' : '—'} dns=${str(w.ipv4_dns_prefer) ? '✓' : '—'} · get_device_info: ${Object.keys(i).join(',') || '—'}`);
    }
    const dns = [str(w.ipv4_dns_prefer), str(w.ipv4_dns_standby)].filter(x => x && x !== '0.0.0.0').join(' · ');
    const wan = str(w.ipv4_address);
    return {
      // الاسم التجاري أول (TOPFLOW MU5252) ثم الموديل — ما نخمّن (صفحة MU5250/MU5252/U60 Pro وحدة)
      model: pickS(c, 'device_market_name', 'model_name') ?? pickS(i, 'model_name', 'device_name', 'product_name') ?? 'ZTE (الجيل الجديد)',
      software: pickS(c, 'wa_inner_version', 'web_red_version') ?? pickS(i, 'software_version', 'wa_inner_version'),
      hardware: pickS(c, 'hardware_version'),
      wanIp: wan && wan !== '0.0.0.0' ? wan : undefined,
      dns: dns || undefined,
      operator: opName(d.network_provider_fullname),
    };
  }

  /**
   * الأجهزة المتصلة — نفس صفحة station_info (getCurrentlyAttachedDevicesInfo + getAttachedCableDevices):
   *   zwrt_router.api.router_get_user_list_num ← access_total_num
   *   router_wireless_access_list {start_id, end_id} (صفحات ٦٤) ← wireless_access_list_info[]
   *   router_lan_access_list ← lan_access_list_info[]  · كل عنصر: mac_address · ip_address · hostname
   * قراءة بس — الحظر ما انضاف (ما شفنا أمره بدليل).
   */
  async getDevices(): Promise<ConnectedDevice[]> {
    const out: ConnectedDevice[] = [];
    const seen = new Set<string>();
    const add = (list: unknown) => {
      for (const x of (Array.isArray(list) ? list : []) as any[]) {
        const mac = str(x?.mac_address).toUpperCase();
        if (!mac || seen.has(mac)) continue;
        seen.add(mac);
        out.push({ mac, ip: str(x?.ip_address) || undefined, name: str(x?.hostname) || undefined });
      }
    };
    const n = await this.authRead(() => this.call('zwrt_router.api', 'router_get_user_list_num', {}));
    const total = Number(str(n.access_total_num)) || 0;
    for (let a = 1; a <= Math.max(total, 1) && a <= 256; a += 64) {
      try { add((await this.call('zwrt_router.api', 'router_wireless_access_list', { start_id: a, end_id: a + 63 })).wireless_access_list_info); } catch {}
    }
    try { add((await this.call('zwrt_router.api', 'router_lan_access_list', {})).lan_access_list_info); } catch {}
    diag(`[zte-ng] الأجهزة: ${out.length} · access_total_num=${total}`);
    if (!out.length && total > 0) throw new Error(`الراوتر يقول ${total} أجهزة بس ما أعطانا القائمة`);
    return out;
  }

  async getTemps(): Promise<DeviceTemp[]> {
    try {
      const t = await this.call('zwrt_bsp.thermal', 'get_cpu_temp', {});
      let c = num(t.cpuss_temp ?? t.cpu_temp ?? t.temp);
      if (c === undefined) return [];
      if (c > 1000) c = c / 1000; else if (c > 150) c = c / 10;
      return c > 0 && c < 130 ? [{ key: 'cpu', label: 'المعالج', c: Math.round(c) }] : [];
    } catch { return []; }
  }

  private async wanStats(): Promise<Record<string, unknown>> {
    return await this.call('zwrt_data', 'get_wwandst', { source_module: 'web', cid: 1, type: 4 });
  }

  async getTraffic(): Promise<Traffic> {
    const w = await this.wanStats();
    return { downBytesPerSec: num(w.real_rx_speed) ?? 0, upBytesPerSec: num(w.real_tx_speed) ?? 0, connectedSecs: num(w.real_time) ?? 0 };
  }

  async getUsage(): Promise<Usage> {
    const w = await this.wanStats();
    return { downloadBytes: num(w.month_rx_bytes) ?? 0, uploadBytes: num(w.month_tx_bytes) ?? 0 };
  }

  async reboot(): Promise<void> {
    await this.write('zwrt_mc.device.manager', 'device_reboot', {});
  }

  // ─── الترددات ووضع الشبكة ───

  useBaseline(b: Record<string, string> | null) { this.orig = b; }
  private baseLte(): number[] | null { const l = bandsOfMask(this.orig?.lte_band_lock); return l.length >= 4 ? l : null; }
  private baseNr(): number[] | null { const l = nrListOf(this.orig?.nr5g_sa_band_lock); return l.length ? l : null; }

  async readBaseline(): Promise<Record<string, string> | null> {
    const d = await this.net();
    if (bandsOfMask(d.lte_band_lock).length < 4) return null;
    const mode = str(d.net_select);
    if (mode === 'Only_LTE' || mode === 'Only_5G') return null;
    const out: Record<string, string> = { lte_band_lock: str(d.lte_band_lock) };
    if (str(d.nr5g_sa_band_lock)) out.nr5g_sa_band_lock = str(d.nr5g_sa_band_lock);
    if (mode) out.net_select = mode;
    return out;
  }

  async getBandConfig(): Promise<BandConfig> {
    const d = await this.net();
    const lte = bandsOfMask(d.lte_band_lock);
    const nr = nrListOf(d.nr5g_sa_band_lock);
    const bl = this.baseLte(), bn = this.baseNr();
    const supported = [...new Set([...LTE_BANDS, ...lte])].sort((a, b) => a - b);
    const nrSupported = [...new Set([...NR_BANDS, ...nr])].sort((a, b) => a - b);
    // «مو مثبّت» = كل الترددات الأصلية مفتوحة (أو القائمة فاضية)
    const locked = !lte.length || (bl ? bl.every(b => lte.includes(b)) : lte.length >= 10) ? [] : lte;
    const nrLocked = !nr.length || (bn ? bn.every(b => nr.includes(b)) : nr.length >= 8) ? [] : nr;
    const mode = NG_TO_CODE[str(d.net_select)] ?? (str(d.net_select) || '00');
    // تثبيت 5G يسري على SA بس — في NSA (مع 4G) ما له أثر، فما نعرضه كخيار
    const sa = /^SA$/i.test(str(d.network_type)) || str(d.net_select) === 'Only_5G';
    return {
      supported, locked, nrSupported: sa ? nrSupported : [], nrLocked, mode,
      modes: [
        { value: '00', label: 'تلقائي' },
        { value: '0803', label: '4G + 5G' },
        { value: '03', label: '4G فقط' },
        { value: '08', label: '5G فقط (SA)' },
      ],
      nrLockable: sa,
      nrPreferred: sa ? [...new Set([...(bn ?? [78, 41, 28]), ...nr])].filter(b => NR_BANDS.includes(b)) : [],
    };
  }

  async setNetworkMode(mode: string): Promise<void> {
    const v = CODE_TO_NG[mode] ?? mode;
    await this.write('zte_nwinfo_api', 'nwinfo_set_netselect', { net_select: v });
  }

  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    if (bands !== 'keep') {
      const lte = bands.length ? bands : (this.baseLte() ?? LTE_BANDS);
      await this.lteLock(lte);
    }
    if (nrBands) {
      const nr = nrBands.length ? nrBands : (this.baseNr() ?? NR_BANDS);
      const cur = nrListOf((await this.net()).nr5g_sa_band_lock);
      if (!sameSet(cur, nr)) await this.nrLock('SA', nr);
    }
  }

  /**
   * تثبيت 4G. U60 Pro: nwinfo_set_gwl_bandlock (قناع عشري). فيرموير MC8830/MU5250: مافيه gwl_bandlock
   * (ACL «web» ما فيه ← Access denied)، وصفحته تثبّت بـ setBandSelect = nwinfo_set_lte_ext_band بنفس الخانات
   * والقناع hex: "0x" + ١٦ خانة (developer_options.js / network_debug.js في نفس كود ZTE — G5 · MC888 · MC801A،
   * مكتبة الملفات ٦ نوفمبر). نجرّب gwl أول؛ رفض صلاحية/أمر مو موجود ← ext ونتذكره لهالراوتر.
   */
  private lteExt = false;
  private async lteLock(bands: number[]): Promise<void> {
    const dec = maskOf(bands);
    const known = extHosts.get(this.host);
    if (known) { this.lteExt = true; this.lteFmt = this.lteFmt ?? known; }
    if (!this.lteExt) {
      try {
        await this.write('zte_nwinfo_api', 'nwinfo_set_gwl_bandlock', { is_gw_band: '0', gw_band_mask: '0', is_lte_band: '1', lte_band_mask: dec }, true);
        return;
      } catch (e: any) {
        // 2 = خانات غلط (MU5252 ٨ نوفمبر: «[2]» على كل تردد) — الأمر موجود بس هالفيرموير يبي lte_ext_band
        if (e?.devNeeded || (e?.code !== -32002 && e?.code !== 2 && e?.code !== 3 && e?.code !== -32601)) throw e;
        diag(`[zte-ng] gwl_bandlock مرفوض (${e?.code}) ← lte_ext_band`);
      }
    }
    // صيغتين لنفس الأمر: صفحة MU5250/MU5252 (FULL ٨ نوفمبر — config.js DEVICE_MODEL "MU5250"، developer_options.js):
    // setBandSelect({ lte_band: "1,3" }) قائمة أرقام بفواصل، والقناع hex يرجع [2] (خانات غلط) — هذا سبب
    // «[2]» على كل تردد. صفحات G5 / MC888: قناع hex. القائمة أول (دليل من صفحة نفس العائلة)، والقناع على [2] بس.
    const fmts: Array<'list' | 'hex'> = this.lteFmt ? [this.lteFmt] : ['list', 'hex'];
    let last: any = null;
    for (const f of fmts) {
      try {
        if (f === 'list') {
          const def = await this.defaultBands();
          const want = def?.lte.length ? bands.filter(b => def.lte.includes(b)) : bands;
          if (!want.length) throw noChange('الترددات المطلوبة مو في قائمة راوترك — ما غيّرنا شي.');
          await this.write('zte_nwinfo_api', 'nwinfo_set_lte_ext_band', { lte_band: want.join(',') });
          diag(`[zte-ng] lte_ext_band ✓ قائمة ${want.join(',')}`);
          // للتشخيص: هل lte_band_lock (القناع اللي نقراه) يتحدّث مع صيغة القائمة؟
          try { const d = await this.net(); diag(`[zte-ng] بعد الكتابة: lte_band_lock=${str(d.lte_band_lock) || '—'} · lte_band=${str(d.lte_band) || '—'}`); } catch {}
        } else {
          const hex = '0x' + BigInt(dec).toString(16).padStart(16, '0');
          await this.write('zte_nwinfo_api', 'nwinfo_set_lte_ext_band', { is_gw_band: '0', gw_band_mask: '0', is_lte_band: '1', lte_band_mask: hex });
          diag(`[zte-ng] lte_ext_band ✓ ${hex}`);
        }
        this.lteExt = true;
        this.lteFmt = f;
        extHosts.set(this.host, f);
        return;
      } catch (e: any) {
        last = e;
        if (e?.code !== 2) throw e;
        diag(`[zte-ng] lte_ext_band (${f}) ← [2] خانات غلط`);
      }
    }
    throw last;
  }
  private lteFmt: 'list' | 'hex' | null = null;

  /** القوائم الافتراضية من الراوتر نفسه (uci zwrt_zte_nwinfo.default_band_lock — getLockBandInfo في صفحته) */
  private defaults: { lte: number[]; sa: number[]; nsa: number[] } | null = null;
  private async defaultBands(): Promise<{ lte: number[]; sa: number[]; nsa: number[] } | null> {
    if (this.defaults) return this.defaults;
    try {
      if (this.session === ZERO && this.password) await this.doLogin();
      const r: any = await this.call('uci', 'get', { config: 'zwrt_zte_nwinfo', section: 'default_band_lock' });
      const v = r?.values ?? r ?? {};
      const l = (x: unknown) => str(x).split(',').map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 300);
      this.defaults = { lte: l(v.default_lte_ext_band_lock), sa: l(v.default_nr5g_sa_band_lock), nsa: l(v.default_nr5g_nsa_band_lock) };
      diag(`[zte-ng] الترددات الافتراضية: 4G ${this.defaults.lte.join(',') || '—'} · SA ${this.defaults.sa.join(',') || '—'} · NSA ${this.defaults.nsa.join(',') || '—'}`);
    } catch { return null; }
    return this.defaults;
  }

  /**
   * تثبيت 5G: U60 Pro يقبل nr5g_type "SA" / "nsa". صفحة MU5252 ترسل "0" (SA) و "1" (NSA) — غيرها يرجع [2].
   * نبدأ بصيغة العائلة ونجرّب الثانية على [2] بس.
   */
  private nrNumeric: boolean | null = null;
  private async nrLock(type: 'SA' | 'NSA', bands: number[]): Promise<void> {
    const def = await (this.lteExt ? this.defaultBands() : Promise.resolve(null));
    const allow = type === 'SA' ? def?.sa : def?.nsa;
    const want = allow?.length ? bands.filter(b => allow.includes(b)) : bands;
    if (!want.length) throw noChange('ترددات 5G المطلوبة مو في قائمة راوترك — ما غيّرنا شي.');
    const numFirst = this.nrNumeric ?? this.lteExt;
    const order = numFirst ? [true, false] : [false, true];
    let last: any = null;
    for (const num of this.nrNumeric === null ? order : [this.nrNumeric]) {
      const t = num ? (type === 'SA' ? '0' : '1') : (type === 'SA' ? 'SA' : 'nsa');
      try {
        await this.write('zte_nwinfo_api', 'nwinfo_set_nrbandlock', { nr5g_type: t, nr5g_band: want.join(',') });
        this.nrNumeric = num;
        return;
      } catch (e: any) {
        last = e;
        if (e?.code !== 2) throw e;
        diag(`[zte-ng] nrbandlock (nr5g_type=${t}) ← [2]`);
      }
    }
    throw last;
  }

  /** لأجهزة G5 (MC801A Pro…): 5G بوضع NSA يحتاج nr5g_type=nsa — لو رفض نجرّب SA */
  async setNrBandsTyped(nr: number[], nsa: boolean): Promise<void> {
    const band = nr.join(',');
    void band;
    if (nsa) {
      try { await this.nrLock('NSA', nr); return; } catch {}
    }
    await this.nrLock('SA', nr);
  }

  async getActiveLock(): Promise<ActiveLock | null> {
    const c = await this.getBandConfig();
    if (!c.locked.length && !c.nrLocked.length) return null;
    return { bands: c.locked, nrBands: c.nrLocked };
  }

  // ─── تثبيت البرج: نقرأه ونفكّه بس (التثبيت موقوف — cellLockRisk) ───

  async getCellLocks(): Promise<CellLockState[]> {
    const d = await this.net();
    const out: CellLockState[] = [];
    const l = str(d.lock_lte_cell).split(',').map(x => x.trim());
    if (l.length >= 2 && l[1] && l[1] !== '0') out.push({ tech: 'LTE', pci: l[0], arfcn: l[1], band: lteBandOf(num(l[1])) });
    const n = str(d.lock_nr_cell).split(',').map(x => x.trim());
    if (n.length >= 2 && n[1] && n[1] !== '0') out.push({ tech: 'NR', pci: n[0], arfcn: n[1], band: bandNum(n[2]) });
    return out;
  }
  async getCellLock(): Promise<CellLockState | null> { return (await this.getCellLocks())[0] ?? null; }

  async unlockCell(tech?: 'LTE' | 'NR'): Promise<void> {
    if (!tech || tech === 'LTE') await this.write('zte_nwinfo_api', 'nwinfo_lock_lte_cell', { lock_lte_pci: '0', lock_lte_earfcn: '0' });
    if (!tech || tech === 'NR') await this.write('zte_nwinfo_api', 'nwinfo_lock_nr_cell', { lock_nr_pci: '0', lock_nr_earfcn: '0', lock_nr_cell_band: '0' });
  }

  // ─── لقطة الإعداد قبل أي تجربة + الإرجاع المتحقق منه ───

  async readLockState(): Promise<LockSnapshot> {
    const d = await this.net();
    const lte = str(d.lte_band_lock), nr = str(d.nr5g_sa_band_lock), mode = str(d.net_select);
    if (!lte && !mode) throw new Error('الراوتر ما رجّع إعدادات الترددات');
    const lb = bandsOfMask(lte), nb = nrListOf(nr);
    const bl = this.baseLte(), bn = this.baseNr();
    const lAuto = lb.length >= 10 || (!!bl && sameSet(lb, bl));
    const nAuto = !nb.length || nb.length >= 8 || (!!bn && sameSet(nb, bn));
    const summary = `4G: ${lAuto ? 'تلقائي' : lb.map(b => 'B' + b).join('+') || 'تلقائي'} · 5G: ${nAuto ? 'تلقائي' : nb.map(b => 'n' + b).join('+')} · ${NG_LABEL[mode] ?? (mode || '—')}`;
    return { driver: this.id, at: Date.now(), summary, data: { lte_band_lock: lte, nr5g_sa_band_lock: nr, net_select: mode } };
  }

  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني');
    const want = snap.data as { lte_band_lock: string; nr5g_sa_band_lock: string; net_select: string };
    const d = await this.net();
    const wl = bandsOfMask(want.lte_band_lock), wn = nrListOf(want.nr5g_sa_band_lock);
    if (wl.length && !sameSet(bandsOfMask(d.lte_band_lock), wl)) {
      await this.lteLock(wl);
    }
    if (wn.length && !sameSet(nrListOf(d.nr5g_sa_band_lock), wn)) {
      await this.nrLock('SA', wn);
    }
    if (want.net_select && str(d.net_select) !== want.net_select) {
      await this.write('zte_nwinfo_api', 'nwinfo_set_netselect', { net_select: want.net_select });
    }
    await new Promise(r => setTimeout(r, 1500));
    const a = await this.net();
    const miss: string[] = [];
    if (wl.length && !sameSet(bandsOfMask(a.lte_band_lock), wl)) miss.push('ترددات 4G');
    if (wn.length && !sameSet(nrListOf(a.nr5g_sa_band_lock), wn)) miss.push('ترددات 5G');
    if (want.net_select && str(a.net_select) !== want.net_select) miss.push('وضع الشبكة');
    if (miss.length) throw restoreMismatch(miss);
  }

  /** إنقاذ: يرجّع الإعدادات الأصلية (أو كل الترددات)، يفك أي تثبيت برج، ويعيد التشغيل */
  async restoreAll(baseline: Record<string, string> | null): Promise<void> {
    const b = baseline ?? this.orig;
    const lte = bandsOfMask(b?.lte_band_lock);
    const nr = nrListOf(b?.nr5g_sa_band_lock);
    try { await this.lteLock(lte.length >= 4 ? lte : LTE_BANDS); } catch {}
    try { await this.nrLock('SA', nr.length ? nr : NR_BANDS); } catch {}
    try { await this.write('zte_nwinfo_api', 'nwinfo_set_netselect', { net_select: b?.net_select || 'WL_AND_5G' }); } catch {}
    try { await this.unlockCell(); } catch {}
    try { await this.reboot(); } catch {}
  }
}
