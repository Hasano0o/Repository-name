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
import { RouterDriver, Capability, Signal, Carrier, Usage, NetworkInfo, SignalSnapshot, CellTower, BandConfig, ConnectedDevice } from '../types';
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
  capabilities: Capability[] = ['signal', 'reboot', 'usage', 'devices'];

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
      return { id: 'zyxel-' + (m ? m[1].toLowerCase() : 'generic'), label, brand: 'zyxel', tech: /LTE/i.test(m?.[1] ?? '') ? '4G' : '5G' };
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

  private encrypt(obj: unknown): string {
    const content = aesCbcEncrypt(this.aesKey, this.iv, utf8(JSON.stringify(obj)));
    const key = rsaPkcs1Encrypt(this.rsaPem!, utf8(b64(this.aesKey)), n => Crypto.getRandomBytes(n));
    return JSON.stringify({ content: b64(content), key: b64(key), iv: b64(this.iv) });
  }
  private decrypt(j: any): any {
    if (!j || typeof j !== 'object' || !j.content || !j.iv) return j;
    const plain = aesCbcDecrypt(this.aesKey, unb64(j.iv), unb64(j.content));
    return JSON.parse(fromUtf8(plain));
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    this.host = host;
    this.user = username || 'admin';
    this.password = password || '';
    if (!this.password) throw new Error('نحتاج كلمة مرور الراوتر');
    const fp = bytesToHex(sha256(utf8ToBytes('bandly-zx:' + this.user + ':' + this.password)));
    if (!(opts?.fresh || opts?.lastTry) && await isBadPassword(host, fp)) {
      throw new Error('كلمة المرور المحفوظة رفضها الراوتر قبل — ما جرّبناها مرة ثانية عشان ما ينقفل الدخول. حدّثها من إعدادات الراوتر.');
    }
    const pem = await this.rsaKey();
    this.aesKey = Crypto.getRandomBytes(32);
    this.iv = Crypto.getRandomBytes(32);
    const params = {
      Input_Account: this.user,
      Input_Passwd: b64(utf8(this.password)),
      currLang: 'en',
      RememberPassword: 0,
      SHA512_password: false,
    };
    const body = pem ? this.encrypt(params) : JSON.stringify(params);
    const r = await http(this.base() + '/UserLogin', {
      method: 'POST',
      headers: this.hdr({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Origin: this.base(), Referer: this.base() + '/login' }),
      body,
    }, 10000);
    let j: any = null;
    try { j = this.decrypt(await r.json()); } catch {}
    const key = str(j?.sessionkey);
    if (r.status !== 200 || !key) {
      if (r.status === 401 || /password|account/i.test(JSON.stringify(j ?? ''))) await markBadPassword(host, fp);
      throw new Error('كلمة المرور أو اسم المستخدم غلط (زيكسل يستخدم اسم مستخدم غالباً admin). تأكد منها — ما بنجرّب مرة ثانية لحالنا.');
    }
    await markBadPassword(host, null);
    this.sessionkey = key;
  }

  async logout(): Promise<void> {
    if (!this.sessionkey) return;
    try { await http(`${this.base()}/cgi-bin/UserLogout?sessionkey=${this.sessionkey}`, { headers: this.hdr() }, 5000); } catch {}
    this.sessionkey = '';
  }

  private async dal(oid: string, again = true): Promise<Record<string, any> | null> {
    if (!this.sessionkey) await this.login(this.host, this.user, this.password);
    const r = await http(`${this.base()}/cgi-bin/DAL?oid=${oid}&sessionkey=${this.sessionkey}`, { headers: this.hdr() }, 8000);
    if (r.status === 401 && again) { this.sessionkey = ''; return this.dal(oid, false); }
    let j: any;
    try { j = this.decrypt(await r.json()); } catch {
      if (again) { this.sessionkey = ''; return this.dal(oid, false); }   // مفتاح AES ما يطابق الجلسة
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
    if (!this.sessionkey) await this.login(this.host, this.user, this.password);
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

  // ─── الترددات ───
  // أمر التثبيت يختلف بين فيرموير زيكسل وما عندنا مرجع مؤكد له — نعرض الترددات المدعومة من الراوتر،
  // ولو المستخدم حاول يثبّت: ما نكتب شي، ونرسل للمطوّر (مرة وحدة) أسماء إعدادات الشبكة الخلوية
  // اللي يقبلها راوتره — بدون أي رقم شريحة/جهاز/واي فاي — عشان نبني التثبيت الصح.
  async getBandConfig(): Promise<BandConfig> {
    const c = (await this.dal('cellwan_status')) ?? {};
    const lte: number[] = [], nr: number[] = [];
    for (const t of str(c.INTF_Supported_Bands).split(',')) {
      const b = bandOf(t); if (!b) continue;
      (/^NR|^N\d/i.test(t.trim()) ? nr : lte).push(b);
    }
    return {
      supported: [...new Set(lte)].sort((a, b) => a - b),
      locked: [],
      nrSupported: [],
      nrLocked: [],
      nrLockable: false,
      mode: '00',
      modes: [],
    };
  }

  private dumped = false;
  async setBand(): Promise<void> {
    if (!this.dumped) {
      this.dumped = true;
      this.cellwanDump().then(t => import('../../services/errors').then(m => m.sendSupportReport('zyxel-bands', t))).catch(() => {});
    }
    throw noChange('تثبيت الترددات لراوترك زيكسل لسا ما جهز — ما غيّرنا أي شي. أرسلنا للمطوّر أسماء إعدادات راوترك (بدون أي بيانات شخصية) عشان يضيفه قريب.');
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

}
