/**
 * هواوي — «مزايا تجريبية» (٢٨ نوفمبر). من كود صفحات Vue اللي وصلت من الأعضاء (تقارير page-higame · page-onekey) + جدول main.js:
 *   تسريع الألعاب HiGame   higameDevs = GET /api/hilink/higame  {HiGameControlEnable, DevList[]}
 *                          higameControl = POST /api/hilink/higamecontrol  {data:{HiGameControlEnable: true|false}} (JSON)
 *   التشخيص بضغطة         onekeyDiag = GET /api/monitoring/onekey_diag  {connection_status, connection_wireless_status, modemdialup_err …}
 * الرد ممكن يجي JSON أو XML حسب الموديل — نقرأ الاثنين. لسا ما انجرّبت على راوتر حقيقي.
 */
import type { LabItem } from '../types';
import { tryVariants, type LabResult } from '../labVariants';

export interface HwLabIo {
  /** GET بـ _ResponseFormat: JSON — يرجّع النص كما هو */
  get(p: string): Promise<string>;
  postJson(p: string, body: unknown): Promise<string>;
}

/** قيمة حقل من رد JSON أو XML */
export function field(text: string, key: string): string | undefined {
  const t = String(text ?? '');
  try {
    const j = JSON.parse(t);
    const walk = (x: any): any => {
      if (!x || typeof x !== 'object') return undefined;
      if (key in x) return x[key];
      for (const v of Object.values(x)) { const r = walk(v); if (r !== undefined) return r; }
      return undefined;
    };
    const v = walk(j);
    return v === undefined || v === null ? undefined : String(v);
  } catch {}
  const m = t.match(new RegExp(`<${key}>([^<]*)</${key}>`, 'i'));
  return m ? m[1].trim() : undefined;
}
/** كل الحقول البسيطة (للعرض) */
export function allFields(text: string, max = 20): { label: string; value: string }[] {
  const t = String(text ?? '');
  const out: { label: string; value: string }[] = [];
  try {
    const walk = (x: any, pre: string) => {
      if (out.length >= max || x === null || x === undefined) return;
      if (typeof x === 'object') { for (const k of Object.keys(x)) walk(x[k], k); return; }
      const v = String(x).trim();
      if (v) out.push({ label: pre, value: v.slice(0, 60) });
    };
    walk(JSON.parse(t), '');
    return out;
  } catch {}
  const re = /<([A-Za-z_][\w]*)>([^<]+)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) && out.length < max) out.push({ label: m[1], value: m[2].trim().slice(0, 60) });
  return out;
}
const isOn = (v: string | undefined) => /^(1|true)$/i.test(String(v ?? ''));
const hwErr = (t: string) => field(t, 'code') && /<error>|"error"/i.test(t) ? field(t, 'code') : undefined;

export async function hwLabs(io: HwLabIo): Promise<LabItem[]> {
  const out: LabItem[] = [];
  const [g, d] = await Promise.all([io.get('hilink/higame').catch(() => ''), io.get('monitoring/onekey_diag').catch(() => '')]);
  const en = field(g, 'HiGameControlEnable');
  if (en !== undefined && !hwErr(g)) {
    out.push({
      id: 'hw-higame', group: 'الألعاب', kind: 'toggle', cmd: 'hilink/higamecontrol', title: 'تسريع الألعاب (HiGame)',
      desc: 'ميزة هواوي: تقلل فقد الحزم والتأخير لأجهزة الألعاب على الواي فاي.', value: isOn(en) ? '1' : '0',
    });
  }
  if (d && !hwErr(d)) {
    const rows = onekeyRows(d);
    if (rows.length) out.push({ id: 'hw-onekey', group: 'التشخيص', kind: 'info', title: 'التشخيص بضغطة', desc: 'فحص راوترك نفسه للاتصال والشريحة (من صفحة «التشخيص» في هواوي).', rows });
  }
  return out;
}

/** صيغ القيمة — الصفحة ترسل true/false (JSON)، والبدائل للفيرمويرات اللي تقرأ نص */
export const HIGAME_VARIANTS = ['bool', 'str', 'num'];
export async function hwRunLab(io: HwLabIo, id: string, value?: string, prefer?: string): Promise<LabResult> {
  if (id !== 'hw-higame') throw new Error('ميزة غير معروفة: ' + id);
  const on = value === '1';
  return tryVariants(HIGAME_VARIANTS, prefer, v => higameSet(io, on, v));
}
async function higameSet(io: HwLabIo, on: boolean, variant: string): Promise<string> {
  const val = variant === 'str' ? (on ? '1' : '0') : variant === 'num' ? (on ? 1 : 0) : on;
  const r = await io.postJson('hilink/higamecontrol', { data: { HiGameControlEnable: val } });
  const code = hwErr(r);
  if (code) throw new Error(`hilink/higamecontrol: الراوتر رفض (${code}·${variant})`);
  await new Promise(res => setTimeout(res, 1500));
  const after = field(await io.get('hilink/higame'), 'HiGameControlEnable');
  if (isOn(after) !== on) throw new Error(`hilink/higamecontrol: الراوتر قبل الأمر بس القراءة بعده ${after ?? 'فاضية'}`);
  return 'تم';
}

