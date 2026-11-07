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
  if (/NSA/.test(m)) return '5G NSA';
  if (/NR|5G/.test(m) || wisIs5g(li)) return '5G SA';
  if (/LTE|4G/.test(m)) return '4G';
  if (/WCDMA|3G/.test(m)) return '3G';
  return undefined;
}

export function wisSignal(li: WisInfo): Signal {
  const network = wisNetwork(li);
  const b = s(li.band).match(/(\d{1,3})\s*$/)?.[1] ?? s(li.band).match(/\d{1,3}/)?.[0];
  const sinrRaw = s(li.sinr);
  const sinr = sinrRaw === '255' ? undefined : n(li.sinr, -30, 50);
  if (network === '5G SA') {
    return {
      network, nrBand: b ? 'n' + b : undefined, nrPci: okId(li.phys_cellid), nrArfcn: okId(li.arfcn),
      nrRsrp: n(li.rsrp, -156, -31), nrRsrq: n(li.rsrq, -43, 20), nrSinr: sinr, cellId: okId(li.cellid), nrActiveFromStatus: true,
    };
  }
  return {
    network, band: b ? 'B' + b : undefined, pci: okId(li.phys_cellid), earfcn: okId(li.arfcn), cellId: okId(li.cellid),
    rsrp: n(li.rsrp, -150, -30), rsrq: n(li.rsrq, -40, 0), sinr,
  };
}

/** الأبراج المجاورة: neighbourN = «arfcn,pci,…» (الباقي ما نعرف ترتيبه — ما نخمّن) */
export function wisNeighbours(li: WisInfo): { arfcn?: string; pci?: string }[] {
  const cnt = n(li.neighb_num, 0, 64) ?? 0;
  const out: { arfcn?: string; pci?: string }[] = [];
  for (let i = 1; i <= cnt; i++) {
    const p = s(li[`neighbour${i}`]).split(',').map(x => x.trim());
    if (p.length >= 2 && (okId(p[0]) || okId(p[1]))) out.push({ arfcn: okId(p[0]), pci: okId(p[1]) });
  }
  return out;
}
