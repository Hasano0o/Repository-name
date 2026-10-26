/**
 * FiberHome 5G CPE (واجهة Vue — LG6121/LG6851… بيعت مع STC وغيرها). عنوانه غالباً 192.168.8.1.
 *
 * كل الطلبات من ملفات صفحة الراوتر الحقيقية (تقرير ٢٦ أكتوبر) — مو تخمين:
 *   POST /api/tmp/FHAPIS (بعد الدخول) · /api/tmp/FHNCAPIS (بدون دخول) · /api/sign/DO_WEB_LOGIN
 *   الجسم {dataObj, ajaxmethod, sessionid} بتشفير AES (./crypto)، والرد مشفّر (إلا الدخول).
 *   أسماء الإعدادات من get_xmlnode_js_file (./nodes).
 *
 * النسخة الأولى: الإشارة، الأبراج المجاورة، تثبيت الترددات (4G/5G)، وضع الشبكة، تثبيت البرج، إعادة التشغيل.
 * كل تغيير نتأكد منه بإعادة القراءة، وفيه لقطة + إرجاع متحقق منه (مثل هواوي و ZTE).
 * لسا ما انجرّب على راوتر حقيقي — أي رد غريب يطلع برسالة فيها اسم الأمر عشان يوصلنا في التقرير.
 */
import { RouterDriver, Capability, Signal, NetworkInfo, SignalSnapshot, CellTower, BandConfig, ActiveLock, CellLockTarget, CellLockState, DeviceDetails } from '../types';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { noChange } from '../noChange';
import { http } from '../http';
import { buildSnapshot } from '../../utils/snapshot';
import { ModelProfile } from '../models';
import { fhBody, fhDecrypt, fhKey } from './crypto';
import {
  parseNodeFile, missing, NEED, paths, RF_FIELDS, signalFrom, neighborsFrom,
  LTE_BANDS, NR_BANDS, parseBands, joinBands, FH_TO_CODE, CODE_TO_FH, MODES, loginError,
} from './nodes';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
interface CellRow { idx: string; act: string; arfcn: string; pci: string }
interface FhLockData { band4: string; band5: string; enable: string; mode: string; endc: string; cellEnable: string; cells: CellRow[] }

export class FiberhomeDriver implements RouterDriver {
  id = 'fiberhome';
  name = 'FiberHome';
  capabilities: Capability[] = ['signal', 'cells', 'reboot', 'bandLock'];

  private host = '';
  private user = 'admin';
  private password = '';
  private encrypt = true;
  private nodes: Record<string, string> | null = null;
  private info: Record<string, any> | null = null;

