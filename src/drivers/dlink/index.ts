/**
 * D-Link DWR-2000M (4G) و DWR-3000M (5G) — 192.168.0.1، صفحة React («cpe-webui»)، واجهة JSON على /acfun/.
 * كل شي من ملفات صفحة الراوتر الحقيقية (ملفين DWR-2000M/MOB + ملف DWR-3000M، ٣١ أكتوبر):
 *   الطلب: GET بالخانات في الرابط · POST بجسم JSON · Content-Type: application/json · الجلسة بالكوكي (-goahead-session-)
 *   الرد: {errcode, msg, info, waitime?} — errcode 0/فاضي = تمام · 6 = الجلسة راحت · 22 = قفل بعد ٥ محاولات غلط
 *         waitime = ثواني تطبيق الإعداد (الصفحة تعدّها قبل ما ترجع) — ننتظرها قبل قراءة التأكيد
 *   الدخول: getLoginKey?username ← PublicKey + Challenge ← HMAC-MD5 مرتين (./crypto) ← POST /acfun/login {username, password}
 *           المفتاح الأول (cipherKey) يشفّر خانات حساسة (كلمة الواي فاي، APN) — dlEncrypt/dlDecrypt
 *
 * الموجود في صفحته وبنيناه (٧ نوفمبر):
 *   الإشارة 4G/5G والدمج · الشركة والحالة · معلومات الجهاز · الأجهزة المتصلة
 *   تثبيت الترددات (bandLockSetup — نوع شبكة واحد بالمرة: {bandLockEnabled, netType, enabledBand "3,20"})
 *   تثبيت البرج (cellLockSetup — {cellLockEnabled, netType, pcid, arfcn, (5G) band, scs})
 *   وضع الشبكة (mobileNetworkBasicSetting — نفس نموذج APN كامل مع netType)
 *   لقطة + إرجاع متحقق منه · إنقاذ (فك الكل + تلقائي)
 *   الرسائل (getsmsList / sendsms / delsms) · الواي فاي (الاسم، الكلمة، القناة، تشغيل/إطفاء — لكل نطاق)
 *   حظر الأجهزة (تحكم الواي فاي: wlanCtrlSetting «deny» / wlanCtrlDel) · إعادة التشغيل · ضبط المصنع
 * كل تغيير نتأكد منه بإعادة القراءة. لسا ما انجرّب على راوتر حقيقي.
 */
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, Carrier, ConnectedDevice, DeviceDetails, BandConfig,
  ActiveLock, CellLockTarget, CellLockState, SmsMessage, WifiRadio, RouterExtras,
} from '../types';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { http } from '../http';
import { noChange } from '../noChange';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import { dlLoginHash, dlEncrypt, dlDecrypt } from './crypto';
import {
  signalFrom, carriersFrom, cellsFrom, connectedFrom, devicesFrom, bandConfigFrom, bandTokens, nrKeys,
  DL_MODES, modeCode, smsFrom, splitPhone, nrScs,
} from './parse';

const NET_ERR = /تعذر الاتصال|ما رد|timeout|network|abort|انقطع/i;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const BANDS = { '2.4': '2.4GHz', '5': '5GHz' } as const;
const isMac = (m: string) => /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(m);
const truthy = (v: unknown) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

interface DlLockData {
  band: { enabled: boolean; netType: string; enabledBand: string };
  cell: { enabled: boolean; netType: string; pcid: string; arfcn: string; band?: string; scs?: string };
  mode: string;
}

export class DlinkDriver implements RouterDriver {
  id = 'dlink';
  name = 'D-Link';
  capabilities: Capability[] = ['signal', 'cells', 'reboot', 'devices', 'bandLock', 'sms', 'block'];

  private host = '';
  private model = '';
  private loggedIn = false;
  /** cipherKey — المفتاح الأول من الدخول (الصفحة تحفظه في localStorage) */
  private key = '';
  /** وقت انتظار آخر أمر (ثواني) — نختصره في الاختبارات */
  waitScale = 1000;

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private is5g() { return /3000|5g/i.test(this.model); }

