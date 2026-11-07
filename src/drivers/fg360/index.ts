/**
 * لوحة «FG360» — 5G CPE (Arcadyan AW1000 بسوفتوير OpenWrt معدّل، لوحة عربية/صينية على المنفذ 8088).
 * ٧ نوفمبر ٢٠٢٦ — من ملفات FULL عضو (app.js الصفحة نفسها). شرح الردود في parse.ts.
 *
 * ليش درايفر لحاله: على المنفذ 80 فيه LuCI الأصلية وتعلق (كل الطلبات timeout — تقريرين «جهاز جديد» ٧ نوفمبر)،
 * واللوحة الحقيقية JSON نظيف على :8088/cgi-bin/api.cgi. لو العنوان بدون منفذ نضيف 8088 بنفسنا.
 *
 * المزايا (كلها من أوامر صفحتهم نفسها): الإشارة والدمج والأبراج المجاورة، تثبيت ترددات 4G/5G،
 * تثبيت برج (cell.set مؤقت — يرجع تلقائي بعد إعادة التشغيل)، وضع الشبكة، إعادة التشغيل.
 * ما نلمس: imei.set ولا قوة الإرسال (tx_power) ولا الفيرموير.
 */
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, DeviceDetails, RouterExtras,
  BandConfig, CellLockTarget, CellLockState, ActiveLock, Carrier,
} from '../types';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { noChange } from '../noChange';
import { http } from '../http';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import type { ModelProfile } from '../models';
import { fgSignal, fgCells, fgCarriers, fgNetwork, FG_MODES, nums, scrub, fgHost } from './parse';

