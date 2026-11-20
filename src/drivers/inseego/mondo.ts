/**
 * تعديل «MONDO DEBO» على Inseego MiFi 8800L (AUTH عضو ٢١ نوفمبر ٢٠٢٦ — bandlock.html + celllock.html + mondo-secure-client.js v216).
 * منطق صافي (الشبكة تنمرر من الدرايفر) عشان ينختبر في node.
 *
 * البروتوكول (mondo-secure-client.js):
 *  • كل شي POST /cgi/mapi.cgi form-urlencoded (بجلسة صفحة الـ MiFi)
 *  • الجلسة: {a:'r'} يرجّع جلسة شغالة · غيره ← رمز ٨ أرقام من شاشة الجهاز (القائمة ← MONDO ← رمز الويب، ٥ دقايق مرة وحدة) {a:'l', p:رمز}
 *    الرد المقبول: {ok, c, n, m: [٩ أسماء أوامر سرية]} · الجلسة ١٥ دقيقة من آخر استخدام
 *  • الأمر: {a:'x', x:m[IDX[اسم]], c, n, ...القيم} · الرد فيه c/n جديدة (تتبدّل كل طلب) · e='request_rejected' ← جلسة جديدة مرة وحدة
 *  • أوامر التغيير مهام: {ok, id} ← result {i:id} كل ثانية لين pending يروح
 *  • band_apply {b:"1,3"} · lock_manual {p:PCI, e:EARFCN} · lock_current · unlock · radio_mode {b:"4"|"3"|"0"}
 *    الأداة نفسها تتأكد بالقراءة، ولو فشل التغيير ترجّع الإعداد السابق («…original_selection_restored»)
 */
import type { Signal, Carrier, CellTower, CellLockState } from '../types';

export const MONDO_IDX: Record<string, number> = { status: 0, result: 1, refresh: 2, lock_current: 3, lock_manual: 4, unlock: 5, band_apply: 6, reboot: 7, radio_mode: 8 };
/** الترددات في bandlock.html (selectAllBands) */
export const MONDO_BANDS = [1, 2, 3, 4, 5, 7, 8, 12, 13, 14, 17, 18, 19, 20, 25, 26, 28, 29, 30, 38, 39, 40, 41, 42];

export interface MondoSession { c: string; n: string; m: string[] }
export type MondoPost = (form: Record<string, string>) => Promise<any>;

export const mondoForm = (o: Record<string, unknown>) =>
  Object.keys(o).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k] == null ? '' : String(o[k]))).join('&');

export function mondoAccept(r: any): MondoSession | null {
  return r && r.ok && r.c && r.n && Array.isArray(r.m) && r.m.length === 9 ? { c: String(r.c), n: String(r.n), m: r.m.map(String) } : null;
}

/** رسائل الأداة بالعربي (من bandlock.html و mondo-secure-client.js) */
const MSG: Record<string, string> = {
  Band_selection_applied_live: 'طُبقت الترددات مباشرة وتم التحقق من الاتصال',
  Band_selection_applied_waiting_network: 'طُبقت الترددات؛ بانتظار الشبكة',
  Band_selection_readback_verified: 'تم التحقق من الترددات',
  Band_commands_accepted_readback_unavailable: 'قَبِل المودم الأوامر؛ التحقق بالقراءة غير متاح',
  Band_command_rejected_readback_unavailable: 'رفض المودم أمر التثبيت',
  Band_commands_accepted_network_reconnect_failed: 'قَبِل المودم الأوامر، لكن إعادة اتصال الشبكة فشلت',
  Band_selection_readback_mismatch: 'الإعداد المقروء لا يطابق الترددات المطلوبة',
  Unlock_cell_before_excluding_its_band: 'فك تثبيت البرج قبل ما تستبعد تردده',
  Another_band_change_is_running: 'فيه عملية ثانية شغالة على الجهاز — انتظر شوي',
  Band_reconnect_failed_original_selection_restored: 'تعذر تجديد الاتصال؛ رجعت الترددات السابقة',
  Band_change_failed_original_selection_restored: 'الجهاز ما قبل التغيير؛ رجعت الترددات السابقة',
  Band_readback_failed_original_selection_restored: 'ما تأكد الإعداد الجديد؛ رجعت الترددات السابقة',
  Unlock_cell_before_changing_network_mode: 'فك تثبيت البرج أول ثم غيّر نوع الشبكة',
  Network_change_failed_previous_mode_restored: 'الجهاز ما قبل التغيير؛ رجع وضع الشبكة السابق',
  Another_radio_operation_is_running: 'فيه عملية ثانية شغالة على الجهاز — انتظر شوي',
  Cell_recovery_pending: 'الجهاز يرجّع الاتصال — انتظر شوي',
};
export function mondoMessage(r: any): string {
  const m = String(r?.message ?? '');
  if (MSG[m]) return MSG[m];
  if (r?.ok) return 'تم';
  return m || String(r?.e ?? r?.error ?? 'ما وصلت نتيجة من الجهاز');
}
/** فشل مع «restored» = الجهاز رجّع الإعداد السابق لحاله */
export const mondoRestored = (r: any) => /restored/i.test(String(r?.message ?? '')) || r?.restored === true || r?.restored === '1';

