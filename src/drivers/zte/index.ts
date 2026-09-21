import { sha256 } from '@noble/hashes/sha2';
import { md5 } from '@noble/hashes/legacy';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import {
  RouterDriver, Capability, Signal, NetworkInfo, Traffic, ConnectedDevice,
  Usage, DeviceDetails, CellTower, BandConfig, ActiveLock, Carrier,
  SignalSnapshot,
} from '../types';
import { http } from '../http';
import {
  parsePci, decodeBandMask, encodeBandMask, parseZteCa, bandLabel,
} from '../../utils/normalize';
import { buildSnapshot } from '../../utils/snapshot';

const sha256Upper = (s: string) => bytesToHex(sha256(utf8ToBytes(s))).toUpperCase();
const md5Hex = (s: string) => bytesToHex(md5(utf8ToBytes(s)));

/**
 * PCI/cell_id عند ZTE بالست عشري (f = 15) — نحوّله لعشري.
 * نعتمد parsePci لتفادي اختلافات الصيغ، ونسقط للنص الأصلي لو رجع undefined.
 */
const pciDec = (v?: string): string | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = parsePci(v);
  return n === undefined ? v.trim() : String(n);
};

/** رقم التردد 4G من EARFCN */
const LTE_EARFCN: [number, number, number][] = [
  [1, 0, 599], [3, 1200, 1949], [7, 2750, 3449], [8, 3450, 3799], [20, 6150, 6449],
  [28, 9210, 9659], [38, 37750, 38249], [40, 38650, 39649], [41, 39650, 41589],
  [42, 41590, 43589],
];
const lteBandOf = (earfcn?: number) =>
  earfcn === undefined ? undefined : LTE_EARFCN.find(([, a, b]) => earfcn >= a && earfcn <= b)?.[0];

/** ترددات MU5001 المعروفة — لو الراوتر ما قال غير كذا */
const DEFAULT_LTE = [1, 3, 7, 8, 20, 28, 40, 41];
const DEFAULT_NR = [40, 41, 78];

const bandsFromMask = (hex?: string): number[] => (hex ? decodeBandMask(hex) : []);
const maskFromBands = (bands: number[]) => encodeBandMask(bands);

const nrList = (v?: string) =>
  (v ?? '').split(',').map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0);

const num = (v?: string): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

const pick = (o: Record<string, string>, ...keys: string[]): string | undefined => {
  for (const k of keys) { const v = o[k]; if (v !== undefined && v !== '') return v; }
  return undefined;
};

const bandNum = (v?: string): number | undefined => {
  if (!v) return undefined;
  const m = String(v).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
};

/**
 * نص الترددات بنفس صيغة هواوي عشان الواجهة تعرض الدمج:
 * "20MHz@500(B1) + 20MHz@1450(B3) + 20MHz@9310(B28)"
 */
function caBandString(r: Record<string, string>): string | undefined {
  const earfcn = r.wan_active_channel || r.lte_ca_pcell_freq || '';
  const pb = bandNum(r.lte_band) ?? bandNum(r.lte_ca_pcell_band)
    ?? bandNum(r.wan_active_band) ?? lteBandOf(num(earfcn));
  if (!pb) return undefined;
  const bw = num(r.lte_ca_pcell_bandwidth);
  const label = bandLabel(pb, 'LTE') ?? ('B' + pb);
  const parts = [(bw ? bw + 'MHz' : '') + (earfcn ? '@' + earfcn : '') + '(' + label + ')'];
  const ca = r.wan_lte_ca || '';
  if (/activ/i.test(ca) && !/deactiv|inactiv/i.test(ca)) {
    for (const row of (r.lte_multi_ca_scell_info || '').split(';')) {
      const f = row.split(',').map(x => x.trim());
      if (f.length < 5) continue;
      const b = bandNum(f[3]) ?? lteBandOf(num(f[4]));
      if (!b) continue;
      const w = num(f[5]);
      const lbl = bandLabel(b, 'LTE') ?? ('B' + b);
      parts.push((w ? w + 'MHz' : '') + '@' + f[4] + '(' + lbl + ')');
    }
  }
  return parts.join(' + ');
}

export class ZteDriver implements RouterDriver {
  id = 'zte';
  name = 'ZTE';
  capabilities: Capability[] = ['signal', 'devices', 'traffic', 'usage', 'reboot', 'cells', 'bandLock'];
  private host = '';
  private password = '';

