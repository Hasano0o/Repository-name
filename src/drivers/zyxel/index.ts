/**
 * زيكسل (NR5103E / NR7101 / FWA505 / LTE5398 … — صفحة «Web-Based Configurator» الجديدة).
 * مرجع: zulufoxtrot/nr7101 v2 (MIT) + ha-zyxel.
 *
 * النسخة الأولى: **قراءة بس** (الإشارة، الدمج، الاستهلاك) + إعادة التشغيل.
 *  - الدخول: GET /getRSAPublickKey ← لو فيه مفتاح: الطلب يتشفّر AES-256-CBC والمفتاح RSA PKCS#1،
 *    والرد يتفك بنفس مفتاح AES. لو ما فيه: JSON عادي.
 *  - البيانات: /cgi-bin/DAL?oid=cellwan_status&sessionkey=…
 *  - كلمة مرور انرفضت ← نتذكرها وما نعيدها (زيكسل يقفل الدخول بعد محاولات).
 */
import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { RouterDriver, Capability, Signal, Carrier, Usage, NetworkInfo, SignalSnapshot, CellTower, BandConfig, ConnectedDevice, ActiveLock, RouterExtras, SmsMessage, WifiRadio } from '../types';
import { unesc, zxWlanPayload, zxSecured, zxSmsList, zxSmsBody, zxBlocked, zxBlockPayload, zxAzimuth, ZxAzimuth } from './extra';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { noChange } from '../noChange';
import { http } from '../http';
import { buildSnapshot } from '../../utils/snapshot';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';
import { ModelProfile } from '../models';
import { aesCbcEncrypt, aesCbcDecrypt, b64, unb64, rsaPkcs1Encrypt, utf8, fromUtf8 } from './crypto';

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};
const neg = (v: unknown, floor = -140) => { const n = num(v); return n !== undefined && n < 0 && n > floor ? n : undefined; };
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
/** "LTE_BC28" → 28 · "NR5G_BAND78"/"n78" → 78 */
const bandOf = (v: unknown) => { const m = str(v).match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : undefined; };

export class ZyxelDriver implements RouterDriver {
  id = 'zyxel';
  name = 'Zyxel';
  capabilities: Capability[] = ['signal', 'reboot', 'usage', 'devices', 'bandLock', 'sms', 'block'];

  private host = '';
  private user = 'admin';
  private password = '';
  private sessionkey = '';
  private rsaPem: string | null | undefined;
  private aesKey: Uint8Array = new Uint8Array(32);
  private iv: Uint8Array = new Uint8Array(32);

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private hdr(extra: Record<string, string> = {}) {
    return { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', Referer: this.base() + '/', ...extra };
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const r = await http(this.base() + '/getBasicInformation', { headers: this.hdr() }, 4000);
      const j: any = await r.json();
      return j?.result === 'ZCFG_SUCCESS';
    } catch {
      return false;
    }
  }

  async identify(): Promise<ModelProfile | null> {
    try {
      const r = await http(this.base() + '/getBasicInformation', { headers: this.hdr() }, 4000);
      const txt = await r.text();
      const m = txt.match(/\b((?:NR|FWA|LTE|AX|VMG|EX|DX)\d{3,5}[A-Z0-9-]*(?:\s*5G)?(?:\s*V\d)?)\b/i);
      const label = m ? 'Zyxel ' + m[1] : 'Zyxel';
      // اشتغلت عند أعضاء (ملفات FULL ٣١ أكتوبر): NR5103E — الدخول والإشارة وتثبيت ترددات 4G (PUT cellwan_band انقبل)؛
      // FWA505 — الدخول والإشارة. غيرها (ومنها NR5103EV2) يبقى غير مؤكد لين يوصلنا منه
      const verified = /^(NR5103E|FWA505)$/i.test(m?.[1] ?? '') || undefined;
      return { id: 'zyxel-' + (m ? m[1].toLowerCase() : 'generic'), label, brand: 'zyxel', tech: /LTE/i.test(m?.[1] ?? '') ? '4G' : '5G', verified };
    } catch { return null; }
  }

  private async rsaKey(): Promise<string | null> {
    if (this.rsaPem !== undefined) return this.rsaPem;
    try { await http(this.base() + '/GetInfoNoLogin', { headers: this.hdr() }, 5000); } catch {}
    try {
      const r = await http(this.base() + '/getRSAPublickKey', { headers: this.hdr({ 'If-Modified-Since': 'Thu, 01 Jun 1970 00:00:00 GMT' }) }, 5000);
      const j: any = await r.json();
      const k = str(j?.RSAPublicKey);
      this.rsaPem = k && k !== 'None' ? k : null;
    } catch { this.rsaPem = null; }
    return this.rsaPem;
  }

