import { Carrier, Signal } from '../types';
import { parseHuaweiSecList } from '../../utils/normalize';

const num = (v?: string) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : undefined;
};
const bw = (v?: string) => {
  const n = parseFloat((v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const tag = (xml: string, t: string) =>
  xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1];
/** "DL:124 UL:18124" → "124" */
const dl = (v?: string) => (v ?? '').match(/DL:\s*(\d+)/i)?.[1] ?? ((v ?? '').match(/^\s*(\d+)/)?.[1]);

/**
 * حقل band في device/signal يحمل كل النواقل النشطة:
 * "15MHz@124(B1) + 10MHz@6300(B20) + 20MHz@1650(B3)" وأحياناً "+ 80MHz@...(n40)".
 * الأول هو الأساسي (PCC).
 */
export function parseBandField(band?: string): { tech: 'LTE' | 'NR'; band: number; arfcn: string; bandwidth: number }[] {
  const out: { tech: 'LTE' | 'NR'; band: number; arfcn: string; bandwidth: number }[] = [];
  for (const m of (band ?? '').matchAll(/(\d+(?:\.\d+)?)\s*MHz\s*@\s*(\d+)\s*\(\s*([Bn])(\d+)\s*\)/gi)) {
    out.push({ tech: m[3].toLowerCase() === 'n' ? 'NR' : 'LTE', band: parseInt(m[4], 10), arfcn: m[2], bandwidth: parseFloat(m[1]) });
  }
  return out;
}

/** بدون حقل band المفصّل: أرقام الترددات من "B3" أو "B1+B3" */
function lteBandsLoose(band?: string): number[] {
  return [...(band ?? '').matchAll(/\bB(\d{1,3})\b/gi)].map(m => parseInt(m[1], 10)).filter(n => n > 0);
}

/**
 * يبني قائمة النواقل النشطة — نفس اللي تعرضه صفحة "معلومات الخلية" في الراوتر:
 * الأساسي من device/signal، والإضافية من device/seccellinfo.
 * يستخدم parseHuaweiSecList من normalize لتفادي ازدواج منطق التحليل.
 */
export function carriersFrom(sigXml: string, sig: Signal, secXml = ''): Carrier[] {
  const out: Carrier[] = [];
  const lteSec = parseHuaweiSecList(tag(secXml, 'lteseccell_list'), 'LTE');
  const nrSec = parseHuaweiSecList(tag(secXml, 'nrseccell_list'), 'NR');
  const fromBand = parseBandField(sig.band);
  // ١) الأساسي
  const pcc = fromBand.find(x => x.tech === 'LTE');
  const pccBand = pcc?.band ?? lteBandsLoose(sig.band)[0];
  if (pccBand) {
    out.push({
      tech: 'LTE', band: pccBand, role: 'PCC',
      arfcn: pcc?.arfcn ?? dl(sig.earfcn),
      pci: sig.pci,
      bandwidth: pcc?.bandwidth ?? bw(sig.dlBandwidth),
      rsrp: sig.rsrp, rsrq: sig.rsrq, sinr: sig.sinr,
    });
  }
  // ٢) الإضافية 4G — بالتفاصيل من seccellinfo
  for (const r of lteSec) {
    if (!r.band) continue;
    if (out.some(x => x.tech === 'LTE' && x.arfcn === r.arfcn)) continue;
    out.push({
      tech: 'LTE', band: r.band, role: 'SCC', arfcn: r.arfcn, pci: r.pci,
      bandwidth: r.bandwidth ?? fromBand.find(x => x.arfcn === r.arfcn)?.bandwidth,
      rsrp: r.rsrp, rsrq: r.rsrq, sinr: r.sinr,
    });
  }
  // المذكورة في band وما جات في القائمة
  for (const x of fromBand.filter(x => x.tech === 'LTE')) {
    if (out.some(c => c.tech === 'LTE' && (c.arfcn === x.arfcn || (!c.arfcn && c.band === x.band)))) continue;
    out.push({ tech: 'LTE', band: x.band, role: 'SCC', arfcn: x.arfcn, bandwidth: x.bandwidth });
  }
  if (!fromBand.length) {
    for (const b of lteBandsLoose(sig.band).slice(1)) {
      if (!out.some(c => c.tech === 'LTE' && c.band === b)) out.push({ tech: 'LTE', band: b, role: 'SCC' });
    }
  }
  // ٣) 5G — من الإشارة أولاً ثم من القائمة
  const nrBandNum = parseInt(((sig.nrBand ?? '').match(/(\d+)/) ?? [])[1] ?? '', 10);
  if (Number.isFinite(nrBandNum) && (sig.nrRsrp !== undefined || sig.nrPci)) {
    out.push({
      tech: 'NR', band: nrBandNum, role: out.length ? 'SCC' : 'PCC',
      arfcn: sig.nrArfcn, pci: sig.nrPci,
      bandwidth: bw(sig.nrDlBandwidth) ?? fromBand.find(x => x.tech === 'NR')?.bandwidth,
      rsrp: sig.nrRsrp, rsrq: sig.nrRsrq, sinr: sig.nrSinr,
    });
  }
  for (const r of nrSec) {
    if (!r.band || out.some(x => x.tech === 'NR' && x.arfcn === r.arfcn)) continue;
    out.push({ tech: 'NR', band: r.band, role: 'SCC', arfcn: r.arfcn, pci: r.pci, bandwidth: r.bandwidth, rsrp: r.rsrp, rsrq: r.rsrq, sinr: r.sinr });
  }
  for (const x of fromBand.filter(x => x.tech === 'NR')) {
    if (out.some(c => c.tech === 'NR' && (c.arfcn === x.arfcn || c.band === x.band))) continue;
    out.push({ tech: 'NR', band: x.band, role: 'SCC', arfcn: x.arfcn, bandwidth: x.bandwidth });
  }
  return out;
}
