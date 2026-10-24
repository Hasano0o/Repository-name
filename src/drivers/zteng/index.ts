/**
 * ZTE الجيل الجديد (U60 Pro / MU5250، وغالباً G5 Ultra وأجهزة zwrt الأحدث).
 * الصفحة ما فيها goform — كل شي عبر ubus JSON-RPC على /ubus/.
 *
 *  - القراءة: zte_nwinfo_api.nwinfo_get_netinfo مسموح بدون دخول (rpcd ACL «unauthenticated»).
 *  - الدخول: zwrt_web.web_login_info (salt) ثم web_login بـ SHA256(SHA256(pw).upper + salt).upper
 *    (مرجع: dklasens/MU5250-OpenUI، MIT). ما ندخل إلا لما نحتاج نكتب، ومرة وحدة بس:
 *    لو انرفضت الكلمة نتذكرها وما نعيدها (نفس حماية MU5001) — عشان ما ينقفل الدخول.
 *  - الكتابة (نفس أوامر صفحة الراوتر):
 *      4G: nwinfo_set_gwl_bandlock  lte_band_mask = قناع **عشري** كنص
 *      5G: nwinfo_set_nrbandlock    nr5g_band = "78,41" (يطبّق على SA بس — في NSA ما له أثر)
 *      وضع الشبكة: nwinfo_set_netselect  net_select
 *      إعادة التشغيل: zwrt_mc.device.manager.device_reboot
 *  - تثبيت البرج: موقوف — فكّه ما يسري إلا بإعادة تشغيل أو تبديل وضع الشبكة.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import {
  RouterDriver, Capability, Signal, Carrier, SignalSnapshot, NetworkInfo, CellTower, DeviceTemp,
  Traffic, Usage, BandConfig, ActiveLock, CellLockState, DeviceDetails,
} from '../types';
import { http } from '../http';
import { buildSnapshot } from '../../utils/snapshot';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { isBadPassword, markBadPassword } from '../zte/formulaStore';

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

export class ZteNgDriver implements RouterDriver {
  id = 'zte-ng';
  name = 'ZTE (الجيل الجديد)';
  capabilities: Capability[] = ['signal', 'cells', 'bandLock', 'reboot', 'usage', 'traffic'];
  cellLockRisk = 'تثبيت البرج موقوف على هذا الجهاز للحين — فكّه ما يسري إلا بإعادة تشغيل الراوتر. استخدم تثبيت الترددات بداله.';

  private host = '';
  private session = ZERO;
  private password = '';
  private orig: Record<string, string> | null = null;

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  /** نداء ubus واحد — يرجع الكائن (result[1]) أو يرمي لو الكود مو 0 */
  private async call(obj: string, method: string, params: Record<string, unknown> = {}, session?: string): Promise<Record<string, unknown>> {
    const body = JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'call', params: [session ?? this.session, obj, method, params] }]);
    const res = await http(`${this.base()}/ubus/?t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: this.base() + '/', 'Z-Mode': '1' },
      body,
    }, 6000);
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
      return typeof info === 'object' && ('network_type' in info || 'lte_rsrp' in info || 'nr5g_rsrp' in info);
    } catch {
      try { await this.call('zwrt_web', 'web_language_get', {}, ZERO); return true; } catch { return false; }
    }
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
    if (!s2) {
      await markBadPassword(this.host, fp);
      throw new Error('كلمة المرور غلط. تأكد منها (الملصق تحت الراوتر أو اللي غيّرتها أنت) — ما بنجرّب مرة ثانية لحالنا.');
    }
    await markBadPassword(this.host, null);
    this.session = s2;
  }

  /** أمر كتابة: يدخل لو ما دخلنا، ولو الجلسة انتهت (رفض صلاحية) يدخل مرة ثانية ويعيد */
  private async write(obj: string, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.session === ZERO) await this.doLogin();
    try {
      return await this.call(obj, method, params);
    } catch (e: any) {
      if (e?.code === 6 || e?.code === -32002) {
        this.session = ZERO;
        await this.doLogin();
        return await this.call(obj, method, params);
      }
      throw e;
    }
  }

  async logout(): Promise<void> {
    if (this.session !== ZERO) { try { await this.call('zwrt_web', 'web_logout', {}); } catch {} }
    this.session = ZERO;
  }

  private async net(): Promise<NetInfo> {
    try { return await this.call('zte_nwinfo_api', 'nwinfo_get_netinfo', {}); }
    catch { return await this.call('zte_nwinfo_api', 'nwinfo_get_netinfo', {}, ZERO); }
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

  async getDeviceDetails(): Promise<DeviceDetails> {
    const d = await this.net().catch(() => ({} as NetInfo));
    let i: Record<string, unknown> = {};
    try { i = await this.call('zwrt_mc.device.manager', 'get_device_info', {}); } catch {}
    const pickS = (o: Record<string, unknown>, ...k: string[]) => { for (const x of k) { const v = str(o[x]); if (v) return v; } return undefined; };
    return {
      model: pickS(i, 'model_name', 'device_name', 'hardware_model', 'product_name') ?? 'ZTE U60 Pro',
      imei: pickS(i, 'imei', 'IMEI'),
      software: pickS(i, 'software_version', 'wa_inner_version', 'sw_version', 'firmware_version'),
      hardware: pickS(i, 'hardware_version', 'hw_version'),
      operator: str(d.network_provider_fullname) || undefined,
    };
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
      await this.write('zte_nwinfo_api', 'nwinfo_set_gwl_bandlock', {
        is_gw_band: '0', gw_band_mask: '0', is_lte_band: '1', lte_band_mask: maskOf(lte),
      });
    }
    if (nrBands) {
      const nr = nrBands.length ? nrBands : (this.baseNr() ?? NR_BANDS);
      const cur = nrListOf((await this.net()).nr5g_sa_band_lock);
      if (!sameSet(cur, nr)) await this.write('zte_nwinfo_api', 'nwinfo_set_nrbandlock', { nr5g_type: 'SA', nr5g_band: nr.join(',') });
    }
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
      await this.write('zte_nwinfo_api', 'nwinfo_set_gwl_bandlock', { is_gw_band: '0', gw_band_mask: '0', is_lte_band: '1', lte_band_mask: maskOf(wl) });
    }
    if (wn.length && !sameSet(nrListOf(d.nr5g_sa_band_lock), wn)) {
      await this.write('zte_nwinfo_api', 'nwinfo_set_nrbandlock', { nr5g_type: 'SA', nr5g_band: wn.join(',') });
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
    try { await this.write('zte_nwinfo_api', 'nwinfo_set_gwl_bandlock', { is_gw_band: '0', gw_band_mask: '0', is_lte_band: '1', lte_band_mask: maskOf(lte.length >= 4 ? lte : LTE_BANDS) }); } catch {}
    try { await this.write('zte_nwinfo_api', 'nwinfo_set_nrbandlock', { nr5g_type: 'SA', nr5g_band: (nr.length ? nr : NR_BANDS).join(',') }); } catch {}
    try { await this.write('zte_nwinfo_api', 'nwinfo_set_netselect', { net_select: b?.net_select || 'WL_AND_5G' }); } catch {}
    try { await this.unlockCell(); } catch {}
    try { await this.reboot(); } catch {}
  }
}
