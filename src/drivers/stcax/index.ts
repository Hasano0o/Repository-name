/**
 * STC 5G AX3600 (FWA-AX3600 · «5G AX3600 IDU») — OpenWrt بواجهة Vue (webpack) فوق /cgi-bin/luci/index.
 * من ملفات صفحة عضو (١٤ نوفمبر ٢٠٢٦، router-5G-AX3600-1114-170116 — @wrrzy، STC البدائع). لسا ما انجرّب ميداني.
 *
 * كل الأوامر POST JSON على «svcrunner» (رابط نسبي من صفحة /cgi-bin/luci/index) — دالة الطلب في app.js (vLgD):
 *   الجسم = {…الطلب, token: "", rid: sha256(JSON(payload))} · رأس Auth-Info = sha256(JSON(الجسم قبل تبديل الاسم))
 *   namespace "status" ينرسل «sim_info» (الهاش محسوب قبل التبديل — نفس الصفحة بالضبط). الرد {name, namespace, payload}.
 *   الجلسة كوكي (withCredentials). انتهت = رد خطأ {namespace:"error", name:"token_error"}.
 *
 * الأوامر من كود الصفحة نفسه:
 *   auth/checkpasswd {user: base64, password: base64} ← status 1 · info/get ← مصفوفة (LTE4G / NR5G: sig_rsrp sig_rsrq sig_snr sig_cqi cell_id plmn)
 *   status/all_status ← network_mode (LTE/NR5G/ENDC) · CA_MODE · operator · reboot/reboot
 *   lock_cell: get ← {cell_cat 7=LTE/11=NR, cell_band "1,3", cell_arfun, cell_pci} · set {cell_act, cell_band, cell_arfcn, cell_pci} · clr {clr_lock_cell:""}
 *   الصفحة تثبّت 4G أو 5G (وحدة بس في المرة) — ترددات، وبرج اختياري (ARFCN + PCI).
 * بعد أي كتابة نقرأ ونتأكد (ما ندّعي النجاح).
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, DeviceDetails, BandConfig, CellLockTarget, CellLockState,
} from '../types';
import { http } from '../http';
import { noChange } from '../noChange';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import { utf8 } from '../zyxel/crypto';

/** قوائم صفحته (33.js: cellBandOpt / cellNrOpt) */
export const AX_LTE = [1, 3, 5, 7, 8, 18, 19, 20, 26, 28, 32, 38, 40, 42, 46];
export const AX_NR = [1, 3, 5, 7, 8, 20, 28, 38, 40, 41, 77, 78, 79];

const sha = (s: string) => bytesToHex(sha256(utf8(s)));
const b64s = (s: string) => {
  const u = utf8(s); let bin = '';
  for (const c of u) bin += String.fromCharCode(c);
  return typeof btoa === 'function' ? btoa(bin) : (globalThis as any).Buffer.from(u).toString('base64');
};

/** الطلب مثل vLgD بالضبط — ترتيب المفاتيح نفس نداء الصفحة (الهاش على النص) */
export function axRequest(req: Record<string, unknown>): { body: string; authInfo: string } {
  const a: Record<string, unknown> = { ...req, token: '' };
  a.rid = sha(JSON.stringify(req.payload));
  const authInfo = sha(JSON.stringify(a));
  if (a.namespace === 'status') a.namespace = 'sim_info';
  return { body: JSON.stringify(a), authInfo };
}

/** info/get و status/all_status يرجعون مصفوفة كائنات ← الصفحة تدمجها (Object.assign) */
export function merged(p: unknown): any {
  if (Array.isArray(p)) return p.reduce((m, x) => Object.assign(m, x && typeof x === 'object' ? x : {}), {} as any);
  return p && typeof p === 'object' ? p : {};
}
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && String(v).match(/\d/) ? n : undefined;
};
const str = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v).trim(); return s || undefined; };
const bandList = (s: unknown) => String(s ?? '').split(',').map(x => Number(x.trim())).filter(n => n > 0);

export function axSignal(info: any, st: any): Signal {
  const s: Signal = {};
  const l = info?.LTE4G, n = info?.NR5G;
  const lr = num(l?.sig_rsrp), nr = num(n?.sig_rsrp);
  if (l && lr !== undefined && lr < 0) { s.rsrp = lr; s.rsrq = num(l.sig_rsrq); s.sinr = num(l.sig_snr); s.cellId = str(l.cell_id); }
  if (n && nr !== undefined && nr < 0) { s.nrRsrp = nr; s.nrRsrq = num(n.sig_rsrq); s.nrSinr = num(n.sig_snr); s.nrActiveFromStatus = true; if (!s.cellId) s.cellId = str(n.cell_id); }
  const mode = String(st?.network_mode ?? '').toUpperCase();
  const ca = String(st?.CA_MODE ?? '');
  const caN = /NO_CA/i.test(ca) ? 0 : Number((ca.match(/(\d+)/) || [])[1] || 0);
  if (caN > 1) s.caCount = caN;
  const lteOn = s.rsrp !== undefined, nrOn = s.nrRsrp !== undefined;
  s.network = mode === 'ENDC' || (lteOn && nrOn) ? '5G NSA' : mode === 'NR5G' || (nrOn && !lteOn) ? '5G SA'
    : lteOn || mode === 'LTE' ? (caN > 1 ? '4G+' : '4G') : undefined;
  return s;
}

