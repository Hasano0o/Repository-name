/**
 * OPPO 5G CPE — قراءة ردود الراوتر (منطق صافي بدون شبكة، عليه اختبارات).
 * أسماء الخانات من صفحة الراوتر نفسها (js/chunk-187f8bd8 الرئيسية، chunk-d8443c28 الشبكة …):
 *   NasService/GetSignal {Type:1}: "4G_RSRP" "4G_RSRQ" "4G_SINR" "5G_RSRP" … "5G_RSRPValid" … SCG (0 = بدون 5G مع 4G)
 *   NasMng/GetSignal: NetMode ("4G"/"5G"/"3G") و{"4G":{Rsrp,Rsrq,Sinr}, "5G":{…}}
 *   NasMng/GetSysInfo: SrvStatus (2 = فيه خدمة) · NetMode ("NR5G"/"4G"/"3G") · Plmn · RoamStatus
 *   NasService/GetCellInfo: NetMode · LtePhyCellId · NrPhyCellId — NasMng/GetCellInfo: PhyCellId
 *   NasMng/GetBandInfo: Band[] · CaBand[] — NasMng/GetCaInfo: Status (1 = الدمج شغال)
 *   القيم الغلط: -32768 (الصفحة تعرضها «/»)
 */
import { Signal, CellTower, NetworkModeOption, ConnectedDevice, Carrier, SmsMessage } from '../types';

const INVALID = -32768;
const num = (v: unknown, lo: number, hi: number): number | undefined => {
  if (v === null || v === undefined || v === '' || v === '/') return undefined;
  const x = Number(v);
  if (!Number.isFinite(x) || x <= -3276 || x === INVALID) return undefined;
  return x >= lo && x <= hi ? x : undefined;
};
const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s && s !== '/' && s !== '-1' && s !== 'N/A' ? s : undefined;
};

/** «B3» «LTE B3» «n78» «NR n78» «78» ← {tech, band} (الرقم لحاله = 4G إلا لو الشبكة SA) */
export function parseBandToken(t: unknown, sa = false): { tech: 'LTE' | 'NR'; band: number } | null {
  const s = String(t ?? '').trim();
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const band = parseInt(m[1], 10);
  if (/(^|[^a-z])(n|nr)\s*\d/i.test(s) || /NR|5G/i.test(s)) return { tech: 'NR', band };
  if (/(^|[^a-z])(b|lte)\s*\d/i.test(s) || /LTE|4G/i.test(s)) return { tech: 'LTE', band };
  return { tech: sa ? 'NR' : 'LTE', band };
}

export interface OppoRaw {
  sys?: any; sig?: any; nsig?: any; cell?: any; ncell?: any; band?: any; ca?: any;
}

