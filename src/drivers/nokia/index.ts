/**
 * Nokia FastMile 5G Gateway (3.1 — 192.168.1.1، واجهة Angular /web_whw/) — من ملفات صفحة حقيقية لثلاث أعضاء (٢٧ و٣١ أكتوبر).
 * البروتوكول من كود الصفحة نفسه (main-es2015 + assets/js/crypto_page.js):
 *   الدخول: GET login_web_app.cgi?nonce ← {nonce, randomKey, iterations؟} ثم POST login_web_app.cgi بـ sha256 (./crypto) ← {result 0, sid, token}
 *           result ‎-1 = كلمة غلط · ‎-2 = الراوتر قفل الدخول. الجلسة بالكوكي (withCredentials) والكتابة فيها csrf_token = token.
 *   القراءة: GET <اسم>_web_app.cgi ← JSON.
 *
 * الموجود في صفحته وبنيناه: الإشارة 4G/5G + الدمج (PCC/SCC) · معلومات الجهاز · الأجهزة المتصلة · استهلاك الشريحة · إعادة التشغيل.
 * مو موجود في صفحته: تثبيت الترددات والبرج ووضع الشبكة (radio_config فيه «وقت مسح الأبراج» بس) — setBand يوقف قبل أي أمر.
 * لسا ما انجرّب على راوتر حقيقي — أي رد غريب يطلع برسالة فيها اسم الرابط.
 */
import * as Crypto from 'expo-crypto';
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, Carrier, ConnectedDevice, Usage, DeviceDetails, CellLockTarget, CellLockState } from '../types';
import { http } from '../http';
import { noChange } from '../noChange';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import { nkLoginBody } from './crypto';
import { rawFrom, signalFrom, carriersFrom, cellsFrom, devicesFrom, NkRaw } from './parse';

export class NokiaDriver implements RouterDriver {
  id = 'nokia';
  name = 'Nokia FastMile';
  capabilities: Capability[] = ['signal', 'cells', 'reboot', 'devices', 'usage'];

