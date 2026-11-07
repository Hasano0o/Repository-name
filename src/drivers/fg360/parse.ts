/**
 * لوحة «FG360» (5G CPE — Arcadyan AW1000 بسوفتوير OpenWrt معدّل) — قراءة ردود /cgi-bin/api.cgi.
 * ملف صافي بدون react-native — عشان الاختبارات.
 *
 * من ملفات FULL عضو (٧ نوفمبر ٧:٥٣ م): app.js الصفحة نفسها على المنفذ 8088.
 *  • كل الطلبات: POST /cgi-bin/api.cgi  JSON { action, session, ...بيانات }
 *    الرد JSON — فشل = HTTP غير 2xx أو { success:false, message } · 401 = الجلسة انتهت
 *  • status.get ← { cellular: { rat, cell_rat ("LTE"/…)، rsrp, rsrq, sinr, rssi, band, arfcn, ssb_arfcn, pci,
 *      cell_id, tac, base_station_id, operator_name, status ("connected"), sim_status, temperature, uptime,
 *      carriers:[{role,state,band,pci,arfcn,bandwidth,rsrp}], neighbors:[{rat,pci,arfcn|ssb_arfcn,rsrp,rsrq,sinr}] } }
 *  • network.get ← { network: { ready, rat, preferred1, preferred2, fiveg_mode (3 SA / 5 NSA / 7 الاثنين),
 *      supported_lte:[], lte_bands:[], supported_nr:[], nr_bands:[] } }
 *  • cell.get ← { locked } · cell.set { kind: lte|nr, arfcn, pci, persistent } · cell.clear
 *  • network.bands.set { rat, preferred1, preferred2, lte:[أرقام], nr:[أرقام] } · network.mode.set { rat }
 *
 * ⚠️ شكل القيم الفعلي (نص «-95» أو «-95 dBm»، «n78» أو «78») ما شفناه — الصفحة تعرضها كما هي.
 * عشان كذا كل قراءة هنا متسامحة، والدرايفر يسجّل أول رد خام (بدون الأرقام الخاصة) في التشخيص.
 */
import type { Signal, CellTower, Carrier, NetworkModeOption, ConnectedDevice } from '../types';

/** رقم من نص زي «-95» / «-95 dBm» / «-95.5» — undefined لو فاضي أو «-» أو «--» */
export function num(v: unknown, lo = -1e9, hi = 1e9): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
  const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
}

