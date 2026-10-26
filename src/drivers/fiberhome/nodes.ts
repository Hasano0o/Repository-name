/**
 * FiberHome 5G CPE — منطق صافي بدون شبكة (عليه اختبارات).
 * كل شي هنا من ملفات صفحة الراوتر الحقيقية (تقرير ٢٦ أكتوبر، 192.168.8.1، STC):
 *   rfSignal.js · frequencyLockSet.js · cellLockSet.js · networkSet.js · reboot.js · login.html · polyfill.min.js
 *
 * أسماء الإعدادات (x_NetworkSettings_obj …) يرسلها الراوتر وقت التشغيل (get_xmlnode_js_file) كنص JS
 * والصفحة تسوي له eval. إحنا ما نسوي eval: نقرأ الإسنادات بس (نص، أو نص + اسم ثاني).
 */
import { Signal, CellTower } from '../types';

/** يقرأ `x_a = "…"` و `var x_a="…", x_b=x_a+"…"` و `window.x_a = …` — بدون تنفيذ أي كود */
export function parseNodeFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pending: [string, string][] = [];
  const re = /\b(x_[A-Za-z0-9_]+)\s*=\s*((?:"[^"\n]*"|'[^'\n]*'|[A-Za-z0-9_$.]+)(?:\s*\+\s*(?:"[^"\n]*"|'[^'\n]*'|[A-Za-z0-9_$.]+))*)/g;
  for (const m of text.matchAll(re)) pending.push([m[1], m[2]]);
  const evalExpr = (expr: string): string | undefined => {
    let s = '';
    for (const raw of expr.split(/\s*\+\s*/)) {
      const p = raw.trim();
      if (/^"[^"]*"$|^'[^']*'$/.test(p)) s += p.slice(1, -1);
      else if (/^\d+$/.test(p)) s += p;
      else {
        const id = p.replace(/^window\./, '');
        if (out[id] === undefined) return undefined;
        s += out[id];
      }
    }
    return s;
  };
  // نعيد لين ما يتغيّر شي (أسماء تعتمد على أسماء جت بعدها)
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const v = evalExpr(pending[i][1]);
      if (v !== undefined) { out[pending[i][0]] = v; pending.splice(i, 1); }
    }
  }
  return out;
}

/** الأسماء اللي يحتاجها الدرايفر — لو ناقص واحد نقول بالضبط وش */
export const NEED = {
  rf: ['x_RadioSignalParameter_obj', 'x_RadioSignal_WorkMode', 'x_RadioSignal_RSRP', 'x_RadioSignal_SINR', 'x_RadioSignal_BAND', 'x_RadioSignal_PCI'],
  band: ['x_NetworkSettings_obj', 'x_NetworkSet_LTELockBAND', 'x_NetworkSet_NRLockBAND', 'x_NetworkSet_LockBandEnable'],
  mode: ['x_NetworkSettings_obj', 'x_NetworkSet_NetworkMode', 'x_NetworkSet_ENDC'],
  cell: ['x_LockCellList_obj', 'x_LockCellList_LockCell', 'x_LockCellList_LockEnable', 'x_LockCellList_act', 'x_LockCellList_arfcn', 'x_LockCellList_pci'],
};
export function missing(n: Record<string, string>, keys: string[]): string[] {
  return keys.filter(k => n[k] === undefined);
}

