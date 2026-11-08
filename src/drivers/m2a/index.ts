/**
 * جيب M2A-77 (MiFi «MIFI_M2_6877»، فيرموير M2A_77_EU — ليبيا، ٨ نوفمبر ٢٠٢٦). ملفات «جهاز جديد» مرتين.
 *
 * البروتوكول (من صفحاته: ipaddr.js · js/manage.js · login.html · debug.html · bandSelect.html · js/devicemanagement.js):
 *   الواجهة على 80، والأوامر على منفذ ثاني من ipaddr.js: var postaddr = "192.168.43.1:8882"
 *   POST http://<postaddr>/query | /set | /info — JSON {cmd: رقم, logon_pwd: الكلمة نفسها, …} ← {code: 200 | 400, …}
 *   الدخول: set {cmd:1, logon_pwd} (الصفحة قبلها 114 = اللغة + فحص الكلمة — ما نرسله عشان ما نغيّر لغته)
 *   الإشارة: query {cmd:100} (debug.html) · الأجهزة: info {cmd:215} ← conn_dev · الحظر: set {cmd:102|103, info:[{mac}]}
 *   الترددات: info {cmd:181} ← {GSM,UMTS,LTE,CDMA,NR}:{support,enable} · info {cmd:182, …نفس الشكل} (bandSelect.html)
 *   إعادة التشغيل: set {cmd:113, restart: Date.parse(new Date())}
 * ٨ نوفمبر (المساء — الجيب اشتغل عند العضو) كمّلنا من باقي صفحاته:
 *   وضع الشبكة: 100 ← networkselection · set {cmd:115, networkselection} (0 تلقائي · 1 = 4G/3G · 4 = 5G بس · 5 = 4G بس)
 *   آي بي جديد: set {cmd:116, simnwoff: 1} ثم {simnwoff: 0} (زر «بيانات الجوال» في صفحتهم)
 *   قفل البرج (js/lock.js): info {cmd:176} ← {lock, rat, gsm1900, arfcn, cellid, lock_mode}
 *                           info {cmd:175, lock, rat (7 = 4G · 11 = 5G), gsm1900, arfcn, cellid = PCI, lock_mode (3 = خامل ومتصل · 0 = خامل بس · -1 بدون تغيير)}
 *   الرسائل (js/sms.js): query {cmd:210} ← sms_rev · set {cmd:212, sms_send:{phonenumber, txt: base64}} · set {cmd:126, _id} مقروءة
 *   (حذف الرسائل 211 بخانات غامضة عندهم — ما انضاف)
 */
import { RouterDriver, Capability, Signal, NetworkInfo, DeviceDetails, ConnectedDevice, BandConfig, CellLockTarget, CellLockState, SmsMessage } from '../types';
import { http } from '../http';
import { noChange } from '../noChange';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import type { ModelProfile } from '../models';
import { m2aSignal, m2aDevices, m2aBands, enableList, val, m2aSms, b64enc, M2A_MODES } from './parse';

export class M2aDriver implements RouterDriver {
  readonly id = 'm2a';
  name = 'MiFi M2A';
  readonly capabilities: Capability[] = ['signal', 'bandLock', 'reboot', 'devices', 'block', 'sms', 'cells'];
  private host = '';
  private api = '';
  private pw = '';
  private logged = false;

