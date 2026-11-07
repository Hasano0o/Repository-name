import {
  RouterDriver, Capability, SignalSnapshot, DeviceDetails, Signal, NetworkInfo, BandConfig, CellTower,
  CellLockTarget, CellLockState, ActiveLock,
} from '../types';
import { LockSnapshot, restoreMismatch } from '../lockSnapshot';
import { noChange } from '../noChange';
import { CbiForm, CbiState, parseCbiForm, cbiState, cbiApply, cbiPairs, cbiDiff, multipart } from './cbi';
import { pro7BandLists, lockedBands, pro7NetField, pro7Modes, pro7ModeByLabel, pro7CellFields, nrScs, Pro7List } from './pro7lock';
import { http } from '../http';
import { isLanHost } from '../../utils/host';
import { buildSnapshot } from '../../utils/snapshot';
import { pro7Signal, pro7Network, Pro7Status } from './pro7';
import { WisInfo, WisConfig, isWisPage, wisSignal, wisNetwork, wisIs5g, wisNeighbours, wisLocked, wisBandPath, wisModePath, WIS_LTE, WIS_NR, WIS_MODES } from './wis';

/**
 * راوترات OpenWrt بواجهة LuCI القديمة (Lua) — أول واحد: «5G CPE Pro 7» (موبايلي، ١ نوفمبر ٢٠٢٦، ثيم bigtmt).
 *
 * من ملفات صفحة العضو:
 *  • "/" = صفحة OpenWrt الافتراضية ← <meta refresh> لـ /cgi-bin/luci
 *  • /cgi-bin/luci بدون جلسة = صفحة الدخول بحالة 403: <form method="post" action="/cgi-bin/luci">
 *    بخانتين luci_username / luci_password (الملصق: admin/admin)
 *  • بعد الدخول: كوكي sysauth، وأحياناً ;stok=… في الرابط (LuCI 15+)
 *
 * الإشارة: admin/status/nr?status=1 (pro7.ts). الكتابة (٢ نوفمبر، من ملف FULL فيه صفحات المودم):
 *   تثبيت الترددات 4G/5G (admin/modem/band) · وضع الشبكة (admin/modem/network) · تثبيت البرج 4G و5G SA (admin/modem/cell).
 *   كلها نماذج CBI — نقرأ النموذج من الصفحة الحية ونرسله مثل المتصفح (cbi.ts)، ونتأكد بالقراءة بعده (pro7lock.ts).
 *   الراوتر اللي ما فيه هالصفحات (LuCI ثاني) ← noChange بدون أي إرسال. لا نرسل أي أمر تخميني.
 */
export class LuciDriver implements RouterDriver {
  readonly id = 'luci';
  name = 'OpenWrt (LuCI)';
  readonly capabilities: Capability[] = ['signal', 'cells', 'bandLock'];
  private host = '';
  /** ;stok=… لو الفيرموير يحطه في الروابط بعد الدخول */
  private stok = '';
  /** ثيم superos (WIS — صحن 5G «Feedhorn»): الإشارة من «<root>?status=1» → lte_info (wis.ts) بدل admin/status/nr */
  private wis = false;