export class MondoClient {
  private s: MondoSession | null;
  constructor(private post: MondoPost, session: MondoSession | null = null, private onSession?: (s: MondoSession | null) => void) {
    this.s = session;
  }
  get paired() { return !!this.s; }
  private set(s: MondoSession | null) { this.s = s; this.onSession?.(s); }

  /** يرجّع جلسة شغالة بدون رمز ({a:'r'}) — false = يحتاج رمز من الشاشة */
  async resume(): Promise<boolean> {
    const r = await this.post({ a: 'r' });
    const s = mondoAccept(r);
    if (s) { this.set(s); return true; }
    return false;
  }

  async pair(code: string): Promise<void> {
    // صفحة v216 تطلب ٨ أرقام، بس جهاز عضو (٢١ نوفمبر) طلّع رمز ٦ خانات — نرسل اللي كتبه كما هو والجهاز يحكم
    const p = String(code ?? '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9]{4,12}$/.test(p)) throw new Error('اكتب الرمز اللي على شاشة الجهاز كما هو (القائمة ← MONDO ← رمز الويب)');
    const r = await this.post({ a: 'l', p });
    const s = mondoAccept(r);
    if (!s) throw new Error(r?.e === 'pair_expired'
      ? 'الرمز انتهى أو خلصت المحاولات — طلّع رمز جديد من شاشة الجهاز'
      : 'الرمز غلط أو انتهى — تأكد من شاشة الجهاز وجرّب رمز جديد');
    this.set(s);
  }

  /** أمر واحد — بدون جلسة: نحاول {a:'r'}، وإذا ما نفع نرمي «يحتاج رمز» */
  async call(name: string, data: Record<string, unknown> = {}, retry = true): Promise<any> {
    if (!this.s && !(await this.resume())) throw mondoNeedsCode();
    const ix = MONDO_IDX[name];
    const x = ix === undefined ? undefined : this.s!.m[ix];
    if (!x) throw new Error('أمر MONDO غير معروف: ' + name);
    const r = await this.post({ a: 'x', x, c: this.s!.c, n: this.s!.n, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) });
    if (r && r.c && r.n && this.s) this.set({ ...this.s, c: String(r.c), n: String(r.n) });
    if (!r?.ok && r?.e === 'request_rejected' && retry) {
      this.set(null);
      if (!(await this.resume())) throw mondoNeedsCode();
      return this.call(name, data, false);
    }
    return r ?? { ok: false, e: 'bad_response' };
  }

  /** مهمة تغيير: بدء ← result كل ثانية لين تخلص (حد maxSecs) */
  async job(name: string, data: Record<string, unknown>, maxSecs = 120, sleep = (ms: number) => new Promise(res => setTimeout(res, ms))): Promise<any> {
    const q = await this.call(name, data);
    if (!q?.ok || !q?.id) return q;
    for (let i = 0; i < maxSecs; i++) {
      await sleep(1000);
      const r = await this.call('result', { i: q.id });
      if (!r?.pending) return r;
    }
    return { ok: false, e: 'timeout', message: '' };
  }
}

export function mondoNeedsCode(): Error {
  const e = new Error('أدوات MONDO تحتاج رمز من شاشة الجهاز — اكتبه في صفحة الراوتر (خانة «رمز MONDO»)');
  (e as any).mondoCode = true;
  return e;
}
export const isMondoCodeError = (e: unknown) => !!(e as any)?.mondoCode;

