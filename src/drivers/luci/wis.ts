import { Signal } from '../types';

/**
 * LuCI بثيم «superos» (WIS Networks — wisnetworks.com): صحن 5G خارجي «5G Feedhorn» (PoE 24V، 192.168.225.1، موديم Quectel).
 * من ملف FULL عضو (٧ نوفمبر ٥:٥٨ م): الصفحة الرئيسية بعد الدخول تسوي
 *   XHR.poll(3, '<root>', { status: 1 }) ← JSON فيه info.lte_info:
 *   rsrp · rsrq · sinr («255» = ما فيه) · band · arfcn · cellid («-1» = ما فيه) · phys_cellid · sys_mode · dial_ip · imei ·
 *   neighb_num + neighbour1..N = «arfcn,pci,…» (زر Lock جنب كل واحد = تثبيت البرج — ما نفتحه بدون صفحته)
 * القائمة: admin/lte/{network,apn,at_command} · admin/lte_sms · admin/network/network · admin/system/system
 * صيغة القيم نفسها ما شفناها (الملف بدون رد الحالة) ← نقرأ الرقم بس، وأي قيمة خارج المعقول تنشال.
 */
export type WisInfo = Record<string, unknown>;

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
function n(v: unknown, lo: number, hi: number): number | undefined {
  const m = s(v).match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const x = Number(m[0]);
  return Number.isFinite(x) && x >= lo && x <= hi ? x : undefined;
}
const okId = (v: unknown) => { const x = s(v); return x && x !== '-1' && x !== '-' && !/^0+$/.test(x) && !/^N\/?A$/i.test(x) ? x : undefined; };

/** صفحة الحالة الرئيسية (بعد الدخول) حق ثيم superos؟ */
export function isWisPage(html: string): boolean {
  return /luci-static\/superos\//.test(html) && /lte_show_div_update/.test(html);
}

/** 5G ولا 4G: من sys_mode («NR5G-SA» / «5G» …)، أو الرقم القناة (NR-ARFCN فوق ١٠٠ ألف)، أو «n78» في الباند */
export function wisIs5g(li: WisInfo): boolean {
  const m = s(li.sys_mode).toUpperCase();
  if (/NR|5G/.test(m)) return true;
  if (/LTE|4G|WCDMA|3G/.test(m)) return false;
  if (/^n\d+/i.test(s(li.band))) return true;
  return (n(li.arfcn, 0, 3_300_000) ?? 0) > 100_000;
}

export function wisNetwork(li: WisInfo): string | undefined {
  const m = s(li.sys_mode).toUpperCase();
  // الحقيقي (FULL ٧ نوفمبر ٦:١٤ م، RG520N-EB): sys_mode «4G/5G» · band «LTE BAND 1/NR5G BAND 78» = NSA
  if (/NSA/.test(m) || (/4G|LTE/.test(m) && /5G|NR/.test(m))) return '5G NSA';
  if (/NR|5G/.test(m) || wisIs5g(li)) return '5G SA';
  if (/LTE|4G/.test(m)) return '4G';
  if (/WCDMA|3G/.test(m)) return '3G';
  return undefined;
}

/** «LTE BAND 1/NR5G BAND 78» ← {lte: 1, nr: 78} · «78» / «n78» / «B3» لحالها */
export function wisBands(v: unknown): { lte?: number; nr?: number } {
  const t = s(v);
  const lte = t.match(/LTE\s*BAND\s*(\d{1,3})/i)?.[1] ?? t.match(/(?:^|[^n\d])B\s*(\d{1,3})\b/i)?.[1];
  const nr = t.match(/NR5?G?\s*BAND\s*(\d{1,3})/i)?.[1] ?? t.match(/\bn(\d{1,3})\b/)?.[1];
  if (lte || nr) return { lte: lte ? Number(lte) : undefined, nr: nr ? Number(nr) : undefined };
  const only = t.match(/\d{1,3}/)?.[0];
  return only ? { lte: Number(only), nr: Number(only) } : {};
}

export function wisSignal(li: WisInfo): Signal {
  const network = wisNetwork(li);
  const bb = wisBands(li.band);
  const sinrRaw = s(li.sinr);
  const sinr = sinrRaw === '255' ? undefined : n(li.sinr, -30, 50);
  // قراءة وحدة بس (rsrp/rsrq/sinr/arfcn/pci) — تنحسب للشبكة اللي قناتها (NR-ARFCN فوق ١٠٠ ألف = 5G)
  const nrMeas = network === '5G SA' || (network === '5G NSA' && (n(li.arfcn, 0, 3_300_000) ?? 0) > 100_000);
  if (nrMeas) {
    // NSA: مرساة 4G (B1) ما لها أرقام هنا — ما نعرض صف 4G فاضي، نكتفي بـ 5G اللي فيه القراءة
    return {
      network, nrBand: bb.nr ? 'n' + bb.nr : undefined, nrPci: okId(li.phys_cellid), nrArfcn: okId(li.arfcn),
      nrRsrp: n(li.rsrp, -156, -31), nrRsrq: n(li.rsrq, -43, 20), nrSinr: sinr, cellId: okId(li.cellid), nrActiveFromStatus: true,
    };
  }
  return {
    network, band: bb.lte ? 'B' + bb.lte : undefined, pci: okId(li.phys_cellid), earfcn: okId(li.arfcn), cellId: okId(li.cellid),
    rsrp: n(li.rsrp, -150, -30), rsrq: n(li.rsrq, -40, 0), sinr,
  };
}