  private encrypt(obj: unknown, aesKey = this.aesKey, iv = this.iv): string {
    const content = aesCbcEncrypt(aesKey, iv, utf8(JSON.stringify(obj)));
    const key = rsaPkcs1Encrypt(this.rsaPem!, utf8(b64(aesKey)), n => Crypto.getRandomBytes(n));
    return JSON.stringify({ content: b64(content), key: b64(key), iv: b64(iv) });
  }
  private decrypt(j: any, aesKey = this.aesKey): any {
    if (!j || typeof j !== 'object' || !j.content || !j.iv) return j;
    const plain = aesCbcDecrypt(aesKey, unb64(j.iv), unb64(j.content));
    return JSON.parse(fromUtf8(plain));
  }
  /**
   * دخول واحد بس في نفس الوقت (تقرير NR5103EV2 ٣٠ أكتوبر: ٥ UserLogin بنفس اللحظة ← كل دخول يغيّر مفتاح AES
   * ويلغي الجلسة اللي قبله ← الردود ما تنفك و/cgi-bin/DAL يرد 401 ← «كلمة المرور غلط» وهي صحيحة).
   */
  private loginP: Promise<void> | null = null;
  private loginKey = '';
  private ensure(): Promise<void> {
    if (this.sessionkey) return Promise.resolve();
    return this.login(this.host, this.user, this.password);
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    const k = `${host}\n${username || 'admin'}\n${password}`;
    if (this.loginP && this.loginKey === k) return this.loginP;
    this.loginKey = k;
    const p = this.loginOnce(host, username, password, opts);
    this.loginP = p;
    try { await p; } finally { if (this.loginP === p) this.loginP = null; }
  }
  private async loginOnce(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    this.host = host;
    this.user = username || 'admin';
    this.password = password || '';
    if (!this.password) throw new Error('نحتاج كلمة مرور الراوتر');
    const fp = bytesToHex(sha256(utf8ToBytes('bandly-zx:' + this.user + ':' + this.password)));
    if (!(opts?.fresh || opts?.lastTry) && await isBadPassword(host, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل الدخول. حدّثها من إعدادات الراوتر.');
    }
    const pem = await this.rsaKey();
    // مفتاح هالدخول محلي — ما نحطه للجلسة إلا لما ينجح (ما يخرب طلبات شغالة)
    const aesKey = Crypto.getRandomBytes(32);
    const iv = Crypto.getRandomBytes(32);
    const params = {
      Input_Account: this.user,
      Input_Passwd: b64(utf8(this.password)),
      currLang: 'en',
      RememberPassword: 0,
      SHA512_password: false,
    };
    const body = pem ? this.encrypt(params, aesKey, iv) : JSON.stringify(params);
    const r = await http(this.base() + '/UserLogin', {
      method: 'POST',
      headers: this.hdr({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Origin: this.base(), Referer: this.base() + '/login' }),
      body,
    }, 10000);
    let j: any = null;
    try { j = this.decrypt(await r.json(), aesKey); } catch {}
    const key = str(j?.sessionkey);
    if (r.status !== 200 || !key) {
      if (r.status === 401 || /password|account/i.test(JSON.stringify(j ?? ''))) await markBadPassword(host, fp);
      throw new Error('كلمة المرور أو اسم المستخدم غلط (زيكسل يستخدم اسم مستخدم غالباً admin). تأكد منها — ما بنجرّب مرة ثانية لحالنا.');
    }
    await markBadPassword(host, null);
    this.aesKey = aesKey;
    this.iv = iv;
    this.sessionkey = key;
  }

  async logout(): Promise<void> {
    if (!this.sessionkey) return;
    try { await http(`${this.base()}/cgi-bin/UserLogout?sessionkey=${this.sessionkey}`, { headers: this.hdr() }, 5000); } catch {}
    this.sessionkey = '';
  }

  private async dal(oid: string, again = true): Promise<Record<string, any> | null> {
    await this.ensure();
    const used = this.sessionkey, aesKey = this.aesKey;
    const r = await http(`${this.base()}/cgi-bin/DAL?oid=${oid}&sessionkey=${used}`, { headers: this.hdr() }, 8000);
    // 401: الجلسة انتهت — لو طلب ثاني جدّدها خلاص نستخدم الجديدة بدون دخول زايد
    if (r.status === 401 && again) { if (this.sessionkey === used) this.sessionkey = ''; return this.dal(oid, false); }
    let j: any;
    try { j = this.decrypt(await r.json(), aesKey); } catch {
      if (again) { if (this.sessionkey === used) this.sessionkey = ''; return this.dal(oid, false); }   // مفتاح AES ما يطابق الجلسة
      throw new Error('رد غير مفهوم من الراوتر');
    }
    if (j?.result !== 'ZCFG_SUCCESS' || !Array.isArray(j.Object)) return null;
    return j.Object[0] ?? null;
  }

  async getSignal(): Promise<Signal> {
    const c = (await this.dal('cellwan_status')) ?? {};
    const b = bandOf(c.INTF_Current_Band);
    const nsaBand = bandOf(c.NSA_Band);
    const nrOn = !!c.NSA_Enable && (neg(c.NSA_RSRP) !== undefined || !!nsaBand);
    const sinr = num(c.INTF_SINR);
    const nsinr = num(c.NSA_SINR);
    const lteIsNr = /^NR/i.test(str(c.INTF_Current_Band));
    return {
      network: str(c.INTF_Current_Access_Technology) || undefined,
      band: b && !lteIsNr ? `B${b}` : undefined,
      cellId: str(c.INTF_Cell_ID) || undefined,
      pci: str(c.INTF_PhyCell_ID) || undefined,
      earfcn: str(c.INTF_RFCN) || undefined,
      rsrp: neg(c.INTF_RSRP),
      rsrq: num(c.INTF_RSRQ),
      sinr: sinr !== undefined && sinr > -20 && sinr < 50 ? sinr : undefined,
      rssi: neg(c.INTF_RSSI),
      cqi: num(c.INTF_CQI),
      nrBand: nrOn && nsaBand ? 'n' + nsaBand : lteIsNr && b ? 'n' + b : undefined,
      nrPci: nrOn ? str(c.NSA_PCI) || undefined : undefined,
      nrArfcn: nrOn && num(c.NSA_RFCN) ? str(c.NSA_RFCN) : undefined,
      nrRsrp: nrOn ? neg(c.NSA_RSRP) : undefined,
      nrRsrq: nrOn ? num(c.NSA_RSRQ) : undefined,
      nrSinr: nrOn && nsinr !== undefined && nsinr > -20 && nsinr < 50 ? nsinr : undefined,
    };
  }

  async getCarriers(): Promise<Carrier[]> {
    const c = (await this.dal('cellwan_status')) ?? {};
    const out: Carrier[] = [];
    const b = bandOf(c.INTF_Current_Band);
    if (b) out.push({ tech: /^NR/i.test(str(c.INTF_Current_Band)) ? 'NR' : 'LTE', role: 'PCC', band: b, arfcn: str(c.INTF_RFCN) || undefined, pci: str(c.INTF_PhyCell_ID) || undefined, rsrp: neg(c.INTF_RSRP), rsrq: num(c.INTF_RSRQ) });
    // SCC_Info: أسماء الحقول تختلف بين الفيرموير — نلقط اللي فيه Band/PCI/RFCN/RSRP
    for (const s of Array.isArray(c.SCC_Info) ? c.SCC_Info : []) {
      if (!s || typeof s !== 'object') continue;
      const pick = (re: RegExp) => { const k = Object.keys(s).find(x => re.test(x)); return k ? s[k] : undefined; };
      const sb = bandOf(pick(/band/i));
      if (!sb) continue;
      out.push({ tech: /NR|n\d/i.test(str(pick(/band/i))) ? 'NR' : 'LTE', role: 'SCC', band: sb, arfcn: str(pick(/rfcn|earfcn|arfcn/i)) || undefined, pci: str(pick(/pci|phy.*cell/i)) || undefined, rsrp: neg(pick(/rsrp/i)) });
    }
    const nb = bandOf(c.NSA_Band);
    if (c.NSA_Enable && nb) out.push({ tech: 'NR', role: out.length ? 'SCC' : 'PCC', band: nb, arfcn: num(c.NSA_RFCN) ? str(c.NSA_RFCN) : undefined, pci: str(c.NSA_PCI) || undefined, rsrp: neg(c.NSA_RSRP), rsrq: num(c.NSA_RSRQ) });
    return out;
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    const ca = await this.getCarriers().catch(() => [] as Carrier[]);
    return buildSnapshot(sig, ca, [] as CellTower[], { driverId: this.id, driverName: this.name });
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const c = (await this.dal('cellwan_status')) ?? {};
    return { mode: str(c.INTF_Current_Access_Technology) || undefined, connected: /^up$/i.test(str(c.INTF_Status)) };
  }
  async isConnected(): Promise<boolean> {
    try { return !!(await this.getNetworkInfo()).connected; } catch { return false; }
  }

  async getUsage(): Promise<Usage> {
    const t: any = (await this.dal('Traffic_Status')) ?? {};
    let down = 0, up = 0;
    const ifs = Array.isArray(t.ipIface) ? t.ipIface : [];
    const st = Array.isArray(t.ipIfaceSt) ? t.ipIfaceSt : [];
    ifs.forEach((f: any, i: number) => {
      if (/wwan|cell/i.test(str(f?.X_ZYXEL_IfName))) { down += num(st[i]?.BytesReceived) ?? 0; up += num(st[i]?.BytesSent) ?? 0; }
    });
    return { downloadBytes: down, uploadBytes: up };
  }

  async reboot(): Promise<void> {
    await this.ensure();
    const r = await http(`${this.base()}/cgi-bin/Reboot?sessionkey=${this.sessionkey}`, { method: 'POST', headers: this.hdr() }, 8000);
    let j: any = null;
    try { j = this.decrypt(await r.json()); } catch {}
    if (j && j.result && j.result !== 'ZCFG_SUCCESS') throw new Error('الراوتر رفض إعادة التشغيل');
  }

  // ─── الأجهزة المتصلة (lanhosts) — أسماء الحقول تختلف، نلقط اللي فيه MAC ───
  async getDevices(): Promise<ConnectedDevice[]> {
    const o: any = (await this.dal('lanhosts')) ?? {};
    const out: ConnectedDevice[] = [];
    const walk = (x: any) => {
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (!x || typeof x !== 'object') return;
      const keys = Object.keys(x);
      const macK = keys.find(k => /mac|physaddr/i.test(k) && /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(str(x[k])));
      if (macK) {
        const ipK = keys.find(k => /^ip|ipaddr/i.test(k) && /\d+\.\d+\.\d+\.\d+/.test(str(x[k])));
        const nmK = keys.find(k => /host.?name|devicename|^name$/i.test(k));
        const act = keys.find(k => /^active$/i.test(k));
        if (!act || x[act] === true || /true|1/i.test(str(x[act]))) {
          out.push({ mac: str(x[macK]).toUpperCase(), ip: ipK ? str(x[ipK]) : undefined, name: nmK ? str(x[nmK]) || undefined : undefined });
        }
        return;
      }
      keys.forEach(k => walk(x[k]));
    };
    walk(o);
    const seen = new Set<string>();
    return out.filter(d => (seen.has(d.mac) ? false : (seen.add(d.mac), true)));
  }

  // ─── الترددات ووضع الشبكة (cellwan_band — من تقرير FWA505) ───
  //   INTF_Supported_Bands / INTF_Preferred_Bands = "B1,B3,…,n78" · INTF_Preferred_Access_Technology = Auto | NR5G-SA | NR5G-NSA | LTE
  //   الكتابة: PUT على نفس الـ DAL بنفس التشفير، وبعدها نقرأ ونتأكد إنها انحفظت.

  private async dalPut(oid: string, obj: Record<string, unknown>): Promise<void> {
    await this.ensure();
    const send = async () => {
      const pem = await this.rsaKey();
      const used = this.sessionkey, aesKey = this.aesKey, iv = this.iv;
      const r = await http(`${this.base()}/cgi-bin/DAL?oid=${oid}&sessionkey=${used}`, {
        method: 'PUT',
        headers: this.hdr({ 'Content-Type': 'application/json', Origin: this.base() }),
        body: pem ? this.encrypt(obj, aesKey, iv) : JSON.stringify(obj),
      }, 15000);
      let j: any = null;
      try { j = this.decrypt(await r.json(), aesKey); } catch {}
      return { status: r.status, j, used };
    };
    let { status, j, used } = await send();
    if (status === 401) { if (this.sessionkey === used) this.sessionkey = ''; await this.ensure(); ({ status, j } = await send()); }
    if (j?.result !== 'ZCFG_SUCCESS') throw new Error(`الراوتر رفض الإعداد (${String(j?.result ?? j?.ReplyMsg ?? status).slice(0, 60)})`);
  }

  private async bandObj(): Promise<Record<string, any>> {
    const o = await this.dal('cellwan_band');
    if (!o) throw new Error('راوترك ما يعطي إعدادات الترددات');
    return o;
  }
  private static split(v: unknown) {
    const lte: number[] = [], nr: number[] = [];
    for (const t of str(v).split(',').map(x => x.trim()).filter(Boolean)) {
      const n = parseInt(t.replace(/\D/g, ''), 10);
      if (!n) continue;
      (/^n/i.test(t) ? nr : lte).push(n);
    }
    return { lte: [...new Set(lte)], nr: [...new Set(nr)] };
  }
  private static join(lte: number[], nr: number[]) {
    return [...[...new Set(lte)].sort((a, b) => a - b).map(b => 'B' + b), ...[...new Set(nr)].sort((a, b) => a - b).map(b => 'n' + b)].join(',');
  }
  private static TECH_TO_CODE: Record<string, string> = { Auto: '00', 'NR5G-NSA': '0803', LTE: '03', 'NR5G-SA': '08' };
  private static CODE_TO_TECH: Record<string, string> = { '00': 'Auto', '0803': 'NR5G-NSA', '03': 'LTE', '08': 'NR5G-SA' };

  async getBandConfig(): Promise<BandConfig> {
    const o = await this.bandObj();
    const sup = ZyxelDriver.split(o.INTF_Supported_Bands);
    const pref = ZyxelDriver.split(o.INTF_Preferred_Bands);
    const all = (a: number[], b: number[]) => b.every(x => a.includes(x));
    const techs = str(o.INTF_Supported_Access_Technologies).split(',').map(x => x.trim()).filter(Boolean);
    const LABEL: Record<string, string> = { Auto: 'تلقائي', 'NR5G-NSA': '4G + 5G', LTE: '4G فقط', 'NR5G-SA': '5G فقط (SA)' };
    return {
      supported: sup.lte.sort((a, b) => a - b),
      locked: all(pref.lte, sup.lte) ? [] : pref.lte,
      nrSupported: sup.nr.sort((a, b) => a - b),
      nrLocked: all(pref.nr, sup.nr) ? [] : pref.nr,
      nrLockable: sup.nr.length > 0,
      nrPreferred: sup.nr,
      mode: ZyxelDriver.TECH_TO_CODE[str(o.INTF_Preferred_Access_Technology)] ?? str(o.INTF_Preferred_Access_Technology),
      modes: techs.filter(t => ZyxelDriver.TECH_TO_CODE[t]).map(t => ({ value: ZyxelDriver.TECH_TO_CODE[t], label: LABEL[t] ?? t })),
    };
  }

  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const o = await this.bandObj();
    const sup = ZyxelDriver.split(o.INTF_Supported_Bands);
    const cur = ZyxelDriver.split(o.INTF_Preferred_Bands);
    const lte = bands === 'keep' ? cur.lte : (bands.length ? bands.filter(b => sup.lte.includes(b)) : sup.lte);
    const nr = nrBands === undefined ? cur.nr : (nrBands.length ? nrBands.filter(b => sup.nr.includes(b)) : sup.nr);
    if (!lte.length && !nr.length) throw noChange('ما فيه تردد يدعمه راوترك في الاختيار — ما غيّرنا شي.');
    const want = ZyxelDriver.join(lte, nr);
    if (want === ZyxelDriver.join(cur.lte, cur.nr)) return;
    await this.dalPut('cellwan_band', { INTF_Preferred_Bands: want });
    await new Promise(r => setTimeout(r, 1500));
    const after = ZyxelDriver.split((await this.bandObj()).INTF_Preferred_Bands);
    if (ZyxelDriver.join(after.lte, after.nr) !== want) throw new Error('الراوتر قبل الطلب بس الترددات ما تغيّرت');
  }