export function signalFrom(r: OppoRaw): Signal {
  const sys = r.sys ?? {}, sig = r.sig ?? {}, ns = r.nsig ?? {};
  const nsOk = !!r.nsig && (ns.ErrorCode === undefined || ns.ErrorCode === 0);
  const scg = nsOk && Number(ns.SCG) === 1;
  const sysMode = String(sys.NetMode ?? '').toUpperCase();
  const sa = sysMode ? sysMode === 'NR5G' : String(sig.NetMode ?? '') === '5G' && !scg;
  const s: Signal = {};
  if (Number(sys.SrvStatus) === 2 || sys.SrvStatus === undefined) {
    s.network = sa ? '5G SA' : scg ? '5G NSA' : String(sys.NetMode ?? sig.NetMode ?? '') === '3G' ? '3G' : (sys.NetMode || sig.NetMode) ? '4G' : undefined;
  }
  // 4G: من NasService (الأدق) وإلا من NasMng
  if (!sa) {
    s.rsrp = (nsOk ? num(ns['4G_RSRP'], -150, -30) : undefined) ?? num(sig['4G']?.Rsrp, -150, -30);
    s.rsrq = (nsOk ? num(ns['4G_RSRQ'], -40, 0) : undefined) ?? num(sig['4G']?.Rsrq, -40, 0);
    s.sinr = (nsOk ? num(ns['4G_SINR'], -30, 50) : undefined) ?? num(sig['4G']?.Sinr, -30, 50);
    s.pci = str(r.ncell?.LtePhyCellId) ?? str(r.cell?.PhyCellId);
  }
  if (sa || scg) {
    const valid = (k: string) => !nsOk || ns[k + 'Valid'] === undefined || Number(ns[k + 'Valid']) !== 0;
    s.nrRsrp = (nsOk && valid('5G_RSRP') ? num(ns['5G_RSRP'], -156, -31) : undefined) ?? num(sig['5G']?.Rsrp, -156, -31);
    s.nrRsrq = (nsOk && valid('5G_RSRQ') ? num(ns['5G_RSRQ'], -43, 20) : undefined) ?? num(sig['5G']?.Rsrq, -43, 20);
    s.nrSinr = (nsOk && valid('5G_SINR') ? num(ns['5G_SINR'], -23, 40) : undefined) ?? num(sig['5G']?.Sinr, -23, 40);
    s.nrPci = str(r.ncell?.NrPhyCellId) ?? (sa ? str(r.cell?.PhyCellId) : undefined);
    s.nrActiveFromStatus = true;
  }
  const toks = bandTokens(r.band, sa);
  const lte = toks.find(t => t.tech === 'LTE'), nr = toks.find(t => t.tech === 'NR');
  if (lte && !sa) s.band = 'B' + lte.band;
  if (nr && (sa || scg)) s.nrBand = 'n' + nr.band;
  if (Number(r.ca?.Status) === 1 && toks.length > 1) s.caCount = toks.length;
  return s;
}

export function bandTokens(b: any, sa = false) {
  const all = [...(Array.isArray(b?.Band) ? b.Band : []), ...(Array.isArray(b?.CaBand) ? b.CaBand : [])];
  return all.map(x => parseBandToken(x, sa)).filter((x): x is { tech: 'LTE' | 'NR'; band: number } => !!x);
}

export function cellsFrom(s: Signal): CellTower[] {
  const out: CellTower[] = [];
  if (s.pci || s.rsrp !== undefined) out.push({ kind: 'serving', tech: 'LTE', pci: s.pci, band: s.band ? parseInt(s.band.slice(1), 10) : undefined, rsrp: s.rsrp, rsrq: s.rsrq, sinr: s.sinr });
  if (s.nrPci || s.nrRsrp !== undefined) out.push({ kind: s.network === '5G SA' ? 'serving' : 'secondary', tech: 'NR', pci: s.nrPci, band: s.nrBand ? parseInt(s.nrBand.slice(1), 10) : undefined, rsrp: s.nrRsrp, rsrq: s.nrRsrq, sinr: s.nrSinr });
  return out;
}

export function carriersFrom(b: any, sa = false): Carrier[] {
  const seen = { LTE: false, NR: false };
  return bandTokens(b, sa).map(t => {
    const role = seen[t.tech] ? 'SCC' as const : 'PCC' as const;
    seen[t.tech] = true;
    return { tech: t.tech, band: t.band, role };
  });
}

/** وضع الشبكة: مفاتيح القائمة (GetNetModeList) ← رموز التطبيق الموحّدة */
const KEY_CODE: Record<string, { code: string; label: string }> = {
  Auto: { code: '00', label: 'تلقائي (5G SA/NSA + 4G)' },
  AutoSA: { code: '0803', label: 'تلقائي (5G SA + 4G)' },
  Only5G: { code: 'nsa', label: '5G NSA فقط' },
  OnlySA5G: { code: '08', label: '5G SA فقط' },
  Only4G: { code: '03', label: '4G فقط' },
  Only3G: { code: '02', label: '3G فقط' },
};
export interface ModeEntry { code: string; label: string; value: unknown }
export function modesFrom(list: unknown): ModeEntry[] {
  const arr: any[] = Array.isArray((list as any)?.List) ? (list as any).List : Array.isArray(list) ? list as any[] : [];
  return arr.filter(x => x && x.Key !== undefined && x.Value !== undefined).map(x => {
    const k = KEY_CODE[String(x.Key)];
    return k ? { ...k, value: x.Value } : { code: 'oppo:' + String(x.Value), label: String(x.Key), value: x.Value };
  });
}
export const modeOptions = (m: ModeEntry[]): NetworkModeOption[] => m.map(x => ({ value: x.code, label: x.label }));
export const codeOfValue = (m: ModeEntry[], v: unknown) => m.find(x => String(x.value) === String(v))?.code ?? (v === undefined || v === null ? '' : 'oppo:' + String(v));

