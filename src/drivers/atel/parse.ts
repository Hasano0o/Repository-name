/**
 * Asiatelco «/schd/» — سلام HomeFi Max الخارجي (JW515، 192.168.100.1). منطق صافي بدون شبكة عشان ينختبر.
 * من ملفات «مو مدعوم؟» لعضو (٢٠ نوفمبر ٢٠٢٦، جدة): index.html + /schd/html/login-admin.html + script.js.
 */
import type { Signal } from '../types';

/** «/» يحوّل لـ /schd/html/login-admin.html بعد ما يسأل /rest/1.0/WebHeader/ */
export function isSchdPage(html: string): boolean {
  return /\/rest\/1\.0\/WebHeader/i.test(html) && /\/schd\/html\//i.test(html);
}

/** رد /rest/1.0/WebHeader/ — فيه Login + SignalLevel (نتعرّف بيه لو «/» تغيّرت) */
export function isWebHeader(j: any): boolean {
  return !!j && typeof j === 'object' && 'Login' in j && ('SignalLevel' in j || 'UsimStatus' in j || 'RSRP' in j);
}

/** صفحة الدخول: SHA1(الكلمة + SecureToken) بحروف hex صغيرة (sha.min.js حق Chris Veness) */
export function schdLoginBody(user: string, shaPassword: string): string {
  return JSON.stringify({ Action: 'Invoke', Username: user, Password: shaPassword });
}

