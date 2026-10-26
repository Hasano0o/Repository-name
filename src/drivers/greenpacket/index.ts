/**
 * Green Packet 5G CPE (E5-250MK — زين، 192.168.0.1، الدخول admin/admin على الملصق).
 * واجهة REST عادية بدون تشفير: /web/v1/… JSON، الرد {code, msg, data}، الهوية في رأس authorization
 * (من /web/v1/user/login ← data.Authorization). كل شي من ملفات صفحة الراوتر الحقيقية (تقرير ٢٦ أكتوبر).
 *
 * الموجود في صفحته وبنيناه: الإشارة والدمج (cainfo) · تثبيت الترددات 4G/5G (LookBand) · تثبيت البرج
 * (Cell Selection ← Preferred Listing) · وضع الشبكة · إعادة التشغيل وضبط المصنع · الأجهزة وحظرها (فلتر الواي فاي)
 * الرسائل · معلومات الجهاز · مركز التحكم (DMZ، UPnP، تشغيل كل شبكة، الاسم والكلمة) · قناة الواي فاي.
 * كل تغيير نتأكد منه بإعادة القراءة، وفيه لقطة + إرجاع متحقق منه.
 * لسا ما انجرّب على راوتر حقيقي — أي رد غريب يطلع برسالة فيها اسم الأمر عشان يوصلنا في التقرير.
 */
import {
  RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, BandConfig, ActiveLock, CellLockTarget, CellLockState,
  ConnectedDevice, DeviceDetails, Carrier, SmsMessage, RouterExtras, WifiRadio,
} from '../types';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { noChange } from '../noChange';
import { http } from '../http';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import {
  GpRaw, signalFrom, cellsFrom, carriersFrom, neighborsFrom, lockedRows, bandSubmit, bandNo, BandRow, modesFrom, modeOptions, GpMode,
  devicesFrom, smsFrom, ssidError, wifiPassError, isIPv4,
} from './parse';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const V = '/web/v1';
interface GpLockData { lte: number[]; nr: number[]; cfg: string; cells: any[]; mode: string }

export class GreenPacketDriver implements RouterDriver {
  id = 'greenpacket';
  name = 'Green Packet';
  capabilities: Capability[] = ['signal', 'cells', 'reboot', 'bandLock', 'devices', 'block', 'sms'];

