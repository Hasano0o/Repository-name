/**
 * Nokia FastMile 6.1 (زين — واجهة Angular الجديدة «EAA Phase 3»، 192.168.1.1) — من ملفات صفحة عضو (٣١ أكتوبر، router-Nokia-6-1).
 * درايفر لحاله: صفحته وبروتوكوله غير FastMile 3.1 (./index) — أي تعديل هنا ما يلمس 3.1.
 *
 * من كود الصفحة (main.da0b… + 797.a93b…):
 *   الدخول (isFWADevice): POST login_web_app.cgi?nonce «userName=» ← {nonce, randomKey, iterations, pubkey}
 *     ← POST login_web_app.cgi?salt «userhash&nonce» ← {alati}
 *     ← secret = hex(SHA256(alati+كلمة)) مكرر iterations ثم sha256(user, secret) ← POST login_web_app.cgi ← {result 0, token, sid}
 *     result ‎-1 كلمة غلط (failurecount) · ‎-2 حاول بعدين.
 *   «ubus»: POST JSON service_function_web_app.cgi {version:1, csrf_token, id:1, interface:"Nokia.GenericService", service:"OAM", function, paralist}
 *     ← {result 0, FunctionResult}. ما ينشفّر.
 *   POST_CSRF (إعادة التشغيل…): الجسم + csrf_token مشفّر بـ pubkey (encrypt_post_data — ./crypto nkEncryptPost).
 *
 * الموجود وبنيناه: الإشارة (status_get_web_app.cgi = نفس خانات 3.1) + الدمج (GetCAState) · معلومات الجهاز والشريحة ·
 *   استهلاك الشريحة · إعادة التشغيل · **الترددات 4G و5G** (Get/SetSupportedCellularBands — بس لو BandLockMode = String_based مثل الصفحة) ·
 *   **وضع الشبكة** (Get/SetCellularAccessConfig: 1 = SA+NSA · 2 = NSA · 3 = SA · 4 = LTE).
 * موجود بصفحته وما انضاف للحين: تثبيت الأبراج (قائمة خلايا cell_management + SetCellLockConfig) — ننتظر أول تجربة للترددات.
 * لسا ما انجرّب على راوتر حقيقي.
 */
import * as Crypto from 'expo-crypto';
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, Carrier, Usage, DeviceDetails, BandConfig,
} from '../types';
import { http } from '../http';
import { noChange } from '../noChange';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import { nkLoginBody, nkSha256url, nkEscape, nkEncryptPost } from './crypto';
import { rawFrom, signalFrom, carriersFrom, cellsFrom, bandNum, NkRaw } from './parse';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand = (n: number) => Crypto.getRandomBytes(n);

/** وضع الشبكة: AccessModeNo في الصفحة ← أكواد التطبيق (نفس اللي في OPPO/هواوي) */
export const NK_MODES: { no: number; code: string; label: string }[] = [
  { no: 1, code: '00', label: 'تلقائي (5G SA/NSA + 4G)' },
  { no: 2, code: 'nsa', label: '5G NSA فقط' },
  { no: 3, code: '08', label: '5G SA فقط' },
  { no: 4, code: '03', label: '4G فقط' },
];

/** GetCAState ← نفس شكل cell_CA_stats_cfg في 3.1 عشان نستخدم نفس القارئ (LTEDLCA ثم NRDLCA) */
export function caFrom(r: any): any {
  const x = r?.FunctionResult && (r.FunctionResult.LTEDLCA || r.FunctionResult.NRDLCA) ? r.FunctionResult : r;
  const lte: any[] = Array.isArray(x?.LTEDLCA) ? x.LTEDLCA : [];
  const nr: any[] = Array.isArray(x?.NRDLCA) ? x.NRDLCA : [];
  const ca: any = { X_ALU_COM_DLCarrierAggregationNumberOfEntries: lte.length + nr.length };
  let i = 1;
  for (const c of lte) ca[i++] = { ScellBand: String(c.ScellBand ?? '').replace(/^\s*n/i, ''), ScellChannel: c.DownlinkEarfcn, PhysicalCellID: c.PhysicalCellID };
  for (const c of nr) { const b = bandNum(c.ScellBand); ca[i++] = { ScellBand: b ? 'n' + b : '', ScellChannel: c.Downlinkarfcn, PhysicalCellID: c.PhysicalCellID }; }
  return ca;
}

