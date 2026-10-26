/**
 * راوترات الجيب 4G بفيرموير ZTE القديم (UFI — «4G LTE pocket wifi»، 192.168.0.1) — تقرير «جهاز جديد» ٢٦ أكتوبر.
 * نفس عائلة goform، بس يختلف عن درايفر ZTE (MU5001 وغيره) — فدرايفر لحاله عشان أي تعديل هنا ما يلمس غيره:
 *   • ما فيه wa_inner_version (فدرايفر ZTE ما يتعرّف عليه) — النسخة في cr_version
 *   • الدخول: LOGIN {username: base64, password: base64} (PASSWORD_ENCODE) بدون توقيع AD
 *       الرد: result 0 أو 4 = نجح · 3 = كلمة غلط · 2 = فيه أحد داخل
 *   • الإشارة: nv_rsrp nv_rsrq lte_sinr nv_pci nv_arfcn lte_band nv_cellid nv_enodebid (4G بس)
 *   • تثبيت الترددات: SET_BAND_LOCK {band1_lock … band41_lock} والقراءة lockband1 … lockband41
 *   • آي بي جديد: DISCONNECT_NETWORK ثم CONNECT_NETWORK · إعادة التشغيل REBOOT_DEVICE · ضبط المصنع RESTORE_FACTORY_SETTINGS
 *   • الأجهزة station_list · الحظر WIFI_MAC_FILTER {ACL_mode 2 + wifi_mac_black_list (١٠ بالكثير، بـ ;)}
 * لسا ما انجرّب على جهاز حقيقي — أي رد غريب يطلع برسالة فيها اسم الأمر.
 */
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, BandConfig, ActiveLock, ConnectedDevice, DeviceDetails,
} from '../types';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { noChange } from '../noChange';
import { http } from '../http';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** أسماء الترددات في صفحة band_lock.js (القراءة lockbandN والكتابة bandN_lock) */
export const UFI_BANDS = [1, 3, 5, 7, 8, 20, 28, 38, 39, 40, 41];
/** الصفحة تقرأ هذي الأربعة بس من الراوتر — الباقي مطفي فيها */
const PAGE_BANDS = [1, 3, 28, 41];

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
};
const num = (v: unknown, lo: number, hi: number) => {
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/);
  const x = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(x) && x >= lo && x <= hi ? x : undefined;
};
const str = (v: unknown) => { const s = String(v ?? '').trim(); return s && s !== '--' && s !== '— —' ? s : undefined; };

/** المتاح = اللي الراوتر يرجّع له 0 أو 1 (والأربعة اللي تقراها الصفحة دايماً) */
export function ufiAvailable(r: Record<string, string>): number[] {
  return UFI_BANDS.filter(b => PAGE_BANDS.includes(b) || r['lockband' + b] === '0' || r['lockband' + b] === '1');
}
/** المقفول: الكل مفعّل أو الكل طافي = تلقائي (ولا تثبيت) */
export function ufiLocked(r: Record<string, string>): number[] {
  const av = ufiAvailable(r);
  const on = av.filter(b => r['lockband' + b] === '1');
  return on.length === 0 || on.length === av.length ? [] : on;
}
export function ufiSignal(r: Record<string, string>): Signal {
  const nt = String(r.network_type ?? '').toUpperCase();
  const b = String(r.lte_band ?? '').match(/(\d+)/);
  return {
    network: /LTE|4G/.test(nt) ? '4G' : /WCDMA|UMTS|HSPA|3G/.test(nt) ? '3G' : /GSM|EDGE|GPRS|2G/.test(nt) ? '2G' : nt ? nt : undefined,
    band: b ? 'B' + b[1] : undefined,
    earfcn: str(r.nv_arfcn), pci: str(r.nv_pci), cellId: str(r.nv_cellid), enodebId: str(r.nv_enodebid),
    rsrp: num(r.nv_rsrp, -150, -30) ?? num(r.lte_rsrp, -150, -30),
    rsrq: num(r.nv_rsrq, -40, 0),
    sinr: num(r.lte_sinr, -30, 50),
    rssi: num(r.rssi, -130, -10),
  };
}

