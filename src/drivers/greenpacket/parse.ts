/**
 * Green Packet 5G CPE (E5-250MK — زين، 192.168.0.1) — قراءة الردود (منطق صافي، عليه اختبارات).
 * كل الأسماء من ملفات صفحة الراوتر (تقرير ٢٦ أكتوبر، static/js/app + chunk-5b2197a0 …):
 *   الرد دايماً {code: 200, msg, data}
 *   /web/v1/dashboard/radio/cainfo        data.Items[].CACells[] {Index, Type, Band, ARFCN, FrequencyBandwidth, PCI, RSSI, RSRP, RSRQ, CINR}
 *   /web/v1/dashboard/radio/nsacellinfo   {PLMN, TAC, PCI, ECGI}  (PCI ممكن يجي «…(PCI:123)» — الصفحة تقصه)
 *   /web/v1/dashboard/radio/nrcellinfo    {NR_PLMN, NR_TAC, NR_PCI, NCGI}
 *   /web/v1/startup/radiocellsinfo        Items[] {WorkMode, SINR, RSRP}
 *   /web/v1/dashboard/internetinfo        {Status: "Connected"/"Not Connect", WorkMode: LTE/NSA/SA/WCDMA, Operator}
 *   الترددات: ltenetworkband?Mode=4G|5G ← Items (المتاحة) · ltediscretebandsetting ← Items المقفولة
 *             (قائمة فاضية = تلقائي) — الكتابة Items بـ OperateType insert/delete/none مثل صفحة LookBand
 *   البرج: cellselect/config {Config: AutoSelect | PreferredListing} + cellselect/preferredlist Items
 */
import { Signal, CellTower, Carrier, NetworkModeOption, ConnectedDevice, SmsMessage } from '../types';

const num = (v: unknown, lo: number, hi: number): number | undefined => {
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const x = parseFloat(m[0]);
  return Number.isFinite(x) && x >= lo && x <= hi ? x : undefined;
};
const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s && s !== '-' && s !== '--' && !/^n\/?a$/i.test(s) ? s : undefined;
};
/** «Band3(PCI:123)» أو «123» ← "123" */
export function pciOf(v: unknown): string | undefined {
  const s = String(v ?? '');
  const m = s.match(/PCI\s*:\s*(\d+)/i) ?? s.match(/^\s*(\d+)\s*$/);
  return m ? m[1] : str(s.match(/\d+/)?.[0]);
}

/** «B3» «LTE BAND 3» «n78» «N78» «78» ← {tech, band} — الـ ARFCN الكبير (> 100000) = 5G */
export function bandOf(band: unknown, arfcn?: unknown, type?: unknown): { tech: 'LTE' | 'NR'; band: number } | null {
  const s = String(band ?? '').trim();
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const b = parseInt(m[1], 10);
  const a = Number(String(arfcn ?? '').replace(/\D/g, ''));
  if (/^\s*n\s*\d|NR|5G/i.test(s) || /NR|5G/i.test(String(type ?? '')) || a > 100000) return { tech: 'NR', band: b };
  return { tech: 'LTE', band: b };
}

export interface CaCell { tech: 'LTE' | 'NR'; band: number; arfcn?: string; pci?: string; rsrp?: number; rsrq?: number; sinr?: number; rssi?: number; bw?: number; primary: boolean }
export function caCells(r: any): CaCell[] {
  const items: any[] = Array.isArray(r?.Items) ? r.Items : [];
  const out: CaCell[] = [];
  for (const it of items) for (const c of Array.isArray(it?.CACells) ? it.CACells : []) {
    const b = bandOf(c.Band, c.ARFCN, c.Type);
    if (!b) continue;
    const bw = num(String(c.FrequencyBandwidth ?? '').split('/').pop(), 1, 400);
    out.push({
      ...b, arfcn: str(c.ARFCN), pci: pciOf(c.PCI),
      rsrp: num(c.RSRP, -156, -30), rsrq: num(c.RSRQ, -43, 20), sinr: num(c.CINR ?? c.SINR, -30, 50), rssi: num(c.RSSI, -130, -10),
      bw, primary: /P/i.test(String(c.Type ?? '')) && !/S/i.test(String(c.Type ?? '').replace(/SA/i, '')),
    });
  }
  // لو النوع ما وضّح الأساسي: أول خلية من كل تقنية
  for (const t of ['LTE', 'NR'] as const) {
    const xs = out.filter(x => x.tech === t);
    if (xs.length && !xs.some(x => x.primary)) xs[0].primary = true;
  }
  return out;
}

export interface GpRaw { inet?: any; ca?: any; nsa?: any; nr?: any; score?: any }

