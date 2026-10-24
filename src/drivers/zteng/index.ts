/**
 * ZTE الجيل الجديد (U60 Pro / MU5250، وغالباً G5 Ultra وأجهزة zwrt الأحدث).
 * الصفحة ما فيها goform — كل شي عبر ubus JSON-RPC على /ubus/.
 *
 * النسخة الأولى: **قراءة بس**.
 *  - zte_nwinfo_api.nwinfo_get_netinfo مسموح بدون دخول (rpcd ACL «unauthenticated») ← الإشارة بدون أي محاولة دخول.
 *  - الدخول: zwrt_web.web_login_info (salt) ثم web_login بـ SHA256(SHA256(pw).upper + salt).upper
 *    (مرجع: dklasens/MU5250-OpenUI، MIT). نجرّبه **مرة وحدة بس لما المستخدم يكتب الكلمة بنفسه** —
 *    المهام الخلفية ما تحاول تدخل أبداً، عشان ما ينقفل الدخول.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { RouterDriver, Capability, Signal, Carrier } from '../types';
import { http } from '../http';

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

export class ZteNgDriver implements RouterDriver {
  id = 'zte-ng';
  name = 'ZTE (الجيل الجديد)';
  capabilities: Capability[] = ['signal'];

  private host = '';
  private session = ZERO;

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
    // القراءة ما تحتاج دخول — ما نحاول إلا لو المستخدم كتب الكلمة بنفسه (نتأكد منها مرة وحدة)
    if (!password || !(opts?.fresh || opts?.lastTry)) return;
    const info = await this.call('zwrt_web', 'web_login_info', {}, ZERO);
    const salt = str(info.zte_web_sault);
    if (!salt) throw new Error('الراوتر ما عطانا بيانات الدخول — جرّب بعد شوي');
    let r: Record<string, unknown>;
    try {
      r = await this.call('zwrt_web', 'web_login', { password: sha(sha(password) + salt) }, ZERO);
    } catch {
      throw new Error('كلمة المرور غلط. تأكد منها (الملصق تحت الراوتر أو اللي غيّرتها أنت) — ما بنجرّب مرة ثانية لحالنا.');
    }
    const s = str(r.ubus_rpc_session);
    if (!s) throw new Error('كلمة المرور غلط. تأكد منها — ما بنجرّب مرة ثانية لحالنا.');
    this.session = s;
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
}
