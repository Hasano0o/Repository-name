/**
 * Inseego MiFi (8000 / 8800L «Verizon Jetpack» · M2000) — قراءة الردود. بدون react-native عشان ينختبر.
 *
 * من ملفات صفحة ٣ أعضاء (٢٨ أكتوبر · ٣ و٦ نوفمبر، ليبيانا — 192.168.1.1):
 *  • /srv/status (بدون دخول — شريط الحالة في كل صفحة، notifications.js + $.statusBar في index.html)
 *    ← { statusData: { statusBarSignalBars, statusBarTechnology, statusBarTechnologyText, statusBarNetwork,
 *        statusBarConnectionState, statusBarRoaming, statusBarSimStatus, statusBarBatteryPercent,
 *        statusBarBatteryChargingState, statusBarWiFiClientListSize, statusBarAirplaneMode … } }
 *    ما فيه RSRP/SINR — بس عدد الأعمدة ونوع الشبكة والشركة.
 *  • /cgi/signalstat.cgi — مو من Inseego: موجود بس في الأجهزة اللي عليها تعديل «Band Manager» (band_manager.html)
 *    ← { ok, rssi, rsrp, rsrq, snr, tech, bars, oper, cell, band, batt, ca }
 *  • /login/ ← `var secToken = "…"` + `<input name="gSecureToken" value="…">` (نفس اللي يقرأه band_manager.html)
 */
import type { Signal, NetworkInfo } from '../types';

export interface InseegoStatus {
  statusBarSignalBars?: number | string;
  statusBarTechnology?: string;
  statusBarTechnologyText?: string;
  statusBarNetwork?: string;
  statusBarNetworkID?: string;
  statusBarConnectionState?: string;
  statusBarRoaming?: boolean | string;
  statusBarSimStatus?: string;
  statusBarBatteryPercent?: number | string;
  statusBarBatteryChargingState?: string | boolean;
  statusBarBatteryDetection?: boolean | string;
  statusBarWiFiClientListSize?: number | string;
  statusBarAirplaneMode?: boolean | string;
  [k: string]: unknown;
}

export interface InseegoSignalStat {
  ok?: boolean | number;
  rssi?: string | number; rsrp?: string | number; rsrq?: string | number; snr?: string | number;
  tech?: string; bars?: string | number; oper?: string; cell?: string | number; band?: string | number;
  batt?: string | number; ca?: boolean | number | string;
}

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return undefined;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && String(v).trim() !== '-' ? n : undefined;
};
const str = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s && s !== '-' && s !== '--' ? s : undefined;
};
const truthy = (v: unknown) => v === true || v === 1 || v === '1' || /^(true|yes|on)$/i.test(String(v ?? ''));

/** /srv/status ← statusData (أو الكائن نفسه لو جا بدون غلاف) */
export function statusFrom(j: any): InseegoStatus | null {
  if (!j || typeof j !== 'object') return null;
  const d = j.statusData && typeof j.statusData === 'object' ? j.statusData : j;
  return Object.keys(d).some(k => k.startsWith('statusBar')) ? d as InseegoStatus : null;
}

/** «4G LTE» / «LTE» / «LTE-A» / «5G» / «3G» ← اسم الشبكة اللي يفهمه التطبيق */
export function techName(t?: string): string | undefined {
  const s = String(t ?? '').trim();
  if (!s) return undefined;
  if (/5G|NR/i.test(s)) return '5G';
  if (/LTE|4G/i.test(s)) return /\+|LTE-?A|CA/i.test(s) ? 'LTE+' : 'LTE';
  if (/3G|UMTS|WCDMA|HSPA|EVDO|1x/i.test(s)) return '3G';
  if (/2G|GSM|EDGE|GPRS/i.test(s)) return '2G';
  return s;
}

/**
 * الإشارة: الأرقام بس من signalstat.cgi (تعديل Band Manager). بدونه ما نخترع أرقام من الأعمدة —
 * نرجع نوع الشبكة بس (وإذا 5G: nrAvailable = الأعمدة).
 */