  private base() { return 'http://' + this.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  private hdr(extra: Record<string, string> = {}) {
    return { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01', Referer: this.base() + '/main.html', ...extra };
  }
  private log(...a: unknown[]) { if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[fiberhome]', ...a); }

  /** GET /api/tmp/<FHAPIS|FHNCAPIS>?ajaxmethod=… (الردود هنا مو مشفّرة — مثل $get) */
  private async getQ(method: string, nocheck = false): Promise<any> {
    const r = await http(`${this.base()}/api/tmp/${nocheck ? 'FHNCAPIS' : 'FHAPIS'}?ajaxmethod=${method}&_=${Math.random()}`, { headers: this.hdr() }, 8000);
    if (r.status === 418) throw new Error('انتهت الجلسة');
    if (r.status === 417) throw new Error('فيه أحد داخل صفحة الراوتر من جهاز ثاني — سكّرها وجرّب');
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  }

  /** مثل $post: رمز جديد لكل طلب (get_refresh_sessionid)، والمفتاح أول ١٦ حرف منه */
  private async post(method: string, dataObj: unknown, opts: { nocheck?: boolean; sign?: boolean; timeout?: number } = {}): Promise<any> {
    const tok = await this.getQ('get_refresh_sessionid', true);
    const sid = String(tok?.sessionid ?? '');
    if (this.encrypt && sid.length < 16) throw new Error(`${method}: الراوتر ما أعطى رمز جلسة`);
    const path = opts.sign ? `/api/sign/${method}` : `/api/tmp/${opts.nocheck ? 'FHNCAPIS' : 'FHAPIS'}`;
    const r = await http(`${this.base()}${path}?_${Math.random()}`, {
      method: 'POST',
      headers: this.hdr({ 'Content-Type': 'application/json; charset=utf-8' }),
      body: fhBody({ dataObj: dataObj ?? null, ajaxmethod: method }, sid, this.encrypt),
    }, opts.timeout ?? 15000);
    if (r.status === 418) throw new Error('انتهت الجلسة');
    if (r.status === 417) throw new Error('فيه أحد داخل صفحة الراوتر من جهاز ثاني — سكّرها وجرّب');
    const t = await r.text();
    if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
    // الدخول والخروج ردهم نص عادي (polyfill: ما نفك loginoutPath)
    if (opts.sign) return t;
    let plain = t;
    if (this.encrypt) {
      try { plain = fhDecrypt(t, fhKey(sid)); } catch { throw new Error(`${method}: ما قدرنا نفك رد الراوتر`); }
    }
    try { return JSON.parse(plain); } catch { return plain; }
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const j = await this.getQ('is_encrypt', true);
      return !!j && typeof j === 'object' && 'enable' in j;
    } catch { return false; }
  }

  private async deviceInfo(): Promise<Record<string, any>> {
    if (this.info) return this.info;
    const d = await this.post('get_device_info', null, { nocheck: true });
    this.info = d && typeof d === 'object' ? d : {};
    return this.info!;
  }

  async identify(): Promise<ModelProfile | null> {
    try {
      const enc = await this.getQ('is_encrypt', true);
      this.encrypt = String(enc?.enable) === '1';
      const m = String((await this.deviceInfo()).model_name ?? '').trim();
      return { id: 'fiberhome' + (m ? '-' + m.toLowerCase() : ''), label: 'FiberHome' + (m ? ' ' + m : ''), brand: 'fiberhome', tech: '5G' };
    } catch { return null; }
  }

  async login(host: string, username: string, password: string): Promise<void> {
    this.host = host;
    this.user = (username || '').trim() || 'admin';
    this.password = password;
    const enc = await this.getQ('is_encrypt', true);
    this.encrypt = String(enc?.enable) === '1';
    const res = await this.post('DO_WEB_LOGIN', { username: this.user, password }, { sign: true });
    const err = loginError(typeof res === 'string' ? res : JSON.stringify(res));
    if (err) throw new Error(err);
    // نفس صفحة الدخول بعد النجاح
    try { await this.getQ('set_developer_mode'); } catch {}
    await this.loadNodes();
  }

  private async loadNodes(): Promise<Record<string, string>> {
    if (this.nodes) return this.nodes;
    const r = await this.post('get_xmlnode_js_file', null, { nocheck: true });
    const xml = typeof r?.xml === 'string' ? r.xml : '';
    if (!xml) throw new Error('get_xmlnode_js_file: الراوتر ما أعطى أسماء الإعدادات');
    const n = parseNodeFile(xml);
    if (!Object.keys(n).length) throw new Error('get_xmlnode_js_file: ما قدرنا نقرأ أسماء الإعدادات من الراوتر');
    this.nodes = n;
    return n;
  }
  /** الأسماء اللازمة لميزة — لو ناقص نوقف قبل أي أمر ونقول وش ناقص (يوصلنا في التقرير) */
  private async need(keys: string[], what: string): Promise<Record<string, string>> {
    const n = await this.loadNodes();
    const miss = missing(n, keys);
    if (miss.length) throw noChange(`${what} لسا ما يشتغل على راوترك — ما لقينا ${miss.slice(0, 3).join('، ')} في إعداداته. ما غيّرنا شي.`);
    return n;
  }

  async logout(): Promise<void> {
    try { await this.post('DO_WEB_LOGOUT', null, { sign: true }); } catch {}
  }

  // ═══ القراءة ═══
  private async rf(): Promise<Record<string, any>> {
    const n = await this.need(NEED.rf, 'قراءة الإشارة');
    const r = await this.post('get_value_by_xmlnode', paths(n, RF_FIELDS));
    if (!r || typeof r !== 'object') throw new Error('get_value_by_xmlnode: رد غير متوقع');
    return r;
  }
  async getSignal(): Promise<Signal> { return signalFrom(await this.rf()); }

  async getCells(): Promise<CellTower[]> {
    const rf = await this.rf();
    const s = signalFrom(rf);
    const out: CellTower[] = [];
    if (s.pci || s.rsrp !== undefined) out.push({ kind: 'serving', tech: 'LTE', pci: s.pci, band: s.band ? parseInt(s.band.slice(1), 10) : undefined, rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr, cellId: s.cellId } as CellTower);
    if (s.nrPci || s.nrRsrp !== undefined) out.push({ kind: s.network === '5G SA' ? 'serving' : 'secondary', tech: 'NR', pci: s.nrPci, band: s.nrBand ? parseInt(s.nrBand.slice(1), 10) : undefined, rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr } as CellTower);
    return [...out, ...neighborsFrom(rf)];
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const rf = await this.rf();
    const s = signalFrom(rf);
    return buildSnapshot(s, [], neighborsFrom(rf), { driverId: this.id, driverName: this.name });
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    let operator: string | undefined;
    try { operator = String((await this.deviceInfo()).operator_name ?? '').replace(/_/g, ' ').trim() || undefined; } catch {}
    let mode = '';
    try { mode = String((await this.rf()).WorkMode ?? '').trim(); } catch {}
    return { operator, connected: /LTE|NSA|SA/i.test(mode), mode: mode || undefined, supports5g: true };
  }
  async isConnected(): Promise<boolean> {
    try { return /LTE|NSA|SA/i.test(String((await this.rf()).WorkMode ?? '')); } catch { return false; }
  }
  async getDeviceDetails(): Promise<DeviceDetails> {
    const d = await this.deviceInfo().catch(() => ({} as Record<string, any>));
    return { model: d.model_name, software: d.software_version ?? d.sw_version, operator: d.operator_name };
  }

  async reboot(): Promise<void> {
    // نفس reboot.js: نسجّل الرسالة ثم نعيد التشغيل
    try { await this.post('do_cmd_web', { key: 'RECORD_MESSAGE_WEB' }); } catch {}
    try { await this.post('do_cmd_web', { key: 'REBOOT_WEB' }); } catch (e) {
      // الراوتر يقطع الاتصال وهو يطفي — هذا نجاح غالباً
      if (!/تعذر الاتصال|ما رد/.test(String((e as any)?.message ?? e))) throw e;
    }
  }

  // ═══ الترددات ووضع الشبكة ═══
  private async readBand() {
    const n = await this.need([...NEED.band, ...NEED.mode], 'تثبيت الترددات');
    const o = n.x_NetworkSettings_obj;
    const r = await this.post('get_value_by_xmlnode', {
      band4: o + n.x_NetworkSet_LTELockBAND, band5: o + n.x_NetworkSet_NRLockBAND, enable: o + n.x_NetworkSet_LockBandEnable,
      mode: o + n.x_NetworkSet_NetworkMode, endc: o + n.x_NetworkSet_ENDC,
    });
    if (!r || typeof r !== 'object') throw new Error('get_value_by_xmlnode: رد غير متوقع (الترددات)');
    return { n, band4: String(r.band4 ?? ''), band5: String(r.band5 ?? ''), enable: String(r.enable ?? ''), mode: String(r.mode ?? ''), endc: String(r.endc ?? '') };
  }
  private async setValues(url: Record<string, string>, value: Record<string, string>) {
    const r = await this.post('set_value_by_xmlnode', { url, value });
    if (r && typeof r === 'object' && (r.success === 'false' || r.success === false)) throw new Error('set_value_by_xmlnode: الراوتر رفض');
  }

  async getBandConfig(): Promise<BandConfig> {
    const b = await this.readBand();
    const on = b.enable === '1';
    return {
      supported: LTE_BANDS,
      locked: on ? parseBands(b.band4) : [],
      nrSupported: NR_BANDS,
      nrLocked: on ? parseBands(b.band5) : [],
      nrPreferred: NR_BANDS,
      mode: FH_TO_CODE[b.mode] ?? b.mode,
      modes: MODES,
    };
  }

  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const b = await this.readBand();
    const on = b.enable === '1';
    const curL = on ? parseBands(b.band4) : [], curN = on ? parseBands(b.band5) : [];
    let lte = bands === 'keep' ? curL : bands.filter(x => LTE_BANDS.includes(x));
    let nr = nrBands === undefined ? curN : nrBands.filter(x => NR_BANDS.includes(x));
    if (bands !== 'keep' && bands.length && !lte.length) throw noChange('الترددات اللي اخترتها ما تطلع في صفحة راوترك — ما غيّرنا شي.');
    // الصفحة تمنع B32 لحاله (تردد تنزيل بس — ما فيه اتصال)
    if (lte.length === 1 && lte[0] === 32) throw noChange('B32 لحاله ما يشتغل (تردد تنزيل بس) — ما غيّرنا شي.');
    const lock = lte.length > 0 || nr.length > 0;
    // تقنية بدون اختيار وهو مقفول = كل تردداتها (القائمة الفاضية ممكن تعني «ولا شي» عند الراوتر)
    if (lock && !lte.length) lte = LTE_BANDS.filter(x => x !== 32);
    if (lock && !nr.length) nr = NR_BANDS;
    const want = { band4: lock ? joinBands(lte) : b.band4, band5: lock ? joinBands(nr) : b.band5, enable: lock ? '1' : '0' };
    if (want.enable === b.enable && (!lock || (want.band4 === joinBands(parseBands(b.band4)) && want.band5 === joinBands(parseBands(b.band5))))) return;
    const o = b.n.x_NetworkSettings_obj;
    await this.setValues(
      { band4: o + b.n.x_NetworkSet_LTELockBAND, band5: o + b.n.x_NetworkSet_NRLockBAND, enable: o + b.n.x_NetworkSet_LockBandEnable },
      want,
    );
    await sleep(3000); // الصفحة نفسها تعيد القراءة بعد ٣ ثواني
    const a = await this.readBand();
    if (a.enable !== want.enable || (lock && (joinBands(parseBands(a.band4)) !== want.band4 || joinBands(parseBands(a.band5)) !== want.band5))) {
      throw new Error('الراوتر قبل أمر الترددات بس القراءة بعده مختلفة');
    }
  }

  async setNetworkMode(mode: string): Promise<void> {
    const v = CODE_TO_FH[mode] ?? mode;
    const b = await this.readBand();
    if (b.mode === v) return;
    const o = b.n.x_NetworkSettings_obj;
    await this.setValues({ NetworkMode: o + b.n.x_NetworkSet_NetworkMode, ENDC: o + b.n.x_NetworkSet_ENDC }, { NetworkMode: v, ENDC: b.endc });
    await sleep(3000);
    if ((await this.readBand()).mode !== v) throw new Error('الراوتر قبل أمر وضع الشبكة بس ما تغيّر');
  }

  async getActiveLock(): Promise<ActiveLock | null> {
    const c = await this.getBandConfig();
    const cell = (await this.getCellLocks().catch(() => []))[0];
    if (!c.locked.length && !c.nrLocked.length && !cell) return null;
    return { bands: c.locked, nrBands: c.nrLocked, pci: cell?.pci };
  }

  // ═══ تثبيت البرج (cellLockSet.js) ═══
  private async readCells(): Promise<{ n: Record<string, string>; enable: string; rows: CellRow[] }> {
    const n = await this.need(NEED.cell, 'تثبيت البرج');
    const list = await this.post('get_xml_childnode_value', {
      url: n.x_LockCellList_obj + n.x_LockCellList_LockCell,
      node: { act: n.x_LockCellList_act, arfcn: n.x_LockCellList_arfcn, pci: n.x_LockCellList_pci },
    });
    const en = await this.post('get_value_by_xmlnode', { LockEnable: n.x_LockCellList_obj + n.x_LockCellList_LockEnable });
    const arr: any[] = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : [];
    return {
      n, enable: String(en?.LockEnable ?? ''),
      rows: arr.map(e => ({ idx: String(e.child_node_idx ?? ''), act: String(e.act ?? ''), arfcn: String(e.arfcn ?? ''), pci: String(e.pci ?? '') })),
    };
  }
  private async setCellEnable(n: Record<string, string>, on: boolean) {
    await this.setValues({ Enable: n.x_LockCellList_obj + n.x_LockCellList_LockEnable }, { Enable: on ? '1' : '0' });
  }

  async getCellLocks(): Promise<CellLockState[]> {
    const c = await this.readCells();
    if (c.enable !== '1') return [];
    return c.rows.map(r => ({ tech: r.act === '1' ? 'LTE' as const : 'NR' as const, pci: r.pci, arfcn: r.arfcn }));
  }
  async getCellLock(): Promise<CellLockState | null> { return (await this.getCellLocks())[0] ?? null; }

  async lockCell(t: CellLockTarget): Promise<void> {
    const pci = String(t.pci ?? '').trim();
    const arfcn = String(t.arfcn ?? '').trim();
    if (!pci) throw noChange('ما عندنا رقم البرج (PCI) — ما نقدر نثبّت عليه');
    if (!arfcn) throw noChange('الراوتر ما أعطانا رقم قناة هذا البرج — ثبّت التردد بدلاً منه');
    const c = await this.readCells();
    const act = t.tech === 'NR' ? '2' : '1';
    if (!c.rows.some(r => r.act === act && r.arfcn === arfcn && r.pci === pci)) {
      await this.post('add_set_xmlnode', {
        url: c.n.x_LockCellList_obj + c.n.x_LockCellList_LockCell,
        setNode: {
          url: { act: c.n.x_LockCellList_act, arfcn: c.n.x_LockCellList_arfcn, pci: c.n.x_LockCellList_pci },
          value: { act, arfcn, pci },
        },
      });
    }
    if (c.enable !== '1') await this.setCellEnable(c.n, true);
    await sleep(3000);
    const a = await this.readCells();
    if (a.enable !== '1' || !a.rows.some(r => r.act === act && r.arfcn === arfcn && r.pci === pci)) {
      throw new Error('الراوتر قبل أمر تثبيت البرج بس القراءة بعده مختلفة');
    }
  }
  async unlockCell(): Promise<void> {
    const c = await this.readCells();
    if (c.enable === '1') await this.setCellEnable(c.n, false);
  }

  // ═══ لقطة قبل التجربة + إرجاع متحقق منه ═══
  async readLockState(): Promise<LockSnapshot> {
    const b = await this.readBand();
    let cellEnable = '', cells: CellRow[] = [];
    try { const c = await this.readCells(); cellEnable = c.enable; cells = c.rows; } catch {}
    const data: FhLockData = { band4: b.band4, band5: b.band5, enable: b.enable, mode: b.mode, endc: b.endc, cellEnable, cells };
    const on = b.enable === '1';
    const summary = `4G: ${on ? parseBands(b.band4).map(x => 'B' + x).join('+') || '—' : 'تلقائي'} · 5G: ${on ? parseBands(b.band5).map(x => 'n' + x).join('+') || '—' : 'تلقائي'} · الشبكة: ${MODES.find(m => m.value === FH_TO_CODE[b.mode])?.label ?? (b.mode || '—')}${cellEnable === '1' ? ` · برج ${cells.map(c => c.pci).join('+')}` : ''}`;
    return { driver: this.id, at: Date.now(), summary, data };
  }

  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    const d = snap.data as FhLockData;
    const b = await this.readBand();
    const o = b.n.x_NetworkSettings_obj;
    const url: Record<string, string> = {}, value: Record<string, string> = {};
    if (b.enable !== d.enable || joinBands(parseBands(b.band4)) !== joinBands(parseBands(d.band4)) || joinBands(parseBands(b.band5)) !== joinBands(parseBands(d.band5))) {
      Object.assign(url, { band4: o + b.n.x_NetworkSet_LTELockBAND, band5: o + b.n.x_NetworkSet_NRLockBAND, enable: o + b.n.x_NetworkSet_LockBandEnable });
      Object.assign(value, { band4: d.band4, band5: d.band5, enable: d.enable });
    }
    if (d.mode && b.mode !== d.mode) Object.assign(url, { NetworkMode: o + b.n.x_NetworkSet_NetworkMode, ENDC: o + b.n.x_NetworkSet_ENDC }) && Object.assign(value, { NetworkMode: d.mode, ENDC: d.endc || b.endc });
    if (Object.keys(url).length) await this.setValues(url, value);
    // البرج: نشيل الأبراج اللي انضافت بعد اللقطة، ونرجّع حالة التفعيل
    if (d.cellEnable !== '') {
      try {
        const c = await this.readCells();
        const extra = c.rows.filter(r => !d.cells.some(x => x.act === r.act && x.arfcn === r.arfcn && x.pci === r.pci));
        for (const r of extra.sort((x, y) => Number(y.idx) - Number(x.idx))) {
          await this.post('del_xmlnode', { url: c.n.x_LockCellList_obj + c.n.x_LockCellList_LockCell, index: r.idx });
        }
        if (c.enable !== d.cellEnable) await this.setCellEnable(c.n, d.cellEnable === '1');
      } catch {}
    }
    await sleep(3000);
    const a = await this.readBand();
    const miss: string[] = [];
    if (a.enable !== d.enable || (d.enable === '1' && (joinBands(parseBands(a.band4)) !== joinBands(parseBands(d.band4)) || joinBands(parseBands(a.band5)) !== joinBands(parseBands(d.band5))))) miss.push('الترددات');
    if (d.mode && a.mode !== d.mode) miss.push('وضع الشبكة');
    if (d.cellEnable !== '') {
      try {
        const c = await this.readCells();
        if (c.enable !== d.cellEnable) miss.push('تثبيت البرج');
      } catch { miss.push('تثبيت البرج'); }
    }
    if (miss.length) throw restoreMismatch(miss);
  }

  /** إنقاذ: فك قفل الترددات والبرج + تلقائي */
  async restoreAll(): Promise<void> {
    const b = await this.readBand();
    const o = b.n.x_NetworkSettings_obj;
    await this.setValues(
      { enable: o + b.n.x_NetworkSet_LockBandEnable, NetworkMode: o + b.n.x_NetworkSet_NetworkMode, ENDC: o + b.n.x_NetworkSet_ENDC },
      { enable: '0', NetworkMode: '3', ENDC: b.endc },
    );
    try { await this.unlockCell(); } catch {}
  }
}