  /** منفذ الأوامر من ipaddr.js (عادة 8882) */
  private async findApi(host: string, timeout = 3000): Promise<string | null> {
    try {
      const r = await http(`http://${host}/ipaddr.js`, {}, timeout);
      const t = await r.text();
      const m = t.match(/^\s*var\s+postaddr\s*=\s*["']([\d.]+):(\d{2,5})["']/m);
      if (!m) return null;
      return `${host.replace(/:\d+$/, '')}:${m[2]}`;
    } catch { return null; }
  }

  private async post(path: 'query' | 'set' | 'info', body: Record<string, unknown>, timeout = 8000): Promise<any> {
    const r = await http(`http://${this.api}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, logon_pwd: this.pw }),
    }, timeout);
    const t = await r.text();
    let j: any = null;
    try { j = JSON.parse(t); } catch {}
    if (!j) throw new Error(`الجيب رجّع رد غير متوقع (cmd ${body.cmd}، HTTP ${r.status})`);
    return j;
  }

  /** طلب مع دخول من جديد مرة لو رجع 400 */
  private async cmd(path: 'query' | 'set' | 'info', body: Record<string, unknown>, timeout?: number): Promise<any> {
    let j = await this.post(path, body, timeout);
    if (Number(j.code) === 400 && this.pw) { await this.doLogin(); j = await this.post(path, body, timeout); }
    if (Number(j.code) !== 200) throw new Error(`الجيب رفض الأمر (cmd ${body.cmd}، code ${j.code ?? '—'})`);
    return j;
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    const api = await this.findApi(host, 2500);
    if (!api) return false;
    this.host = host; this.api = api;
    return true;
  }

  async identify(): Promise<ModelProfile | null> {
    return { id: 'm2a-77', label: 'MiFi M2A-77', brand: 'mifi', tech: '4G', writeUnverified: true,
      note: 'جيب M2A-77 — الدخول والإشارة مؤكدة. الترددات وقفل البرج ووضع الشبكة والرسائل من صفحته نفسها — جرّب ميزة ميزة وأرسل تشخيص لو شي ما زبط.' };
  }

  private async doLogin() {
    const j = await this.post('set', { cmd: 1 }, 10000);
    diag(`[m2a] login (cmd 1) → code ${j.code ?? '—'}`);
    if (Number(j.code) === 400) throw new Error('كلمة المرور غلط — نفس اللي تدخل فيها صفحة الجيب 192.168.43.1');
    if (Number(j.code) !== 200) throw new Error(`الدخول فشل (code ${j.code ?? '—'})`);
    this.logged = true;
  }

  async login(host: string, _username: string, password: string): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    if (!this.api || this.host !== host) {
      const api = await this.findApi(host, 6000);
      if (!api) throw new Error(`ما لقينا منفذ الأوامر في الجيب (${host}/ipaddr.js)`);
      this.host = host; this.api = api;
    }
    this.pw = password;
    await this.doLogin();
  }

  async logout(): Promise<void> { this.logged = false; }

  private infoLogged = false;
  private async status(): Promise<any> {
    const r = await this.cmd('query', { cmd: 100 });
    if (!this.infoLogged) {
      this.infoLogged = true;
      diag(`[m2a] cmd100: internet_conn=${r.internet_conn ?? '—'} band=${r.band ?? '—'} rsrp=${r.rsrp ?? '—'} ss_rsrp=${r.ss_rsrp ?? '—'} sinr=${r.sinr ?? '—'} nws=${r.nws ?? '—'} simsig=${r.simsig ?? '—'} · خانات: ${Object.keys(r).filter(k => !/imei|imsi|sn_num|iccid|pwd|mac/i.test(k)).join(',')}`);
    }
    return r;
  }

  async getSignal(): Promise<Signal> { return m2aSignal(await this.status()); }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const r = await this.status();
    const s = m2aSignal(r);
    return { operator: r.sim_mdntd && val(r.sim_mdntd) === undefined ? String(r.sim_mdntd) : undefined,
      connected: Number(r.internet_conn) > 0, mode: s.network, supports5g: Number(r.internet_conn) === 3 ? true : undefined };
  }

  async getDeviceDetails(): Promise<DeviceDetails> {
    const r = await this.status().catch(() => ({} as any));
    return {
      model: String(r.device_model || r.device_name || 'M2A-77'),
      software: r.sw_version || r.software_version || undefined,
      hardware: r.hw_version || r.hardware_version || undefined,
      wanIp: r.wan_ipv4 && r.wan_ipv4 !== '0.0.0.0' ? String(r.wan_ipv4) : undefined,
    };
  }

  async getDevices(): Promise<ConnectedDevice[]> { return m2aDevices(await this.cmd('info', { cmd: 215 })); }

  async blockDevice(mac: string, block: boolean): Promise<void> {
    await this.cmd('set', { cmd: block ? 102 : 103, info: [{ mac }] });
    const d = (await this.getDevices()).find(x => x.mac === mac.toUpperCase());
    if (d && !!d.blocked !== block) throw new Error('الجيب قبل الأمر بس ما تغيّرت حالة الجهاز');
  }

  async reboot(): Promise<void> { await this.cmd('set', { cmd: 113, restart: Date.parse(new Date().toString()) }, 10000).catch(() => {}); }

  // ═══ الترددات (bandSelect.html) ═══
  private async bands(): Promise<any> { return this.cmd('info', { cmd: 181 }); }

  async getBandConfig(): Promise<BandConfig> {
    const r = await this.bands();
    const lte = m2aBands(r.LTE), nr = m2aBands(r.NR);
    return {
      supported: lte.supported, locked: lte.enabled.length === lte.supported.length ? [] : lte.enabled,
      nrSupported: nr.supported, nrLocked: nr.enabled.length === nr.supported.length ? [] : nr.enabled,
      mode: String((await this.status().catch(() => ({} as any))).networkselection ?? ''), modes: M2A_MODES,
    };
  }

  // ═══ وضع الشبكة (mobileconnection.js) ═══
  async setNetworkMode(mode: string): Promise<void> {
    if (!M2A_MODES.some(m => m.value === mode)) throw noChange('هالوضع مو موجود في جيبك');
    await this.cmd('set', { cmd: 115, networkselection: Number(mode) });
    for (let i = 0; i < 5; i++) {
      await new Promise(res => setTimeout(res, 1500));
      const r = await this.status().catch(() => null);
      if (r && String(r.networkselection) === mode) return;
    }
    throw new Error('الجيب قبل الأمر بس وضع الشبكة ما تغيّر — جرّب مرة ثانية');
  }

  /** آي بي جديد — نطفي بيانات الجوال ونرجّعها (116 simnwoff) */
  async reconnectData(opts?: { holdSecs?: number }): Promise<void> {
    await this.cmd('set', { cmd: 116, simnwoff: 1 });
    await new Promise(res => setTimeout(res, Math.max(3, opts?.holdSecs ?? 6) * 1000));
    await this.cmd('set', { cmd: 116, simnwoff: 0 });
  }

  // ═══ قفل البرج (lock.js) ═══
  private async lockInfo(): Promise<any> { return this.cmd('info', { cmd: 176 }); }

  async getCellLock(): Promise<CellLockState | null> {
    const r = await this.lockInfo();
    if (Number(r.lock) !== 1) return null;
    return { pci: String(r.cellid ?? ''), arfcn: String(r.arfcn ?? ''), tech: Number(r.rat) === 11 ? 'NR' : 'LTE' };
  }

  async lockCell(t: CellLockTarget): Promise<void> {
    if (!t.arfcn || !/^\d+$/.test(String(t.arfcn)) || !/^\d+$/.test(String(t.pci))) throw noChange('قفل البرج يحتاج التردد (ARFCN) و PCI بالأرقام');
    const cur = await this.lockInfo().catch(() => ({} as any));
    await this.cmd('info', { cmd: 175, lock: 1, rat: t.tech === 'NR' ? 11 : 7, gsm1900: Number(cur.gsm1900) === 1 ? 1 : 0,
      arfcn: Number(t.arfcn), cellid: Number(t.pci), lock_mode: 3 }, 15000);
    await new Promise(res => setTimeout(res, 1500));
    const after = await this.lockInfo();
    if (Number(after.lock) !== 1 || String(after.cellid) !== String(Number(t.pci)) || String(after.arfcn) !== String(Number(t.arfcn))) {
      throw new Error('الجيب قبل الأمر بس قفل البرج ما تثبّت — جرّب مرة ثانية');
    }
  }

  async unlockCell(): Promise<void> {
    const cur = await this.lockInfo();
    if (Number(cur.lock) !== 1) return;
    await this.cmd('info', { cmd: 175, lock: 0, rat: Number(cur.rat) || 7, gsm1900: Number(cur.gsm1900) === 1 ? 1 : 0,
      arfcn: Number(cur.arfcn) || 0, cellid: Number(cur.cellid) || 0, lock_mode: Number(cur.lock_mode ?? -1) }, 15000);
    await new Promise(res => setTimeout(res, 1500));
    if (Number((await this.lockInfo()).lock) === 1) throw new Error('الجيب ما فك قفل البرج — جرّب مرة ثانية');
  }

  // ═══ الرسائل (sms.js) ═══
  async listSms(box: 'inbox' | 'sent' = 'inbox'): Promise<SmsMessage[]> { return m2aSms(await this.cmd('query', { cmd: 210 }), box); }
  async markSmsRead(index: string): Promise<void> { await this.cmd('set', { cmd: 126, _id: Number(index) }); }
  async sendSms(phone: string, text: string): Promise<void> {
    const p = String(phone).replace(/[^\d+]/g, '');
    if (!p || !text) throw noChange('الرقم والنص مطلوبين');
    await this.cmd('set', { cmd: 212, sms_send: { phonenumber: p, txt: b64enc(text) } }, 20000);
  }

  /** نفس setBand في صفحتهم: نرسل الخمس مجموعات كاملة، ونغيّر LTE (و NR لو انطلب) بس — ونتأكد بالقراءة */
  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const r = await this.bands();
    const groups = ['GSM', 'UMTS', 'LTE', 'CDMA', 'NR'] as const;
    const body: Record<string, unknown> = { cmd: 182 };
    for (const g of groups) body[g] = { support: r[g]?.support ?? [], enable: r[g]?.enable ?? [] };
    const wantLte = bands === 'keep' ? undefined : enableList(r.LTE, bands);
    const wantNr = nrBands === undefined ? undefined : enableList(r.NR, nrBands);
    if (wantLte) {
      if (!wantLte.includes(1)) throw noChange('الترددات المطلوبة مو في قائمة جيبك — ما غيّرنا شي.');
      (body.LTE as any).enable = wantLte;
    }
    if (wantNr && wantNr.length) {
      if (!wantNr.includes(1)) throw noChange('ترددات 5G المطلوبة مو في قائمة جيبك — ما غيّرنا شي.');
      (body.NR as any).enable = wantNr;
    }
    await this.cmd('info', body, 15000);
    diag(`[m2a] cmd182 ← LTE ${wantLte ? wantLte.join('') : 'كما هو'}${wantNr ? ` · NR ${wantNr.join('')}` : ''}`);
    await new Promise(res => setTimeout(res, 1500));
    const after = await this.bands();
    const same = (a: unknown[], b: number[]) => Array.isArray(a) && a.length === b.length && a.every((x, i) => Number(x) === b[i]);
    if ((wantLte && !same(after.LTE?.enable, wantLte)) || (wantNr && wantNr.length && !same(after.NR?.enable, wantNr))) {
      throw new Error('الجيب قبل الأمر بس الترددات ما تغيّرت — جرّب مرة ثانية');
    }
  }
}