export interface NkBands { mode: string; b4: { Band: unknown; Enable: boolean }[]; b5: { Band: unknown; ForNSA: boolean; ForSA: boolean }[] }
export function bandsFrom(fr: any): NkBands {
  return {
    mode: String(fr?.BandLockMode ?? ''),
    b4: (Array.isArray(fr?.Bands4G) ? fr.Bands4G : []).map((b: any) => ({ Band: b.Band, Enable: !!b.Enable })),
    b5: (Array.isArray(fr?.Bands5G) ? fr.Bands5G : []).map((b: any) => ({ Band: b.Band, ForNSA: !!b.ForNSA, ForSA: !!b.ForSA })),
  };
}

export class NokiaFwaDriver implements RouterDriver {
  id = 'nokia-fwa';
  name = 'Nokia FastMile 6.1';
  capabilities: Capability[] = ['signal', 'cells', 'reboot', 'usage', 'bandLock'];

  private host = '';
  private token = '';
  private pubkey = '';
  private model = '';

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private hdr(json = false): Record<string, string> {
    return { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', Accept: 'application/json, text/plain, */*', Referer: this.base() + '/web_whw/' };
  }
  private async req(path: string, body?: string, json = false, timeout = 10000): Promise<any> {
    const r = await http(`${this.base()}/${path}`, body === undefined ? { headers: this.hdr() } : { method: 'POST', headers: this.hdr(json), body }, timeout);
    if (r.status === 401 || r.status === 403) throw new Error('انتهت الجلسة');
    const t = (await r.text()).trim();
    if (!r.ok) throw new Error(`${path.split('?')[0]}: HTTP ${r.status}`);
    if (!t) return {};
    try { return JSON.parse(t); } catch {
      if (/<html|<!doctype/i.test(t)) throw new Error('انتهت الجلسة');
      throw new Error(`${path.split('?')[0]}: رد غير متوقع`);
    }
  }
  /** نداء «ubus» مثل callUBUS في الصفحة */
  private async ubus(fn: string, paralist: unknown[] = []): Promise<any> {
    const body = JSON.stringify({ version: 1, csrf_token: this.token, id: 1, interface: 'Nokia.GenericService', service: 'OAM', function: fn, paralist });
    const r = await this.req('service_function_web_app.cgi', body, true);
    const d = r && typeof r === 'object' && 'data' in r && r.data && typeof r.data === 'object' && 'result' in r.data ? r.data : r;
    return d;
  }
  private async ubusOk(fn: string, paralist: unknown[] = [], what = fn): Promise<any> {
    const d = await this.ubus(fn, paralist);
    if (Number(d?.result) !== 0) throw new Error(`${what}: الراوتر رفض (${d?.reason ?? d?.result ?? 'رد غير متوقع'})`);
    return d.FunctionResult ?? {};
  }
  /** POST_CSRF: الجسم + csrf_token مشفّر بمفتاح الراوتر */
  private postCsrf(path: string, data?: string, timeout?: number) {
    const plain = (data ? data + '&' : '') + 'csrf_token=' + this.token;
    return this.req(path, this.pubkey ? nkEncryptPost(this.pubkey, plain, rand) : plain, false, timeout);
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const r = await http(this.base() + '/', {}, 4000);
      if (r.status >= 400) return false;
      const t = await r.text();
      // 3.1 = main-es2015 + «FastMile» في العنوان (./index) — 6.1 = main.<hash>.js بدون عنوان
      if (!/web_whw/i.test(t) || /main-es2015/i.test(t)) return false;
      const n = await this.req('login_web_app.cgi?nonce');
      return !!n?.nonce && !!n?.pubkey;
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    if (!this.model) {
      try { this.model = String((await this.req('main_web_app.cgi'))?.gwmodel ?? '').trim(); } catch {}
    }
    const m = this.model;
    return {
      id: 'nokia-fwa' + (m ? '-' + m.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : ''),
      label: 'Nokia FastMile 6.1' + (m ? ` (${m})` : ''), brand: 'nokia', tech: '5G', nrLock: true,
    };
  }

  async login(host: string, username: string, password: string): Promise<void> {
    this.host = host;
    this.token = '';
    const user = (username || '').trim() || 'admin';
    const n = await this.req('login_web_app.cgi?nonce', `userName=${encodeURIComponent(user)}`);
    const nonce = String(n?.nonce ?? '');
    if (!nonce) throw new Error('login_web_app: الراوتر ما أعطى nonce');
    this.pubkey = String(n?.pubkey ?? '');
    const s = await this.req('login_web_app.cgi?salt', `userhash=${nkSha256url(user, nonce)}&nonce=${nkEscape(nonce)}`);
    const salt = String(s?.alati ?? '');
    const iters = Number(n?.iterations) || 0;
    const { body } = nkLoginBody(user, password, nonce, String(n?.randomKey ?? ''), rand, iters, salt);
    const r = await this.req('login_web_app.cgi', body, false, 30000);
    const res = Number(r?.result);
    if (res === 0 && r?.token) { this.token = String(r.token); return; }
    if (res === -2) throw new Error('الراوتر قفل الدخول بعد محاولات غلط — انتظر شوي وجرّب (محاولات كثيرة)');
    if (res === -1) throw new Error('كلمة المرور غلط' + (r?.failurecount ? ` (المحاولة ${r.failurecount})` : '') + ' — في نوكيا اسم المستخدم غالباً admin والكلمة تحت الراوتر');
    throw new Error(`تعذّر تسجيل الدخول (login_web_app: ${r?.result ?? 'رد غير متوقع'})`);
  }
  async logout(): Promise<void> {
    try { await this.req('login_web_app.cgi?out'); } catch {}
    this.token = '';
  }

  // ═══ الإشارة ═══
  private async raw(): Promise<NkRaw> {
    const [st, ca] = await Promise.all([this.req('status_get_web_app.cgi'), this.ubus('GetCAState').catch(() => null)]);
    if (!st || typeof st !== 'object' || (!st.cell_LTE_stats_cfg && !st.cell_5G_stats_cfg)) throw new Error('status_get: رد غير متوقع');
    const raw = rawFrom(st);
    if (ca) raw.ca = caFrom(ca);
    return raw;
  }
  async getSignal(): Promise<Signal> { return signalFrom(await this.raw()); }
  async getCells(): Promise<CellTower[]> { return cellsFrom(signalFrom(await this.raw())); }
  async getCarriers(): Promise<Carrier[]> { return carriersFrom(await this.raw()); }
  async getSnapshot(): Promise<SignalSnapshot> {
    const r = await this.raw();
    return buildSnapshot(signalFrom(r), carriersFrom(r), cellsFrom(signalFrom(r)), { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const s = signalFrom(await this.raw());
    return { connected: s.rsrp !== undefined || s.nrRsrp !== undefined, mode: s.network, supports5g: true };
  }
  async isConnected(): Promise<boolean> {
    try { const s = signalFrom(await this.raw()); return s.rsrp !== undefined || s.nrRsrp !== undefined; } catch { return false; }
  }
  async getUsage(): Promise<Usage> {
    const c = (await this.raw()).cell ?? {};
    return { downloadBytes: Number(c.BytesReceived) || 0, uploadBytes: Number(c.BytesSent) || 0 };
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const [st, raw] = await Promise.all([this.req('fastmile_statistics_status_web_app.cgi').catch(() => null), this.raw().catch(() => null)]);
    const sim = st?.sim_cfg?.[0] ?? {};
    await this.identify();
    return {
      model: this.model ? 'FastMile 6.1 · ' + this.model : 'FastMile 6.1', imei: st?.network_cfg?.[0]?.IMEI || undefined,
      simStatus: sim.Status || undefined, wanIp: raw?.apn?.X_ALU_COM_IPAddressV4 || undefined,
    };
  }

  async reboot(): Promise<void> {
    try { await this.postCsrf('reboot_web_app.cgi'); } catch (e) {
      if (!/تعذر الاتصال|ما رد|timeout|network|abort/i.test(String((e as any)?.message ?? e))) throw e;
    }
  }

  // ═══ الترددات ووضع الشبكة (صفحة «Cellular configuration») ═══
  private async bands(): Promise<NkBands> {
    return bandsFrom(await this.ubusOk('GetSupportedCellularBands', [], 'قائمة الترددات'));
  }
  private async accessMode(): Promise<number> {
    return Number((await this.ubusOk('GetCellularAccessConfig', [], 'وضع الشبكة'))?.AccessModeNo) || 0;
  }
  async getBandConfig(): Promise<BandConfig> {
    const [b, no] = await Promise.all([this.bands(), this.accessMode().catch(() => 0)]);
    const n4 = b.b4.map(x => bandNum(x.Band)).filter((x): x is number => !!x);
    const on4 = b.b4.filter(x => x.Enable).map(x => bandNum(x.Band)).filter((x): x is number => !!x);
    const n5 = b.b5.map(x => bandNum(x.Band)).filter((x): x is number => !!x);
    const on5 = b.b5.filter(x => x.ForNSA || x.ForSA).map(x => bandNum(x.Band)).filter((x): x is number => !!x);
    const editable = b.mode === 'String_based';
    return {
      supported: n4, locked: editable && on4.length < n4.length ? on4 : [],
      nrSupported: editable ? n5 : [], nrLocked: editable && on5.length < n5.length ? on5 : [],
      nrLockable: editable && n5.length > 0 ? undefined : false,
      mode: NK_MODES.find(m => m.no === no)?.code ?? '', modes: NK_MODES.map(m => ({ value: m.code, label: m.label })),
    };
  }
  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const b = await this.bands();
    // الصفحة نفسها تعرض قائمة الترددات للتعديل بس في وضع String_based — غيره (Object_based) معلومات بس
    if (b.mode !== 'String_based') throw noChange('راوترك ما يسمح بتعديل الترددات من صفحته (القائمة للعرض بس) — ما غيّرنا شي.');
    const has4 = (n: number) => b.b4.some(x => bandNum(x.Band) === n);
    const has5 = (n: number) => b.b5.some(x => bandNum(x.Band) === n);
    let b4 = b.b4, b5 = b.b5;
    if (bands !== 'keep') {
      const want = bands.filter(has4);
      if (bands.length && !want.length) throw noChange('الترددات اللي اخترتها ما تطلع في قائمة راوترك — ما غيّرنا شي.');
      b4 = b.b4.map(x => ({ Band: x.Band, Enable: !want.length || want.includes(bandNum(x.Band) ?? -1) }));
    }
    if (nrBands !== undefined) {
      const want = nrBands.filter(has5);
      if (nrBands.length && !want.length) throw noChange('ترددات 5G اللي اخترتها ما تطلع في قائمة راوترك — ما غيّرنا شي.');
      b5 = b.b5.map(x => { const on = !want.length || want.includes(bandNum(x.Band) ?? -1); return { Band: x.Band, ForNSA: on, ForSA: on }; });
    }
    if (b4.length && !b4.some(x => x.Enable)) throw noChange('لازم يبقى تردد 4G واحد على الأقل — ما غيّرنا شي.');
    const same = JSON.stringify(b4) === JSON.stringify(b.b4) && JSON.stringify(b5) === JSON.stringify(b.b5);
    if (same) return;
    const payload: Record<string, unknown> = {};
    if (b4.length) payload.Bands4G = b4;
    if (b5.length) payload.Bands5G = b5;
    await this.ubusOk('SetSupportedCellularBands', [payload], 'الترددات');
    await sleep(3000);
    const after = await this.bands();
    const on = (l: { Band: unknown; Enable: boolean }[]) => l.filter(x => x.Enable).map(x => bandNum(x.Band)).sort().join(',');
    if (on(after.b4) !== on(b4)) throw new Error('الراوتر قبل أمر الترددات بس القراءة بعده مختلفة');
  }
  async setNetworkMode(mode: string): Promise<void> {
    const m = NK_MODES.find(x => x.code === mode);
    if (!m) throw noChange('هالوضع مو موجود في راوترك — ما غيّرنا شي.');
    if ((await this.accessMode().catch(() => 0)) === m.no) return;
    await this.ubusOk('SetCellularAccessConfig', [{ AccessModeNo: m.no }], 'وضع الشبكة');
    await sleep(2000);
    if ((await this.accessMode()) !== m.no) throw new Error('الراوتر قبل أمر وضع الشبكة بس ما تغيّر');
  }
}