/** «B3» / «LTE BAND 3» / «3» / «n78» ← 3 / 78 */
export function bandNum(v: unknown): number | undefined {
  const m = String(v ?? '').match(/(\d{1,3})/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n > 0 && n < 300 ? n : undefined;
}

const id = (v: unknown): string | undefined => {
  const s = String(v ?? '').trim();
  return /^[0-9A-Fa-f]+$/.test(s) && s !== '0' ? s : undefined;
};

/** نقل الخلية الأساسية تقنيتها 5G؟ — cell_rat «NR»/«NR5G»/«5G» أو band يبدأ بـ n */
export function isNr(rat: unknown, band?: unknown): boolean {
  const r = String(rat ?? '').toUpperCase();
  if (/LTE|4G/.test(r) && !/NR|5G/.test(r)) return false;
  if (/NR|5G/.test(r)) return true;
  return /^\s*n\d/i.test(String(band ?? ''));
}

/** نوع الشبكة للعرض: «5G SA» / «5G NSA» / «4G» */
export function fgNetwork(c: any): string {
  const rat = String(c?.rat ?? '').toUpperCase();
  const nrCarrier = (c?.carriers ?? []).some((x: any) => isNr(x?.rat, x?.band));
  if (/NSA|ENDC|EN-DC/.test(rat)) return '5G NSA';
  if (/SA\b|NR5G-SA|NR-SA/.test(rat)) return '5G SA';
  if (isNr(c?.cell_rat || rat, c?.band)) return '5G SA';
  if (nrCarrier || (/LTE|4G/.test(rat) && /NR|5G/.test(rat))) return '5G NSA';
  if (/LTE|4G/.test(rat) || c?.cell_rat === 'LTE') return '4G';
  return rat || '';
}

export function fgSignal(c: any): Signal {
  if (!c || typeof c !== 'object') return {};
  const network = fgNetwork(c);
  const servNr = isNr(c.cell_rat || c.rat, c.band);
  const s: Signal = { network };
  const meas = {
    rsrp: num(c.rsrp, -160, -20), rsrq: num(c.rsrq, -40, 10), sinr: num(c.sinr, -30, 60),
  };
  if (servNr) {
    s.nrBand = bandNum(c.band) ? 'n' + bandNum(c.band) : undefined;
    s.nrPci = id(c.pci); s.nrArfcn = id(c.ssb_arfcn) ?? id(c.arfcn);
    s.nrRsrp = meas.rsrp; s.nrRsrq = meas.rsrq; s.nrSinr = meas.sinr;
    s.nrActiveFromStatus = true;
  } else {
    s.band = bandNum(c.band) ? 'B' + bandNum(c.band) : undefined;
    s.pci = id(c.pci); s.earfcn = id(c.arfcn);
    s.rsrp = meas.rsrp; s.rsrq = meas.rsrq; s.sinr = meas.sinr;
    s.rssi = num(c.rssi, -120, -10);
    // NSA: ناقل 5G من قائمة النواقل
    const nr = (c.carriers ?? []).find((x: any) => isNr(x?.rat, x?.band));
    if (nr) {
      const b = bandNum(nr.band);
      s.nrBand = b ? 'n' + b : undefined; s.nrPci = id(nr.pci); s.nrArfcn = id(nr.arfcn);
      s.nrRsrp = num(nr.rsrp, -160, -20); s.nrRsrq = num(nr.rsrq, -40, 10); s.nrSinr = num(nr.sinr, -30, 60);
      s.nrActiveFromStatus = true;
    }
  }
  s.cellId = id(c.cell_id_decimal) ?? id(c.cell_id);
  s.tac = id(c.tac);
  s.enodebId = id(c.base_station_id);
  const cc = (c.carriers ?? []).filter((x: any) => /active|activ|激活|1/i.test(String(x?.state ?? 'active')));
  if (cc.length > 1) s.caCount = cc.length;
  return s;
}

/** نواقل الدمج (PCC + SCC) */
export function fgCarriers(c: any): Carrier[] {
  return (c?.carriers ?? []).map((x: any, i: number): Carrier | null => {
    const band = bandNum(x?.band);
    if (!band) return null;
    const tech: 'LTE' | 'NR' = isNr(x?.rat, x?.band) ? 'NR' : 'LTE';
    const role: 'PCC' | 'SCC' = /P|主/.test(String(x?.role ?? '')) && !/S/.test(String(x?.role ?? '')) ? 'PCC' : (i === 0 && !x?.role ? 'PCC' : 'SCC');
    return {
      tech, band, role, arfcn: id(x?.arfcn), pci: id(x?.pci), bandwidth: num(x?.bandwidth, 1, 400),
      rsrp: num(x?.rsrp, -160, -20), rsrq: num(x?.rsrq, -40, 10), sinr: num(x?.sinr, -30, 60),
    };
  }).filter(Boolean) as Carrier[];
}

/** البرج الحالي + المجاورة */
export function fgCells(c: any): CellTower[] {
  if (!c || typeof c !== 'object') return [];
  const out: CellTower[] = [];
  const servNr = isNr(c.cell_rat || c.rat, c.band);
  const pci = id(c.pci);
  if (pci || num(c.rsrp) !== undefined) {
    out.push({
      kind: 'serving', tech: servNr ? 'NR' : 'LTE', band: bandNum(c.band), pci,
      arfcn: servNr ? (id(c.ssb_arfcn) ?? id(c.arfcn)) : id(c.arfcn), cellId: id(c.cell_id_decimal) ?? id(c.cell_id),
      rsrp: num(c.rsrp, -160, -20), rsrq: num(c.rsrq, -40, 10), sinr: num(c.sinr, -30, 60),
    });
  }
  for (const x of fgCarriers(c)) {
    if (x.role !== 'SCC') continue;
    out.push({ kind: 'secondary', tech: x.tech, band: x.band, pci: x.pci, arfcn: x.arfcn, rsrp: x.rsrp, rsrq: x.rsrq, sinr: x.sinr });
  }
  for (const n of c.neighbors ?? []) {
    const tech: 'LTE' | 'NR' = String(n?.rat || c.cell_rat || c.rat || '').toUpperCase().includes('LTE') ? 'LTE' : 'NR';
    const npci = id(n?.pci);
    if (!npci) continue;
    out.push({
      kind: 'neighbor', tech, pci: npci, arfcn: id(n?.ssb_arfcn) ?? id(n?.arfcn), band: bandNum(n?.band),
      rsrp: num(n?.rsrp, -160, -20), rsrq: num(n?.rsrq, -40, 10), sinr: num(n?.sinr, -30, 60),
    });
  }
  return out;
}

/** أوضاع الشبكة — نفس قائمة صفحتهم (select name="rat") */
export const FG_MODES: NetworkModeOption[] = [
  { value: '20', label: '5G + 4G + 3G' },
  { value: '17', label: '5G + 4G' },
  { value: '14', label: '5G بس' },
  { value: '3', label: '4G بس' },
  { value: '10', label: 'تلقائي' },
];

export const nums = (a: unknown): number[] =>
  Array.isArray(a) ? [...new Set(a.map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 300))].sort((x, y) => x - y) : [];

