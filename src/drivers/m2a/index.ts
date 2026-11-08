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
 * قفل البرج (channelLock.html) صفحته بدون كود ← ما انضاف.
 */
import { RouterDriver, Capability, Signal, NetworkInfo, DeviceDetails, ConnectedDevice, BandConfig } from '../types';
import { http } from '../http';
import { noChange } from '../noChange';
import { diag } from '../../services/diag';
import { isLanHost } from '../../utils/host';
import type { ModelProfile } from '../models';
import { m2aSignal, m2aDevices, m2aBands, enableList, val } from './parse';

export class M2aDriver implements RouterDriver {
  readonly id = 'm2a';
  name = 'MiFi M2A';
  readonly capabilities: Capability[] = ['signal', 'bandLock', 'reboot'];
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
      note: 'جيب M2A-77 — جديد: الإشارة والأجهزة والترددات من صفحته نفسها. جرّب وأرسل ملفات جهازك لو شي ما زبط.' };
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
      mode: '', modes: [],
    };
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