/** «UnKnown» / "" / null ← undefined · الرقم صفر مع «idle» = ما فيه قراءة */
export function num(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (!s || /unknown|n\/a|^-+$/i.test(s)) return undefined;
  const n = Number(s.replace(/\s*(dbm|db)\s*$/i, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function str(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  return !s || /^unknown$/i.test(s) || s === 'N/A' ? undefined : s;
}

/** التقنية بلغة التطبيق: «5G» / «4G» — من Technology (LTE · LTE+ · 5G · NR…) */
export function techOf(h: any): '5G' | '4G' | undefined {
  const t = String(h?.Technology ?? h?.NetworkType ?? '').toUpperCase();
  if (/5G|NR/.test(t)) return '5G';
  if (/LTE|4G/.test(t)) return '4G';
  return undefined;
}

/**
 * الإشارة من WebHeader: رقم واحد لكل قيمة (RSRP/RSRQ/SINR/RSSI) بدون ما يقول هي 4G ولا 5G.
 * • الصفحة نفسها ما تعرض الأرقام إذا كلها صفر (RSSI و RSRP = 0) — نفس القاعدة: صفر = ما فيه قراءة.
 * • قراءة وحدة ← بطاقة وحدة (أول تجربة ٢١ نوفمبر: كنا نعبّي 4G و5G بنفس الأرقام فطلعت بطاقتين متطابقة).
 *   تنحط في الخانات الأساسية (كل الشاشات تقراها)، و Technology «5G» ← nrActiveFromStatus بس.
 * • SINR = 0 بالضبط مع RSRP قوي = الراوتر ما يعبّيه (أول تجربة: RSRP -61 و SINR 0 ← «اتصالك ضعيف» غلط) — نخليه فاضي.
 */
export function signalFrom(h: any): Signal {
  const rsrp = num(h?.RSRP), rssi = num(h?.RSSI);
  const empty = (rsrp === undefined || rsrp === 0) && (rssi === undefined || rssi === 0);
  const tech = techOf(h);
  const s: Signal = { network: tech };
  if (tech === '5G') s.nrActiveFromStatus = true;
  if (empty) return s;
  const rsrq = num(h?.RSRQ), sinr = num(h?.SINR);
  if (rsrp !== undefined && rsrp !== 0) s.rsrp = rsrp;
  if (rsrq !== undefined && rsrq !== 0) s.rsrq = rsrq;
  if (sinr !== undefined && !(sinr === 0 && rsrp !== undefined && rsrp > -100)) s.sinr = sinr;
  if (rssi !== undefined && rssi !== 0) s.rssi = rssi;
  // FULL ٢١ نوفمبر: WebHeader فيه "PCI": "31" (و Technology "NR5G-NSA")
  const pci = str(h?.PCI);
  if (pci && /^\d+$/.test(pci)) s.pci = pci;
  return s;
}

/**
 * ردود REST في ملف FULL: الأسرار تنحذف قبل ما تطلع من الجوال (FULL ٢١ نوفمبر وصل فيه WiFiKey و IMEI و SessionIdentifier).
 * المفتاح كامل (مو كلمة لحالها) لأن أسماءهم ملصوقة: WiFiKey · DeviceInfoIMEI · ConnectedDeviceMacAddress.
 */
// MDN = رقم جوال الشريحة (AccountInfoMDN — AUTH ٢١ نوفمبر ١:٥١ طلع فيه رقم العضو)
const REST_SECRET = /(key|passw|psk|secret|token|session|imei|imsi|iccid|esn|meid|serial|mac|ssid|msisdn|mobilenumber|phone|ipv6|answer|mdn|accountinfomin|number)/i;
export function scrubRest(text: string): string {
  const walk = (v: any, k = ''): any => {
    if (Array.isArray(v)) return v.map(x => walk(x));
    if (v && typeof v === 'object') { const o: any = {}; for (const [kk, vv] of Object.entries(v)) o[kk] = walk(vv, kk); return o; }
    if (k && REST_SECRET.test(k) && v !== '' && v !== null && v !== undefined && typeof v !== 'boolean') return '«محذوف»';
    return v;
  };
  try { return JSON.stringify(walk(JSON.parse(text)), null, 1); }
  catch { return text.replace(/"([\w.-]{1,60})"\s*:\s*"([^"]*)"/g, (all, k, v) => (REST_SECRET.test(k) && v ? `"${k}":"«محذوف»"` : all)); }
}

/**
 * CellularServiceStatus (AUTH ٢١ نوفمبر ١:٠١ — عضو جدة، NR5G-NSA): في NSA القيم «4G / 5G» بخانة وحدة:
 *   currentPrimaryCarrierComponent "B1 / n78" · CurrentSignalStrengthInRSRP "-61 / -52" · …InRSRQ "-16 / -11" · …InSNR "3 / 24"
 *   CurrentPCI "31" · CurrentGlobalCellId "3756C0B" (hex) · currentSecondaryCarrierComponent "UnKnown" (الثانوي — ما يعرضه)
 * في 4G بس أو SA: قيمة وحدة.
 */
export function splitDual(v: unknown): string[] {
  const s = str(v);
  if (!s) return [];
  return s.split('/').map(x => x.trim()).filter(Boolean);
}

/** التردد: "B1 / n78" ← {band:B1, nrBand:n78} · "3" ← B3 (أو n3 في SA) · "n41" ← n41 */
export function bandFrom(raw: unknown, technology: unknown): { band?: string; nrBand?: string } {
  const parts = splitDual(raw);
  if (!parts.length) return {};
  const t = String(technology ?? '').toUpperCase();
  const sa = /SA\b/.test(t) && !/NSA/.test(t) && /5G|NR/.test(t);
  const out: { band?: string; nrBand?: string } = {};
  parts.forEach((p, i) => {
    const m = /(\d{1,3})/.exec(p);
    if (!m) return;
    const nr = /^\s*n(?!\/a)|\bNR\b|NR\s*BAND/i.test(p) || (parts.length > 1 ? i === 1 && !/^\s*b/i.test(p) : sa);
    if (nr) { if (!out.nrBand) out.nrBand = 'n' + m[1]; }
    else if (!out.band) out.band = 'B' + m[1];
  });
  return out;
}

/** يدمج CellularServiceStatus مع قراءة WebHeader: الخانات الناقصة + قراءة 5G (الجزء الثاني) لو NSA */
export function mergeService(s: Signal, svc: any): Signal {
  if (!svc || typeof svc !== 'object') return s;
  const tech = svc.CurrentWirelessTechnology ?? '';
  const b = bandFrom(svc.currentPrimaryCarrierComponent ?? svc.CurrentPrimaryCarrierComponent, tech);
  const out: Signal = { ...s };
  if (b.band && !out.band) out.band = b.band;
  if (b.nrBand && !out.nrBand) out.nrBand = b.nrBand;
  const cid = str(svc.CurrentGlobalCellId);
  if (cid && /^[0-9a-f]+$/i.test(cid) && !out.cellId) {
    out.cellId = cid.toUpperCase();
    const n = parseInt(cid, 16);
    if (Number.isFinite(n) && cid.length >= 5) out.enodebId = String(Math.floor(n / 256));
  }
  const pci = str(svc.CurrentPCI);
  if (pci && /^\d+$/.test(pci) && !out.pci) out.pci = pci;
  const rsrp = splitDual(svc.CurrentSignalStrengthInRSRP).map(num);
  const rsrq = splitDual(svc.CurrentSignalStrengthInRSRQ).map(num);
  const snr = splitDual(svc.CurrentSignalToNoiseLevelInSNR).map(num);
  const ok = (v?: number) => v !== undefined && v !== 0;
  // الجزء الأول = 4G (الأساسي)
  if (out.rsrp === undefined && ok(rsrp[0])) out.rsrp = rsrp[0];
  if (out.rsrq === undefined && ok(rsrq[0])) out.rsrq = rsrq[0];
  if (out.sinr === undefined && snr[0] !== undefined && out.rsrp !== undefined) out.sinr = snr[0];
  // الجزء الثاني = 5G (NSA) ← بطاقة 5G بأرقامها الحقيقية
  const dual = rsrp.length > 1 || !!b.nrBand && !!b.band;
  if (dual && ok(rsrp[1])) {
    out.nrRsrp = rsrp[1];
    if (ok(rsrq[1])) out.nrRsrq = rsrq[1];
    if (snr[1] !== undefined) out.nrSinr = snr[1];
    out.nrActiveFromStatus = true;
    out.network = '5G';
  }
  if (out.rssi === undefined) { const v = num(svc.CurrentSignalStrengthInRSSI); if (ok(v)) out.rssi = v; }
  return out;
}

/** الاستهلاك من DataUsageStatisticsGetAll (من بداية الدورة) */
export function usageFrom(j: any): { downloadBytes: number; uploadBytes: number } | null {
  const d = Number(j?.TotalBytesReceived), u = Number(j?.TotalBytesTransmitted);
  if (!Number.isFinite(d) || !Number.isFinite(u) || d < 0 || u < 0) return null;
  return { downloadBytes: d, uploadBytes: u };
}

/** متصل؟ — ConnectStatus «CONNECTED» (الصفحة تقارن بالحروف الكبيرة) */
export function connectedOf(h: any): boolean | undefined {
  const c = String(h?.ConnectStatus ?? '').toUpperCase();
  if (!c) return undefined;
  return c === 'CONNECTED';
}