export class ZteUfiDriver implements RouterDriver {
  id = 'zte-ufi';
  name = 'ZTE 4G';
  capabilities: Capability[] = ['signal', 'cells', 'reboot', 'bandLock', 'devices', 'block'];

  private host = '';

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private headers(extra: Record<string, string> = {}) {
    return { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01', Referer: this.base() + '/index.html', ...extra };
  }
  private async get(cmds: string[]): Promise<Record<string, string>> {
    const multi = cmds.length > 1 ? '&multi_data=1' : '';
    const r = await http(`${this.base()}/goform/goform_get_cmd_process?isTest=false&cmd=${encodeURIComponent(cmds.join(','))}${multi}&_=${Date.now()}`, { headers: this.headers() }, 8000);
    const t = await r.text();
    let j: any;
    try { j = JSON.parse(t); } catch { throw new Error('goform_get_cmd_process: رد غير متوقع'); }
    const out: Record<string, string> = {};
    if (j && typeof j === 'object') for (const [k, v] of Object.entries(j)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    return out;
  }
  private async getRaw(cmd: string): Promise<any> {
    const r = await http(`${this.base()}/goform/goform_get_cmd_process?isTest=false&cmd=${cmd}&_=${Date.now()}`, { headers: this.headers() }, 8000);
    return JSON.parse(await r.text());
  }
  private async post(body: Record<string, string>, what = body.goformId): Promise<any> {
    const form = Object.entries({ isTest: 'false', ...body }).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const r = await http(`${this.base()}/goform/goform_set_cmd_process`, {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }), body: form,
    }, 12000);
    const t = await r.text();
    let j: any;
    try { j = JSON.parse(t); } catch { throw new Error(`${what}: رد غير متوقع`); }
    return j;
  }
  private async act(body: Record<string, string>, what: string): Promise<void> {
    const j = await this.post(body, what);
    if (String(j?.result) !== 'success') throw new Error(`${what}: الراوتر رفض (${String(j?.result ?? '؟').slice(0, 30)})`);
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const r = await this.get(['cr_version', 'wa_inner_version', 'lockband1']);
      // ZTE الجديد عنده wa_inner_version — يروح لدرايفر ZTE. هذا للقديم بس
      return !!str(r.cr_version) && !str(r.wa_inner_version) && 'lockband1' in r;
    } catch { return false; }
  }
  async identify(): Promise<ModelProfile | null> {
    try {
      const r = await this.get(['cr_version', 'hw_version']);
      const v = str(r.cr_version) ?? '';
      const m = v.match(/^([A-Za-z0-9]+?)(?:_|V\d|$)/)?.[1] ?? '';
      return { id: 'zte-ufi' + (m ? '-' + m.toLowerCase() : ''), label: m ? `${m} (جيب 4G)` : 'راوتر جيب 4G', brand: 'zte', tech: '4G', nrLock: false };
    } catch { return null; }
  }

  async login(host: string, username: string, password: string, opts?: { lastTry?: boolean; fresh?: boolean }): Promise<void> {
    this.host = host;
    if (!opts?.fresh && !opts?.lastTry) {
      try { if ((await this.get(['loginfo'])).loginfo === 'ok') return; } catch {}
    }
    const st = await this.get(['psw_fail_num_str', 'login_lock_time']).catch(() => ({} as Record<string, string>));
    const left = parseInt(st.psw_fail_num_str ?? '', 10);
    if (left === 0) throw new Error(`الراوتر قفل الدخول بعد محاولات غلط — جرّب بعد ${Math.ceil(Number(st.login_lock_time || 300) / 60)} دقايق`);
    if (left === 1 && !opts?.lastTry) {
      const e = new Error('باقي محاولة وحدة قبل ما يقفل الراوتر الدخول — تأكد من كلمة المرور.');
      (e as any).code = 'LAST_TRY'; (e as any).left = 1;
      throw e;
    }
    const j = await this.post({ goformId: 'LOGIN', username: b64((username || '').trim() || 'admin'), password: b64(password) }, 'LOGIN');
    const res = String(j?.result ?? '');
    if (res === '0' || res === '4') return;
    if (res === '3') throw new Error('كلمة المرور غلط — تأكد منها من الملصق أو اللي غيّرتها');
    if (res === '2') throw new Error('فيه أحد داخل صفحة الراوتر من جهاز ثاني — سكّرها وجرّب بعد دقيقة');
    throw new Error(`LOGIN: الراوتر رفض الدخول (${res || '؟'})`);
  }
  async logout(): Promise<void> {
    try { await this.post({ goformId: 'LOGOUT' }); } catch {}
  }

  // ═══ الإشارة (4G بس) ═══
  private async sig(): Promise<Record<string, string>> {
    return this.get(['network_type', 'network_provider', 'nv_rsrp', 'lte_rsrp', 'nv_rsrq', 'lte_sinr', 'nv_pci', 'nv_arfcn', 'lte_band', 'nv_cellid', 'nv_enodebid', 'rssi', 'ppp_status']);
  }
  async getSignal(): Promise<Signal> { return ufiSignal(await this.sig()); }
  async getCells(): Promise<CellTower[]> {
    const s = await this.getSignal();
    return s.pci || s.rsrp !== undefined
      ? [{ kind: 'serving', tech: 'LTE', pci: s.pci, arfcn: s.earfcn, band: s.band ? parseInt(s.band.slice(1), 10) : undefined, cellId: s.cellId, rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr }]
      : [];
  }
  async getSnapshot(): Promise<SignalSnapshot> {
    const s = await this.getSignal();
    return buildSnapshot(s, [], await this.getCells(), { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const r = await this.sig();
    return { operator: str(r.network_provider), connected: /connected/i.test(r.ppp_status ?? '') && !/disconnected/i.test(r.ppp_status ?? ''), mode: ufiSignal(r).network, supports5g: false };
  }
  async isConnected(): Promise<boolean> {
    try { const p = (await this.get(['ppp_status'])).ppp_status ?? ''; return /connected/i.test(p) && !/disconnected/i.test(p); } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const r = await this.get(['cr_version', 'hw_version', 'wan_ipaddr', 'network_provider']).catch(() => ({} as Record<string, string>));
    return { model: (await this.identify())?.label, software: str(r.cr_version), hardware: str(r.hw_version), wanIp: str(r.wan_ipaddr), operator: str(r.network_provider) };
  }

  async reboot(): Promise<void> {
    try { await this.post({ goformId: 'REBOOT_DEVICE' }); } catch {}
  }
  async factoryReset(): Promise<void> { await this.act({ goformId: 'RESTORE_FACTORY_SETTINGS' }, 'ضبط المصنع'); }
  /** آي بي جديد: فصل البيانات ورجوعها (نفس زر «اتصال/فصل» في الصفحة) */
  async reconnectData(opts?: { holdSecs?: number }): Promise<void> {
    await this.act({ goformId: 'DISCONNECT_NETWORK', notCallback: 'true' }, 'فصل البيانات');
    await sleep(Math.max(2, opts?.holdSecs ?? 3) * 1000);
    await this.act({ goformId: 'CONNECT_NETWORK', notCallback: 'true' }, 'رجوع البيانات');
  }

  // ═══ تثبيت الترددات (band_lock.js) ═══
  private async bandsRaw(): Promise<Record<string, string>> {
    return this.get(UFI_BANDS.map(b => 'lockband' + b));
  }
  async getBandConfig(): Promise<BandConfig> {
    const r = await this.bandsRaw();
    return { supported: ufiAvailable(r), locked: ufiLocked(r), nrSupported: [], nrLocked: [], mode: '03', modes: [] };
  }
  async setBand(bands: number[] | 'keep'): Promise<void> {
    if (bands === 'keep') return;
    const r = await this.bandsRaw();
    const av = ufiAvailable(r);
    const want = bands.filter(b => av.includes(b));
    if (bands.length && !want.length) throw noChange('الترددات اللي اخترتها ما يدعمها راوترك — ما غيّرنا شي.');
    // فك التثبيت = كل الترددات المتاحة مفعّلة (آمن مهما كان معنى «الكل صفر» في الفيرموير)
    const on = want.length ? want : av;
    const cur = ufiLocked(r);
    if (cur.length === want.length && cur.every(b => want.includes(b))) return;
    const body: Record<string, string> = { goformId: 'SET_BAND_LOCK' };
    for (const b of UFI_BANDS) body[`band${b}_lock`] = on.includes(b) ? '1' : '0';
    await this.act(body, 'تثبيت الترددات');
    await sleep(3000);
    const got = ufiLocked(await this.bandsRaw());
    if (got.length !== want.length || !got.every(b => want.includes(b))) throw new Error('الراوتر قبل أمر الترددات بس القراءة بعده مختلفة');
  }
  async getActiveLock(): Promise<ActiveLock | null> {
    const l = (await this.getBandConfig()).locked;
    return l.length ? { bands: l, nrBands: [] } : null;
  }
  async readLockState(): Promise<LockSnapshot> {
    const l = ufiLocked(await this.bandsRaw());
    return { driver: this.id, at: Date.now(), summary: `4G: ${l.map(b => 'B' + b).join('+') || 'تلقائي'}`, data: { bands: l } };
  }
  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    try { await this.setBand((snap.data as { bands: number[] }).bands); } catch { throw restoreMismatch(['الترددات']); }
  }
  async restoreAll(): Promise<void> { try { await this.setBand([]); } catch {} }

  // ═══ الأجهزة والحظر (WIFI_MAC_FILTER) ═══
  async getDevices(): Promise<ConnectedDevice[]> {
    const [w, l, f] = await Promise.all([
      this.getRaw('station_list').catch(() => ({})), this.getRaw('lan_station_list').catch(() => ({})), this.filter().catch(() => null),
    ]);
    const rows: any[] = [...(Array.isArray(w?.station_list) ? w.station_list : []), ...(Array.isArray(l?.lan_station_list) ? l.lan_station_list : [])];
    const black = new Set(f?.mode === '2' ? f.black : []);
    const seen = new Set<string>();
    return rows.filter(x => x?.mac_addr).map(x => ({ mac: String(x.mac_addr).toUpperCase(), ip: str(x.ip_addr), name: str(x.hostname) }))
      .filter(d => !seen.has(d.mac) && !!seen.add(d.mac)).map(d => ({ ...d, blocked: black.has(d.mac) }));
  }
  private async filter() {
    const r = await this.get(['ACL_mode', 'wifi_mac_black_list', 'wifi_mac_white_list']);
    return { mode: String(r.ACL_mode ?? '0'), black: String(r.wifi_mac_black_list ?? '').split(';').map(x => x.trim().toUpperCase()).filter(Boolean) };
  }
  async getBlockedDevices(): Promise<ConnectedDevice[]> {
    const f = await this.filter();
    return f.mode === '2' ? f.black.map(mac => ({ mac, blocked: true })) : [];
  }
  async blockDevice(mac: string, block: boolean): Promise<void> {
    const m = mac.toUpperCase();
    const f = await this.filter();
    if (f.mode === '1') throw noChange('فلتر الأجهزة في راوترك على «القائمة البيضاء» — غيّره من صفحة الراوتر لو تبي تحظر من هنا. ما غيّرنا شي.');
    const list = f.mode === '2' ? f.black : [];
    const next = block ? (list.includes(m) ? list : [...list, m]) : list.filter(x => x !== m);
    if (next.length > 10) throw noChange('راوترك يحظر ١٠ أجهزة بالكثير — فك حظر جهاز أول. ما غيّرنا شي.');
    if (next.length === list.length && f.mode === (block ? '2' : f.mode) && next.every(x => list.includes(x))) return;
    await this.act({ goformId: 'WIFI_MAC_FILTER', ACL_mode: '2', wifi_mac_black_list: next.join(';') }, block ? 'حظر الجهاز' : 'فك الحظر');
  }
}