export function signalFrom(r: GpRaw): Signal {
  const wm = String(r.inet?.WorkMode ?? '').toUpperCase();
  const sa = wm === 'SA', nsa = wm === 'NSA';
  const s: Signal = { network: sa ? '5G SA' : nsa ? '5G NSA' : wm === 'LTE' ? '4G' : wm === 'WCDMA' ? '3G' : undefined };
  const cells = caCells(r.ca);
  const lte = cells.find(c => c.tech === 'LTE' && c.primary), nr = cells.find(c => c.tech === 'NR' && c.primary);
  const score: any[] = Array.isArray(r.score?.Items) ? r.score.Items : [];
  const sc = (k: RegExp) => score.find(x => k.test(String(x?.WorkMode ?? '')));
  if (!sa) {
    const sl = sc(/LTE|4G/i);
    s.band = lte ? 'B' + lte.band : undefined;
    s.earfcn = lte?.arfcn;
    s.pci = lte?.pci ?? pciOf(r.nsa?.PCI);
    s.cellId = str(r.nsa?.ECGI);
    s.rsrp = lte?.rsrp ?? num(sl?.RSRP, -150, -30);
    s.rsrq = lte?.rsrq;
    s.sinr = lte?.sinr ?? num(sl?.SINR, -30, 50);
    s.rssi = lte?.rssi;
  }
  if (sa || nsa || nr) {
    const sn = sc(/NR|5G|SA/i);
    s.nrBand = nr ? 'n' + nr.band : undefined;
    s.nrArfcn = nr?.arfcn;
    s.nrPci = nr?.pci ?? pciOf(r.nr?.NR_PCI);
    s.nrRsrp = nr?.rsrp ?? num(sn?.RSRP, -156, -31);
    s.nrRsrq = nr?.rsrq;
    s.nrSinr = nr?.sinr ?? num(sn?.SINR, -23, 40);
    if (sa) s.cellId = str(r.nr?.NCGI);
  }
  if (cells.length > 1) {
    s.caCount = cells.length;
    const bw = cells.reduce((a, c) => a + (c.bw ?? 0), 0);
    if (bw) s.caBandwidthMhz = bw;
  }
  return s;
}

export function cellsFrom(r: GpRaw): CellTower[] {
  const s = signalFrom(r);
  return caCells(r.ca).map(c => ({
    kind: c.primary ? (c.tech === 'NR' && s.network !== '5G SA' ? 'secondary' : 'serving') : 'secondary',
    tech: c.tech, band: c.band, arfcn: c.arfcn, pci: c.pci, rsrp: c.rsrp, rsrq: c.rsrq, sinr: c.sinr, rssi: c.rssi,
  } as CellTower));
}

export function carriersFrom(r: GpRaw): Carrier[] {
  return caCells(r.ca).map(c => ({ tech: c.tech, band: c.band, role: c.primary ? 'PCC' as const : 'SCC' as const, arfcn: c.arfcn, pci: c.pci, bandwidth: c.bw, rsrp: c.rsrp, rsrq: c.rsrq }));
}

/** جيران من sortedcelllist (الشكل مو مؤكد — نقرأ اللي نعرفه بس) */
export function neighborsFrom(r: any): CellTower[] {
  const items: any[] = Array.isArray(r?.Items) ? r.Items : [];
  return items.map(x => {
    const b = bandOf(x.BandId ?? x.Band, x.Earfcn ?? x.ARFCN, x.NetworkMode);
    const pci = pciOf(x.PCI);
    if (!b || !pci) return null;
    return { kind: 'neighbor', tech: b.tech, band: b.band, arfcn: str(x.Earfcn ?? x.ARFCN), pci, rsrp: num(x.RSRP, -156, -30), sinr: num(x.SINR ?? x.CINR, -30, 50) } as CellTower;
  }).filter((x): x is CellTower => !!x);
}

// ═══ الترددات ═══
export interface BandRow { IndexId: string; NetworkMode: string; BandId: string; StartFreq: string; EndFreq: string; StartEarfcn: string; EndEarfcn: string; OperateType: string }
export const bandNo = (id: unknown) => { const m = String(id ?? '').match(/(\d+)/); return m ? parseInt(m[1], 10) : NaN; };
export function lockedRows(r: any): BandRow[] {
  const items: any[] = Array.isArray(r?.Items) ? r.Items : [];
  return items.filter(x => x && x.BandId !== undefined).map(x => ({
    IndexId: String(x.IndexId ?? ''), NetworkMode: String(x.NetworkMode ?? ''), BandId: String(x.BandId),
    StartFreq: String(x.StartFreq ?? ''), EndFreq: String(x.EndFreq ?? ''), StartEarfcn: String(x.StartEarfcn ?? ''), EndEarfcn: String(x.EndEarfcn ?? ''),
    OperateType: String(x.OperateType ?? 'none'),
  }));
}
/**
 * الطلب نفسه اللي تبنيه صفحة LookBand (submitBand) لتقنية وحدة:
 * كل تردد متاح: مختار وموجود ← none · مو مختار وموجود ← delete · مختار ومو موجود ← insert
 */