export function devicesFrom(r: any): ConnectedDevice[] {
  const arr: any[] = Array.isArray(r?.OnlineTerminal) ? r.OnlineTerminal : [];
  return arr.filter(x => x?.Mac).map(x => ({
    mac: String(x.Mac).toUpperCase(),
    ip: str(x.IpAddr),
    name: x.Name && x.Name !== '*' ? String(x.Name) : undefined,
  }));
}

/** TimeStamp "YYYYMMDDhhmmss" ← "YYYY-MM-DD hh:mm:ss" */
export function smsDate(t: unknown): string {
  const s = String(t ?? '');
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : s;
}
/** الرسائل من محادثة وحدة. Type 2/3/4 = مرسلة منّا (الصفحة: isMe). أول UnReadNum واردة = ما انقرت */
export function smsFrom(src: string, unread: number, list: any[], box: 'inbox' | 'sent'): SmsMessage[] {
  const mine = (t: unknown) => [2, 3, 4].includes(Number(t));
  const rows = (Array.isArray(list) ? list : []).filter(x => x && x.SmsSn !== undefined)
    .sort((a, b) => String(b.TimeStamp ?? '').localeCompare(String(a.TimeStamp ?? '')));
  let left = unread;
  const out: SmsMessage[] = [];
  for (const x of rows) {
    const me = mine(x.Type);
    const isUnread = !me && left > 0;
    if (!me && left > 0) left--;
    if ((box === 'sent') !== me) continue;
    out.push({ index: src + '|' + String(x.SmsSn), phone: src, content: String(x.Data ?? ''), date: smsDate(x.TimeStamp), unread: isUnread });
  }
  return out;
}
export function smsIndex(index: string): { src: string; sn: string } {
  const i = index.lastIndexOf('|');
  return i < 0 ? { src: '', sn: index } : { src: index.slice(0, i), sn: index.slice(i + 1) };
}

/** مدة التشغيل بالثواني ← "H:MM:SS" (مثل مركز التحكم) */
export function uptimeFrom(v: unknown): string | undefined {
  const s = Math.floor(Number(v));
  if (!Number.isFinite(s) || s <= 0) return undefined;
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** خانات إعداد شبكة واي فاي اللي ترسلها الصفحة (SetIfaceConfig / Set5gPerfConfig) */
export function ifacePayload(x: any): Record<string, unknown> {
  const o: Record<string, unknown> = {
    SSID: String(x?.SSID ?? ''), Key: String(x?.Key ?? ''), Encryption: String(x?.Encryption ?? 'none'),
    Enable: Number(x?.Enable ? 1 : 0), Hide: Number(x?.Hide ? 1 : 0),
  };
  if (o.Encryption !== 'none' && x?.EncType !== undefined) o.EncType = x.EncType;
  return o;
}
/** إعداد راديو (SetDevConfig) — نفس الخانات اللي تعرفها الصفحة */
export function radioPayload(x: any): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of ['Strength', 'Channel', 'Width', 'Mode']) if (x?.[k] !== undefined) o[k] = x[k];
  return o;
}

export const wifiPassError = (p: string) =>
  p.length < 8 || p.length > 63 || !/^[\x20-\x7e]+$/.test(p) ? 'كلمة مرور الواي فاي لازم تكون من ٨ إلى ٦٣ حرف إنجليزي أو رقم أو رمز.' : null;
export const ssidError = (n: string) => {
  const len = new TextEncoder().encode(n).length;
  return !n || len > 32 ? 'اسم الشبكة لازم يكون من ١ إلى ٣٢ حرف (العربي يحسب أكثر من حرف).' : null;
};
export const isIPv4 = (ip: string) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip);