export function signalFrom(st: InseegoStatus | null, ss: InseegoSignalStat | null): Signal {
  const sig: Signal = {};
  const tech = techName(str(ss?.tech) ?? str(st?.statusBarTechnology) ?? str(st?.statusBarTechnologyText));
  if (tech) sig.network = tech;
  if (ss && truthy(ss.ok)) {
    const rsrp = num(ss.rsrp), rsrq = num(ss.rsrq), snr = num(ss.snr), rssi = num(ss.rssi);
    // قيم خارج المدى = المودم ما قراها
    if (rsrp !== undefined && rsrp < 0 && rsrp > -160) sig.rsrp = rsrp;
    if (rsrq !== undefined && rsrq <= 0 && rsrq > -40) sig.rsrq = rsrq;
    if (snr !== undefined && snr > -30 && snr < 50) sig.sinr = snr;
    if (rssi !== undefined && rssi < 0 && rssi > -130) sig.rssi = rssi;
    const b = num(ss.band);
    if (b && b > 0 && b < 300) sig.band = String(b);
    const cell = str(ss.cell);
    if (cell && /^\d+$/.test(cell) && cell !== '0') sig.cellId = cell;
    if (truthy(ss.ca) && sig.network === 'LTE') sig.network = 'LTE+';
  }
  if (sig.network === '5G') {
    const bars = num(st?.statusBarSignalBars);
    if (bars !== undefined && bars >= 0 && bars <= 5) { sig.nrAvailable = bars; sig.nrActiveFromStatus = true; }
  }
  return sig;
}

export function networkFrom(st: InseegoStatus | null, ss: InseegoSignalStat | null, model: string): NetworkInfo {
  const cs = String(st?.statusBarConnectionState ?? '').trim();
  const op = str(ss?.oper) ?? str(st?.statusBarNetwork);
  return {
    operator: op,
    connected: /^connected$/i.test(cs) ? true : /disconnect|not ?connected|idle|searching/i.test(cs) ? false : undefined,
    mode: techName(str(ss?.tech) ?? str(st?.statusBarTechnology)),
    // M2000 = جيب 5G · 8000/8800L = 4G LTE بس
    supports5g: /M2000|M3000|5G/i.test(model) ? true : /8000|8800/i.test(model) ? false : undefined,
  };
}

/** البطارية من شريط الحالة (أو signalstat) */
export function healthFrom(st: InseegoStatus | null, ss: InseegoSignalStat | null): { battery?: number; charging?: boolean } | undefined {
  const b = num(st?.statusBarBatteryPercent) ?? num(ss?.batt);
  if (b === undefined || b < 0 || b > 100) return undefined;
  const ch = st?.statusBarBatteryChargingState;
  return { battery: b, charging: ch === undefined ? undefined : ch === true || /^(charging|true|1)$/i.test(String(ch).trim()) };
}

/** /login/ ← secToken + gSecureToken. null لو الصفحة ما فيها هالخانات (فيرموير ثاني) */
export function loginTokens(html: string): { secToken: string; gSecureToken: string } | null {
  const sec = html.match(/var\s+secToken\s*=\s*["']([^"']+)["']/)?.[1];
  // صفحة MiFi 8000 الأصلية: نفس القيمة في `gSecureToken : "…"` (بيانات $.ajax) وفي <input name="gSecureToken">
  const g = html.match(/gSecureToken\s*:\s*["']([^"']+)["']/)?.[1]
    ?? html.match(/name=["']gSecureToken["'][^>]*value=["']([^"']+)["']/i)?.[1]
    ?? html.match(/value=["']([^"']+)["'][^>]*name=["']gSecureToken["']/i)?.[1];
  return sec && g ? { secToken: sec, gSecureToken: g } : null;
}

/** اسم الموديل من <title> صفحة الجهاز («MiFi 8000» · «M2000») */
export function modelFromHtml(html: string): string | undefined {
  const t = html.match(/<title>\s*([^<]{2,40}?)\s*<\/title>/i)?.[1]?.trim();
  if (!t) return undefined;
  if (/MiFi|M[1-9]\d{3}\b|Jetpack|Inseego/i.test(t)) return t;
  return undefined;
}

/** صفحة Inseego؟ (شريط الحالة + سكربتات MiFi) — للتعرّف من الصفحة الرئيسية */
export function looksInseego(html: string): boolean {
  return /\/srv\/status|statusBarSignalBars|mifienums\.js|inseego\.com/i.test(html);
}