/** طلب get_value_by_xmlnode للإشارة — نفس getRFObj في rfSignal.js (المفتاح = اسم الخانة في الرد) */
export const RF_FIELDS: Record<string, [string, string]> = {
  WorkMode: ['x_RadioSignalParameter_obj', 'x_RadioSignal_WorkMode'],
  PLMN: ['x_RadioSignalParameter_obj', 'x_RadioSignal_PLMN'],
  TAC: ['x_RadioSignalParameter_obj', 'x_RadioSignal_TAC'],
  RSRP: ['x_RadioSignalParameter_obj', 'x_RadioSignal_RSRP'],
  RSRQ: ['x_RadioSignalParameter_obj', 'x_RadioSignal_RSRQ'],
  SINR: ['x_RadioSignalParameter_obj', 'x_RadioSignal_SINR'],
  RSSI: ['x_RadioSignalParameter_obj', 'x_RadioSignal_RSSI'],
  BAND: ['x_RadioSignalParameter_obj', 'x_RadioSignal_BAND'],
  PCI: ['x_RadioSignalParameter_obj', 'x_RadioSignal_PCI'],
  ECGI: ['x_RadioSignalParameter_obj', 'x_RadioSignal_ECGI'],
  LTE_CQI: ['x_RadioSignalParameter_obj', 'x_RadioSignal_LTE_CQI'],
  LTE_Power: ['x_RadioSignalParameter_obj', 'x_RadioSignal_LTE_Power'],
  NR_BAND: ['x_RadioSignalParameter_obj', 'x_RadioSignal_NR_Band'],
  NR_PCI: ['x_RadioSignalParameter_obj', 'x_RadioSignal_NR_PCI'],
  SSB_RSRP: ['x_RadioSignalParameter_obj', 'x_RadioSignal_SSB_RSRP'],
  SSB_RSRQ: ['x_RadioSignalParameter_obj', 'x_RadioSignal_SSB_RSRQ'],
  SSB_SINR: ['x_RadioSignalParameter_obj', 'x_RadioSignal_SSB_SINR'],
  NR_CQI: ['x_RadioSignalParameter_obj', 'x_RadioSignal_NR_CQI'],
  NR_Power: ['x_RadioSignalParameter_obj', 'x_RadioSignal_NR_Power'],
  NCGI: ['x_RadioSignalParameter_obj', 'x_RadioSignal_NCGI'],
  EARFCN_NBR: ['x_RadioSignalParameter_obj', 'x_RadioSignal_EARFCN_NBR'],
  PCI_NBR: ['x_RadioSignalParameter_obj', 'x_RadioSignal_PCI_NBR'],
  RSRP_NBR: ['x_RadioSignalParameter_obj', 'x_RadioSignal_RSRP_NBR'],
  SINR_NBR: ['x_RadioSignalParameter_obj', 'x_RadioSignal_SINR_NBR'],
  BAND_NBR: ['x_RadioSignalParameter_obj', 'x_RadioSignal_BAND_NBR'],
};
/** يبني {مفتاح: مسار} — الخانات اللي اسمها ناقص من ملف الراوتر نتخطاها بدل ما نطيّح الطلب كله */
export function paths(n: Record<string, string>, fields: Record<string, [string, string]>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, [obj, f]] of Object.entries(fields)) if (n[obj] !== undefined && n[f] !== undefined) o[k] = n[obj] + n[f];
  return o;
}

const num = (v: unknown): number | undefined => {
  const s = String(v ?? '').trim();
  if (!s || s === '-' || /^n\/?a$/i.test(s)) return undefined;
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : undefined;
};
const sig = (v: unknown, lo: number, hi: number) => { const x = num(v); return x !== undefined && x >= lo && x <= hi ? x : undefined; };
const str = (v: unknown) => { const s = String(v ?? '').trim(); return s && s !== '-' ? s : undefined; };
const bandNo = (v: unknown) => { const m = String(v ?? '').match(/(\d+)/); return m ? parseInt(m[1], 10) : undefined; };
const list = (v: unknown) => String(v ?? '').split(/[,;|]/).map(x => x.trim()).filter(x => x !== '');