  private base(host = this.host) {
    return 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
  private root() {
    return this.stok ? `/cgi-bin/luci/;stok=${this.stok}` : '/cgi-bin/luci';
  }
  /** اسم الجهاز من <title> صفحة الدخول (Pro7) */
  private nameFrom(html: string) {
    // بعد الدخول العنوان «Pro7 - System Status» — ناخذ اسم الجهاز بس
    const t = html.match(/<title>\s*([^<]{2,60}?)\s*<\/title>/i)?.[1]?.split(/\s+[-|–]\s+/)[0]?.trim();
    if (t && !/^(LuCI|OpenWrt|Authorization)/i.test(t)) this.name = `${t} (OpenWrt)`;
  }

  async detect(host: string): Promise<boolean> {
    if (!isLanHost(host)) return false;
    try {
      const r = await http(`${this.base(host)}/cgi-bin/luci`, {}, 4000);
      const t = await r.text();
      // بدون جلسة: صفحة الدخول (403 عادةً، أو 200 في بعض النسخ)
      if (!/name=["']?luci_password/i.test(t)) return false;
      this.nameFrom(t);
      return true;
    } catch {
      return false;
    }
  }

  async login(host: string, username: string, password: string): Promise<void> {
    if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي (192.168 / 10 / 172)');
    this.host = host;
    this.stok = '';
    const body = `luci_username=${encodeURIComponent(username || 'admin')}&luci_password=${encodeURIComponent(password)}`;
    // الفورم يرسل لنفس الرابط — نجاح = 302 لصفحة الإدارة (fetch يلحقه) + كوكي sysauth في الجرة
    const r = await http(`${this.base()}/cgi-bin/luci`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${this.base()}/cgi-bin/luci` },
      body,
    }, 12000);
    const t = await r.text();
    const st = (r.url || '').match(/;stok=([0-9a-f]{8,64})/i)?.[1] ?? t.match(/;stok=([0-9a-f]{8,64})/i)?.[1] ?? '';
    // رجع لنا فورم الدخول نفسه = الكلمة غلط (LuCI ما يعطي رمز خطأ، يعيد الصفحة)
    if (/name=["']?luci_password/i.test(t) && !st) {
      throw new Error('اسم المستخدم أو كلمة المرور غلط — جرّب اللي على الملصق تحت الراوتر (admin / admin)');
    }
    this.stok = st;
    this.nameFrom(t);
    if (isWisPage(t)) {
      this.wis = true;
      if (/wisnetworks/i.test(t) || this.name === 'OpenWrt (LuCI)') this.name = 'WIS 5G CPE (OpenWrt)';
    }
  }

  async logout(): Promise<void> {
    if (!this.host) return;
    try { await http(`${this.base()}${this.root()}/admin/logout`, {}, 5000); } catch {}
  }

  /**
   * صفحات بعد الدخول للجامع (FULL). الجامع ما يلحق روابط القائمة (بدون امتداد) — فنعطيه صفحات المودم بالاسم.
   * من قائمة Pro7 (ملف FULL الأول، ١ نوفمبر): admin/status/{nr,wan,overview,system} · admin/modem/{band,cell,network,connect,apn}
   * كلها عرض (GET بدون قيم) — ما فيها أي أمر.
   */
  afterLoginPages(): string[] {
    const r = this.root();
    return [
      `${r}/`,
      // superos (WIS): الحالة JSON + صفحات المودم من قائمته (٧ نوفمبر)
      `${r}?status=1`,
      ...['lte', 'lte/network', 'lte/apn', 'lte/at_command', 'lte_sms/lte_inbox', 'network/network', 'system/system', 'status']
        .map(x => `${r}/admin/${x}`),
      ...['status/nr', 'status/wan', 'status/overview', 'status/system', 'status/lan',
        'modem/band', 'modem/cell', 'modem/network', 'modem/connect', 'modem/apn',
        'system/device', 'network/setting', 'sms/inbox'].map(x => `${r}/admin/${x}`),
    ];
  }

  async isConnected(): Promise<boolean> {
    try {
      const r = await http(`${this.base()}${this.root()}/admin`, {}, 5000);
      const t = await r.text();
      return !/name=["']?luci_password/i.test(t);
    } catch {
      return false;
    }
  }

  /**
   * software = رقم «نسخة الصفحات اللي نطلبها» — ملفات FULL تنرسل مرة لكل بصمة (الموديل|software)،
   * فلما نضيف صفحات جديدة للجامع نرفع الرقم ويرجع الكرت مرة وحدة. (2 = صفحات المودم بالاسم، 3 = بعد إصلاح تصادم الأسماء — ١ نوفمبر)
   */
  async getDeviceDetails(): Promise<DeviceDetails> {
    return { model: this.name.replace(/ \(OpenWrt\)$/, ''), software: 'luci-pages-4' };
  }

  /**
   * Pro7 (ثيم bigtmt): أيقونات الهيدر من XHR.poll(5, '<root>/admin/status/nr_icons') ← JSON
   * {mode: "LTE" | "NR5G-NSA" | "NR5G-SA" | "WCDMA" | "5G", signal: "0"…"5", status, sms_num} — من كود الصفحة نفسها.
   * ما فيه أرقام (RSRP/SINR/تردد/برج) — هذي في admin/status/nr، نضيفها لما توصل صفحتها. ما نخترع أرقام من الشرطات.
   */
  private async icons(): Promise<{ mode?: string; signal?: string; status?: string; sms_num?: string } | null> {
    try {
      const r = await http(`${this.base()}${this.root()}/admin/status/nr_icons`, {}, 8000);
      const t = await r.text();
      if (/name=["']?luci_password/i.test(t)) throw new Error('انتهت الجلسة');
      const j = JSON.parse(t);
      return j && typeof j === 'object' ? j : null;
    } catch (e) {
      if (String((e as any)?.message ?? '').includes('انتهت الجلسة')) throw e;
      return null;
    }
  }

  /** Pro7: admin/status/nr?status=1 ← JSON بالأرقام (pro7.ts). null لو الراوتر ما عنده هالصفحة (LuCI ثاني) */
  private async status(): Promise<Pro7Status | null> {
    try {
      const r = await http(`${this.base()}${this.root()}/admin/status/nr?status=1`, {}, 12000);
      const t = await r.text();
      if (/name=["']?luci_password/i.test(t)) throw new Error('انتهت الجلسة');
      const j = JSON.parse(t);
      return j && typeof j === 'object' ? j as Pro7Status : null;
    } catch (e) {
      if (String((e as any)?.message ?? '').includes('انتهت الجلسة')) throw e;
      return null;
    }
  }

  /** superos: «<root>?status=1» ← JSON {lte_info, lte_config, …} (نفس XHR.poll في صفحتهم الرئيسية) */
  private async wisStatus(): Promise<{ info: WisInfo | null; cfg: WisConfig | null } | null> {
    try {
      const r = await http(`${this.base()}${this.root()}?status=1`, {}, 12000);
      const t = await r.text();
      if (/name=["']?luci_password/i.test(t)) throw new Error('انتهت الجلسة');
      const j: any = JSON.parse(t);
      if (!j || typeof j !== 'object') return null;
      const o = (x: unknown) => (x && typeof x === 'object' ? x as Record<string, unknown> : null);
      return { info: o(j.lte_info), cfg: o(j.lte_config) };
    } catch (e) {
      if (String((e as any)?.message ?? '').includes('انتهت الجلسة')) throw e;
      return null;
    }
  }
  private async wisInfo(): Promise<WisInfo | null> { return (await this.wisStatus())?.info ?? null; }
  private async wisCfg(): Promise<WisConfig> {
    const c = (await this.wisStatus())?.cfg;
    if (!c) throw noChange('ما قدرنا نقرأ إعدادات المودم من الراوتر — ما غيّرنا شي.');
    return c;
  }
  /** أمر GET من صفحة admin/lte/network ← ننتظر الحفظ (صفحتهم تعيد التحميل بعد ٣–٥ث) ونتأكد بالقراءة */
  private async wisSend(path: string, check: (c: WisConfig) => boolean, what: string): Promise<void> {
    const r = await http(`${this.base()}${path}`, { headers: { Referer: `${this.base()}${this.root()}/admin/lte/network` } }, 20000);
    const t = await r.text().catch(() => '');
    if (/name=["']?luci_password/i.test(t)) throw new Error(`انتهت الجلسة وقت حفظ ${what} — ادخل مرة ثانية`);
    if (r.status >= 400) throw new Error(`الراوتر رفض ${what} (HTTP ${r.status})`);
    for (const wait of [5000, 5000, 5000]) {
      await sleep(wait);
      const c = (await this.wisStatus().catch(() => null))?.cfg;
      if (c && check(c)) return;
    }
    throw new Error(`الراوتر قبل أمر ${what} بس القراءة بعده مختلفة`);
  }
  private wisBandCfg(c: WisConfig): BandConfig {
    return {
      supported: WIS_LTE, locked: wisLocked(c.net_band, WIS_LTE), nrSupported: WIS_NR, nrLocked: wisLocked(c.net_5g_band, WIS_NR),
      mode: String(c.net_mode ?? ''), modes: WIS_MODES,
    };
  }
  /** الترددات: [] = كل القائمة (صفحتهم ما فيها «تلقائي» — كل المربعات = Any) · keep = نفس الحالي */
  private async wisSetBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    const c = await this.wisCfg();
    const cur = this.wisBandCfg(c);
    const lte = bands === 'keep' ? (cur.locked.length ? cur.locked : WIS_LTE) : (bands.length ? [...new Set(bands)] : WIS_LTE);
    const nr = nrBands === undefined ? (cur.nrLocked.length ? cur.nrLocked : WIS_NR) : (nrBands.length ? [...new Set(nrBands)] : WIS_NR);
    const badL = lte.filter(b => !WIS_LTE.includes(b)), badN = nr.filter(b => !WIS_NR.includes(b));
    if (badL.length || badN.length) throw noChange(`ترددات مو في قائمة راوترك: ${[...badL.map(b => 'B' + b), ...badN.map(b => 'n' + b)].join(' ')} — ما غيّرنا شي.`);
    const want = { l: wisLocked(lte, WIS_LTE), n: wisLocked(nr, WIS_NR) };
    if (want.l.join() === cur.locked.join() && want.n.join() === cur.nrLocked.join()) return;
    const sorted = (x: number[]) => [...x].sort((a, b) => a - b);
    await this.wisSend(wisBandPath(this.root(), sorted(lte), sorted(nr)), k => {
      const b = this.wisBandCfg(k);
      return b.locked.join() === want.l.join() && b.nrLocked.join() === want.n.join();
    }, 'الترددات');
  }
  private async wisSetMode(mode: string): Promise<void> {
    if (!WIS_MODES.some(m => m.value === mode)) throw noChange('هالوضع مو موجود في قائمة راوترك — ما غيّرنا شي.');
    const c = await this.wisCfg();
    if (String(c.net_mode) === mode) return;
    await this.wisSend(wisModePath(this.root(), c, mode), k => String(k.net_mode) === mode, 'وضع الشبكة');
  }

  async getSignal(): Promise<Signal> {
    if (this.wis) {
      const li = await this.wisInfo();
      if (li) return wisSignal(li);
    }
    const j = await this.status();
    if (j) return pro7Signal(j);
    // احتياط: نوع الشبكة بس من أيقونات الهيدر
    const st = await this.icons();
    return { network: pro7Network(st?.mode), nrActiveFromStatus: /NR5G|^5G$/i.test(String(st?.mode ?? '')) || undefined };
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    if (this.wis) {
      const li = await this.wisInfo();
      if (li) return { operator: String(li.operator ?? '').trim() || undefined, mode: wisNetwork(li), connected: !!String(li.dial_ip ?? '').match(/\d+\.\d+/), supports5g: true };
    }
    const j = await this.status();
    if (j) {
      const ds = String(j.data_status ?? '').toUpperCase();
      return {
        operator: String(j.name ?? '').trim() || undefined,
        connected: ds === 'CONNECT' ? true : ds === 'DISCONNECT' ? false : undefined,
        mode: pro7Network(j.mode), supports5g: true,
      };
    }
    const st = await this.icons();
    return { mode: pro7Network(st?.mode), supports5g: true };
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    return buildSnapshot(sig, [], cellsOf(sig), { driverId: this.id, driverName: this.name });
  }

  /** البرج الحالي (4G و 5G) — صفحة Pro7 ما فيها أبراج مجاورة */
  async getCells(): Promise<CellTower[]> {
    const sig = await this.getSignal();
    const out = cellsOf(sig);
    if (this.wis) {
      const li = await this.wisInfo().catch(() => null);
      const nr = li ? wisIs5g(li) : false;
      for (const c of li ? wisNeighbours(li) : []) {
        out.push({ kind: 'neighbor', tech: c.nr || (nr && !c.arfcn) ? 'NR' : 'LTE', pci: c.pci, arfcn: c.arfcn, rsrp: c.rsrp, rsrq: c.rsrq });
      }
    }
    return out;
  }

  // ═══════════ الكتابة: نماذج CBI في admin/modem/{band,network,cell} (pro7lock.ts) ═══════════

  private async page(name: 'band' | 'network' | 'cell'): Promise<CbiForm> {
    let t = '';
    try {
      const r = await http(`${this.base()}${this.root()}/admin/modem/${name}`, {}, 15000);
      t = await r.text();
    } catch (e) {
      throw noChange(`ما قدرنا نقرأ صفحة ${PAGE_AR[name]} من الراوتر — ما غيّرنا شي. (${(e as any)?.message ?? e})`);
    }
    if (/name=["']?luci_password/i.test(t)) throw noChange('انتهت الجلسة مع الراوتر — ما غيّرنا شي. ادخل مرة ثانية.');
    let f: CbiForm | null = null;
    try { f = parseCbiForm(t); } catch {}
    if (!f || !f.fields.some(x => x.name.startsWith('cbid.'))) throw noChange(`راوترك ما فيه صفحة ${PAGE_AR[name]} اللي نعرفها — ما غيّرنا شي.`);
    return f;
  }

  /** يرسل النموذج بالتغييرات (لو فيه فرق) وينتظر ويقرأ ويتأكد. يرجّع false لو ما احتاج يرسل */
  private async submit(name: 'band' | 'network' | 'cell', form: CbiForm, ch: Partial<CbiState>): Promise<boolean> {
    if (!cbiDiff(cbiState(form), ch).length) return false;
    let pairs: [string, string][];
    try { pairs = cbiPairs(cbiApply(form, ch)); } catch (e) {
      throw noChange(`صفحة ${PAGE_AR[name]} في راوترك مختلفة عن اللي نعرفه — ما غيّرنا شي. (${(e as any)?.message ?? e})`);
    }
    const action = /^\//.test(form.action) ? form.action : `${this.root()}/admin/modem/${name}`;
    const { body, type } = multipart(pairs);
    const r = await http(`${this.base()}${action}`, {
      method: 'POST',
      headers: { 'Content-Type': type, Referer: `${this.base()}${this.root()}/admin/modem/${name}` },
      body,
    }, 30000);
    const t = await r.text().catch(() => '');
    if (/name=["']?luci_password/i.test(t)) throw new Error(`انتهت الجلسة وقت حفظ ${PAGE_AR[name]} — ادخل مرة ثانية`);
    if (/cbi-section-error|cbi-value-error/.test(t)) throw new Error(`الراوتر رفض قيم ${PAGE_AR[name]} (POST admin/modem/${name})`);
    // LuCI يحفظ ويطبّق (uci commit + reload) — نعطيه وقت وبعدين نقرأ الصفحة ونقارن
    let bad: string[] = [];
    for (const wait of [4000, 4000]) {
      await sleep(wait);
      try { bad = cbiDiff(cbiState(await this.page(name)), ch); } catch { bad = ['read']; }
      if (!bad.length) return true;
    }
    throw new Error(`الراوتر قبل أمر ${PAGE_AR[name]} بس القراءة بعده مختلفة (${bad.join(', ')})`);
  }

  async getBandConfig(): Promise<BandConfig> {
    if (this.wis) return this.wisBandCfg(await this.wisCfg());
    const [b, n] = await Promise.all([this.page('band'), this.page('network').catch(() => null)]);
    const l = pro7BandLists(b);
    const nr = [...new Set([...(l.nsa?.opts ?? []), ...(l.sa?.opts ?? [])].map(o => o.band))].sort((x, y) => x - y);
    const nrLocked = l.nsa?.enabled ? lockedBands(l.nsa) : lockedBands(l.sa);
    return {
      supported: (l.lte?.opts ?? []).map(o => o.band), locked: lockedBands(l.lte),
      nrSupported: nr, nrLocked,
      mode: n ? pro7NetField(n)?.value ?? '' : '', modes: n ? pro7Modes(n) : [],
    };
  }

  /**
   * 4G = قسم LTE · 5G = قسما NSA و SA مع بعض (نفس القائمة). [] = نطفي «Enable» (كل الترددات) وما نلمس المربعات.
   * ما نشغّل «Enable» بقائمة فاضية أبداً.
   */
  async setBand(bands: number[] | 'keep', nrBands?: number[]): Promise<void> {
    if (this.wis) return this.wisSetBand(bands, nrBands);
    const form = await this.page('band');
    const l = pro7BandLists(form);
    const ch: Partial<CbiState> = { flags: {}, multi: {} };
    const put = (k: Pro7List, want: number[]) => {
      const x = l[k]!;
      if (!want.length) { ch.flags![x.flag] = false; return; }
      ch.flags![x.flag] = true;
      ch.multi![x.list] = x.opts.filter(o => want.includes(o.band)).map(o => o.value);
    };
    if (bands !== 'keep') {
      if (!l.lte) throw noChange('ما لقينا قسم ترددات 4G في صفحة راوترك — ما غيّرنا شي.');
      const want = [...new Set(bands)].filter(b => l.lte!.opts.some(o => o.band === b));
      if (bands.length && want.length !== new Set(bands).size) throw noChange(`ترددات 4G هذي مو في قائمة راوترك: ${bands.filter(b => !want.includes(b)).map(b => 'B' + b).join(' ')} — ما غيّرنا شي.`);
      put('lte', want);
    }
    if (nrBands !== undefined) {
      const lists = (['nsa', 'sa'] as Pro7List[]).filter(k => l[k]);
      if (!lists.length) throw noChange('ما لقينا قسم ترددات 5G في صفحة راوترك — ما غيّرنا شي.');
      const want = [...new Set(nrBands)];
      if (want.length && !lists.every(k => want.every(b => l[k]!.opts.some(o => o.band === b)))) {
        throw noChange(`ترددات 5G هذي مو في قائمة راوترك: ${want.map(b => 'n' + b).join(' ')} — ما غيّرنا شي.`);
      }
      for (const k of lists) put(k, want);
    }
    if (!Object.keys(ch.flags!).length) return;
    await this.submit('band', form, ch);
  }

  /** mode = قيمة الخيار في صفحة الراوتر (0 تلقائي … 6) — من getBandConfig().modes */
  async setNetworkMode(mode: string): Promise<void> {
    if (this.wis) return this.wisSetMode(mode);
    const form = await this.page('network');
    const f = pro7NetField(form);
    if (!f) throw noChange('ما لقينا «Network Mode» في صفحة راوترك — ما غيّرنا شي.');
    if (!f.options?.some(o => o.value === mode)) throw noChange('هالوضع مو موجود في قائمة راوترك — ما غيّرنا شي.');
    await this.submit('network', form, { vals: { [f.name]: mode } });
  }

  async getCellLocks(): Promise<CellLockState[]> {
    // WIS: تثبيت البرج (lte_dev_celllock) موجود بس ما فتحناه — بعد ما تنجح الترددات والوضع ميداني
    if (this.wis) return [];
    const form = await this.page('cell');
    const st = cbiState(form);
    const c = pro7CellFields(form);
    const out: CellLockState[] = [];
    if (c.lte && st.flags[c.lte.enable]) out.push({ tech: 'LTE', pci: st.vals[c.lte.pci] || undefined, arfcn: st.vals[c.lte.freq] || undefined });
    if (c.sa && st.flags[c.sa.enable]) {
      const b = Number(st.vals[c.sa.band!] ?? '');
      out.push({ tech: 'NR', pci: st.vals[c.sa.pci] || undefined, arfcn: st.vals[c.sa.freq] || undefined, band: b > 0 ? b : undefined });
    }
    return out;
  }
  async getCellLock(): Promise<CellLockState | null> { return (await this.getCellLocks())[0] ?? null; }

  async lockCell(t: CellLockTarget): Promise<void> {
    if (this.wis) throw noChange('تثبيت البرج في راوترك ما فتحناه للحين — جرّب تثبيت الترددات. ما غيّرنا شي.');
    const pci = String(t.pci ?? '').trim(), arfcn = String(t.arfcn ?? '').trim();
    if (!/^\d{1,4}$/.test(pci) || Number(pci) > 1007) throw noChange('رقم البرج (PCI) ناقص أو غلط — ما غيّرنا شي.');
    if (!/^\d{1,7}$/.test(arfcn)) throw noChange('الراوتر ما أعطانا رقم قناة هذا البرج — ثبّت التردد بدلاً منه.');
    const form = await this.page('cell');
    const c = pro7CellFields(form);
    if (t.tech === 'LTE') {
      if (!c.lte) throw noChange('ما لقينا تثبيت برج 4G في صفحة راوترك — ما غيّرنا شي.');
      await this.submit('cell', form, { flags: { [c.lte.enable]: true }, vals: { [c.lte.freq]: arfcn, [c.lte.pci]: pci } });
      return;
    }
    if (!c.sa) throw noChange('ما لقينا تثبيت برج 5G في صفحة راوترك — ما غيّرنا شي.');
    // القسم اسمه sacelllock ← يشتغل في SA بس. في «4G بس / 3G بس / 5G NSA بس» ما له أثر
    const net = await this.page('network').catch(() => null);
    const mv = net ? pro7NetField(net)?.value : undefined;
    const noSa = net ? ['4G Only', '3G Only', '5G NSA Only'].map(x => pro7ModeByLabel(net, x)).filter(Boolean) : [];
    if (mv !== undefined && noSa.includes(mv)) throw noChange('تثبيت برج 5G في راوترك يشتغل في وضع 5G SA بس، وراوترك الحين على وضع ما فيه SA — غيّر وضع الشبكة أول. ما غيّرنا شي.');
    let band = t.band;
    if (!band) band = (await this.getCells().catch(() => [])).find(x => x.tech === 'NR' && x.pci === pci && x.arfcn === arfcn)?.band;
    if (!band) throw noChange('ما عرفنا تردد برج 5G هذا — ما غيّرنا شي.');
    const scs = nrScs(band);
    if (c.sa.scs && !scs) throw noChange(`ما نعرف إعداد SCS الصح لـ n${band} — ما نثبّت عليه عشان ما تنقطع الخدمة. ما غيّرنا شي.`);
    const vals: Record<string, string> = { [c.sa.freq]: arfcn, [c.sa.pci]: pci };
    if (c.sa.band) vals[c.sa.band] = String(band);
    if (c.sa.scs && scs) vals[c.sa.scs] = scs;
    await this.submit('cell', form, { flags: { [c.sa.enable]: true }, vals });
  }

  /** بدون tech = يفك الاثنين. نطفي «Enable» بس ونخلي الأرقام (مثل صفحة الراوتر) */
  async unlockCell(tech?: 'LTE' | 'NR'): Promise<void> {
    if (this.wis) return;
    const form = await this.page('cell');
    const c = pro7CellFields(form);
    const flags: Record<string, boolean> = {};
    if (c.lte && tech !== 'NR') flags[c.lte.enable] = false;
    if (c.sa && tech !== 'LTE') flags[c.sa.enable] = false;
    if (!Object.keys(flags).length) return;
    await this.submit('cell', form, { flags });
  }

  async getActiveLock(): Promise<ActiveLock | null> {
    const c = await this.getBandConfig();
    const cell = (await this.getCellLocks().catch(() => []))[0];
    if (!c.locked.length && !c.nrLocked.length && !cell) return null;
    return { bands: c.locked, nrBands: c.nrLocked, pci: cell?.pci };
  }

  // ═══ لقطة + إرجاع: كل خانات الصفحات الثلاث كما هي ═══
  async readLockState(): Promise<LockSnapshot> {
    if (this.wis) {
      const c = await this.wisCfg();
      const b = this.wisBandCfg(c);
      const summary = `4G: ${b.locked.map(x => 'B' + x).join('+') || 'تلقائي'} · 5G: ${b.nrLocked.map(x => 'n' + x).join('+') || 'تلقائي'} · ${WIS_MODES.find(m => m.value === b.mode)?.label ?? b.mode}`;
      return { driver: this.id, at: Date.now(), summary, data: { wis: true, lte: b.locked, nr: b.nrLocked, mode: b.mode } };
    }
    const [b, n, c] = [await this.page('band'), await this.page('network'), await this.page('cell')];
    const data: Pro7LockData = { band: cbiState(b), network: cbiState(n), cell: cbiState(c) };
    const l = pro7BandLists(b);
    const cfg = pro7NetField(n);
    const cells = pro7CellFields(c);
    const lk = [
      cells.lte && data.cell.flags[cells.lte.enable] ? `برج 4G ${data.cell.vals[cells.lte.pci]}` : '',
      cells.sa && data.cell.flags[cells.sa.enable] ? `برج 5G ${data.cell.vals[cells.sa.pci]}` : '',
    ].filter(Boolean).join(' · ');
    const nrL = l.nsa?.enabled ? lockedBands(l.nsa) : lockedBands(l.sa);
    const summary = `4G: ${lockedBands(l.lte).map(x => 'B' + x).join('+') || 'تلقائي'} · 5G: ${nrL.map(x => 'n' + x).join('+') || 'تلقائي'}`
      + (cfg ? ` · ${pro7Modes(n).find(m => m.value === cfg.value)?.label ?? cfg.value}` : '') + (lk ? ' · ' + lk : '');
    return { driver: this.id, at: Date.now(), summary, data };
  }

  async restoreLockState(snap: LockSnapshot): Promise<void> {
    if (snap.driver !== this.id) throw new Error('اللقطة من نوع راوتر ثاني — ما نرجّعها');
    const w = snap.data as { wis?: boolean; lte?: number[]; nr?: number[]; mode?: string };
    if (w?.wis) {
      const miss: string[] = [];
      try { await this.wisSetBand(w.lte ?? [], w.nr ?? []); } catch { miss.push('الترددات'); }
      if (w.mode) { try { await this.wisSetMode(w.mode); } catch { miss.push('وضع الشبكة'); } }
      if (miss.length) throw restoreMismatch(miss);
      return;
    }
    const d = snap.data as Pro7LockData;
    const miss: string[] = [];
    // الترتيب: البرج ← الترددات ← وضع الشبكة (نفس ترتيب الأمان في باقي الدرايفرات)
    for (const [name, label] of [['cell', 'تثبيت البرج'], ['band', 'الترددات'], ['network', 'وضع الشبكة']] as const) {
      try { await this.submit(name, await this.page(name), d[name]); } catch { miss.push(label); }
    }
    if (miss.length) throw restoreMismatch(miss);
  }

  /** إنقاذ: يفك البرج والترددات ويرجّع الوضع «Auto» — كل خطوة لحالها */
  async restoreAll(): Promise<void> {
    if (this.wis) {
      try { await this.wisSetBand([], []); } catch {}
      try { await this.wisSetMode('Auto'); } catch {}
      return;
    }
    try { await this.unlockCell(); } catch {}
    try { await this.setBand([], []); } catch {}
    try {
      const n = await this.page('network');
      const auto = pro7ModeByLabel(n, 'Auto');
      if (auto !== undefined) await this.setNetworkMode(auto);
    } catch {}
  }
}

interface Pro7LockData { band: CbiState; network: CbiState; cell: CbiState }
const PAGE_AR = { band: 'الترددات', network: 'وضع الشبكة', cell: 'تثبيت البرج' } as const;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function cellsOf(s: Signal): CellTower[] {
  const out: CellTower[] = [];
  const n = (x?: string) => { const v = Number(String(x ?? '').replace(/^[Bn]/i, '')); return v > 0 ? v : undefined; };
  if (s.pci || s.earfcn) out.push({ kind: 'serving', tech: 'LTE', pci: s.pci, arfcn: s.earfcn, band: n(s.band), cellId: s.cellId, rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr });
  if (s.nrPci || s.nrArfcn) out.push({ kind: 'serving', tech: 'NR', pci: s.nrPci, arfcn: s.nrArfcn, band: n(s.nrBand), rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr });
  return out;
}