/**
 * التشخيص بضغطة بالعربي (حسن ٢٨ نوفمبر: كانت تطلع أسماء الحقول الخام مقطوعة وأرقام بدون معنى).
 * المعاني من صفحة onekey نفسها (تقرير page-onekey): connection_status 0 واي فاي · 1 كيبل · 2 شبكة الجوال
 * (وبعدها signal_status 1 = ضعيفة · speedLimitStatus 1 = محدودة السرعة) · 3 يتصل · 4 فشل البيانات · 5 فشل الواي فاي
 * · 6 فشل الاتصال · 7 متصل والإنترنت ما يوصل · 8 فشل التسجيل. باقي الخانات: 0 = سليم، غيره = فيه مشكلة.
 */
const OK = 'سليم ✓';
const CONN: Record<string, string> = {
  '0': 'متصل عن طريق واي فاي ✓', '1': 'متصل بالكيبل ✓', '2': 'متصل بشبكة الجوال ✓', '3': 'يحاول يتصل…',
  '4': 'فشل اتصال البيانات ✗', '5': 'فشل اتصال الواي فاي ✗', '6': 'فشل الاتصال بالشبكة ✗',
  '7': 'متصل بس الإنترنت ما يوصل ✗', '8': 'ما قدر يسجّل في الشبكة ✗',
};
const ITEMS: { re: RegExp; label: string; bad: (v: string) => string }[] = [
  { re: /^signal_stat/i, label: 'الإشارة', bad: v => (v === '1' ? 'ضعيفة ✗' : `فيها مشكلة (${v})`) },
  { re: /^sim_stat/i, label: 'الشريحة', bad: v => `فيها مشكلة (${v}) — شيك عليها` },
  { re: /^dialupswitch/i, label: 'بيانات الجوال', bad: () => 'مطفية من الراوتر ✗' },
  { re: /^datalimit/i, label: 'حد الاستهلاك', bad: () => 'وصلت الحد ✗' },
  { re: /^roam/i, label: 'التجوال', bad: () => 'مطفي وأنت على شبكة تجوال ✗' },
  { re: /^staticdns/i, label: 'DNS', bad: () => 'DNS يدوي فيه مشكلة ✗' },
  { re: /^apnstatus/i, label: 'إعدادات APN', bad: v => `فيها مشكلة (${v}) ✗` },
  { re: /^modemdialup/i, label: 'الاتصال بالمشغّل', bad: v => `خطأ رقم ${v} ✗` },
  { re: /^speedlimit/i, label: 'تحديد السرعة', bad: () => 'المشغّل حادّ سرعتك ✗' },
  { re: /^connection_wireless/i, label: 'الاتصال اللاسلكي', bad: v => `حالة ${v}` },
];
export function onekeyRows(text: string): { label: string; value: string }[] {
  const raw = allFields(text, 24);
  if (!raw.length) return [];
  const out: { label: string; value: string }[] = [];
  let problems = 0;
  const cs = raw.find(r => /^connection_status$/i.test(r.label))?.value;
  if (cs !== undefined) {
    const v = CONN[cs] ?? `حالة ${cs}`;
    if (/✗/.test(v)) problems++;
    out.push({ label: 'الاتصال', value: v });
  }
  for (const r of raw) {
    if (/^connection_status$/i.test(r.label)) continue;
    const it = ITEMS.find(x => x.re.test(r.label));
    if (!it) { if (r.value !== '0') out.push({ label: r.label, value: r.value }); continue; }
    if (out.some(o => o.label === it.label)) continue;
    const okv = r.value === '0' || r.value === '';
    if (!okv) problems++;
    out.push({ label: it.label, value: okv ? OK : it.bad(r.value) });
  }
  out.unshift({ label: 'النتيجة', value: problems ? `فيه ${problems === 1 ? 'مشكلة وحدة' : problems + ' مشاكل'} — شوف تحت` : 'كل شي سليم ✓' });
  return out;
}