/** نسخة من الرد بدون الأرقام الخاصة (IMEI/ICCID/IMSI…) ولا الـ AT الخام — للتشخيص */
export function scrub(j: unknown, max = 1800): string {
  const drop = /imei|imsi|iccid|msisdn|serial|mac|password|session|phone|raw|sms|hostname/i;
  const walk = (v: any, d: number): any => {
    if (d > 4) return '…';
    if (Array.isArray(v)) return v.slice(0, 8).map(x => walk(x, d + 1));
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const [k, x] of Object.entries(v)) o[k] = drop.test(k) ? '«محذوف»' : walk(x, d + 1);
      return o;
    }
    return v;
  };
  try { return JSON.stringify(walk(j, 0)).slice(0, max); } catch { return ''; }
}

/** «host» بدون منفذ ← نضيف 8088 (لوحتهم عليه — المنفذ 80 فيه LuCI الأصلية وتعلق) */
export function fgHost(host: string): string {
  const h = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (/^\[.*\]:\d+$/.test(h) || /^[^:\[\]]+:\d+$/.test(h)) return h;
  return h + ':8088';
}

/** رمز الشبكة (MCC+MNC) ← اسمها — بعض الفيرمويرات ترجع «60601» بدل الاسم. المجهول يبقى رقم كما هو. */
const PLMN: Record<string, string> = {
  '42001': 'stc', '42003': 'موبايلي', '42004': 'زين',
  '60600': 'ليبيانا', '60601': 'المدار',
};
export function opName(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const code = s.replace(/\s+/g, '');
  if (/^\d{5,6}$/.test(code)) return PLMN[code] ? `${PLMN[code]} (${code})` : code;
  return s;
}

/**
 * الأجهزة المتصلة — من رد status.get نفسه (صفحتهم الرئيسية «在线设备»):
 *   const clients = c.clients || { total: 0, types: {} } · clients.clients = [{ hostname, ip }]
 * ما فيه MAC في ردهم ← المفتاح من الآي بي (ولا حظر — ما فيه أمر حظر في صفحتهم).
 * نتسامح وين ما كانت (أعلى الرد أو داخل cellular) لأن `c` في صفحتهم ما نعرف بالضبط أي مستوى.
 * null = الرد ما فيه قسم الأجهزة أصلاً (ما نقول «صفر» وحنا ما قرينا).
 */
export function fgClients(r: any): { total: number; list: ConnectedDevice[] } | null {
  const box = [r?.clients, r?.cellular?.clients, r?.status?.clients].find(x => x && typeof x === 'object');
  if (!box) return null;
  const arr: any[] = Array.isArray(box) ? box : Array.isArray(box.clients) ? box.clients : [];
  const seen = new Set<string>();
  const list: ConnectedDevice[] = [];
  arr.forEach((x, i) => {
    const ip = String(x?.ip ?? '').trim() || undefined;
    const name = String(x?.hostname ?? x?.name ?? '').trim() || undefined;
    const mac = String(x?.mac ?? '').trim() || `ip:${ip ?? name ?? i}`;
    if (seen.has(mac)) return;
    seen.add(mac);
    list.push({ mac, ip, name });
  });
  const total = Number(box.total);
  return { total: Number.isFinite(total) && total > list.length ? total : list.length, list };
}