  async setNetworkMode(mode: string): Promise<void> {
    const tech = ZyxelDriver.CODE_TO_TECH[mode] ?? mode;
    await this.dalPut('cellwan_band', { INTF_Preferred_Access_Technology: tech });
  }

  async getActiveLock(): Promise<ActiveLock | null> {
    const c = await this.getBandConfig();
    return c.locked.length || c.nrLocked.length ? { bands: c.locked, nrBands: c.nrLocked } : null;
  }

  // لقطة قبل أي تجربة + إرجاع متحقق منه (نفس حماية هواوي و ZTE)
  async readLockState(): Promise<LockSnapshot> {
    const o = await this.bandObj();
    const bands = str(o.INTF_Preferred_Bands), tech = str(o.INTF_Preferred_Access_Technology);
    const p = ZyxelDriver.split(bands), sp = ZyxelDriver.split(o.INTF_Supported_Bands);
    const lAll = sp.lte.every(x => p.lte.includes(x)), nAll = sp.nr.every(x => p.nr.includes(x));
    const summary = `4G: ${lAll ? 'تلقائي' : p.lte.map(b => 'B' + b).join('+')} · 5G: ${nAll ? 'تلقائي' : p.nr.map(b => 'n' + b).join('+')} · ${tech || '—'}`;
    return { driver: this.id, at: Date.now(), summary, data: { bands, tech } };
  }
  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني');
    const want = snap.data as { bands: string; tech: string };
    const o = await this.bandObj();
    const patch: Record<string, unknown> = {};
    const norm = (v: unknown) => { const x = ZyxelDriver.split(v); return ZyxelDriver.join(x.lte, x.nr); };
    if (want.bands && norm(o.INTF_Preferred_Bands) !== norm(want.bands)) patch.INTF_Preferred_Bands = want.bands;
    if (want.tech && str(o.INTF_Preferred_Access_Technology) !== want.tech) patch.INTF_Preferred_Access_Technology = want.tech;
    if (Object.keys(patch).length) await this.dalPut('cellwan_band', patch);
    await new Promise(r => setTimeout(r, 1500));
    const a = await this.bandObj();
    const miss: string[] = [];
    if (want.bands && norm(a.INTF_Preferred_Bands) !== norm(want.bands)) miss.push('الترددات');
    if (want.tech && str(a.INTF_Preferred_Access_Technology) !== want.tech) miss.push('وضع الشبكة');
    if (miss.length) throw restoreMismatch(miss);
  }

  /** إنقاذ: كل الترددات + تلقائي */
  async restoreAll(): Promise<void> {
    try {
      const o = await this.bandObj();
      await this.dalPut('cellwan_band', { INTF_Preferred_Bands: str(o.INTF_Supported_Bands), INTF_Preferred_Access_Technology: 'Auto' });
    } catch {}
    try { await this.reboot(); } catch {}
  }

  /** أسماء إعدادات الشبكة الخلوية اللي يقبلها الراوتر — بدون الأرقام الحساسة */
  async cellwanDump(): Promise<string> {
    const OIDS = ['cellwan_band', 'cellwan_bandsel', 'cellular_band', 'cellwan_mgmt', 'cellwan_wan', 'cellwan_psru',
      'cellwan_lock', 'cellwan_ltecell', 'cellwan_nrcell', 'cellwan_cell_lock', 'cellwan_sim', 'cellwan_mapn', 'cellwan_nsa'];
    const SECRET = /imei|imsi|iccid|msisdn|mac|passw|psk|key|ssid|serial|phone|number|apn_?user|pin(?!g)/i;
    const clean = (x: any): any => {
      if (Array.isArray(x)) return x.slice(0, 8).map(clean);
      if (x && typeof x === 'object') {
        const o: any = {};
        for (const [k, v] of Object.entries(x)) o[k] = SECRET.test(k) ? '«محذوف»' : clean(v);
        return o;
      }
      return typeof x === 'string' && x.length > 120 ? x.slice(0, 120) + '…' : x;
    };
    const lines: string[] = [`Zyxel ${(await this.identify().catch(() => null))?.label ?? ''} — إعدادات الشبكة الخلوية`];
    for (const oid of OIDS) {
      try {
        const o = await this.dal(oid);
        lines.push(`--- ${oid}: ${o ? JSON.stringify(clean(o)).slice(0, 2500) : '(ما فيه)'}`);
      } catch (e: any) { lines.push(`--- ${oid}: ✗ ${String(e?.message ?? e).slice(0, 60)}`); }
    }
    return lines.join('\n');
  }


  // ═══════════ ميزات الصفحة (ملفات FULL لـ NR5103E و FWA505 — ٣١ أكتوبر) — كل الأوامر من app.js ═══════════

  /** طلب DAL بأي طريقة — GET/DELETE: القيم في الرابط (مثل httpReqSendAndRecv) · PUT/POST: الجسم مشفّر مثل dalPut */
  private async dalReq(method: 'GET' | 'PUT' | 'POST' | 'DELETE', oid: string, body?: unknown, query: Record<string, string | number> = {}): Promise<any> {
    await this.ensure();
    const send = async () => {
      const pem = await this.rsaKey();
      const used = this.sessionkey, aesKey = this.aesKey, iv = this.iv;
      const q = Object.entries(query).map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('');
      const hasBody = body !== undefined && (method === 'PUT' || method === 'POST');
      const r = await http(`${this.base()}/cgi-bin/DAL?oid=${oid}&sessionkey=${used}${q}`, {
        method,
        headers: this.hdr(hasBody ? { 'Content-Type': 'application/json', Origin: this.base() } : {}),
        ...(hasBody ? { body: pem ? this.encrypt(body, aesKey, iv) : JSON.stringify(body) } : {}),
      }, 15000);
      let j: any = null;
      try { j = this.decrypt(await r.json(), aesKey); } catch {}
      return { status: r.status, j, used };
    };
    let { status, j, used } = await send();
    if (status === 401) { if (this.sessionkey === used) this.sessionkey = ''; await this.ensure(); ({ status, j } = await send()); }
    if (j?.result !== 'ZCFG_SUCCESS') throw new Error(`${oid}: الراوتر رفض (${String(j?.ReplyMsg || j?.result || status).slice(0, 60)})`);
    return method === 'GET' ? unesc(j) : j;
  }
  private async dalList(oid: string): Promise<any[]> {
    const j = await this.dalReq('GET', oid);
    return Array.isArray(j?.Object) ? j.Object : [];
  }
  /** إعدادات الواجهة (Support5G، supportSmsCmd) — نفس /getWebGuiFlag اللي تقراه الصفحة */
  private flags: Record<string, any> | null = null;
  private async guiFlags(): Promise<Record<string, any>> {
    if (this.flags) return this.flags;
    try {
      const r = await http(this.base() + '/getWebGuiFlag', { headers: this.hdr() }, 6000);
      const j: any = this.decrypt(await r.json());
      this.flags = j && typeof j === 'object' ? j : {};
    } catch { this.flags = {}; }
    return this.flags!;
  }
  private async has5G(list: any[]): Promise<boolean> {
    const f = await this.guiFlags();
    if (typeof f.Support5G === 'boolean') return f.Support5G;
    return !!list[4] && /5/.test(String(list[4].band ?? list[4].Band ?? '5'));
  }

  // ─── الواي فاي: الاسم والكلمة (صفحة Wifisetting) وتشغيل كل نطاق (Main24gsubmit / Main5gsubmit) ───
  async getExtras(): Promise<RouterExtras> {
    const list = await this.dalList('wlan');
    const ex: RouterExtras = {};
    const w2 = list[0], w5 = list[4];
    if (!w2) return ex;
    const five = await this.has5G(list) && !!w5;
    const nets: NonNullable<RouterExtras['wifiNets']> = [{ index: '1', band: '2.4', name: String(w2.SSID ?? ''), secured: zxSecured(w2) }];
    if (five && !w2.oneSsidEnable) nets.push({ index: '5', band: '5', name: String(w5.SSID ?? ''), secured: zxSecured(w5) });
    ex.wifiNets = nets;
    ex.bands = [{ band: '2.4', on: !!w2.wlEnable }, ...(five ? [{ band: '5' as const, on: !!w5.wlEnable }] : [])];
    return ex;
  }
  /** بعد أي تغيير واي فاي الصفحة تنتظر Wireless?action=WlCheck (لين ٦٠ ث) — الواي فاي ممكن ينقطع وقتها */
  private async wlCheck() {
    try { await http(`${this.base()}/cgi-bin/Wireless?action=WlCheck&sessionkey=${this.sessionkey}`, { headers: this.hdr() }, 60000).then(r => r.text()); } catch {}
  }
  async setWifiNames(names: { index: string; name: string }[], password?: string): Promise<void> {
    for (const n of names) {
      const v = n.name.trim();
      if (!v || v.length > 32) throw noChange('اسم الشبكة لازم يكون من ١ إلى ٣٢ حرف — ما غيّرنا شي.');
    }
    if (password !== undefined && (password.length < 8 || password.length > 63)) throw noChange('كلمة الواي فاي لازم تكون من ٨ إلى ٦٣ حرف — ما غيّرنا شي.');
    const list = await this.dalList('wlan');
    if (password && !zxSecured(list[0])) throw noChange('شبكتك مفتوحة بدون حماية — فعّل الحماية من صفحة الراوتر أول. ما غيّرنا شي.');
    const body = zxWlanPayload(list, await this.has5G(list), names.map(n => ({ index: n.index, name: n.name.trim() })), password);
    await this.dalReq('PUT', 'wlan', body);
    await this.wlCheck();
  }
  async setBandOn(band: '2.4' | '5', on: boolean): Promise<void> {
    const list = await this.dalList('wlan');
    const o = band === '2.4' ? list[0] : list[4];
    if (!o) throw noChange('راوترك ما فيه هالشبكة — ما غيّرنا شي.');
    if (!!o.wlEnable === on) return;
    await this.dalReq('PUT', 'wlan', { Index: band === '2.4' ? 1 : 5, wlEnable: on });
    await this.wlCheck();
  }
  /**
   * القناة الحالية من نفس الكائن (AutoChannelEnable = تلقائي). تغييرها في الصفحة يرسل كل إعدادات الشبكة مع الحماية
   * (doWifiApply: secMode/encryp/الكلمة/العرض/الجانب) — ما نرسلها لين نتأكد من أول تجربة للاسم والكلمة، فهي للعرض بس.
   */
  async getWifiRadios(): Promise<WifiRadio[]> {
    const list = await this.dalList('wlan');
    const out: WifiRadio[] = [];
    const one = (o: any, band: '2.4' | '5') => {
      if (!o) return;
      const allowed = String(o.PossibleChannels ?? '').split(',').map(x => x.trim()).filter(Boolean);
      out.push({ band, channel: o.AutoChannelEnable ? '0' : String(o.channel ?? '0'), allowed, writable: false });
    };
    one(list[0], '2.4');
    if (await this.has5G(list)) one(list[4], '5');
    return out;
  }

  // ─── الرسائل (صفحة Cellular WAN › SMS) ───
  async listSms(box: 'inbox' | 'sent' = 'inbox'): Promise<SmsMessage[]> {
    const list = await this.dalList('cellwan_sms');
    return zxSmsList(list[0], box, !!(await this.guiFlags()).supportSmsCmd);
  }
  async markSmsRead(index: string): Promise<void> {
    // الصفحة تعلّمها مقروءة بس لو supportSmsCmd (stateHandler) — غيرها ما فيه أمر لها
    if (!(await this.guiFlags()).supportSmsCmd) return;
    await this.dalReq('PUT', 'cellwan_sms', { setSmsState: 1, SMS_InboxObjId: Number(index) });
  }
  async deleteSms(index: string): Promise<void> {
    await this.dalReq('DELETE', 'cellwan_sms', undefined, { objIndex: index });
  }
  async sendSms(phone: string, text: string): Promise<void> {
    if (!phone.replace(/\D/g, '')) throw noChange('رقم المستلم غير صحيح — ما انرسل شي.');
    const b = zxSmsBody(phone, text, !!(await this.guiFlags()).supportSmsCmd);
    if (!b) throw noChange('الرسالة طويلة — الحد ٧٠ حرف بالعربي أو ١٦٠ بالإنجليزي. ما انرسل شي.');
    await this.dalReq('POST', 'cellwan_sms', b);
  }

  // ─── حظر الأجهزة (صفحة Security › MAC Filter) ───
  async getBlockedDevices(): Promise<ConnectedDevice[]> {
    return zxBlocked((await this.dalList('macfilter'))[0]);
  }
  async blockDevice(mac: string, block: boolean, name?: string): Promise<void> {
    const o = (await this.dalList('macfilter'))[0];
    if (!o) throw new Error('macfilter: رد غير متوقع');
    if (o.MAC?.Filter_Enable && !o.MAC?.Restrict) {
      throw noChange('حظر الأجهزة في راوترك على «القائمة المسموحة بس» — غيّرها من صفحة الراوتر لو تبي تحظر من هنا. ما غيّرنا شي.');
    }
    const body = zxBlockPayload(o, mac, block, name);
    if (!body) return;
    await this.dalReq('PUT', 'macfilter', body);
    const after = zxBlocked((await this.dalList('macfilter'))[0]).some(d => d.mac === mac.toUpperCase());
    if (after !== block) throw new Error('الراوتر قبل أمر الحظر بس القائمة ما تغيّرت');
  }

  // ─── البوصلة (FWA505 الخارجي — صفحة Maintenance › Azimuth) ───
  async getAzimuth(): Promise<ZxAzimuth | null> {
    try { return zxAzimuth((await this.dalList('azimuth'))[0]); } catch { return null; }
  }
}
