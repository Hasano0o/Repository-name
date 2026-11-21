/**
 * ZLT / SIMCom «war» (X10 · X21 · X28 Pro · VN007+ — وغالباً X300A) — منطق صافي بدون شبكة عشان ينختبر.
 * من ملفات «مو مدعوم؟» للأعضاء (٣١ أكتوبر – ٨ نوفمبر ٢٠٢٦): index.html + js/main.js + js/login.js + js/info/sysInfo.js.
 * كل الأوامر POST JSON على /cgi-bin/http.cgi: { cmd, method:"GET"|"POST", language, sessionId, … }.
 */
import type { Signal, CellTower } from '../types';
import { bandOfArfcn } from '../../utils/arfcn';

export const ZLT_CGI = '/cgi-bin/http.cgi';
/** أرقام الأوامر من RequestCmd في main.js */
export const ZCMD = { DEVICE_VERSION_INFO: 43, LOGIN: 100, SYS_INFO_NETWORK: 205, GET_NEXT_LOGIN_TIME: 232 } as const;

/** «/» حقهم: تعليق المحرر «@FilePath … war\index.html» (X21: simcom_war) — ما نرسل POST لأي راوتر قبل ما نشوفه */
export function isZltPage(html: string): boolean {
  return /simcom_war/i.test(html) || (/@FilePath/i.test(html) && /\\war\\index\.html/i.test(html));
}

/** الرد أحياناً قبله نص — مثل SysUtil.parseJSON: من أول «{» */
export function parseZlt(text: string): any {
  const i = text.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i)); } catch { return null; }
}

/** «NO_AUTH» = الجلسة راحت */
export function isNoAuth(text: string, j: any): boolean {
  return /NO_AUTH/.test(text) || j?.message === 'NO_AUTH';
}

/** جسم الطلب مثل Page.postJSON */
export function zltBody(cmd: number, method: 'GET' | 'POST', sessionId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ cmd, method, language: 'EN', sessionId, ...extra });
}

/** "" · "NULL" · "-" ← undefined · "-95dBm" ← -95 */
export function num(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (!s || /^(null|n\/a|-+|unknown)$/i.test(s)) return undefined;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}
export function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return !s || /^(null|-+)$/i.test(s) ? undefined : s;
}

/** «B3» / «LTE BAND 3» / «3» ← "3" · «n78» ← "78" */
export function bandNum(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = s.match(/(\d{1,3})(?!.*\d)/);
  return m ? m[1] : undefined;
}

/** «372+372+372» / «647424+640704+501390» — الدمج يجي بخانة وحدة مفصولة بـ + (X300A du، ٢٢ نوفمبر). الأول = الأساسي */
export function parts(v: unknown): string[] {
  const t = str(v);
  return t ? t.split(/\s*\+\s*/).map(x => x.trim()).filter(x => x && !/^(null|-+)$/i.test(x)) : [];
}
const first = (v: unknown) => parts(v)[0];

/** رد SYS_INFO_NETWORK (205) ← قراءة الإشارة (نفس الحقول اللي تعرضها sysInfo.js) */
export function signalFrom(s0: any): Signal {
  if (!s0 || typeof s0 !== 'object') return {};
  // كل خانة فيها «+» نوخذ أولها (الأساسي) — الثانويات في caCellsFrom
  const s: any = {};
  for (const [k, v] of Object.entries(s0)) s[k] = typeof v === 'string' && v.includes('+') && !/^\+?\d+$/.test(v) ? (first(v) ?? '') : v;
  const out: Signal = {
    network: str(s.network_type_str),
    band: bandNum(s.currentband),
    pci: str(s.PCI),
    cellId: str(s.CELL_ID),
    earfcn: str(s.FREQ),
    enodebId: str(s.ENODEBID),
    dlBandwidth: str(s.bandwidth),
    rsrp: num(s.RSRP), rsrq: num(s.RSRQ), sinr: num(s.SINR), rssi: num(s.RSSI),
    cqi: num(s.CQI), dlMcs: num(s.dl_mcs),
  };
  const nrRsrp = num(s.RSRP_5G);
  if (nrRsrp !== undefined && nrRsrp < 0) {
    out.nrRsrp = nrRsrp;
    out.nrRsrq = num(s.RSRQ_5G);
    out.nrSinr = num(s.SINR_5G);
    out.nrBand = bandNum(s.currentband_5g);
    out.nrPci = str(s.PCI_5G);
    out.nrArfcn = str(s.FREQ_5G);
    out.nrDlBandwidth = str(s.bandwidth_5g);
    out.nrCqi = num(s.CQI_5G);
    out.nrDlMcs = num(s.dl_mcs_5g);
  }
  const n4 = Math.max(parts(s0.PCI).length, parts(s0.FREQ).length);
  const n5 = Math.max(parts(s0.PCI_5G).length, parts(s0.FREQ_5G).length);
  const cc = (out.rsrp !== undefined && out.rsrp < 0 ? Math.max(n4, 1) : 0) + (out.nrRsrp !== undefined ? Math.max(n5, 1) : 0);
  if (cc > 1) out.caCount = cc;
  // 4G صفر/فاضي (5G SA) ← ما نعبّي بطاقة 4G بأرقام غلط
  if (out.rsrp !== undefined && out.rsrp >= 0) { out.rsrp = undefined; out.rsrq = undefined; out.sinr = undefined; }
  return out;
}

/** رسالة الدخول الفاشل: login_times = المحاولات الباقية (الصفحة تقفل ١٨٠ ث لما تخلص) */
export function loginFailMsg(times: unknown): string {
  const n = Number(times);
  if (Number.isFinite(n) && n < 1) return 'الراوتر قفل الدخول بعد محاولات غلط — انتظر ٣ دقايق وجرّب مرة وحدة.';
  const left = Number.isFinite(n) ? ` (باقي ${n} محاولات قبل ما ينقفل)` : '';
  return `اسم المستخدم أو الكلمة غلط${left}. الافتراضي غالباً admin / admin — أو اللي على ملصق الجهاز.`;
}

/** الأبراج: الأساسي + ثانويات الدمج (PCI/FREQ مفصولة بـ +، والتردد من رقم القناة) */
export function caCellsFrom(s0: any, sig: Signal): CellTower[] {
  const out: CellTower[] = [];
  const add = (tech: 'LTE' | 'NR', pcis: string[], arfcns: string[], rsrp?: number, rsrq?: number, sinr?: number, band?: string) => {
    const n = Math.max(pcis.length, arfcns.length, rsrp !== undefined ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = arfcns[i];
      const b = a ? bandOfArfcn(tech, Number(a)) : undefined;
      out.push({
        kind: i === 0 ? 'serving' : 'secondary', tech, pci: pcis[i], arfcn: a,
        band: i === 0 && band ? Number(band) : b,
        ...(i === 0 ? { rsrp, rsrq, sinr, cellId: tech === 'LTE' ? sig.cellId : undefined } : {}),
      });
    }
  };
  if (sig.rsrp !== undefined) add('LTE', parts(s0?.PCI), parts(s0?.FREQ), sig.rsrp, sig.rsrq, sig.sinr, sig.band);
  if (sig.nrRsrp !== undefined) add('NR', parts(s0?.PCI_5G), parts(s0?.FREQ_5G), sig.nrRsrp, sig.nrRsrq, sig.nrSinr, sig.nrBand);
  return out;
}