export interface AxLock { cat: string; bands: number[]; arfcn?: string; pci?: string }
export function axLock(p: any): AxLock {
  return { cat: String(p?.cell_cat ?? ''), bands: bandList(p?.cell_band), arfcn: str(p?.cell_arfun ?? p?.cell_arfcn), pci: str(p?.cell_pci) };
}

export class StcAxDriver implements RouterDriver {
  readonly id = 'stc-ax3600';
  name = 'STC 5G AX3600';
  readonly capabilities: Capability[] = ['signal', 'cells', 'reboot', 'bandLock'];
  private host = '';
  /** مسار svcrunner — يتحدد في detect (نسبي من /cgi-bin/luci/index أو /cgi-bin/luci/index/) */
  private svc = '';
  private model = '';

  private base(h = this.host) { return 'http://' + h.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  private async call(req: Record<string, unknown>, timeout = 15000): Promise<any> {
    const { body, authInfo } = axRequest(req);
    const r = await http(`${this.base()}/${this.svc || 'cgi-bin/luci/svcrunner'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json, text/plain, */*', 'Auth-Info': authInfo, Referer: this.base() + '/cgi-bin/luci/index' },
      body,
    }, timeout);
    const t = (await r.text()).trim();
    let d: any = null;
    try { d = JSON.parse(t); } catch {}
    if (d?.namespace === 'error' && d?.name === 'token_error') throw new Error('انتهت الجلسة');
    if (!r.ok) throw new Error(`svcrunner: HTTP ${r.status}`);
    if (!d || typeof d !== 'object' || !('payload' in d)) throw new Error('svcrunner: رد غير متوقع');
    const p = d.payload;
    if (p && typeof p === 'object' && !Array.isArray(p) && (p.result === 'okay' || p.result === 'ok')) p.status = '1';
    return p;
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const r = await http(this.base() + '/', {}, 4000);
      const t = await r.text();
      if (!/cgi-bin\/luci\/index/i.test(t)) return false;
      const p = await http(this.base() + '/cgi-bin/luci/index', {}, 5000);
      const pt = await p.text();
      // صفحة Vue (webpack): static/js/app.<hash>.js + manifest — LuCI القديم فيه luci_password بدلها
      if (!/static\/js\/app\.[0-9a-f]+\.js/i.test(pt) || /luci_password/i.test(pt)) return false;
      // نحدد مسار svcrunner: أول واحد يرد JSON بشكل {namespace} (حتى لو token_error) — طلب قراءة بس
      for (const path of ['cgi-bin/luci/svcrunner', 'cgi-bin/luci/index/svcrunner']) {
        try {
          const { body, authInfo } = axRequest({ payload: {}, name: 'get', namespace: 'language' });
          const x = await http(`${this.base()}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Auth-Info': authInfo }, body }, 4000);
          const j = JSON.parse((await x.text()).trim());
          if (j && typeof j === 'object' && 'namespace' in j) { this.svc = path; return true; }
        } catch {}
      }
      return false;
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    const m = this.model;
    return { id: 'stc-ax3600', label: m && !/^5G AX3600$/i.test(m) ? `STC 5G AX3600 (${m})` : 'STC 5G AX3600', brand: 'openwrt', tech: '5G', nrLock: true };
  }

  async login(host: string, username: string, password: string): Promise<void> {
    this.host = host;
    if (!this.svc) await this.detect(host);
    const user = (username || '').trim() || 'admin';
    const p = await this.call({ payload: { user: b64s(user), password: b64s(password) }, name: 'checkpasswd', namespace: 'auth' });
    if (String(p?.status) === '1') return;
    if (p?.expires !== undefined) throw new Error('الراوتر قفل الدخول بعد محاولات غلط — انتظر شوي وجرّب (محاولات كثيرة)');
    throw new Error('كلمة المرور غلط — المستخدم والكلمة مكتوبين على ملصق الراوتر تحت User و Password (المستخدم غالباً admin)');
  }
  async logout(): Promise<void> {
    try { await this.call({ name: 'logout', namespace: 'auth', payload: {} }); } catch {}
  }