  private log(...a: unknown[]) {
    if (__DEV__) console.log('[zte]', ...a);
  }

  private base() {
    const h = this.host.replace(/\/+$/, '');
    return h.startsWith('http') ? h : 'http://' + h;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Referer: this.base() + '/index.html',
      'X-Requested-With': 'XMLHttpRequest',
      ...extra,
    };
  }

  /** قراءة حقول — لازم multi_data=1 لما تكون أكثر من حقل */
  private async get(fields: string[]): Promise<Record<string, string>> {
    const multi = fields.length > 1 ? '&multi_data=1' : '';
    const url = this.base() + '/goform/goform_get_cmd_process?isTest=false' + multi +
      '&cmd=' + encodeURIComponent(fields.join(',')) + '&_=' + Date.now();
    const res = await http(url, { headers: this.headers() });
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const out: Record<string, string> = {};
      for (const k of Object.keys(j)) {
        const v = j[k];
        out[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      return out;
    } catch {
      throw new Error('رد غير مفهوم من الراوتر');
    }
  }

  private async getRaw(field: string): Promise<any> {
    const url = this.base() + '/goform/goform_get_cmd_process?isTest=false&cmd=' +
      encodeURIComponent(field) + '&_=' + Date.now();
    const res = await http(url, { headers: this.headers() });
    try { return JSON.parse(await res.text()); } catch { return null; }
  }

  /**
   * مرشحو صيغة AD — من الأكثر شيوعاً للأقل. كلها موثقة من فيرمويرات ZTE،
   * مو brute-force. نجربها مرة وحدة ثم نحفظ الناجحة.
   */
  private static readonly AD_FORMULAS = ['wa+cr', 'wa', 'wa+cr+web', 'wa+web', 'concat'] as const;
  private adFormula: string | null = null;
  private adProbed = false;

  private async computeAd(formula: string): Promise<string | undefined> {
    try {
      const v = await this.get(['wa_inner_version', 'cr_version', 'web_version']);
      const rd = (await this.get(['RD'])).RD;
      if (!rd) return undefined;
      const wa = v.wa_inner_version ?? '';
      const cr = v.cr_version ?? '';
      const web = v.web_version ?? '';
      switch (formula) {
        case 'wa+cr': return md5Hex(md5Hex(wa + cr) + rd);
        case 'wa': return md5Hex(md5Hex(wa) + rd);
        case 'wa+cr+web': return md5Hex(md5Hex(wa + cr + web) + rd);
        case 'wa+web': return md5Hex(md5Hex(wa + web) + rd);
        case 'concat': return md5Hex(wa + cr + rd);
        default: return undefined;
      }
    } catch {
      return undefined;
    }
  }

  /** يختبر الصيغ على SET_WEB_LANGUAGE (بلا تأثير جانبي — نفس اللغة). */
  private async probeAdFormula(): Promise<void> {
    if (this.adProbed) return;
    this.adProbed = true;
    try {
      const v = await this.get(['wa_inner_version', 'cr_version', 'web_version']);
      const rd = (await this.get(['RD'])).RD;
      if (!rd) return;
      const wa = v.wa_inner_version ?? '';
      const cr = v.cr_version ?? '';
      const web = v.web_version ?? '';
      const formulas: Array<[string, string]> = [
        ['wa+cr', md5Hex(md5Hex(wa + cr) + rd)],
        ['wa', md5Hex(md5Hex(wa) + rd)],
        ['wa+cr+web', md5Hex(md5Hex(wa + cr + web) + rd)],
        ['wa+web', md5Hex(md5Hex(wa + web) + rd)],
        ['concat', md5Hex(wa + cr + rd)],
      ];
      for (const [name, ad] of formulas) {
        try {
          const form = `isTest=false&goformId=SET_WEB_LANGUAGE&Language=en&AD=${encodeURIComponent(ad)}`;
          const res = await http(this.base() + '/goform/goform_set_cmd_process', {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
            body: form,
          });
          const out = await res.text();
          if (/"result"\s*:\s*"?0"?/.test(out) || /success/i.test(out)) {
            this.adFormula = name;
            return;
          }
        } catch {}
      }
      this.adFormula = 'wa+cr';
    } catch {}
  }

  private async signAd(): Promise<string | undefined> {
    if (!this.adProbed) await this.probeAdFormula();
    return this.computeAd(this.adFormula ?? 'wa+cr');
  }

  private async post(body: Record<string, string>): Promise<string> {
    const extra: Record<string, string> = {};
    if (body.goformId !== 'LOGIN' && body.goformId !== 'SET_WEB_LANGUAGE') {
      const ad = await this.signAd();
      if (ad) extra.AD = ad;
    }
    const form = Object.entries({ isTest: 'false', ...body, ...extra })
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const res = await http(this.base() + '/goform/goform_set_cmd_process', {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form,
    });
    return await res.text();
  }

  async detect(host: string): Promise<boolean> {
    this.host = host;
    try {
      const r = await this.get(['wa_inner_version']);
      return !!r.wa_inner_version;
    } catch {
      return false;
    }
  }

  /** ZTE ما يستخدم اسم مستخدم — كلمة المرور فقط */
  async login(host: string, _username: string, password: string): Promise<void> {
    this.host = host;
    this.password = password;

    // ═══ MU5001 يقبل مستخدم واحد فقط — نفكّ أي جلسة عالقة أول ═══
    try { await this.post({ goformId: 'LOGOUT' }); } catch {}
    try { await this.post({ goformId: 'GOFORM_LOGOUT' }); } catch {}
    await new Promise(r => setTimeout(r, 800));

    // ═══ اجلب LD طازج (يتغيّر بعد LOGOUT) ═══
    let ld = '';
    try { ld = (await this.get(['LD'])).LD || ''; } catch {}
    this.log('login: LD =', ld ? (ld.slice(0, 16) + '...') : '(فاضي)');

    // ═══ صيغ الهاش — كلها موثّقة من فيرمويرات ZTE مختلفة ═══
    const candidates: Array<{ name: string; val: string }> = [];
    if (ld) {
      candidates.push({
        name: 'sha2(pw)+LD.upper',
        val: sha256Upper(sha256Upper(password) + ld.toUpperCase()),
      });
      candidates.push({
        name: 'sha2(pw+LD.upper)',
        val: sha256Upper(sha256Upper(password + ld.toUpperCase())),
      });
    }
    candidates.push({ name: 'sha2(pw)', val: sha256Upper(password) });
    try { candidates.push({ name: 'base64(pw)', val: btoa(password) }); } catch {}

    let sawBusy = false;
    let sawWrong = false;
    let sawSuccessReply = false;

    for (const c of candidates) {
      let out = '';
      try {
        out = await this.post({ goformId: 'LOGIN', password: c.val });
      } catch (e) {
        this.log('login:', c.name, 'THREW', (e as any)?.message ?? String(e));
        continue;
      }
      this.log('login:', c.name, '→', out.slice(0, 120));

      if (/"result"\s*:\s*"?0"?/.test(out)) {
        sawSuccessReply = true;
        await new Promise(r => setTimeout(r, 400));
        if (await this.verifyLogin()) {
          this.log('login: ✓ نجح بـ', c.name);
          return;
        }
        this.log('login: result=0 لكن verify فشل — نكمل');
        continue;
      }
      if (/"result"\s*:\s*"?1"?/.test(out)) { sawWrong = true; continue; }
      if (/"result"\s*:\s*"?3"?/.test(out)) { sawBusy = true; continue; }
    }

    // ═══ لو كل شي فشل، نأكد عدم وجود جلسة قديمة قبل ما نرمي ═══
    if (await this.verifyLogin()) {
      this.log('login: موجودين داخلين أصلاً (جلسة سابقة)');
      return;
    }

    if (sawSuccessReply) {
      throw new Error('الراوتر قبل الدخول لكن loginfo ما رجع "ok" — جرّب مرة ثانية');
    }
    if (sawBusy) {
      throw new Error('الراوتر فيه جلسة عالقة ولا يقبل دخول جديد. جرّب: أعد تشغيل الراوتر، أو اقفل صفحته من أي متصفح، أو انتظر 5 دقائق.');
    }
    if (sawWrong) {
      throw new Error('كلمة المرور غير صحيحة');
    }
    throw new Error('تعذّر تسجيل الدخول في راوتر ZTE');
  }

  /** يفكّ الجلسة العالقة في الفيرموير اللي يسمح بمستخدم واحد */
  private async freeSession(): Promise<void> {
    try { await this.post({ goformId: 'LOGOUT' }); } catch {}
    try { await this.post({ goformId: 'GOFORM_LOGOUT' }); } catch {}
    try { await this.get(['loginfo']); } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }

  /**
   * فحص الجلسة: الراوتر يرجع loginfo = "ok" فقط لو جلستنا هي المسيطرة.
   * أي شي ثاني (فاضي، logout) = غير مسجّل.
   */
  private async verifyLogin(): Promise<boolean> {
    try {
      const r = await this.get(['loginfo']);
      const li = r.loginfo;
      this.log('verifyLogin: loginfo =', JSON.stringify(li ?? ''));
      return li === 'ok';
    } catch (e) {
      this.log('verifyLogin: error', (e as any)?.message ?? String(e));
      return false;
    }
  }

  private async act(body: Record<string, string>): Promise<string> {
    let out = await this.post(body);
    if (/success/i.test(out) || !this.password) return out;
    try { await this.login(this.host, '', this.password); } catch {}
    out = await this.post(body);
    return out;
  }

  private rejected(what: string, out: string): Error {
    const raw = (out || '').replace(/\s+/g, ' ').slice(0, 80);
    return new Error(`الراوتر رفض ${what}. لو صفحة الراوتر مفتوحة في متصفح، سكّرها وجرّب (${raw || 'بدون رد'})`);
  }

  async logout(): Promise<void> {
    try { await this.post({ goformId: 'LOGOUT' }); } catch {}
    this.password = '';
  }

  private async ensure(): Promise<void> {
    if (await this.verifyLogin()) return;
    if (this.password) await this.login(this.host, '', this.password);
  }

  /** قراءة أي حقول بعد تسجيل الدخول — للفحص العميق */
  async rawFields(fields: string[]): Promise<Record<string, string>> {
    await this.ensure();
    return await this.get(fields);
  }

  async getSignal(): Promise<Signal> {
    await this.ensure();
    const r = await this.get([
      'network_type', 'lte_band', 'wan_active_band', 'lte_pci', 'cell_id',
      'lte_rsrp', 'rsrp', 'lte_rsrq', 'rsrq', 'lte_snr', 'rssi', 'lte_rssi',
      'wan_lte_ca', 'lte_ca_pcell_bandwidth', 'lte_ca_pcell_freq', 'wan_active_channel',
      'lte_multi_ca_scell_info', 'lte_ca_pcell_band',
      // 5G NSA (الوضع القديم)
      'Z5g_rsrp', 'Z5g_rsrq', 'Z5g_SINR', 'Z5g_dlEarfcn',
      'nr5g_pci', 'nr5g_action_band', 'nr5g_action_channel', 'nr5g_cell_id',
      // 5G SA (بدائل — MU5001 في وضع Standalone)
      'Z5g_snr', 'Z5g_CQI',
      'nr5g_rsrp', 'nr5g_rsrq', 'nr5g_sinr', 'nr5g_snr',
      'nr5g_band', 'nr5g_sa_band', 'nr_band',
      'nr5g_sa_pci', 'nr_pci', 'nr5g_cell_pci',
      'nr5g_dlEarfcn', 'nr5g_dl_earfcn', 'nr5g_sa_arfcn', 'nr5g_arfcn',
      'nr5g_sa_cell_id', 'nr_cell_id',
      'nr5g_dlbandwidth', 'nr5g_bandwidth', 'nr5g_sa_bandwidth', 'nr5g_dl_bandwidth',
    ]);
    // نأخذ أول قيمة غير فاضية من قائمة بدائل (5G SA يسمي الحقول بشكل مختلف)
    const pickAny = (...keys: string[]): string | undefined => pick(r, ...keys);
    const nrRsrpVal = pickAny('Z5g_rsrp', 'nr5g_rsrp', 'nr5g_sa_rsrp');
    const nrSinrVal = pickAny('Z5g_SINR', 'nr5g_sinr', 'nr5g_sa_sinr', 'Z5g_snr', 'nr5g_snr');
    const nrRsrqVal = pickAny('Z5g_rsrq', 'nr5g_rsrq', 'nr5g_sa_rsrq');
    const nrBandVal = pickAny('nr5g_action_band', 'nr5g_band', 'nr5g_sa_band', 'nr_band');
    const nrPciVal = pickAny('nr5g_pci', 'nr5g_sa_pci', 'nr_pci', 'nr5g_cell_pci');
    const nrArfcnVal = pickAny('Z5g_dlEarfcn', 'nr5g_action_channel', 'nr5g_dlEarfcn', 'nr5g_dl_earfcn', 'nr5g_sa_arfcn', 'nr5g_arfcn');
    const nrCellIdVal = pickAny('nr5g_cell_id', 'nr5g_sa_cell_id', 'nr_cell_id');
    const nrBwVal = pickAny('nr5g_dlbandwidth', 'nr5g_bandwidth', 'nr5g_sa_bandwidth', 'nr5g_dl_bandwidth');
    const nrOn = !!(nrRsrpVal || nrBandVal);
    const nsa = /ENDC|NSA/i.test(r.network_type || '');
    return {
      network: pick(r, 'network_type'),
      band: caBandString(r),
      nrAvailable: !nrOn && nsa ? 3 : undefined,
      cellId: pciDec(pick(r, 'cell_id')),
      pci: pciDec(pick(r, 'lte_pci')),
      earfcn: pick(r, 'wan_active_channel', 'lte_ca_pcell_freq'),
      dlBandwidth: pick(r, 'lte_ca_pcell_bandwidth'),
      rsrp: num(pick(r, 'lte_rsrp', 'rsrp')),
      rsrq: num(pick(r, 'lte_rsrq', 'rsrq')),
      sinr: num(pick(r, 'lte_snr')),
      rssi: num(pick(r, 'lte_rssi', 'rssi')),
      nrBand: nrOn ? nrBandVal : undefined,
      nrPci: nrOn ? pciDec(nrPciVal) : undefined,
      nrArfcn: nrArfcnVal,
      nrDlBandwidth: nrBwVal,
      nrRsrp: num(nrRsrpVal),
      nrRsrq: num(nrRsrqVal),
      nrSinr: num(nrSinrVal),
    };
  }

  async getSnapshot(): Promise<SignalSnapshot> {
    const sig = await this.getSignal();
    const ca = await this.getCarriers().catch(() => [] as Carrier[]);
    const cells = await this.getCells().catch(() => [] as CellTower[]);
    return buildSnapshot(sig, ca, cells, { driverId: this.id, driverName: this.name });
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    await this.ensure();
    const r = await this.get(['network_provider', 'network_type', 'ppp_status', 'modem_main_state']);
    const state = (r.modem_main_state || '') + ' ' + (r.ppp_status || '');
    return {
      operator: pick(r, 'network_provider'),
      mode: pick(r, 'network_type'),
      connected: /connect|working/i.test(state),
    };
  }

  async isConnected(): Promise<boolean> {
    const n = await this.getNetworkInfo();
    return !!n.connected;
  }

  async getDeviceDetails(): Promise<DeviceDetails> {
    await this.ensure();
    const r = await this.get([
      'wa_inner_version', 'cr_version', 'hardware_version', 'wan_ipaddr',
      'network_provider', 'modem_main_state', 'prefer_dns_manual',
    ]);
    return {
      model: pick(r, 'wa_inner_version'),
      software: pick(r, 'cr_version', 'wa_inner_version'),
      hardware: pick(r, 'hardware_version'),
      wanIp: pick(r, 'wan_ipaddr'),
      dns: pick(r, 'prefer_dns_manual'),
      operator: pick(r, 'network_provider'),
      simStatus: pick(r, 'modem_main_state'),
    };
  }

  async getTraffic(): Promise<Traffic> {
    await this.ensure();
    const r = await this.get(['realtime_tx_thrpt', 'realtime_rx_thrpt', 'realtime_time']);
    return {
      downBytesPerSec: num(r.realtime_rx_thrpt) ?? 0,
      upBytesPerSec: num(r.realtime_tx_thrpt) ?? 0,
      connectedSecs: num(r.realtime_time) ?? 0,
    };
  }

  async getUsage(): Promise<Usage> {
    await this.ensure();
    const r = await this.get(['monthly_rx_bytes', 'monthly_tx_bytes', 'realtime_rx_bytes', 'realtime_tx_bytes']);
    return {
      downloadBytes: num(pick(r, 'monthly_rx_bytes', 'realtime_rx_bytes')) ?? 0,
      uploadBytes: num(pick(r, 'monthly_tx_bytes', 'realtime_tx_bytes')) ?? 0,
    };
  }

  async getDevices(): Promise<ConnectedDevice[]> {
    await this.ensure();
    const raw = await this.getRaw('station_list');
    const list = raw && (raw.station_list ?? raw.lan_station_list);
    if (!Array.isArray(list)) return [];
    return list.map((d: any) => ({
      mac: String(d.mac_addr || d.mac || ''),
      ip: d.ip_addr || d.ip || undefined,
      name: d.hostname || d.host_name || undefined,
      blocked: false,
    })).filter(d => d.mac);
  }

  async getCells(): Promise<CellTower[]> {
    await this.ensure();
    const s = await this.getSignal();
    const out: CellTower[] = [];
    if (s.rsrp !== undefined || s.pci) {
      out.push({
        kind: 'serving', tech: 'LTE', pci: s.pci, cellId: s.cellId,
        arfcn: s.earfcn, band: bandNum(s.band),
        rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr, rssi: s.rssi,
      });
    }
    if (s.nrRsrp !== undefined) {
      out.push({
        kind: 'serving', tech: 'NR', pci: s.nrPci, arfcn: s.nrArfcn,
        band: bandNum(s.nrBand), rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr,
      });
    }
    // النواقل الثانوية من نص الدمج "20MHz@500(B1) + ..." — parseZteCa يفكّها كاملة
    if (s.band) {
      for (const c of parseZteCa(s.band)) {
        if (c.role !== 'SCC') continue;
        out.push({
          kind: 'secondary',
          tech: c.tech,
          band: c.band,
          arfcn: c.arfcn,
        });
      }
    }
    // الأبراج المجاورة (MU5001): "earfcn,pci,rsrq,rsrp,rssi;..." — PCI هنا عشري،
    // وأول سطر غالباً هو البرج الحالي نفسه فنتخطاه
    try {
      const r = await this.get(['ngbr_cell_info']);
      for (const row of (r.ngbr_cell_info || '').split(';')) {
        const p = row.split(',').map(x => x.trim());
        if (p.length < 4 || !p[0]) continue;
        if (p[1] === s.pci && p[0] === s.earfcn) continue;
        const earfcn = num(p[0]);
        out.push({
          kind: 'neighbor', tech: 'LTE',
          arfcn: p[0], band: lteBandOf(earfcn), pci: p[1],
          rsrq: num(p[2]), rsrp: num(p[3]), rssi: num(p[4]),
        });
      }
    } catch {}
    return out;
  }

  // ─── الترددات ───
  private async readLocks() {
    const r = await this.get(['lte_band_lock', 'nr5g_nsa_band_lock', 'nr5g_sa_band_lock', 'nr5g_band_lock']);
    const lte = bandsFromMask(r.lte_band_lock);
    const nr = nrList(pick(r, 'nr5g_nsa_band_lock', 'nr5g_band_lock', 'nr5g_sa_band_lock'));
    return { lte, nr };
  }

  async getBandConfig(): Promise<BandConfig> {
    await this.ensure();
    const { lte, nr } = await this.readLocks();
    const supported = [...new Set([...DEFAULT_LTE, ...lte])].sort((a, b) => a - b);
    const nrSupported = [...new Set([...DEFAULT_NR, ...nr])].sort((a, b) => a - b);
    const locked = lte.length === 0 || supported.every(b => lte.includes(b)) ? [] : lte;
    const nrLocked = nr.length === 0 || nrSupported.every(b => nr.includes(b)) ? [] : nr;
    return { supported, locked, nrSupported, nrLocked, mode: 'auto', modes: [] };
  }

  async setBand(bands: number[], nrBands?: number[]): Promise<void> {
    await this.ensure();
    const all = [...new Set([...DEFAULT_LTE, ...(await this.readLocks()).lte])];
    const lte = bands.length ? bands : all;
    const out = await this.act({
      goformId: 'BAND_SELECT',
      is_gw_band: '0', gw_band_mask: '0',
      is_lte_band: '1', lte_band_mask: maskFromBands(lte),
    });
    if (!/success/i.test(out)) throw this.rejected('تثبيت الترددات', out);
    if (nrBands) {
      const nr = nrBands.length ? nrBands : DEFAULT_NR;
      const cur = (await this.readLocks()).nr;
      const same = cur.length === nr.length && nr.every(b => cur.includes(b));
      if (!same) {
        const o2 = await this.act({ goformId: 'WAN_PERFORM_NR5G_BAND_LOCK', nr5g_band_mask: nr.join(',') });
        if (!/success/i.test(o2)) throw this.rejected('تثبيت ترددات 5G', o2);
      }
    }
  }

  async getActiveLock(): Promise<ActiveLock | null> {
    const c = await this.getBandConfig();
    if (!c.locked.length && !c.nrLocked.length) return null;
    return { bands: c.locked, nrBands: c.nrLocked };
  }

  /** النواقل: الأساسي 4G + 5G المرتبط (NSA) — الدمج الإضافي لو الراوتر يعطيه */
  async getCarriers(): Promise<Carrier[]> {
    await this.ensure();
    const r = await this.get([
      'lte_band', 'wan_active_channel', 'lte_pci', 'lte_rsrp', 'lte_rsrq', 'lte_snr',
      'lte_ca_pcell_bandwidth', 'wan_lte_ca', 'lte_multi_ca_scell_info',
      'nr5g_action_band', 'nr5g_action_channel', 'nr5g_pci',
      'Z5g_rsrp', 'Z5g_rsrq', 'Z5g_SINR', 'nr5g_bandwidth',
      'nr5g_band', 'nr5g_sa_band', 'nr5g_sa_pci', 'nr5g_dlEarfcn',
      'nr5g_dl_earfcn', 'nr5g_sa_arfcn', 'nr5g_rsrp', 'nr5g_sinr',
      'nr5g_rsrq', 'nr5g_dlbandwidth', 'nr5g_sa_bandwidth',
    ]);
    const out: Carrier[] = [];
    const earfcn = num(r.wan_active_channel);
    const band = bandNum(r.lte_band) ?? lteBandOf(earfcn);
    if (band) {
      out.push({
        tech: 'LTE', role: 'PCC', band, arfcn: r.wan_active_channel || undefined, pci: pciDec(r.lte_pci),
        bandwidth: num(r.lte_ca_pcell_bandwidth), rsrp: num(r.lte_rsrp), rsrq: num(r.lte_rsrq), sinr: num(r.lte_snr),
      });
    }
    if (/activ/i.test(r.wan_lte_ca || '') && !/deactiv|inactiv/i.test(r.wan_lte_ca || '')) {
      for (const row of (r.lte_multi_ca_scell_info || '').split(';')) {
        const f = row.split(',').map(x => x.trim());
        if (f.length < 5) continue;
        const b = bandNum(f[3]) ?? lteBandOf(num(f[4]));
        if (!b) continue;
        out.push({
          tech: 'LTE', role: 'SCC', band: b, arfcn: f[4] || undefined,
          pci: pciDec(f[1]), bandwidth: num(f[5]),
        });
      }
    }
    const nrBand = pick(r, 'nr5g_action_band', 'nr5g_band', 'nr5g_sa_band');
    const nrRsrpV = pick(r, 'Z5g_rsrp', 'nr5g_rsrp');
    const nb = bandNum(nrBand);
    if (nb && nrRsrpV) {
      out.push({
        tech: 'NR', role: out.length ? 'SCC' : 'PCC', band: nb,
        arfcn: pick(r, 'Z5g_dlEarfcn', 'nr5g_action_channel', 'nr5g_dlEarfcn', 'nr5g_sa_arfcn') || undefined,
        pci: pciDec(pick(r, 'nr5g_pci', 'nr5g_sa_pci')),
        bandwidth: num(pick(r, 'nr5g_bandwidth', 'nr5g_dlbandwidth', 'nr5g_sa_bandwidth')),
        rsrp: num(nrRsrpV),
        rsrq: num(pick(r, 'Z5g_rsrq', 'nr5g_rsrq')),
        sinr: num(pick(r, 'Z5g_SINR', 'nr5g_sinr')),
      });
    }
    return out;
  }

  async reboot(): Promise<void> {
    await this.ensure();
    await this.post({ goformId: 'REBOOT_DEVICE' });
  }
}