  private host = '';
  private token = '';
  private model = '';

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private hdr(): Record<string, string> {
    return { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json, text/plain, */*', Referer: this.base() + '/web_whw/' };
  }

  /** GET/POST على <base>/<cgi> — يرجّع JSON. صفحة HTML أو 401/403 = الجلسة راحت */
  private async req(path: string, body?: string, timeout = 10000): Promise<any> {
    const r = await http(`${this.base()}/${path}`, body === undefined ? { headers: this.hdr() } : { method: 'POST', headers: this.hdr(), body }, timeout);
    if (r.status === 401 || r.status === 403) throw new Error('انتهت الجلسة');
    const t = (await r.text()).trim();
    if (!r.ok) throw new Error(`${path.split('?')[0]}: HTTP ${r.status}`);
    if (!t) return {};
    try { return JSON.parse(t); } catch {
      if (/<html|<!doctype/i.test(t)) throw new Error('انتهت الجلسة');
      throw new Error(`${path.split('?')[0]}: رد غير متوقع`);
    }
  }
  /** أمر كتابة: csrf_token = token من الدخول (postWithCSRFToken في الصفحة) */
  private post(path: string, data?: string, timeout?: number) {
    const b = (data ? data + '&' : '') + 'csrf_token=' + encodeURIComponent(this.token);
    return this.req(path, b, timeout);
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const r = await http(this.base() + '/', {}, 4000);
      if (r.status >= 400) return false;
      const t = await r.text();
      return /FastMile/i.test(t) && /web_whw/i.test(t);
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    let m = this.model;
    if (!m && this.token) {
      try { m = String((await this.req('dashboard_device_info_status_web_app.cgi'))?.device_app_status?.[0]?.Description ?? '').trim(); } catch {}
      this.model = m;
    }
    const label = m && /\d/.test(m) ? (/nokia/i.test(m) ? m : 'Nokia ' + m) : 'Nokia FastMile 5G Gateway';
    return { id: 'nokia' + (m ? '-' + m.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : ''), label, brand: 'nokia', tech: '5G', nrLock: false };
  }

  async login(host: string, username: string, password: string): Promise<void> {
    this.host = host;
    this.token = '';
    const user = (username || '').trim() || 'admin';
    const n = await this.req('login_web_app.cgi?nonce');
    const nonce = String(n?.nonce ?? '');
    if (!nonce) throw new Error('login_web_app: الراوتر ما أعطى nonce');
    const { body } = nkLoginBody(user, password, nonce, String(n?.randomKey ?? ''), k => Crypto.getRandomBytes(k), n?.iterations === undefined || n?.iterations === null ? undefined : Number(n.iterations) || 0);
    const r = await this.req('login_web_app.cgi', body);
    const res = Number(r?.result);
    if (res === 0 && r?.token) { this.token = String(r.token); return; }
    if (res === -2) throw new Error('الراوتر قفل الدخول بعد محاولات غلط — انتظر شوي وجرّب (محاولات كثيرة)');
    if (res === -1) throw new Error('كلمة المرور غلط — اسم المستخدم مكتوب على ملصق الراوتر تحت Username (admin أو userAdmin — بنفس الحروف الكبيرة والصغيرة) والكلمة تحت Password');
    throw new Error(`تعذّر تسجيل الدخول (login_web_app: ${r?.result ?? 'رد غير متوقع'})`);
  }
  async logout(): Promise<void> {
    try { await this.req('login_web_app.cgi?out'); } catch {}
    this.token = '';
  }

  // ═══ الإشارة ═══
  private async raw(): Promise<NkRaw> {
    const r = await this.req('fastmile_radio_status_web_app.cgi');
    if (!r || typeof r !== 'object' || (!r.cell_LTE_stats_cfg && !r.cell_5G_stats_cfg)) throw new Error('fastmile_radio_status: رد غير متوقع');
    return rawFrom(r);
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
    const [d, st, radio] = await Promise.all([
      this.req('dashboard_device_info_status_web_app.cgi').catch(() => null),
      this.req('fastmile_statistics_status_web_app.cgi').catch(() => null),
      this.raw().catch(() => null),
    ]);
    const app = d?.device_app_status?.[0] ?? {};
    const sim = st?.sim_cfg?.[0] ?? {};
    if (app.Description) this.model = String(app.Description);
    return {
      model: app.Description || undefined, software: app.SoftwareVersion || undefined, hardware: app.HardwareVersion || undefined,
      imei: st?.network_cfg?.[0]?.IMEI || undefined, simStatus: sim.Status || undefined,
      wanIp: radio?.apn?.X_ALU_COM_IPAddressV4 || undefined,
    };
  }

  async getDevices(): Promise<ConnectedDevice[]> {
    return devicesFrom(await this.req('dashboard_device_info_status_web_app.cgi'));
  }

  async reboot(): Promise<void> {
    try { await this.post('reboot_web_app.cgi'); } catch (e) {
      // الراوتر يطفي قبل ما يرد أحياناً — مو فشل
      if (!/تعذر الاتصال|ما رد|timeout|network|abort/i.test(String((e as any)?.message ?? e))) throw e;
    }
  }

  // ═══ تثبيت البرج (صفحة «Cell management» — main-es2015.455f…، ١٤ نوفمبر) ═══
  // GET cell_management_get_web_app.cgi ← {CellList4G/5G: [{oid, PhysicalCellID, DownlinkEarfcn | Downlink_NR_ARFCN, Band}],
  //   CellMeasurement4G/5G, MeasurementStatus, reason 5 = الحساب بدون صلاحية}
  // إضافة 4G: POST cell_management_4GCell_add_web_app.cgi «PhysicalCellID & DownlinkEarfcn» + csrf_token · حذف: «oid» على *_delete
  // القائمة = الأبراج المسموحة ← برج واحد فيها = مثبّت عليه. 5G يحتاج «Band» بصيغة ما شفناها ← مقفول لين نشوفها.
  private async cellList(): Promise<{ l4: any[]; l5: any[] }> {
    let r: any;
    try { r = await this.req('cell_management_get_web_app.cgi'); } catch (e) {
      if (/HTTP 404/.test(String((e as any)?.message ?? e))) throw noChange('صفحة راوترك ما فيها تثبيت البرج — ما غيّرنا شي.');
      throw e;
    }
    if (Number(r?.reason) === 5) throw noChange('حسابك في الراوتر ما عنده صلاحية تثبيت البرج — ادخل بحساب المدير (admin). ما غيّرنا شي.');
    if (!r || typeof r !== 'object' || (!Array.isArray(r.CellList4G) && !Array.isArray(r.CellList5G))) throw noChange('صفحة راوترك ما فيها تثبيت البرج — ما غيّرنا شي.');
    return { l4: Array.isArray(r.CellList4G) ? r.CellList4G : [], l5: Array.isArray(r.CellList5G) ? r.CellList5G : [] };
  }
  async getCellLocks(): Promise<CellLockState[]> {
    const { l4, l5 } = await this.cellList();
    return [
      ...l4.map(c => ({ tech: 'LTE' as const, pci: String(c.PhysicalCellID), arfcn: String(c.DownlinkEarfcn) })),
      ...l5.map(c => ({ tech: 'NR' as const, pci: String(c.PhysicalCellID), arfcn: String(c.Downlink_NR_ARFCN), band: Number(String(c.Band ?? '').replace(/\D/g, '')) || undefined })),
    ];
  }
  async getCellLock(): Promise<CellLockState | null> { return (await this.getCellLocks().catch(() => []))[0] ?? null; }
  async lockCell(t: CellLockTarget): Promise<void> {
    if (t.tech === 'NR') throw noChange('تثبيت برج 5G في نوكيا يحتاج صيغة ما تأكدنا منها للحين — جرّب برج 4G. ما غيّرنا شي.');
    if (!t.arfcn || !/^\d+$/.test(String(t.arfcn)) || !/^\d+$/.test(String(t.pci))) throw noChange('نحتاج رقم القناة (EARFCN) ورقم البرج (PCI) — ما غيّرنا شي.');
    const { l4 } = await this.cellList();
    const same = (c: any) => String(c.PhysicalCellID) === String(t.pci) && String(c.DownlinkEarfcn) === String(t.arfcn);
    // نشيل الأبراج الثانية (القائمة = المسموح) ونضيف المطلوب لو مو موجود
    for (const c of l4.filter(c => !same(c))) await this.post('cell_management_4GCell_delete_web_app.cgi', `oid=${encodeURIComponent(String(c.oid))}`);
    if (!l4.some(same)) await this.post('cell_management_4GCell_add_web_app.cgi', `PhysicalCellID=${t.pci}&DownlinkEarfcn=${t.arfcn}`);
    const now = await this.cellList();
    if (!(now.l4.length === 1 && same(now.l4[0]))) throw new Error('الراوتر قبل الأمر بس قائمة الأبراج ما صارت على البرج المطلوب — جرّب مرة ثانية');
  }
  async unlockCell(tech?: 'LTE' | 'NR'): Promise<void> {
    const { l4, l5 } = await this.cellList();
    if (tech !== 'NR') for (const c of l4) await this.post('cell_management_4GCell_delete_web_app.cgi', `oid=${encodeURIComponent(String(c.oid))}`);
    if (tech !== 'LTE') for (const c of l5) await this.post('cell_management_5GCell_delete_web_app.cgi', `oid=${encodeURIComponent(String(c.oid))}`);
    const now = await this.cellList();
    if ((tech !== 'NR' && now.l4.length) || (tech !== 'LTE' && now.l5.length)) throw new Error('الراوتر ما شال كل الأبراج من القائمة — جرّب مرة ثانية');
  }

  // ═══ الترددات: مو موجودة في صفحة هالراوتر ═══
  async setBand(): Promise<void> {
    throw noChange('راوتر نوكيا FastMile ما يسمح بتثبيت الترددات ولا البرج — صفحته نفسها ما فيها هالخيار. ما غيّرنا شي.');
  }
}
