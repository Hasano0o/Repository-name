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
    const rows = allFields(d, 16);
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