export function bandSubmit(mode: '4G' | '5G', available: string[], current: BandRow[], want: number[]): any[] {
  const out: any[] = [];
  for (const id of available) {
    const have = current.find(r => r.NetworkMode === mode && String(r.BandId) === String(id));
    const checked = want.includes(bandNo(id));
    const base = have
      ? { IndexId: have.IndexId, NetworkMode: mode, BandId: id, StartFreq: have.StartFreq, EndFreq: have.EndFreq, StartEarfcn: have.StartEarfcn, EndEarfcn: have.EndEarfcn }
      : { IndexId: '', NetworkMode: mode, BandId: id, StartFreq: '', EndFreq: '', StartEarfcn: '', EndEarfcn: '' };
    if (checked && have) out.push({ ...base, OperateType: 'none', listHave: true, checked: true });
    else if (!checked && have) out.push({ ...base, OperateType: 'delete', listHave: true, checked: '' });
    else if (checked && !have) out.push({ ...base, OperateType: 'insert', listHave: '', checked: true });
  }
  // مقفول على تردد مو في القائمة المتاحة (نادر) ← نشيله لو مو مطلوب
  for (const r of current) {
    if (r.NetworkMode !== mode || available.some(a => String(a) === String(r.BandId))) continue;
    if (!want.includes(bandNo(r.BandId))) out.push({ ...r, OperateType: 'delete', listHave: true, checked: '' });
  }
  return out;
}

// ═══ وضع الشبكة (PreferredMode نصوص من الراوتر) ═══
export interface GpMode { code: string; label: string; value: string }
export function modesFrom(r: any): GpMode[] {
  const items: unknown[] = Array.isArray(r?.Items) ? r.Items : [];
  const used = new Set<string>();
  return items.map(v => String(v)).filter(Boolean).map(v => {
    const u = v.toUpperCase();
    const has5 = /5G|NR|SA/.test(u), has4 = /4G|LTE/.test(u), nsa = /NSA/.test(u), saOnly = /(^|[^N])SA/.test(u);
    let code = has4 && !has5 ? '03' : has5 && !has4 && saOnly && !nsa ? '08' : has5 && !has4 && nsa && !saOnly ? 'nsa' : /AUTO/.test(u) || (has4 && has5) ? '00' : 'gp:' + v;
    if (used.has(code)) code = 'gp:' + v;
    used.add(code);
    const label = code === '03' ? '4G فقط' : code === '08' ? '5G SA فقط' : code === 'nsa' ? '5G NSA فقط' : code === '00' ? 'تلقائي (' + v + ')' : v;
    return { code, label, value: v };
  });
}
export const modeOptions = (m: GpMode[]): NetworkModeOption[] => m.map(x => ({ value: x.code, label: x.label }));

export function devicesFrom(r: any): ConnectedDevice[] {
  const items: any[] = Array.isArray(r?.OnlineItems) ? r.OnlineItems : [];
  return items.filter(x => x?.MacAddress).map(x => ({ mac: String(x.MacAddress).toUpperCase(), ip: str(x.IpAddress ?? x.IPAddress), name: str(x.HostName) }));
}

export function smsFrom(r: any, box: 'inbox' | 'sent'): SmsMessage[] {
  const items: any[] = Array.isArray(r?.ItemList) ? r.ItemList : [];
  return items.filter(x => x?.SmsId !== undefined).map(x => ({
    index: (box === 'sent' ? 'o' : 'i') + String(x.SmsId), phone: String(x.number ?? ''), content: String(x.content ?? ''),
    date: [x.smsdate, x.smstime].filter(Boolean).join(' '), unread: box === 'inbox' && !(x.Readed === true || x.Readed === 1 || x.Readed === '1' || x.Readed === 'true'),
  }));
}

/** شروط صفحة الواي فاي: الاسم ١–٣٢، كلمة WPA ٨–٣٢ بدون مسافات */
export const ssidError = (n: string) => (!n || n.length > 32 ? 'اسم الشبكة لازم يكون من ١ إلى ٣٢ حرف.' : null);
export const wifiPassError = (p: string) =>
  p.length < 8 || p.length > 32 || /\s/.test(p) || /[一-龥]/.test(p) ? 'كلمة مرور الواي فاي في راوترك لازم تكون من ٨ إلى ٣٢ حرف بدون مسافات.' : null;
export const isIPv4 = (ip: string) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip);
