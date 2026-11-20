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
const REST_SECRET = /(key|passw|psk|secret|token|session|imei|imsi|iccid|esn|meid|serial|mac|ssid|msisdn|mobilenumber|phone|ipv6|answer)/i;
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
 * التردد ورقم الخلية من CellularServiceStatus (FULL ٢١ نوفمبر — الصفحة الرئيسية في script.js):
 *   curBand = currentPrimaryCarrierComponent ← «B»+رقم أو «N»+رقم حسب التقنية · CurrentGlobalCellId (hex مثل "1A2D101").
 * في NSA الناقل الأساسي 4G (المرساة) ← B. في SA ← N. نقبل القيمة رقم أو «B3» أو «LTE BAND 3» أو «n78».
 */
export function bandFrom(raw: unknown, technology: unknown): { band?: string; nrBand?: string } {
  const r = str(raw);
  if (!r) return {};
  const m = /(\d{1,3})/.exec(r);
  if (!m) return {};
  const t = String(technology ?? '').toUpperCase();
  const nr = /^\s*n(?!\/a)|\bNR\b|NR\s*BAND/i.test(r) || (/SA\b/.test(t) && !/NSA/.test(t) && /5G|NR/.test(t));
  return nr ? { nrBand: 'n' + m[1] } : { band: 'B' + m[1] };
}

/** يدمج CellularServiceStatus مع قراءة WebHeader — بس الخانات الناقصة (WebHeader هو الأساس) */
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
  if (out.rsrp === undefined) { const v = num(svc.CurrentSignalStrengthInRSRP); if (v !== undefined && v !== 0) out.rsrp = v; }
  if (out.rssi === undefined) { const v = num(svc.CurrentSignalStrengthInRSSI); if (v !== undefined && v !== 0) out.rssi = v; }
  return out;
}

/** متصل؟ — ConnectStatus «CONNECTED» (الصفحة تقارن بالحروف الكبيرة) */
export function connectedOf(h: any): boolean | undefined {
  const c = String(h?.ConnectStatus ?? '').toUpperCase();
  if (!c) return undefined;
  return c === 'CONNECTED';
}