/**
 * الأبراج المجاورة: neighbourN = «arfcn,pci,rsrp,rsrq,-,rssi» — الحقيقي: «500,283,-61,-10,-,-29».
 * القناة تحت ١٠٠ ألف = 4G.
 */
export function wisNeighbours(li: WisInfo): { arfcn?: string; pci?: string; rsrp?: number; rsrq?: number; nr: boolean }[] {
  const cnt = n(li.neighb_num, 0, 64) ?? 0;
  const out: { arfcn?: string; pci?: string; rsrp?: number; rsrq?: number; nr: boolean }[] = [];
  for (let i = 1; i <= cnt; i++) {
    const p = s(li[`neighbour${i}`]).split(',').map(x => x.trim());
    if (p.length >= 2 && (okId(p[0]) || okId(p[1]))) {
      out.push({ arfcn: okId(p[0]), pci: okId(p[1]), rsrp: n(p[2], -156, -30), rsrq: n(p[3], -43, 20), nr: (n(p[0], 0, 3_300_000) ?? 0) > 100_000 });
    }
  }
  return out;
}

// ═══════════ الكتابة (من كود صفحة admin/lte/network نفسها — FULL ٧ نوفمبر ٦:١٤ م) ═══════════
/**
 * lte_config (في رد <root>?status=1): net_band ["1"] · net_5g_band ["41","77","78"] · net_mode «Auto|5G|4G|3G» ·
 * enable «1» · net_monitor «1» · slot 1 · nat_type «0». «Any» أو فاضي = كل الترددات.
 * الترددات (lock_band_save): GET <root>/admin/lte/band_lock_action/<number=0>/<JSON 4G>/<JSON 5G> — مربعات بقيم الأرقام كنص.
 * الوضع (network_config_save): GET <root>/admin/lte/network_config_save/0/{"net_mode","enable":int,"net_monitor":int,"slot":int,"nat_type"}
 */
export type WisConfig = Record<string, unknown>;
/** المربعات في صفحته (المودم RG520N وأخواته — مو SLM828/SLM750) */
export const WIS_LTE = [1, 3, 5, 7, 8, 20, 28, 32, 38, 40, 41, 42, 43, 71];
export const WIS_NR = [1, 2, 3, 5, 7, 8, 12, 20, 25, 28, 38, 40, 41, 48, 66, 71, 77, 78, 79];
export const WIS_MODES = [
  { value: 'Auto', label: 'تلقائي' }, { value: '5G', label: '5G' }, { value: '4G', label: '4G' }, { value: '3G', label: '3G' },
];

/** قائمة الترددات المثبّتة من الإعداد — [] = تلقائي («Any» / فاضي / كل القائمة) */
export function wisLocked(v: unknown, all: number[]): number[] {
  const arr = Array.isArray(v) ? v : s(v) && s(v) !== 'Any' ? s(v).split(/[,\s]+/) : [];
  const b = [...new Set(arr.map(x => parseInt(String(x), 10)).filter(x => x > 0))].sort((x, y) => x - y);
  return b.length && !all.every(x => b.includes(x)) ? b : [];
}

/** الرابط بنفس ترميز المتصفح لمسار فيه JSON: « → %22 (الأقواس [ ] { } : , تبقى زي ما هي إلا { } ) */
const pathJson = (v: unknown) => JSON.stringify(v).replace(/"/g, '%22').replace(/\{/g, '%7B').replace(/\}/g, '%7D').replace(/ /g, '%20');

export function wisBandPath(root: string, lte: number[], nr: number[]): string {
  return `${root}/admin/lte/band_lock_action/0/${pathJson(lte.map(String))}/${pathJson(nr.map(String))}`;
}

export function wisModePath(root: string, cfg: WisConfig, mode: string): string {
  const int = (v: unknown, d: number) => { const x = parseInt(s(v), 10); return Number.isFinite(x) ? x : d; };
  const body = { net_mode: mode, enable: int(cfg.enable, 1), net_monitor: int(cfg.net_monitor, 1), slot: int(cfg.slot, 1), nat_type: s(cfg.nat_type) || '0' };
  return `${root}/admin/lte/network_config_save/0/${pathJson(body)}`;
}