const n = (v: unknown): number | undefined => {
  const s = String(v ?? '').trim().replace(/\s*(dbm|db)$/i, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return Number(s);
};
const pciOf = (v: unknown): string | undefined => { const s = String(v ?? '').trim(); return /^\d+$/.test(s) ? s : undefined; };
const sv = (v: unknown): string | undefined => { const s = String(v ?? '').trim(); return s && s !== '-' && s !== '0' ? s : undefined; };
/** عرض النطاق: بالميجا، أو بعدد الـ RB (6/15/25/50/75/100) */
export function mondoBw(v: unknown): number | undefined {
  const x = n(v);
  if (x === undefined || x <= 0) return undefined;
  const rb: Record<number, number> = { 6: 1.4, 15: 3, 25: 5, 50: 10, 75: 15, 100: 20 };
  if (x > 20 && rb[x]) return rb[x];
  return x <= 20 ? x : undefined;
}

/** الثانويات المفعّلة من ca_detail */
function activeScells(st: any): any[] {
  const c = st?.ca_detail ?? {};
  if (st?.current?.ca !== 'yes' || c.qmi_ok !== '1') return [];
  return (Array.isArray(c.scells) ? c.scells : []).filter((x: any) => x && !/deactiv|inactiv|^off$/i.test(String(x.state ?? "")) && n(x.band));
}

/** النواقل (الأساسي + الثانوي) — نفس renderCa في celllock.html */
export function mondoCarriers(st: any): Carrier[] {
  const cur = st?.current ?? {};
  const p = st?.ca_detail?.pcell ?? {};
  const band = n(p.band ?? cur.band);
  if (!band) return [];
  const out: Carrier[] = [{
    tech: 'LTE', band, role: 'PCC', arfcn: sv(p.earfcn ?? cur.earfcn), pci: pciOf(p.pci ?? cur.pci),
    bandwidth: mondoBw(p.bandwidth), rsrp: n(cur.rsrp), rsrq: n(cur.rsrq), sinr: n(cur.snr),
  }];
  for (const x of activeScells(st)) out.push({ tech: 'LTE', band: n(x.band)!, role: 'SCC', arfcn: sv(x.earfcn), pci: pciOf(x.pci), bandwidth: mondoBw(x.bandwidth), rsrp: n(x.rsrp), rsrq: n(x.rsrq), sinr: n(x.snr ?? x.sinr) });
  return out;
}

/** الإشارة من status — التردد «B3+B1» لو فيه دمج */
export function mondoSignal(st: any): Signal {
  const cur = st?.current ?? {};
  const s: Signal = {};
  const rsrp = n(cur.rsrp), rsrq = n(cur.rsrq), sinr = n(cur.snr ?? cur.sinr);
  if (rsrp !== undefined && rsrp < 0) s.rsrp = rsrp;
  if (rsrq !== undefined && rsrq < 0) s.rsrq = rsrq;
  if (sinr !== undefined && s.rsrp !== undefined) s.sinr = sinr;
  const car = mondoCarriers(st);
  if (car.length) {
    s.band = car.map(c => 'B' + c.band).join('+');
    if (car.length > 1) {
      s.caCount = car.length;
      const bw = car.reduce((a, c) => a + (c.bandwidth ?? 0), 0);
      if (bw > 0) s.caBandwidthMhz = bw;
    }
  }
  const pci = String(cur.pci ?? '').trim();
  if (/^\d+$/.test(pci)) s.pci = pci;
  const e = sv(cur.earfcn); if (e) s.earfcn = e;
  const cell = sv(cur.cell); if (cell) s.cellId = cell;
  if (s.rsrp !== undefined || s.band) s.network = '4G';
  return s;
}

/** الأبراج: المتصل + الثانويات + المجاورة (cells من البحث) */
export function mondoCells(st: any): CellTower[] {
  const out: CellTower[] = mondoCarriers(st).map(c => ({
    kind: c.role === 'PCC' ? 'serving' : 'secondary', tech: 'LTE', band: c.band, arfcn: c.arfcn, pci: c.pci, rsrp: c.rsrp, rsrq: c.rsrq, sinr: c.sinr,
  } as CellTower));
  const seen = new Set(out.map(c => `${c.pci}/${c.arfcn}`));
  for (const x of Array.isArray(st?.cells) ? st.cells : []) {
    const key = `${pciOf(x?.pci)}/${sv(x?.earfcn)}`;
    if (!x || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'neighbor', tech: 'LTE', band: n(x.band), arfcn: sv(x.earfcn), pci: pciOf(x.pci), rsrp: n(x.rsrp), rsrq: n(x.rsrq), rssi: n(x.rssi) });
  }
  return out;
}

/** البرج المثبّت (lock.pci / lock.earfcn) — null = مو مثبّت */
export function mondoLock(st: any): CellLockState | null {
  const l = st?.lock ?? {};
  const pci = String(l.pci ?? '').trim(), e = String(l.earfcn ?? '').trim();
  if (!/^\d+$/.test(pci) || !/^\d+$/.test(e)) return null;
  if (/unlock|none|off/i.test(String(l.dual_state ?? l.state ?? ''))) return null;
  return { pci, arfcn: e, tech: 'LTE', band: undefined };
}

export const MONDO_MODES = [
  { value: '0', label: 'تلقائي 3G / 4G' },
  { value: '4', label: '4G فقط' },
  { value: '3', label: '3G فقط' },
];