  private host = '';
  private token = '';
  private avail: { '4G': string[]; '5G': string[] } | null = null;
  private modes: GpMode[] | null = null;

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }

  /** طلب مثل axios في الصفحة (b775): authorization + الرد {code,data} — غير 200 = رفض */
  private async req(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, opts: { raw?: boolean; timeout?: number } = {}): Promise<any> {
    const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' };
    if (body !== undefined) headers['Content-Type'] = 'application/json;charset=UTF-8';
    if (this.token) headers.authorization = this.token;
    const r = await http(`${this.base()}${V}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, opts.timeout ?? 10000);
    if (r.status === 401) throw new Error('انتهت الجلسة');
    const t = await r.text();
    let j: any;
    try { j = JSON.parse(t); } catch { throw new Error(`${path}: رد غير متوقع (HTTP ${r.status})`); }
    if (opts.raw) return j;
    const code = Number(j?.code);
    if (code === 401) throw new Error('انتهت الجلسة');
    if (j && j.code !== undefined && code !== 200) throw new Error(`${path}: الراوتر رفض (${j.code}${j.msg ? ' ' + String(j.msg).slice(0, 60) : ''})`);
    return j?.data ?? j;
  }
  private get = (p: string) => this.req('GET', p);
  private post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  private del = (p: string, b: unknown) => this.req('DELETE', p, b);

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const j = await this.req('GET', '/startup/productinfo', undefined, { raw: true, timeout: 5000 });
      return !!j && typeof j === 'object' && Number(j.code) === 200 && !!j.data && typeof j.data === 'object';
    } catch { return false; }
  }

  async identify(): Promise<ModelProfile | null> {
    try {
      const d = await this.get('/startup/productinfo');
      const m = String(d?.ProductModel ?? d?.ModelName ?? d?.DeviceName ?? '').trim();
      return { id: 'greenpacket' + (m ? '-' + m.toLowerCase() : ''), label: 'Green Packet' + (m ? ' ' + m : ' 5G'), brand: 'greenpacket', tech: '5G' };
    } catch { return null; }
  }

  async login(host: string, username: string, password: string): Promise<void> {
    this.host = host;
    this.token = '';
    const j = await this.req('POST', '/user/login', { username: (username || '').trim() || 'admin', password }, { raw: true });
    const code = Number(j?.code);
    if (code === 400) throw new Error('اسم المستخدم أو كلمة المرور غلط (الافتراضي على الملصق: admin / admin)');
    if (code === 403) throw new Error('الراوتر قفل الدخول بعد محاولات غلط — انتظر دقيقة وجرّب');
    const tok = j?.data?.Authorization;
    if (code !== 200 || !tok) throw new Error(`user/login: الراوتر رفض الدخول (${j?.code ?? '؟'})`);
    this.token = String(tok);
  }
  async logout(): Promise<void> {
    try { await this.post('/user/logout'); } catch {}
    this.token = '';
  }

  // ═══ الإشارة ═══
  private async raw(): Promise<GpRaw> {
    const safe = (p: string) => this.get(p).catch(() => undefined);
    const [inet, ca, nsa, nr, score] = await Promise.all([
      this.get('/dashboard/internetinfo'), safe('/dashboard/radio/cainfo'), safe('/dashboard/radio/nsacellinfo'),
      safe('/dashboard/radio/nrcellinfo'), safe('/startup/radiocellsinfo'),
    ]);
    return { inet, ca, nsa, nr, score };
  }
  async getSignal(): Promise<Signal> { return signalFrom(await this.raw()); }
  async getCarriers(): Promise<Carrier[]> { return carriersFrom(await this.raw()); }
  async getCells(): Promise<CellTower[]> {
    const r = await this.raw();
    const nb = await this.get('/setting/network/cellselect/sortedcelllist').then(neighborsFrom).catch(() => [] as CellTower[]);
    const own = cellsFrom(r);
    return [...own, ...nb.filter(n => !own.some(o => o.tech === n.tech && o.pci === n.pci && o.arfcn === n.arfcn))];
  }
  async getSnapshot(): Promise<SignalSnapshot> {
    const r = await this.raw();
    return buildSnapshot(signalFrom(r), carriersFrom(r), cellsFrom(r), { driverId: this.id, driverName: this.name });
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    const r = await this.raw();
    return { operator: r.inet?.Operator ? String(r.inet.Operator) : undefined, connected: String(r.inet?.Status) === 'Connected', mode: signalFrom(r).network, supports5g: true };
  }
  async isConnected(): Promise<boolean> {
    try { return String((await this.get('/dashboard/internetinfo'))?.Status) === 'Connected'; } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const [d, w, i] = await Promise.all([
      this.get('/setting/deviceinfo').catch(() => ({} as any)), this.get('/dashboard/waninfo').catch(() => ({} as any)),
      this.get('/dashboard/internetinfo').catch(() => ({} as any)),
    ]);
    return { model: d.ProductModel, software: d.SoftwareVersion, hardware: d.HardwareVersion, wanIp: w.IpAddress, operator: i.Operator };
  }

  async reboot(): Promise<void> {
    try { await this.post('/setting/system/maintenance/reboot'); } catch (e) {
      if (!/تعذر الاتصال|ما رد|timeout|network|abort/i.test(String((e as any)?.message ?? e))) throw e;
    }
  }
  async factoryReset(): Promise<void> { await this.post('/setting/system/maintenance/factoryreset'); }

  // ═══ الترددات ═══
  private async available() {
    if (this.avail) return this.avail;
    const list = async (m: '4G' | '5G') => {
      const r = await this.get(`/setting/network/ltenetworkband?Mode=${m}`).catch(() => null);
      return (Array.isArray(r?.Items) ? r.Items : []).map((x: unknown) => String(x)).filter((x: string) => !isNaN(bandNo(x)));
    };
    const [a, b] = await Promise.all([list('4G'), list('5G')]);
    if (!a.length && !b.length) throw new Error('ltenetworkband: الراوتر ما أعطى قائمة الترددات');
    this.avail = { '4G': a, '5G': b };
    return this.avail;
  }
  private async locked(): Promise<BandRow[]> { return lockedRows(await this.get('/setting/network/ltediscretebandsetting')); }
  private nums = (rows: BandRow[], m: string) => [...new Set(rows.filter(r => r.NetworkMode === m).map(r => bandNo(r.BandId)))].sort((a, b) => a - b);

  async getBandConfig(): Promise<BandConfig> {
    const [av, rows, modes, wm] = await Promise.all([this.available(), this.locked(), this.modeList(), this.get('/setting/network/wirelessnetworksetting/workmode').catch(() => null)]);
    const cur = String(wm?.PreferredMode ?? '');
    return {
      supported: av['4G'].map(bandNo), locked: this.nums(rows, '4G'),
      nrSupported: av['5G'].map(bandNo), nrLocked: this.nums(rows, '5G'),
      nrPreferred: av['5G'].map(bandNo),
      mode: modes.find(m => m.value === cur)?.code ?? cur, modes: modeOptions(modes),
    };
  }
  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const av = await this.available();
    const rows = await this.locked();
    const jobs: ['4G' | '5G', number[]][] = [];
    if (bands !== 'keep') {
      const want = bands.filter(b => av['4G'].some(x => bandNo(x) === b));
      if (bands.length && !want.length) throw noChange('الترددات اللي اخترتها ما تطلع في قائمة راوترك — ما غيّرنا شي.');
      jobs.push(['4G', want]);
    }
    if (nrBands !== undefined) {
      const want = nrBands.filter(b => av['5G'].some(x => bandNo(x) === b));
      if (nrBands.length && !want.length) throw noChange('ترددات 5G اللي اخترتها ما تطلع في قائمة راوترك — ما غيّرنا شي.');
      jobs.push(['5G', want]);
    }
    let wrote = false;
    for (const [m, want] of jobs) {
      const cur = this.nums(rows, m);
      if (cur.length === want.length && cur.every(x => want.includes(x))) continue;
      const items = bandSubmit(m, av[m], rows, want);
      if (!items.some(i => i.OperateType !== 'none')) continue;
      await this.post('/setting/network/ltediscretebandsetting', { Items: items });
      wrote = true;
    }
    if (!wrote) return;
    await sleep(3000);
    const after = await this.locked();
    for (const [m, want] of jobs) {
      const got = this.nums(after, m);
      if (got.length !== want.length || !got.every(x => want.includes(x))) throw new Error('الراوتر قبل أمر الترددات بس القراءة بعده مختلفة');
    }
  }

  // ═══ وضع الشبكة ═══
  private async modeList(): Promise<GpMode[]> {
    if (this.modes) return this.modes;
    this.modes = modesFrom(await this.get('/setting/network/wirelessnetworksetting/preferredmode').catch(() => null));
    return this.modes;
  }
  async setNetworkMode(mode: string): Promise<void> {
    const m = (await this.modeList()).find(x => x.code === mode);
    if (!m) throw noChange('هالوضع مو موجود في قائمة راوترك — ما غيّرنا شي.');
    const cur = await this.get('/setting/network/wirelessnetworksetting/workmode');
    if (String(cur?.PreferredMode) === m.value) return;
    await this.post('/setting/network/wirelessnetworksetting/workmode', { ...(cur && typeof cur === 'object' ? cur : {}), PreferredMode: m.value });
    await sleep(3000);
    if (String((await this.get('/setting/network/wirelessnetworksetting/workmode'))?.PreferredMode) !== m.value) throw new Error('الراوتر قبل أمر وضع الشبكة بس ما تغيّر');
  }

  // ═══ تثبيت البرج (Cell Selection ← Preferred Listing) ═══
  private async cellState(): Promise<{ cfg: string; items: any[] }> {
    const c = await this.get('/setting/network/cellselect/config');
    const cfg = String(c?.Config ?? '');
    const l = cfg === 'PreferredListing' ? await this.get('/setting/network/cellselect/preferredlist').catch(() => null) : null;
    return { cfg, items: Array.isArray(l?.Items) ? l.Items : [] };
  }
  async getCellLocks(): Promise<CellLockState[]> {
    const s = await this.cellState();
    if (s.cfg !== 'PreferredListing') return [];
    return s.items.map(x => ({ tech: String(x.NetworkMode) === '5G' ? 'NR' as const : 'LTE' as const, pci: String(x.PCI ?? ''), arfcn: String(x.Earfcn ?? ''), band: bandNo(x.BandId) || undefined }));
  }
  async getCellLock(): Promise<CellLockState | null> { return (await this.getCellLocks())[0] ?? null; }
  private async clearPreferred(items: any[]) {
    for (const x of items) {
      await this.del('/setting/network/cellselect/preferredlist', { Items: [{
        IndexId: x.IndexId, NetworkMode: x.NetworkMode, BandId: x.BandId, Earfcn: x.Earfcn, PCI: x.PCI, Priority: x.Priority, OperateType: 'delete',
      }] });
    }
  }
  async lockCell(t: CellLockTarget): Promise<void> {
    const pci = String(t.pci ?? '').trim(), arfcn = String(t.arfcn ?? '').trim();
    if (!pci) throw noChange('ما عندنا رقم البرج (PCI) — ما نقدر نثبّت عليه');
    if (!arfcn) throw noChange('الراوتر ما أعطانا رقم قناة هذا البرج — ثبّت التردد بدلاً منه');
    const mode = t.tech === 'NR' ? '5G' : '4G';
    const av = await this.available();
    let band = t.band;
    if (!band) band = (await this.getCells().catch(() => [])).find(c => c.pci === pci && c.arfcn === arfcn)?.band;
    const bandId = av[mode].find(x => bandNo(x) === band);
    if (!bandId) throw noChange('ما عرفنا تردد هذا البرج من قائمة راوترك — ما غيّرنا شي.');
    const s = await this.cellState();
    if (s.cfg === 'PreferredListing' && s.items.length === 1 && String(s.items[0].PCI) === pci && String(s.items[0].Earfcn) === arfcn) return;
    if (s.cfg !== 'PreferredListing') await this.post('/setting/network/cellselect/config', { Config: 'PreferredListing' });
    const cur = s.cfg === 'PreferredListing' ? s.items : (await this.get('/setting/network/cellselect/preferredlist').catch(() => null))?.Items ?? [];
    await this.clearPreferred(cur);
    await this.post('/setting/network/cellselect/preferredlist', { Items: [{ IndexId: '', OperateType: 'insert', Priority: '1', NetworkMode: mode, BandId: bandId, Earfcn: arfcn, PCI: pci }] });
    await sleep(3000);
    const a = await this.cellState();
    if (a.cfg !== 'PreferredListing' || !a.items.some(x => String(x.PCI) === pci && String(x.Earfcn) === arfcn)) throw new Error('الراوتر قبل أمر تثبيت البرج بس القراءة بعده مختلفة');
  }
  async unlockCell(): Promise<void> {
    const s = await this.cellState();
    if (s.cfg === 'PreferredListing') {
      await this.clearPreferred(s.items).catch(() => {});
      await this.post('/setting/network/cellselect/config', { Config: 'AutoSelect' });
    }
  }
  async getActiveLock(): Promise<ActiveLock | null> {
    const c = await this.getBandConfig();
    const cell = (await this.getCellLocks().catch(() => []))[0];
    if (!c.locked.length && !c.nrLocked.length && !cell) return null;
    return { bands: c.locked, nrBands: c.nrLocked, pci: cell?.pci };
  }

  // ═══ لقطة + إرجاع متحقق منه ═══
  async readLockState(): Promise<LockSnapshot> {
    const rows = await this.locked();
    const s = await this.cellState();
    const wm = await this.get('/setting/network/wirelessnetworksetting/workmode').catch(() => null);
    const data: GpLockData = { lte: this.nums(rows, '4G'), nr: this.nums(rows, '5G'), cfg: s.cfg, cells: s.items, mode: String(wm?.PreferredMode ?? '') };
    const summary = `4G: ${data.lte.map(x => 'B' + x).join('+') || 'تلقائي'} · 5G: ${data.nr.map(x => 'n' + x).join('+') || 'تلقائي'}${data.mode ? ' · ' + data.mode : ''}${data.cfg === 'PreferredListing' ? ` · برج ${data.cells.map(c => c.PCI).join('+')}` : ''}`;
    return { driver: this.id, at: Date.now(), summary, data };
  }
  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    const d = snap.data as GpLockData;
    const miss: string[] = [];
    try { await this.setBand(d.lte, d.nr); } catch { miss.push('الترددات'); }
    if (d.mode) {
      const m = (await this.modeList()).find(x => x.value === d.mode);
      if (m) { try { await this.setNetworkMode(m.code); } catch { miss.push('وضع الشبكة'); } }
    }
    try {
      const s = await this.cellState();
      if (d.cfg === 'PreferredListing') {
        const want = d.cells[0];
        if (want && !(s.cfg === 'PreferredListing' && s.items.some(x => String(x.PCI) === String(want.PCI)))) {
          await this.lockCell({ tech: String(want.NetworkMode) === '5G' ? 'NR' : 'LTE', pci: String(want.PCI), arfcn: String(want.Earfcn), band: bandNo(want.BandId) });
        }
      } else if (s.cfg === 'PreferredListing') await this.unlockCell();
      if ((await this.cellState()).cfg !== (d.cfg || 'AutoSelect') && d.cfg) miss.push('تثبيت البرج');
    } catch { miss.push('تثبيت البرج'); }
    if (miss.length) throw restoreMismatch(miss);
  }
  async restoreAll(): Promise<void> {
    try { await this.setBand([], []); } catch {}
    try { await this.unlockCell(); } catch {}
    try { const auto = (await this.modeList()).find(m => m.code === '00'); if (auto) await this.setNetworkMode('00'); } catch {}
  }

  // ═══ الأجهزة والحظر (فلتر الواي فاي — القائمة السوداء) ═══
  async getDevices(): Promise<ConnectedDevice[]> {
    const [h, b] = await Promise.all([this.get('/setting/host/hostsinfo'), this.blackList().catch(() => [])]);
    const bl = new Set(b.map(x => x.mac));
    return devicesFrom(h).map(d => ({ ...d, blocked: bl.has(d.mac) }));
  }
  private async filterMode(): Promise<string> { return String((await this.get('/setting/wifi/macfilterconfig'))?.Settings ?? ''); }
  private async blackList(): Promise<{ mac: string; row: any }[]> {
    if ((await this.filterMode()) !== 'blacklist') return [];
    const r = await this.get('/setting/wifi/macfilteraccesslist?Mode=blacklist');
    return (Array.isArray(r?.AccessList) ? r.AccessList : []).map((x: any) => ({ mac: String(x.MacAddress ?? '').toUpperCase(), row: x }));
  }
  async getBlockedDevices(): Promise<ConnectedDevice[]> { return (await this.blackList()).map(x => ({ mac: x.mac, blocked: true })); }
  async blockDevice(mac: string, block: boolean, name?: string): Promise<void> {
    const m = mac.toUpperCase();
    const mode = await this.filterMode();
    if (mode === 'whitelist') throw noChange('فلتر الأجهزة في راوترك على «القائمة البيضاء» — غيّره من صفحة الراوتر لو تبي تحظر من هنا. ما غيّرنا شي.');
    const r = mode === 'blacklist' ? await this.get('/setting/wifi/macfilteraccesslist?Mode=blacklist') : null;
    const list: any[] = Array.isArray(r?.AccessList) ? r.AccessList : [];
    const row = list.find(x => String(x.MacAddress ?? '').toUpperCase() === m);
    if (block) {
      if (!row) await this.post('/setting/wifi/macfilteraccesslist', { Mode: 'blacklist', AccessList: [{ IndexId: '', HostName: name ?? '', MacAddress: m, OperateType: 'insert' }] });
      if (mode !== 'blacklist') await this.post('/setting/wifi/macfilterconfig', { Settings: 'blacklist' });
    } else if (row) {
      await this.del('/setting/wifi/macfilteraccesslist', { Mode: 'blacklist', AccessList: [{ IndexId: row.IndexId, MacAddress: row.MacAddress, OperateType: 'delete' }] });
    }
  }

  // ═══ الرسائل ═══
  async listSms(box: 'inbox' | 'sent' = 'inbox'): Promise<SmsMessage[]> {
    const p = box === 'sent' ? 'outbox' : 'inbox';
    const out: SmsMessage[] = [];
    for (let start = 0; start < 100; start += 20) {
      const r = await this.get(`/sms/${p}?StartPos=${start}&ReadNum=20`);
      const got = smsFrom(r, box);
      out.push(...got);
      if (got.length < 20) break;
    }
    return out;
  }
  async markSmsRead(index: string): Promise<void> {
    if (index.startsWith('i')) await this.post('/sms/inbox', { SmsId: isNaN(Number(index.slice(1))) ? index.slice(1) : Number(index.slice(1)), Readed: true });
  }
  async deleteSms(index: string): Promise<void> {
    const id = index.slice(1);
    await this.del(index.startsWith('o') ? '/sms/outboxbatchsms' : '/sms/inboxbatchsms', { SmsIds: [isNaN(Number(id)) ? id : Number(id)] });
  }
  async sendSms(phone: string, text: string): Promise<void> {
    const d = new Date();
    await this.post('/sms/newmsg', {
      Recipient: phone, Content: text,
      SmsDate: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, SmsTime: `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`,
    });
  }

  // ═══ مركز التحكم ═══
  async getExtras(): Promise<RouterExtras> {
    const safe = (p: string) => this.get(p).catch(() => null);
    const [dmz, upnp, ap, sec] = await Promise.all([
      safe('/setting/firewall/dmzsetting'), safe('/setting/firewall/upnpsetting'), safe('/setting/wifi/wlanapsetting'), safe('/setting/wifi/wlanapsecurity'),
    ]);
    const ex: RouterExtras = {};
    const on = (v: unknown) => v === true || v === 1 || v === '1' || v === 'Enable' || v === 'true';
    if (dmz && dmz.DmzEnableStatus !== undefined) ex.dmz = { on: on(dmz.DmzEnableStatus), ip: String(dmz.DmzHostIpAddress ?? '') };
    if (upnp && upnp.UPnPServiceEnable !== undefined) ex.upnp = on(upnp.UPnPServiceEnable);
    const sets: any[] = Array.isArray(ap?.Settings) ? ap.Settings : [];
    const bands = sets.map(s => ({ band: String(s.Band).startsWith('5') ? '5' as const : '2.4' as const, on: s.WlanStatus === 'Enable' }));
    if (bands.length) ex.bands = bands;
    const items: any[] = Array.isArray(sec?.Items) ? sec.Items : [];
    const nets = items.map((x, i) => ({ index: String(i), band: String(x.Band ?? '').startsWith('5') ? '5' as const : '2.4' as const, name: String(x.Ssid ?? ''), secured: String(x.SecurityMode ?? 'Disable') !== 'Disable' }))
      .filter(n => n.name);
    if (nets.length) ex.wifiNets = Number(sec?.IsSingleSsid) === 1 || sec?.IsSingleSsid === true ? nets.slice(0, 1) : nets;
    return ex;
  }
  async setDmz(on: boolean, ip: string): Promise<void> {
    const a = String(ip ?? '').trim();
    if (on && !isIPv4(a)) throw noChange('عنوان الجهاز غير صحيح — ما غيّرنا شي.');
    const cur = await this.get('/setting/firewall/dmzsetting');
    await this.post('/setting/firewall/dmzsetting', {
      DmzEnableStatus: typeof cur?.DmzEnableStatus === 'number' ? (on ? 1 : 0) : on,
      ExcludePingService: cur?.ExcludePingService ?? false, ExcludeTelnetSSHPort: cur?.ExcludeTelnetSSHPort ?? false,
      ExcludeWebServerPort: cur?.ExcludeWebServerPort ?? false, DmzHostIpAddress: on ? a : String(cur?.DmzHostIpAddress ?? ''),
    });
  }
  async setUpnp(on: boolean): Promise<void> {
    const cur = await this.get('/setting/firewall/upnpsetting');
    await this.post('/setting/firewall/upnpsetting', {
      ForwardItems: cur?.ForwardItems ?? [],
      UPnPServiceEnable: typeof cur?.UPnPServiceEnable === 'number' ? (on ? 1 : 0) : on,
      UPnPNotifyInternal: String(cur?.UPnPNotifyInternal ?? ''),
    });
  }
  private apItem(s: any, patch: Record<string, unknown> = {}) {
    return {
      WlanStatus: s.WlanStatus === 'Enable' ? 'Enable' : '', Ssid: s.Ssid, CountryCode: s.CountryCode, Mode: s.Mode, ChannelBandwidth: s.ChannelBandwidth,
      ChannelMode: s.ChannelMode, Channel: s.Channel, TxPower: s.TxPower, MaxUsers: s.MaxUsers, Band: s.Band, IndexId: s.IndexId, ...patch,
    };
  }
  private async apFor(band: '2.4' | '5') {
    const ap = await this.get('/setting/wifi/wlanapsetting');
    const s = (Array.isArray(ap?.Settings) ? ap.Settings : []).find((x: any) => (String(x.Band).startsWith('5') ? '5' : '2.4') === band);
    if (!s) throw noChange(`ما لقينا شبكة ${band === '5' ? '٥' : '٢.٤'} جيجا في راوترك — ما غيّرنا شي.`);
    return s;
  }
  async setBandOn(band: '2.4' | '5', on: boolean): Promise<void> {
    const s = await this.apFor(band);
    if ((s.WlanStatus === 'Enable') === on) return;
    await this.post('/setting/wifi/wlanapsetting', { Settings: [this.apItem(s, { WlanStatus: on ? 'Enable' : '' })] });
  }
  async setWifiNames(names: { index: string; name: string }[], password?: string): Promise<void> {
    for (const n of names) { const e = ssidError(n.name.trim()); if (e) throw noChange(e + ' ما غيّرنا شي.'); }
    if (password) { const e = wifiPassError(password); if (e) throw noChange(e + ' ما غيّرنا شي.'); }
    const sec = await this.get('/setting/wifi/wlanapsecurity');
    const items: any[] = Array.isArray(sec?.Items) ? sec.Items.map((x: any) => ({ ...x })) : [];
    if (!items.length) throw new Error('wlanapsecurity: رد غير متوقع');
    const single = Number(sec?.IsSingleSsid) === 1 || sec?.IsSingleSsid === true;
    items.forEach((x, i) => {
      const n = names.find(y => y.index === String(i)) ?? (single ? names[0] : undefined);
      if (n) x.Ssid = n.name.trim();
      if (password) {
        if (String(x.SecurityMode ?? 'Disable') === 'Disable' || x.SecurityMode === 'WEP') throw noChange('شبكتك مفتوحة أو على WEP — فعّل WPA من صفحة الراوتر أول، وبعدها غيّر كلمة المرور من هنا. ما غيّرنا شي.');
        x.PSKKey = password;
      }
    });
    await this.post('/setting/wifi/wlanapsecurity', { IsSingleSsid: sec.IsSingleSsid, Items: items });
  }

  // ═══ قناة الواي فاي ═══
  async getWifiRadios(): Promise<WifiRadio[]> {
    const [ap, para] = await Promise.all([this.get('/setting/wifi/wlanapsetting'), this.get('/setting/wifi/wlanapsettingpara').catch(() => null)]);
    const p: any[] = Array.isArray(para?.Items) ? para.Items : [];
    return (Array.isArray(ap?.Settings) ? ap.Settings : []).map((s: any) => {
      const band = String(s.Band).startsWith('5') ? '5' as const : '2.4' as const;
      const pp = p.find(x => String(x.Band) === String(s.Band));
      return { band, channel: s.ChannelMode === 'Auto' ? '0' : String(s.Channel ?? '0'), allowed: Array.isArray(pp?.Channels) ? pp.Channels.map((c: unknown) => String(c)) : undefined, writable: true };
    });
  }
  async setWifiChannel(band: '2.4' | '5', channel: string): Promise<void> {
    const s = await this.apFor(band);
    const auto = !Number(channel);
    await this.post('/setting/wifi/wlanapsetting', { Settings: [this.apItem(s, auto ? { ChannelMode: 'Auto' } : { ChannelMode: 'Manual', Channel: typeof s.Channel === 'number' ? Number(channel) : channel })] });
  }
}