  /** نفس طبقة الطلبات في الصفحة (موديول 72) */
  private async req(method: 'GET' | 'POST', path: string, data?: unknown, opts: { raw?: boolean; timeout?: number } = {}): Promise<any> {
    let url = `${this.base()}/acfun/${path}`;
    const init: RequestInit = { method, headers: { 'content-type': 'application/json', lang: 'en' } };
    if (method === 'GET') {
      const q = Object.entries((data ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
      if (q) url += '?' + q;
    } else if (data !== undefined) init.body = JSON.stringify(data);
    const r = await http(url, init, opts.timeout ?? 10000);
    if (r.status === 401 || r.status === 403) throw new Error('انتهت الجلسة');
    const t = (await r.text()).trim();
    if (r.status !== 200) throw new Error(`${path}: HTTP ${r.status}`);
    let j: any;
    try { j = JSON.parse(t); } catch {
      // الصفحة ترجّع index.html لأي رابط ما تعرفه
      throw new Error(/<html|<!doctype/i.test(t) ? `${path}: الراوتر رجّع صفحة بدل بيانات` : `${path}: رد غير متوقع`);
    }
    if (opts.raw) return j;
    const code = Number(j?.errcode ?? 0);
    if (code === 6) { this.loggedIn = false; throw new Error('انتهت الجلسة'); }
    if (code === 22) throw new Error('الراوتر قفل الدخول بعد ٥ محاولات غلط — انتظر شوي وجرّب');
    if (code) throw new Error(`${path}: الراوتر رفض (${code}${j?.msg ? ' ' + String(j.msg).slice(0, 60) : ''})`);
    return method === 'POST' ? j : (j?.info ?? {});
  }
  private get = (p: string, d?: Record<string, unknown>) => this.req('GET', p, d);
  /** أمر كتابة + انتظار waitime (الصفحة تعدّه قبل ما ترجع) — حد أعلى ٦٠ث */
  private async post(p: string, d?: unknown, opts: { wait?: boolean; timeout?: number } = {}): Promise<any> {
    const j = await this.req('POST', p, d, { timeout: opts.timeout });
    if (opts.wait !== false) {
      const w = Math.min(60, Math.max(3, Number(j?.waitime) || 0));
      await sleep(w * this.waitScale);
    }
    return j;
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const j = await this.req('GET', 'getProductModelInfo', undefined, { raw: true, timeout: 5000 });
      if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
      const m = String(j?.info?.model ?? '').trim();
      if (m) this.model = m;
      return 'errcode' in j && (!!m || (j.info && typeof j.info === 'object'));
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    if (!this.model) {
      try { this.model = String((await this.req('GET', 'getProductModelInfo', undefined, { raw: true, timeout: 5000 }))?.info?.model ?? '').trim(); } catch {}
    }
    const m = this.model;
    const label = m ? (/d-?link/i.test(m) ? m : 'D-Link ' + m) : 'D-Link DWR';
    const id = 'dlink' + (m ? '-' + m.toLowerCase().replace(/^d-?link\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '');
    return { id, label, brand: 'dlink', tech: this.is5g() ? '5G' : '4G', nrLock: this.is5g() };
  }

  async login(host: string, username: string, password: string): Promise<void> {
    this.host = host;
    this.loggedIn = false;
    const user = (username || '').trim() || 'admin';
    const k = await this.req('GET', 'getLoginKey', { username: user }, { raw: true });
    if (Number(k?.errcode ?? 0)) {
      if (Number(k.errcode) === 22) throw new Error('الراوتر قفل الدخول بعد ٥ محاولات غلط — انتظر شوي وجرّب');
      throw new Error(`getLoginKey: الراوتر رفض (${k.errcode}${k.msg ? ' ' + String(k.msg).slice(0, 60) : ''}) — تأكد من اسم المستخدم (غالباً admin)`);
    }
    const pub = String(k?.info?.PublicKey ?? ''), ch = String(k?.info?.Challenge ?? '');
    if (!pub || !ch) throw new Error('getLoginKey: الراوتر ما أعطى مفتاح الدخول');
    const { password: hash, key } = dlLoginHash(pub, password, ch);
    const r = await this.req('POST', 'login', { username: user, password: hash }, { raw: true });
    const code = Number(r?.errcode ?? 0);
    if (!code) { this.loggedIn = true; this.key = key; return; }
    if (code === 22) throw new Error('الراوتر قفل الدخول بعد ٥ محاولات غلط — انتظر شوي وجرّب');
    const msg = String(r?.msg ?? '');
    if (/password|passwd|pwd|incorrect|wrong|error/i.test(msg) || code === 20 || code === 21)
      throw new Error('كلمة المرور غلط — في D-Link اسم المستخدم غالباً admin والكلمة تحت الراوتر');
    throw new Error(`تعذّر تسجيل الدخول (login: ${code}${msg ? ' ' + msg.slice(0, 60) : ''})`);
  }
  async logout(): Promise<void> {
    try { await this.req('POST', 'logout', {}); } catch {}
    this.loggedIn = false;
  }

  // ═══ الإشارة ═══
  private async rf(): Promise<any> {
    const info = await this.get('getMobileNetStatusParams');
    if (!info || typeof info !== 'object' || (!info.rf && !info.basic)) throw new Error('getMobileNetStatusParams: رد غير متوقع');
    return info;
  }
  private mobile(): Promise<any> {
    return this.get('InternetStatus').then(i => i?.MobileNetwork ?? {}).catch(() => ({}));
  }
  async getSignal(): Promise<Signal> {
    const [info, mob] = await Promise.all([this.rf(), this.mobile()]);
    return signalFrom(info, mob);
  }
  async getCarriers(): Promise<Carrier[]> { return carriersFrom(await this.rf()); }
  async getCells(): Promise<CellTower[]> { return cellsFrom(await this.rf()); }
  async getSnapshot(): Promise<SignalSnapshot> {
    const [info, mob] = await Promise.all([this.rf(), this.mobile()]);
    return buildSnapshot(signalFrom(info, mob), carriersFrom(info), cellsFrom(info), { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const [info, mob] = await Promise.all([this.rf(), this.mobile()]);
    return {
      operator: mob.operators ? String(mob.operators) : undefined,
      connected: connectedFrom(mob, info),
      mode: signalFrom(info, mob).network,
      supports5g: this.is5g() ? true : /2000/.test(this.model) ? false : undefined,
    };
  }
  async isConnected(): Promise<boolean> {
    try {
      const [info, mob] = await Promise.all([this.rf(), this.mobile()]);
      return connectedFrom(mob, info);
    } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const [info, mob] = await Promise.all([this.rf().catch(() => ({} as any)), this.mobile()]);
    const b = info?.basic ?? {};
    return {
      model: this.model || b.productType || undefined, imei: b.imei || mob.imei || undefined,
      software: b.softwareVersion || undefined, hardware: b.hardwareVersion || undefined,
      wanIp: mob.ipAddress || undefined, dns: mob.primary_dns_server || undefined, operator: mob.operators || undefined,
    };
  }

  async reboot(): Promise<void> {
    try { await this.req('POST', 'reboot', ''); } catch (e) {
      // الراوتر يطفي قبل ما يرد أحياناً — مو فشل
      if (!NET_ERR.test(String((e as any)?.message ?? e))) throw e;
    }
  }
  async factoryReset(): Promise<void> {
    try { await this.req('POST', 'reset'); } catch (e) {
      if (!NET_ERR.test(String((e as any)?.message ?? e))) throw e;
    }
  }

  // ═══ الترددات (bandLockSetup — نوع واحد بالمرة) ═══
  private bandInfo() { return this.get('getBandLockInfo'); }

  async getBandConfig(): Promise<BandConfig> {
    const [info, mob] = await Promise.all([this.bandInfo(), this.get('getMobileNetworkBasicConfig').catch(() => null)]);
    const c = bandConfigFrom(info);
    const modes = DL_MODES.filter(m => !m.five || this.is5g());
    return {
      ...c,
      mode: mob?.netType !== undefined ? modeCode(mob.netType) : '00',
      modes: mob && truthy(mob.enable) ? modes.map(m => ({ value: m.code, label: m.label })) : [],
      nrLockable: this.is5g() ? c.nrSupported.length > 0 : undefined,
    };
  }

  /** الجسم اللي ينرسل: {bandLockEnabled, netType, enabledBand} — بنفس رموز allBands حق الراوتر */
  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const info = await this.bandInfo();
    const on = truthy(info?.bandLockEnabled);
    const curNt = String(info?.netType ?? '');
    const lteWant = bands === 'keep' ? undefined : bands;
    const nrWant = nrBands;
    if (lteWant?.length && nrWant?.length) throw noChange('راوترك يثبّت نوع شبكة واحد بالمرة (4G أو 5G) — اختر ترددات 4G بس أو 5G بس. ما غيّرنا شي.');

    let body: { bandLockEnabled: boolean; netType: string; enabledBand: string } | null = null;
    const pick = (nt: string, want: number[]) => {
      const av = bandTokens(info?.[nt]?.allBands);
      if (!av.length) throw noChange(`راوترك ما أعطى قائمة ترددات ${nt} — ما غيّرنا شي.`);
      const toks = want.map(b => av.find(x => x.n === b)?.t).filter((x): x is string => !!x);
      if (!toks.length) throw noChange('الترددات اللي اخترتها ما تطلع في قائمة راوترك — ما غيّرنا شي.');
      return { bandLockEnabled: true, netType: nt, enabledBand: toks.join(',') };
    };
    if (lteWant?.length) body = pick('4G', lteWant);
    else if (nrWant?.length) {
      const nt = nrKeys(info)[0];
      if (!nt) throw noChange('راوترك ما يعطي ترددات 5G للتثبيت — ما غيّرنا شي.');
      body = pick(nt, nrWant);
    } else {
      // فك: بس لو المثبّت حالياً من النوع اللي انطلب فكّه
      const clearLte = lteWant !== undefined && curNt === '4G';
      const clearNr = nrWant !== undefined && /^5G/.test(curNt);
      if (on && (clearLte || clearNr)) body = { bandLockEnabled: false, netType: curNt, enabledBand: String(info?.[curNt]?.enabledBand ?? '') };
    }
    if (!body) return;
    if (body.bandLockEnabled && on && curNt === body.netType && sameSet(String(info?.[curNt]?.enabledBand ?? ''), body.enabledBand)) return;
    await this.post('bandLockSetup', body);
    const a = await this.bandInfo();
    const ok = body.bandLockEnabled
      ? truthy(a?.bandLockEnabled) && String(a?.netType) === body.netType && sameSet(String(a?.[body.netType]?.enabledBand ?? ''), body.enabledBand)
      : !truthy(a?.bandLockEnabled);
    if (!ok) throw new Error(`الراوتر قبل أمر الترددات بس القراءة بعده مختلفة (bandLockSetup: ${String(a?.netType ?? '')} ${String(a?.[body.netType]?.enabledBand ?? '')})`);
  }

  // ═══ وضع الشبكة (mobileNetworkBasicSetting — نموذج APN كامل) ═══
  private async mobileCfg(): Promise<any> {
    const c = await this.get('getMobileNetworkBasicConfig');
    if (!c || typeof c !== 'object') throw new Error('getMobileNetworkBasicConfig: رد غير متوقع');
    return c;
  }
  async setNetworkMode(code: string): Promise<void> {
    const m = DL_MODES.find(x => x.code === code && (!x.five || this.is5g()));
    if (!m) throw noChange('هالوضع مو موجود في راوترك — ما غيّرنا شي.');
    const c = await this.mobileCfg();
    if (!truthy(c.enable)) throw noChange('الاتصال بالشريحة مطفي في صفحة الراوتر — شغّله أول. ما غيّرنا شي.');
    if (String(c.netType ?? '').toUpperCase() === m.value) return;
    if (!this.key && (c.userName || c.password)) throw new Error('انتهت الجلسة');
    // مثل الصفحة: تفك اسم/كلمة APN بالمفتاح وتشفّرها من جديد قبل الإرسال
    const body: Record<string, unknown> = { ...c, netType: m.value };
    for (const f of ['userName', 'password'] as const) if (c[f]) body[f] = dlEncrypt(dlDecrypt(String(c[f]), this.key), this.key);
    if (m.value === '5G' && !body.netMode) body.netMode = 'AUTO';
    await this.post('mobileNetworkBasicSetting', body);
    const a = await this.mobileCfg();
    if (String(a.netType ?? '').toUpperCase() !== m.value) throw new Error('الراوتر قبل أمر وضع الشبكة بس ما تغيّر');
  }

  // ═══ تثبيت البرج (cellLockSetup) ═══
  private cellInfo() { return this.get('getCellLockInfo'); }
  async getCellLocks(): Promise<CellLockState[]> {
    const c = await this.cellInfo();
    if (!truthy(c?.cellLockEnabled) || !String(c?.pcid ?? '')) return [];
    return [{ tech: /^5G/.test(String(c.netType)) ? 'NR' : 'LTE', pci: String(c.pcid), arfcn: String(c.arfcn ?? ''), band: Number(c.band) || undefined }];
  }
  async getCellLock(): Promise<CellLockState | null> { return (await this.getCellLocks())[0] ?? null; }

  async lockCell(t: CellLockTarget): Promise<void> {
    const pci = String(t.pci ?? '').trim(), arfcn = String(t.arfcn ?? '').trim();
    if (!/^\d+$/.test(pci)) throw noChange('ما عندنا رقم البرج (PCI) — ما نقدر نثبّت عليه');
    if (!/^\d+$/.test(arfcn)) throw noChange('الراوتر ما أعطانا رقم قناة هذا البرج — ثبّت التردد بدلاً منه');
    let body: Record<string, unknown>;
    if (t.tech === 'NR') {
      if (!this.is5g()) throw noChange('راوترك 4G — ما فيه تثبيت برج 5G. ما غيّرنا شي.');
      const scs = nrScs(t.band);
      if (!t.band || !scs) throw noChange('ما نعرف إعداد SCS لهالتردد بأمان — ما غيّرنا شي.');
      const nt = nrKeys(await this.bandInfo().catch(() => ({})))[0] ?? '5G';
      body = { cellLockEnabled: true, netType: nt, pcid: pci, arfcn, band: String(t.band), scs: String(scs) };
    } else {
      body = { cellLockEnabled: true, netType: '4G', pcid: pci, arfcn };
    }
    const cur = await this.cellInfo();
    if (truthy(cur?.cellLockEnabled) && String(cur.pcid) === pci && String(cur.arfcn) === arfcn && String(cur.netType) === body.netType) return;
    await this.post('cellLockSetup', body);
    const a = await this.cellInfo();
    if (!truthy(a?.cellLockEnabled) || String(a.pcid) !== pci || String(a.arfcn) !== arfcn) throw new Error('الراوتر قبل أمر تثبيت البرج بس القراءة بعده مختلفة');
  }
  async unlockCell(): Promise<void> {
    const c = await this.cellInfo();
    if (!truthy(c?.cellLockEnabled)) return;
    const body: Record<string, unknown> = { cellLockEnabled: false, netType: String(c.netType ?? '4G'), pcid: String(c.pcid ?? ''), arfcn: String(c.arfcn ?? '') };
    if (/^5G/.test(String(c.netType))) { body.band = String(c.band ?? ''); body.scs = String(c.scs ?? ''); }
    await this.post('cellLockSetup', body);
    if (truthy((await this.cellInfo())?.cellLockEnabled)) throw new Error('الراوتر قبل أمر فك البرج بس لسا مثبّت');
  }
  async getActiveLock(): Promise<ActiveLock | null> {
    const c = bandConfigFrom(await this.bandInfo());
    const cell = (await this.getCellLocks().catch(() => []))[0];
    if (!c.locked.length && !c.nrLocked.length && !cell) return null;
    return { bands: c.locked, nrBands: c.nrLocked, pci: cell?.pci };
  }

  // ═══ لقطة + إرجاع متحقق منه ═══
  async readLockState(): Promise<LockSnapshot> {
    const [b, c, m] = await Promise.all([this.bandInfo(), this.cellInfo(), this.mobileCfg()]);
    const nt = String(b?.netType ?? '');
    const data: DlLockData = {
      band: { enabled: truthy(b?.bandLockEnabled), netType: nt, enabledBand: String(b?.[nt]?.enabledBand ?? '') },
      cell: { enabled: truthy(c?.cellLockEnabled), netType: String(c?.netType ?? ''), pcid: String(c?.pcid ?? ''), arfcn: String(c?.arfcn ?? ''),
        band: c?.band !== undefined ? String(c.band) : undefined, scs: c?.scs !== undefined ? String(c.scs) : undefined },
      mode: String(m?.netType ?? ''),
    };
    const bandTxt = data.band.enabled ? `${nt}: ${data.band.enabledBand || '-'}` : 'الترددات تلقائي';
    const summary = `${bandTxt} · ${data.mode || 'AUTO'}${data.cell.enabled ? ` · برج ${data.cell.pcid}` : ''}`;
    return { driver: this.id, at: Date.now(), summary, data };
  }
  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    const d = snap.data as DlLockData;
    const miss: string[] = [];
    // البرج أول (يفك قبل الترددات عشان ما يعلق على برج خارج الترددات الجديدة)
    try {
      const c = await this.cellInfo();
      if (!d.cell.enabled) { if (truthy(c?.cellLockEnabled)) await this.unlockCell(); }
      else if (!(truthy(c?.cellLockEnabled) && String(c.pcid) === d.cell.pcid && String(c.arfcn) === d.cell.arfcn)) {
        const body: Record<string, unknown> = { cellLockEnabled: true, netType: d.cell.netType, pcid: d.cell.pcid, arfcn: d.cell.arfcn };
        if (/^5G/.test(d.cell.netType)) { body.band = d.cell.band ?? ''; body.scs = d.cell.scs ?? ''; }
        await this.post('cellLockSetup', body);
      }
      const a = await this.cellInfo();
      if (truthy(a?.cellLockEnabled) !== d.cell.enabled || (d.cell.enabled && String(a.pcid) !== d.cell.pcid)) miss.push('تثبيت البرج');
    } catch { miss.push('تثبيت البرج'); }
    try {
      const b = await this.bandInfo();
      const nt = String(b?.netType ?? '');
      const same = truthy(b?.bandLockEnabled) === d.band.enabled
        && (!d.band.enabled || (nt === d.band.netType && sameSet(String(b?.[nt]?.enabledBand ?? ''), d.band.enabledBand)));
      if (!same) {
        await this.post('bandLockSetup', d.band.enabled
          ? { bandLockEnabled: true, netType: d.band.netType, enabledBand: d.band.enabledBand }
          : { bandLockEnabled: false, netType: nt || d.band.netType || '4G', enabledBand: String(b?.[nt]?.enabledBand ?? '') });
        const a = await this.bandInfo();
        const ok = truthy(a?.bandLockEnabled) === d.band.enabled
          && (!d.band.enabled || (String(a?.netType) === d.band.netType && sameSet(String(a?.[d.band.netType]?.enabledBand ?? ''), d.band.enabledBand)));
        if (!ok) miss.push('الترددات');
      }
    } catch { miss.push('الترددات'); }
    if (d.mode) {
      try {
        const cur = String((await this.mobileCfg()).netType ?? '');
        if (cur.toUpperCase() !== d.mode.toUpperCase()) await this.setNetworkMode(modeCode(d.mode));
      } catch { miss.push('وضع الشبكة'); }
    }
    if (miss.length) throw restoreMismatch(miss);
  }
  async restoreAll(): Promise<void> {
    try { await this.unlockCell(); } catch {}
    try {
      const b = await this.bandInfo();
      if (truthy(b?.bandLockEnabled)) {
        const nt = String(b.netType ?? '4G');
        await this.post('bandLockSetup', { bandLockEnabled: false, netType: nt, enabledBand: String(b?.[nt]?.enabledBand ?? '') });
      }
    } catch {}
    try { await this.setNetworkMode('00'); } catch {}
  }
  async readBaseline(): Promise<Record<string, string> | null> {
    const [b, c] = await Promise.all([this.bandInfo(), this.cellInfo()]);
    if (truthy(b?.bandLockEnabled) || truthy(c?.cellLockEnabled)) return null;
    const m = await this.mobileCfg().catch(() => null);
    return { mode: String(m?.netType ?? 'AUTO') };
  }

  // ═══ الأجهزة والحظر (تحكم الواي فاي — «Deny Listed» لكل نطاق) ═══
  private async ctrl(band: '2.4' | '5'): Promise<{ mode: string; list: string[] } | null> {
    const cfg = await this.get('getWlanCtrlConfig', { bandType: BANDS[band] }).catch(() => null);
    if (!cfg) return null;
    const l = await this.get('getWlanCtrlList', { bandType: BANDS[band] }).catch(() => null);
    const list = (Array.isArray(l?.list) ? l.list : []).map((x: any) => String(x?.macAddress ?? '').toLowerCase()).filter(isMac);
    return { mode: String(cfg.wlanCtrlMode ?? 'disable'), list };
  }
  async getBlockedDevices(): Promise<ConnectedDevice[]> {
    const out = new Set<string>();
    for (const b of ['2.4', '5'] as const) {
      const c = await this.ctrl(b);
      if (c?.mode === 'deny') c.list.forEach(m => out.add(m));
    }
    return [...out].map(mac => ({ mac, blocked: true }));
  }
  async getDevices(): Promise<ConnectedDevice[]> {
    const [d, bl] = await Promise.all([this.get('ConnectedClients'), this.getBlockedDevices().catch(() => [] as ConnectedDevice[])]);
    const set = new Set(bl.map(x => x.mac));
    return devicesFrom(d).map(x => ({ ...x, blocked: set.has(x.mac) }));
  }
  async blockDevice(mac: string, block: boolean, name?: string): Promise<void> {
    const m = mac.toLowerCase();
    if (!isMac(m)) throw noChange('عنوان الجهاز (MAC) غير صحيح — ما غيّرنا شي.');
    const bands = (['2.4', '5'] as const);
    const st = await Promise.all(bands.map(b => this.ctrl(b)));
    if (!st.some(Boolean)) throw noChange('صفحة راوترك ما أعطت إعداد حظر الأجهزة — ما غيّرنا شي.');
    if (block && st.some(s => s?.mode === 'allow')) throw noChange('حظر الأجهزة في راوترك على «المسموح بس» — غيّره من صفحة الراوتر لو تبي تحظر من هنا. ما غيّرنا شي.');
    // الفلتر مطفي وفيه عناوين قديمة بالقائمة — لو شغّلناه «حظر» تنحظر معها بدون ما يدري المستخدم
    if (block && st.some(s => s?.mode === 'disable' && s.list.some(x => x !== m))) throw noChange('في قائمة الحظر بصفحة الراوتر أجهزة قديمة والفلتر مطفي — لو شغّلناه بتنحظر معها. نظّف القائمة من صفحة الراوتر أول. ما غيّرنا شي.');
    for (let i = 0; i < bands.length; i++) {
      const s = st[i];
      if (!s) continue;
      if (block && !(s.mode === 'deny' && s.list.includes(m))) {
        await this.post('wlanCtrlSetting', { wlanCtrlMode: 'deny', macAddress: m.toUpperCase(), comment: (name ?? '').slice(0, 32), bandType: BANDS[bands[i]] }, { wait: false });
      }
    }
    if (!block) {
      // الصفحة تحذف بالعنوان بس (بدون النطاق) — نعيد لين يختفي من القائمتين (مرتين حد أعلى)
      for (let k = 0; k < 2; k++) {
        const left = (await Promise.all(bands.map(b => this.ctrl(b)))).some(s => s?.list.includes(m));
        if (!left) break;
        await this.post('wlanCtrlDel', { macAddress: m.toUpperCase() }, { wait: false });
      }
    }
    await sleep(2 * this.waitScale);
    const after = await Promise.all(bands.map(b => this.ctrl(b)));
    const listed = after.some(s => s?.list.includes(m) && s.mode === 'deny');
    if (listed !== block) throw new Error(`الراوتر قبل أمر ${block ? 'الحظر' : 'فك الحظر'} بس القائمة بعده مختلفة`);
  }

  // ═══ الرسائل ═══
  async listSms(box: 'inbox' | 'sent' = 'inbox'): Promise<SmsMessage[]> {
    const type = box === 'sent' ? 2 : 1;
    const out: SmsMessage[] = [];
    for (let page = 1; page <= 10; page++) {
      const j = await this.req('POST', 'getsmsList', { type, pageIndex: page, pageSize: 20 });
      const got = smsFrom(j?.info, box);
      out.push(...got);
      const total = Number(j?.info?.total) || 0;
      if (got.length < 20 || out.length >= total) break;
    }
    return out;
  }
  async deleteSms(index: string): Promise<void> { await this.req('POST', 'delsms', { id: String(index) }); }
  async sendSms(phone: string, text: string): Promise<void> {
    const plmn = await this.rf().then(i => (Array.isArray(i?.rf) ? i.rf[0]?.plmn : i?.rf?.plmn)).catch(() => undefined);
    const p = splitPhone(phone, plmn ? String(plmn) : undefined);
    if (!p) throw noChange('رقم الجوال غير صحيح — اكتبه مثل 05xxxxxxxx أو +9665xxxxxxxx. ما انرسل شي.');
    if (text.length > 160) throw noChange('الرسالة أطول من ١٦٠ حرف (حد صفحة الراوتر) — قصّرها. ما انرسل شي.');
    await this.req('POST', 'sendsms', { countryCode: p.countryCode, contacts: p.number, content: text });
  }

  // ═══ الواي فاي ═══
  private wlan(band: '2.4' | '5') { return this.get('getWlanBasicConfig', { bandType: BANDS[band] }); }
  /** أمر واي فاي — الجوال ممكن ينفصل قبل الرد (مو فشل) */
  private async wifiPost(p: string, body: unknown): Promise<boolean> {
    try { await this.post(p, body); return true; } catch (e) {
      if (NET_ERR.test(String((e as any)?.message ?? e))) return false;
      throw e;
    }
  }
  async getWifiRadios(): Promise<WifiRadio[]> {
    const out: WifiRadio[] = [];
    for (const b of ['2.4', '5'] as const) {
      const w = await this.wlan(b).catch(() => null);
      if (!w || typeof w !== 'object' || w.channelNumber === undefined) continue;
      const ch = String(w.channelNumber);
      out.push({ band: b, channel: /^auto$/i.test(ch) || ch === '0' ? '0' : ch, writable: !truthy(w.wirelessDisable) });
    }
    return out;
  }
  async setWifiChannel(band: '2.4' | '5', channel: string): Promise<void> {
    const w = await this.wlan(band);
    if (!w || w.channelNumber === undefined) throw noChange(`ما لقينا شبكة ${band === '5' ? '٥' : '٢.٤'} جيجا في راوترك — ما غيّرنا شي.`);
    if (truthy(w.wirelessDisable)) throw noChange('الشبكة مطفية — شغّلها أول. ما غيّرنا شي.');
    const auto = !Number(channel);
    const val = auto ? 'Auto' : (typeof w.channelNumber === 'number' ? Number(channel) : String(channel));
    if (String(w.channelNumber) === String(val)) return;
    const body: Record<string, unknown> = { ...w, channelNumber: val, bandType: BANDS[band] };
    // 40MHz بجهة (Upper/Lower) — الصفحة ترجّع القناة «Auto» لو تغيّرت؛ نخلي الجهة مثل ما هي
    if (await this.wifiPost('wlanBasicSetting', body)) {
      const a = await this.wlan(band).catch(() => null);
      if (a && String(a.channelNumber) !== String(val)) throw new Error('الراوتر قبل أمر القناة بس القراءة بعده مختلفة');
      if (a && (a.ssid !== w.ssid || truthy(a.wirelessDisable) !== truthy(w.wirelessDisable))) throw new Error('القناة تغيّرت بس اسم الشبكة أو حالتها تغيّرت معها — راجع صفحة الراوتر');
    }
  }
  async setBandOn(band: '2.4' | '5', on: boolean): Promise<void> {
    const w = await this.wlan(band);
    if (!w || w.wirelessDisable === undefined) throw noChange(`ما لقينا شبكة ${band === '5' ? '٥' : '٢.٤'} جيجا في راوترك — ما غيّرنا شي.`);
    if (!truthy(w.wirelessDisable) === on) return;
    await this.wifiPost('wlanBasicSetting', { ...w, wirelessDisable: !on, bandType: BANDS[band] });
  }
  async getExtras(): Promise<RouterExtras> {
    const ex: RouterExtras = {};
    const nets: NonNullable<RouterExtras['wifiNets']> = [];
    const bands: NonNullable<RouterExtras['bands']> = [];
    for (const b of ['2.4', '5'] as const) {
      const w = await this.wlan(b).catch(() => null);
      if (!w || typeof w !== 'object' || w.ssid === undefined) continue;
      bands.push({ band: b, on: !truthy(w.wirelessDisable) });
      const sec = await this.get('getWlanSecurity', { bandType: BANDS[b] }).catch(() => null);
      const ap = (Array.isArray(sec?.aps) ? sec.aps : []).find((x: any) => x?.apId === sec?.currentId);
      nets.push({ index: b, band: b, name: String(w.ssid ?? ''), secured: !!ap && !/^(disable|none|open)$/i.test(String(ap.encryption ?? 'disable')) });
    }
    if (bands.length) ex.bands = bands;
    if (nets.length) ex.wifiNets = nets;
    return ex;
  }
  async setWifiNames(names: { index: string; name: string }[], password?: string): Promise<void> {
    for (const n of names) {
      const s = n.name.trim();
      if (!s || new TextEncoder().encode(s).length > 32) throw noChange('اسم الشبكة لازم يكون من ١ لـ ٣٢ حرف — ما غيّرنا شي.');
    }
    if (password !== undefined && password !== '' && (password.length < 8 || password.length > 63)) throw noChange('كلمة الواي فاي لازم تكون من ٨ لـ ٦٣ حرف — ما غيّرنا شي.');
    if (password && !this.key) throw new Error('انتهت الجلسة');
    const jobs: (() => Promise<boolean>)[] = [];
    for (const b of ['2.4', '5'] as const) {
      const n = names.find(x => x.index === b);
      const w = n || password ? await this.wlan(b).catch(() => null) : null;
      if (!w || w.ssid === undefined) continue;
      if (password) {
        const sec = await this.get('getWlanSecurity', { bandType: BANDS[b] });
        const ap = (Array.isArray(sec?.aps) ? sec.aps : []).find((x: any) => x?.apId === sec?.currentId);
        if (!ap) throw new Error('getWlanSecurity: رد غير متوقع');
        if (/^(disable|wep)$/i.test(String(ap.encryption ?? 'disable'))) throw noChange('شبكتك مفتوحة أو على WEP — فعّل WPA من صفحة الراوتر أول، وبعدها غيّر الكلمة من هنا. ما غيّرنا شي.');
        const body: Record<string, unknown> = { ...ap, encryptionKey: dlEncrypt(password, this.key), bandType: BANDS[b] };
        if (ap.radiusServerPwd) body.radiusServerPwd = ap.radiusServerPwd;
        // الاسم أول (لو فيه)، الكلمة آخر شي — بعدها الجوال ينفصل
        jobs.push(() => this.wifiPost('wlanSecuritySetting', body));
      }
      if (n && n.name.trim() !== String(w.ssid)) jobs.unshift(() => this.wifiPost('wlanBasicSetting', { ...w, ssid: n.name.trim(), bandType: BANDS[b] }));
    }
    for (const j of jobs) await j();
  }
}

function sameSet(a: string, b: string): boolean {
  const x = bandTokens(a).map(t => t.n).sort((p, q) => p - q), y = bandTokens(b).map(t => t.n).sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