const API = '/cgi-bin/api.cgi';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class Fg360Driver implements RouterDriver {
  readonly id = 'fg360';
  name = '5G CPE (AW1000)';
  readonly capabilities: Capability[] = ['signal', 'cells', 'bandLock', 'reboot'];

  private host = '';
  private session = '';
  private creds: { u: string; p: string } | null = null;
  private logged = new Set<string>();

  private base() { return 'http://' + this.host; }

  /** طلب واحد للـ API — يرجع JSON أو يرمي برسالة الراوتر نفسها */
  private async raw(action: string, data: Record<string, unknown> = {}, timeout = 10000): Promise<{ status: number; j: any }> {
    const r = await http(this.base() + API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...data, action, session: this.session }),
    }, timeout);
    const t = await r.text();
    let j: any = null;
    try { j = JSON.parse(t); } catch {}
    return { status: r.status, j };
  }

  private async api(action: string, data: Record<string, unknown> = {}, timeout = 10000): Promise<any> {
    let { status, j } = await this.raw(action, data, timeout);
    // الجلسة انتهت ← ندخل مرة وحدة ونعيد
    if (status === 401 && this.creds) {
      diag(`[fg360] ${action}: الجلسة انتهت — ندخل من جديد`);
      await this.doLogin(this.creds.u, this.creds.p);
      ({ status, j } = await this.raw(action, data, timeout));
    }
    if (!j) throw new Error(`${action}: الراوتر رجّع رد غير متوقع (HTTP ${status})`);
    if (status === 401) throw new Error('انتهت الجلسة — ادخل مرة ثانية');
    if (status >= 400 || j.success === false) throw new Error(`الراوتر رفض ${action}: ${String(j.message || j.output || status).slice(0, 120)}`);
    if (!this.logged.has(action) && /\.get$/.test(action)) {
      this.logged.add(action);
      diag(`[fg360] ${action} خام: ${scrub(j)}`);
    }
    return j;
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    // عنوان بمنفذ ثاني (غير 8088) — مو هذا الجهاز
    const h = fgHost(host);
    if (!/:8088$/.test(h)) return false;
    this.host = h;
    try {
      const { j } = await this.raw('system.password.status', {}, 2500);
      return !!j && typeof j === 'object' && 'setup_required' in j;
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    return {
      id: 'fg360-aw1000', label: this.name, brand: 'openwrt', tech: '5G',
      writeUnverified: true,
      note: 'لوحة 5G CPE (FG360) على المنفذ 8088 — جديد، جرّبه وأرسل ملفات راوترك لو شي ما زبط.',
    };
  }

  private async doLogin(username: string, password: string) {
    this.session = '';
    const st = await this.raw('system.password.status', {}, 8000).catch(() => null);
    if (st?.j?.setup_required) throw new Error('الراوتر ما عليه كلمة مرور للحين — افتح http://192.168.1.1:8088 في المتصفح وحط كلمة مرور أول مرة، وبعدها ارجع للتطبيق');
    let r: { status: number; j: any };
    try {
      r = await this.raw('login', { username: username || 'root', password }, 15000);
    } catch (e) {
      throw new Error(`الراوتر ما رد على الدخول (${this.host}) — تأكد إنك متصل بشبكته. ${String((e as any)?.message ?? e).slice(0, 60)}`);
    }
    const msg = String(r.j?.message ?? '').slice(0, 100);
    diag(`[fg360] login → ${r.status}${msg ? ` · «${msg}»` : ''}${r.j?.session ? ' · session✓' : ''}`);
    if (r.status === 429 || /锁|lock|频繁|too many/i.test(msg)) throw new Error('الراوتر وقّف الدخول بعد محاولات كثيرة — انتظر شوي وجرّب');
    if (!r.j?.session) {
      if (r.status === 401 || r.status === 403 || /密码|password|用户|user|错误|incorrect|invalid/i.test(msg)) {
        throw new Error('اسم المستخدم أو كلمة المرور غلط — نفس اللي تدخل فيها لوحة 192.168.1.1:8088 (المستخدم غالباً root)');
      }
      throw new Error(`الدخول فشل${msg ? `: ${msg}` : ` (HTTP ${r.status})`}`);
    }
    this.session = String(r.j.session);
  }

  async login(host: string, username: string, password: string): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = fgHost(host);
    this.creds = { u: username || 'root', p: password };
    await this.doLogin(this.creds.u, this.creds.p);
  }

  async logout(): Promise<void> {
    if (!this.session) return;
    try { await this.raw('logout', {}, 4000); } catch {}
    this.session = '';
  }

  async isConnected(): Promise<boolean> {
    try { await this.api('status.get', {}, 6000); return true; } catch { return false; }
  }

  private async cell(): Promise<any> {
    const r = await this.api('status.get');
    return r?.cellular ?? {};
  }

  private async net(): Promise<any> {
    // صفحتهم تعيد لين ready (المودم يجهّز بعد الإقلاع) — نعيد ٣ مرات بس
    for (let i = 0; i < 3; i++) {
      const r = await this.api('network.get');
      const n = r?.network;
      if (n && n.ready !== false) return n;
      await sleep(2000);
    }
    throw noChange('المودم في الراوتر لسا يجهّز — جرّب بعد دقيقة. ما غيّرنا شي.');
  }

  async getSignal(): Promise<Signal> { return fgSignal(await this.cell()); }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const c = await this.cell();
    return {
      operator: String(c.operator_name || c.operator || '').trim() || undefined,
      connected: c.status === 'connected', mode: fgNetwork(c) || undefined, supports5g: true,
    };
  }

  async getDeviceDetails(): Promise<DeviceDetails> {
    const c = await this.cell().catch(() => ({} as any));
    return {
      model: this.name, operator: String(c.operator_name || c.operator || '').trim() || undefined,
      simStatus: c.sim_status || undefined, software: 'fg360-1',
    };
  }

  async getCells(): Promise<CellTower[]> { return fgCells(await this.cell()); }
  async getCarriers(): Promise<Carrier[]> { return fgCarriers(await this.cell()); }

  async getSnapshot(): Promise<SignalSnapshot> {
    const c = await this.cell();
    return buildSnapshot(fgSignal(c), fgCarriers(c), fgCells(c), { driverId: this.id, driverName: this.name });
  }

  async getExtras(): Promise<RouterExtras> {
    const c = await this.cell().catch(() => ({} as any));
    const x: RouterExtras = {};
    const t = Number(String(c.temperature ?? '').match(/-?\d+(\.\d+)?/)?.[0]);
    if (Number.isFinite(t) && t > 0 && t < 120) x.health = { tempC: t };
    if (c.uptime) x.uptime = String(c.uptime);
    return x;
  }

  async reboot(): Promise<void> { await this.api('system.reboot', {}, 15000); }

  // ═══ الترددات ووضع الشبكة ═══
  private cfgOf(n: any): BandConfig {
    return {
      supported: nums(n.supported_lte), locked: lockedOf(n.lte_bands, n.supported_lte),
      nrSupported: nums(n.supported_nr), nrLocked: lockedOf(n.nr_bands, n.supported_nr),
      mode: String(n.rat ?? ''), modes: FG_MODES,
    };
  }
  async getBandConfig(): Promise<BandConfig> { return this.cfgOf(await this.net()); }

  /** [] = كل الترددات (صفحتهم ما فيها «تلقائي» — كل المربعات = حر) · keep / undefined = نفس الحالي */
  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const n = await this.net();
    const sL = nums(n.supported_lte), sN = nums(n.supported_nr);
    if (!sL.length) throw noChange('الراوتر ما أعطانا قائمة ترددات 4G — ما غيّرنا شي.');
    const curL = nums(n.lte_bands), curN = nums(n.nr_bands);
    const lte = bands === 'keep' ? (curL.length ? curL : sL) : (bands.length ? nums(bands) : sL);
    const nr = nrBands === undefined ? (curN.length ? curN : sN) : (nrBands.length ? nums(nrBands) : sN);
    const badL = lte.filter(b => !sL.includes(b)), badN = nr.filter(b => !sN.includes(b));
    if (badL.length || badN.length) throw noChange(`ترددات مو في قائمة راوترك: ${[...badL.map(b => 'B' + b), ...badN.map(b => 'n' + b)].join(' ')} — ما غيّرنا شي.`);
    if (lte.join() === (curL.length ? curL : sL).join() && nr.join() === (curN.length ? curN : sN).join()) return;
    await this.api('network.bands.set', {
      rat: String(n.rat ?? '20'), preferred1: String(n.preferred1 ?? '6'), preferred2: String(n.preferred2 ?? '3'), lte, nr,
    }, 30000);
    await this.verify(x => nums(x.lte_bands).join() === lte.join() && nums(x.nr_bands).join() === nr.join(), 'الترددات');
  }

  async setNetworkMode(mode: string): Promise<void> {
    if (!FG_MODES.some(m => m.value === mode)) throw noChange('هالوضع مو موجود في قائمة راوترك — ما غيّرنا شي.');
    const n = await this.net();
    if (String(n.rat) === mode) return;
    await this.api('network.mode.set', { rat: mode }, 30000);
    await this.verify(x => String(x.rat) === mode, 'وضع الشبكة');
  }

  /** بعد الكتابة: نقرأ ونتأكد (المودم ياخذ ثواني) */
  private async verify(ok: (n: any) => boolean, what: string) {
    for (const wait of [2000, 4000, 6000]) {
      await sleep(wait);
      const r = await this.api('network.get').catch(() => null);
      const n = r?.network;
      if (n && n.ready !== false && ok(n)) return;
    }
    throw new Error(`الراوتر قبل أمر ${what} بس القراءة بعده مختلفة`);
  }

  // ═══ تثبيت البرج (مؤقت — يرجع تلقائي بعد إعادة تشغيل الراوتر) ═══
  async lockCell(t: CellLockTarget): Promise<void> {
    const pci = String(t.pci ?? '').trim(), arfcn = String(t.arfcn ?? '').trim();
    if (!/^\d{1,4}$/.test(pci) || Number(pci) > 1007) throw noChange('رقم البرج (PCI) ناقص أو غلط — ما غيّرنا شي.');
    if (!/^\d{1,7}$/.test(arfcn)) throw noChange('الراوتر ما أعطانا رقم قناة هذا البرج — ثبّت التردد بدلاً منه.');
    await this.api('cell.set', { kind: t.tech === 'NR' ? 'nr' : 'lte', arfcn, pci, persistent: false }, 40000);
    this.lastLock = { tech: t.tech, pci, arfcn, band: t.band };
  }
  private lastLock: CellLockState | null = null;

  async unlockCell(): Promise<void> {
    await this.api('cell.clear', {}, 40000);
    this.lastLock = null;
  }

  async getCellLocks(): Promise<CellLockState[]> {
    const r = await this.api('cell.get', {}, 10000);
    if (!r?.locked) { this.lastLock = null; return []; }
    // ردهم يقول «مقفول» بس — الأرقام من آخر تثبيت سويناه (لو موجود)
    return [this.lastLock ?? {}];
  }
  async getCellLock(): Promise<CellLockState | null> { return (await this.getCellLocks())[0] ?? null; }

  async getActiveLock(): Promise<ActiveLock | null> {
    const c = await this.getBandConfig();
    const cell = (await this.getCellLocks().catch(() => []))[0];
    if (!c.locked.length && !c.nrLocked.length && !cell) return null;
    return { bands: c.locked, nrBands: c.nrLocked, pci: cell?.pci };
  }

  async readLockState(): Promise<LockSnapshot> {
    const n = await this.net();
    const b = this.cfgOf(n);
    const cellLocked = !!(await this.api('cell.get', {}, 10000).catch(() => null))?.locked;
    const summary = `4G: ${b.locked.map(x => 'B' + x).join('+') || 'تلقائي'} · 5G: ${b.nrLocked.map(x => 'n' + x).join('+') || 'تلقائي'} · ${FG_MODES.find(m => m.value === b.mode)?.label ?? b.mode}${cellLocked ? ' · برج مثبّت' : ''}`;
    return { driver: this.id, at: Date.now(), summary, data: { lte: b.locked, nr: b.nrLocked, mode: b.mode, cellLocked } };
  }

  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    const d = snap.data as { lte?: number[]; nr?: number[]; mode?: string; cellLocked?: boolean };
    const miss: string[] = [];
    // البرج ← الترددات ← الوضع
    if (!d.cellLocked) { try { await this.unlockCell(); } catch { miss.push('البرج'); } }
    try { await this.setBand(d.lte ?? [], d.nr ?? []); } catch { miss.push('الترددات'); }
    if (d.mode) { try { await this.setNetworkMode(d.mode); } catch { miss.push('وضع الشبكة'); } }
    if (miss.length) throw restoreMismatch(miss);
  }

  async restoreAll(): Promise<void> {
    const miss: string[] = [];
    try { await this.unlockCell(); } catch { miss.push('البرج'); }
    try { await this.setBand([], []); } catch { miss.push('الترددات'); }
    if (miss.length) throw restoreMismatch(miss);
  }
}

/** المختار = كل المدعوم ← «تلقائي» (قائمة فاضية) مثل باقي الدرايفرات */
function lockedOf(sel: unknown, sup: unknown): number[] {
  const s = nums(sel), all = nums(sup);
  if (!s.length || (all.length && s.length >= all.length && all.every(b => s.includes(b)))) return [];
  return s;
}