  // ═══ الإشارة ═══
  private async read(): Promise<{ info: any; st: any }> {
    const [i, s] = await Promise.all([
      this.call({ payload: '', name: 'get', namespace: 'info' }),
      this.call({ namespace: 'status', name: 'all_status', payload: {} }).catch(() => null),
    ]);
    const info = merged(i);
    if (info.device_model) this.model = String(info.device_model);
    return { info, st: merged(s) };
  }
  async getSignal(): Promise<Signal> { const { info, st } = await this.read(); return axSignal(info, st); }
  async getCells(): Promise<CellTower[]> { return []; }
  async getSnapshot(): Promise<SignalSnapshot> {
    const s = await this.getSignal();
    return buildSnapshot(s, [], [], { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const s = await this.getSignal();
    return { connected: s.rsrp !== undefined || s.nrRsrp !== undefined, mode: s.network, supports5g: true };
  }
  async isConnected(): Promise<boolean> {
    try { const s = await this.getSignal(); return s.rsrp !== undefined || s.nrRsrp !== undefined; } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const { info, st } = await this.read();
    const ip = info?.IPV4?.public_ip;
    return {
      model: str(info.device_model) ?? 'STC 5G AX3600', imei: str(info.device_imei), software: str(info.ex_version), hardware: str(info.hw_ver),
      simStatus: str(st?.sim_status), wanIp: ip && ip !== '0.0.0.0' ? String(ip) : undefined,
    };
  }

  async reboot(): Promise<void> {
    try {
      const p = await this.call({ payload: '', name: 'reboot', namespace: 'reboot' });
      if (String(p?.status) !== '1') throw new Error('الراوتر رفض إعادة التشغيل');
    } catch (e) {
      if (!/تعذر الاتصال|ما رد|timeout|network|abort/i.test(String((e as any)?.message ?? e))) throw e;
    }
  }

  // ═══ الترددات والأبراج (صفحة «Lock frequency / lock cell») ═══
  private async lock(): Promise<AxLock> { return axLock(await this.call({ payload: '', name: 'get', namespace: 'lock_cell' })); }

  async getBandConfig(): Promise<BandConfig> {
    const l = await this.lock();
    const lte = l.cat === '7', nr = l.cat === '11';
    return {
      supported: AX_LTE, nrSupported: AX_NR,
      locked: lte ? l.bands : [], nrLocked: nr ? l.bands : [],
      mode: '00', modes: [], nrLockable: true,
      lockKinds: {
        lte: lte && l.bands.length ? (l.pci ? 'cell' : 'band') : 'none',
        nr: nr && l.bands.length ? (l.pci ? 'cell' : 'band') : 'none',
      },
    };
  }

  private async setLock(cat: '7' | '11', bands: number[], arfcn = '', pci = ''): Promise<void> {
    const list = cat === '7' ? AX_LTE : AX_NR;
    const bad = bands.filter(b => !list.includes(b));
    if (bad.length) throw noChange(`صفحة الراوتر ما فيها ${cat === '7' ? 'B' : 'n'}${bad.join(', ')} — ما غيّرنا شي.`);
    const p = await this.call({ payload: { cell_act: cat, cell_band: bands.map(String).join(','), cell_arfcn: arfcn, cell_pci: pci }, name: 'set', namespace: 'lock_cell' }, 30000);
    if (p && typeof p === 'object' && p.result && !['ok', 'okay'].includes(String(p.result))) throw new Error(`الراوتر رفض التثبيت (${p.result})`);
    const now = await this.lock();
    const same = now.cat === cat && [...now.bands].sort((a, b) => a - b).join(',') === [...bands].sort((a, b) => a - b).join(',')
      && (!pci || now.pci === pci);
    if (!same) throw new Error('الراوتر قبل الأمر بس الإعداد ما تغيّر — جرّب مرة ثانية');
  }
  private async clear(): Promise<void> {
    const p = await this.call({ namespace: 'lock_cell', name: 'clr', payload: { clr_lock_cell: '' } }, 30000);
    if (String(p?.status) !== '1') throw new Error('الراوتر رفض فك التثبيت');
  }

  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const want4 = bands !== 'keep' && bands.length > 0, want5 = !!nrBands && nrBands.length > 0;
    if (want4 && want5) throw noChange('هذا الراوتر يثبّت 4G أو 5G وحدة بس في المرة (مثل صفحته) — اختر وحدة. ما غيّرنا شي.');
    if (want4) return this.setLock('7', bands as number[]);
    if (want5) return this.setLock('11', nrBands!);
    // فك: [] لـ 4G و/أو 5G
    const cur = await this.lock();
    const unlock4 = bands !== 'keep' && cur.cat === '7';
    const unlock5 = nrBands !== undefined && cur.cat === '11';
    if ((unlock4 || unlock5 || (bands !== 'keep' && nrBands !== undefined)) && cur.bands.length) await this.clear();
  }

  async lockCell(t: CellLockTarget): Promise<void> {
    if (!t.band) throw noChange('نحتاج رقم التردد عشان نثبّت على البرج (صفحة الراوتر تطلبه). ما غيّرنا شي.');
    if (!t.arfcn) throw noChange('نحتاج رقم القناة (ARFCN) عشان نثبّت على البرج — صفحة الراوتر تطلبه. ما غيّرنا شي.');
    return this.setLock(t.tech === 'NR' ? '11' : '7', [t.band], String(t.arfcn), String(t.pci));
  }
  async unlockCell(): Promise<void> {
    const cur = await this.lock();
    if (cur.bands.length || cur.pci) await this.clear();
  }
  async getCellLock(): Promise<CellLockState | null> {
    const l = await this.lock();
    if (!l.pci) return null;
    return { pci: l.pci, arfcn: l.arfcn, band: l.bands[0], tech: l.cat === '11' ? 'NR' : 'LTE' };
  }
}