/** WorkMode: LTE / NSA / SA (rfSignal.js يفرّق LTE و SA صراحة) */
export function signalFrom(rf: Record<string, unknown>): Signal {
  const mode = String(rf.WorkMode ?? '').trim().toUpperCase();
  const lte = mode !== 'SA';
  const nr = mode === 'SA' || mode === 'NSA' || /ENDC|NR|5G/.test(mode);
  const s: Signal = {
    network: mode === 'SA' ? '5G SA' : nr ? '5G NSA' : mode === 'LTE' ? '4G' : mode || undefined,
  };
  if (lte) {
    const b = bandNo(rf.BAND);
    s.band = b ? 'B' + b : undefined;
    s.pci = str(rf.PCI);
    s.cellId = str(rf.ECGI);
    s.rsrp = sig(rf.RSRP, -150, -30);
    s.rsrq = sig(rf.RSRQ, -40, 0);
    s.sinr = sig(rf.SINR, -30, 50);
    s.rssi = sig(rf.RSSI, -130, -10);
    s.cqi = sig(rf.LTE_CQI, 0, 15);
    s.txPower = sig(rf.LTE_Power, -60, 40);
  }
  if (nr) {
    const b = bandNo(rf.NR_BAND);
    s.nrBand = b ? 'n' + b : undefined;
    s.nrPci = str(rf.NR_PCI);
    s.nrRsrp = sig(rf.SSB_RSRP, -150, -30);
    s.nrRsrq = sig(rf.SSB_RSRQ, -40, 0);
    s.nrSinr = sig(rf.SSB_SINR, -30, 50);
    s.nrCqi = sig(rf.NR_CQI, 0, 15);
    s.nrTxPower = sig(rf.NR_Power, -60, 40);
    s.nrActiveFromStatus = true;
    if (mode === 'SA') s.cellId = str(rf.NCGI);
  }
  return s;
}

/** الجيران: قوائم مفصولة (EARFCN_NBR, PCI_NBR …) — نربطها بالترتيب */
export function neighborsFrom(rf: Record<string, unknown>): CellTower[] {
  const e = list(rf.EARFCN_NBR), p = list(rf.PCI_NBR), r = list(rf.RSRP_NBR), q = list(rf.SINR_NBR), b = list(rf.BAND_NBR);
  const n = Math.max(e.length, p.length);
  const out: CellTower[] = [];
  for (let i = 0; i < n; i++) {
    if (!p[i] && !e[i]) continue;
    out.push({ kind: 'neighbor', tech: 'LTE', arfcn: e[i] || undefined, pci: p[i] || undefined, band: bandNo(b[i]), rsrp: sig(r[i], -150, -30), sinr: sig(q[i], -30, 50) } as CellTower);
  }
  return out;
}

/** قوائم الترددات في صفحة «تثبيت الترددات» (frequencyLockSet.js) */
export const LTE_BANDS = [1, 3, 5, 7, 8, 20, 28, 32, 38, 40, 41, 42, 43];
export const NR_BANDS = [1, 3, 5, 7, 8, 20, 28, 38, 40, 41, 77, 78];
export const parseBands = (v: unknown) => [...new Set(list(v).map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
export const joinBands = (b: number[]) => [...new Set(b)].sort((a, c) => a - c).join(',');

/**
 * وضع الشبكة (networkSet.js): 0 = 4G فقط · 1 = 4G مفضّل · 2 = 5G فقط · 3 = 5G مفضّل · 4 = 3G فقط
 * و ENDC: 1 = SA · 2 = NSA. نحوّله لأكواد التطبيق (نفس هواوي): 00 تلقائي · 03 4G فقط · 08 5G فقط
 */
export const FH_TO_CODE: Record<string, string> = { '3': '00', '1': '00', '0': '03', '2': '08' };
export const CODE_TO_FH: Record<string, string> = { '00': '3', '0803': '3', '03': '0', '08': '2' };
export const MODES = [
  { value: '00', label: 'تلقائي (5G مفضّل)' },
  { value: '03', label: '4G فقط' },
  { value: '08', label: '5G فقط' },
];

/** رد الدخول (login.html): «0|…» نجح · 1 فيه أحد داخل · 2 محاولات كثيرة · 3 الحساب موقوف · 4 كلمة غلط */
export function loginError(text: string): string | null {
  const code = String(text ?? '').split('|')[0].trim();
  if (code === '0') return null;
  return ({
    '1': 'فيه أحد داخل صفحة الراوتر من جهاز ثاني — سكّرها وجرّب بعد شوي',
    '2': 'محاولات كثيرة — انتظر دقيقة وجرّب',
    '3': 'حساب الإدارة موقوف في الراوتر — جرّب حساب ثاني',
    '4': 'اسم المستخدم أو كلمة المرور غلط',
  } as Record<string, string>)[code] ?? `الراوتر ما قبل الدخول (${code || 'بدون رد'})`;
}
