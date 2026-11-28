/**
 * Green Packet — «مزايا تجريبية» (٢٨ نوفمبر). من ملفات صفحة الأعضاء (D5H 1128-0416 · mwpaa8bjo2te0h):
 *   حمل الراوتر   GET /status/statistics {CpuUsage:{Current}, MemoryUsage:{Current,Total}, Bandwidth:{Dl,Ul,DlPeak,UlPeak}} (+ /status/systemperf)
 *   Gaming Turbo  GET/POST /setting/network/game/config/gamingturbo — أسماء الحقول ما انحفظت في الملفات (صفحة الاستخدام ناقصة)،
 *                 فنقرأ الرد كما هو ونرسله نفسه مع قلب مفتاح التشغيل بس. لو ما لقينا مفتاح واضح ← قراءة بس.
 *   قراءات المهندس GET /engineermode/radio/radioparainfo — نعرض الحقول كما هي (للفني)
 * لسا ما انجرّبت — أي رد غريب يطلع باسم المسار.
 */
import type { LabItem } from '../types';

export interface GpLabIo {
  get(p: string): Promise<any>;
  post(p: string, b: unknown): Promise<any>;
}

const TURBO = '/setting/network/game/config/gamingturbo';

/** أول مفتاح تشغيل في الرد (GamingTurboEnable · Enable · Status …) — true/false أو "1"/"0" أو Enable/Disable */
export function turboKey(o: any): { key: string; on: boolean } | null {
  if (!o || typeof o !== 'object') return null;
  const keys = Object.keys(o).filter(k => /enable|switch|status|turbo/i.test(k));
  keys.sort((a, b) => Number(/enable/i.test(b)) - Number(/enable/i.test(a)));
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'boolean') return { key: k, on: v };
    if (v === 1 || v === 0) return { key: k, on: v === 1 };
    if (typeof v === 'string' && /^(1|0|true|false|enable|disable|enabled|disabled|on|off)$/i.test(v)) return { key: k, on: /^(1|true|enable|enabled|on)$/i.test(v) };
  }
  return null;
}
/** نفس نوع القيمة الأصلية */
export function flipValue(old: unknown, on: boolean): unknown {
  if (typeof old === 'boolean') return on;
  if (typeof old === 'number') return on ? 1 : 0;
  const s = String(old ?? '');
  if (/^(true|false)$/i.test(s)) return on ? 'true' : 'false';
  if (/^(enable|disable)$/i.test(s)) return on ? 'Enable' : 'Disable';
  if (/^(enabled|disabled)$/i.test(s)) return on ? 'Enabled' : 'Disabled';
  if (/^(on|off)$/i.test(s)) return on ? 'On' : 'Off';
  return on ? '1' : '0';
}
/** حقول بسيطة (نص/رقم) من رد — للعرض */
export function flatRows(o: any, max = 24): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const walk = (x: any, pre: string) => {
    if (out.length >= max || x === null || x === undefined) return;
    if (Array.isArray(x)) { x.slice(0, 4).forEach((v, i) => walk(v, `${pre}[${i}]`)); return; }
    if (typeof x === 'object') { for (const k of Object.keys(x)) walk(x[k], pre ? `${pre}.${k}` : k); return; }
    const v = String(x).trim();
    if (v !== '') out.push({ label: pre, value: v.slice(0, 60) });
  };
  walk(o, '');
  return out;
}

export async function gpLabs(io: GpLabIo): Promise<LabItem[]> {
  const out: LabItem[] = [];
  const [st, turbo, eng] = await Promise.all([
    io.get('/status/statistics').catch(() => null),
    io.get(TURBO).catch(() => null),
    io.get('/engineermode/radio/radioparainfo').catch(() => null),
  ]);
  const perf = st?.CpuUsage ? st : await io.get('/status/systemperf').catch(() => null);
  if (perf?.CpuUsage || perf?.MemoryUsage) {
    const rows: { label: string; value: string }[] = [];
    const cpu = parseInt(String(perf.CpuUsage?.Current ?? ''), 10), mem = parseInt(String(perf.MemoryUsage?.Current ?? ''), 10);
    if (!isNaN(cpu)) rows.push({ label: 'المعالج', value: cpu + '٪' });
    if (!isNaN(mem)) rows.push({ label: 'الذاكرة', value: mem + '٪' });
    const bw = perf.Bandwidth ?? st?.Bandwidth;
    if (bw?.Dl) rows.push({ label: 'تنزيل الحين', value: String(bw.Dl) });
    if (bw?.Ul) rows.push({ label: 'رفع الحين', value: String(bw.Ul) });
    out.push({ id: 'gp-load', group: 'حمل الراوتر', kind: 'info', title: 'حمل المعالج والذاكرة', desc: 'لو المعالج فوق ٩٠٪ والنت يقطع، الراوتر نفسه مضغوط مو البرج.', rows });
  }
  if (turbo && typeof turbo === 'object') {
    const k = turboKey(turbo);
    out.push(k
      ? { id: 'gp-turbo', group: 'الألعاب', kind: 'toggle', cmd: 'gamingturbo', title: 'Gaming Turbo', desc: `ميزة الألعاب في راوترك (${k.key}). أثرها على البنق ما انقاس للحين.`, value: k.on ? '1' : '0', rows: flatRows(turbo, 8) }
      : { id: 'gp-turbo-info', group: 'الألعاب', kind: 'info', title: 'Gaming Turbo', desc: 'راوترك فيه الميزة بس ما عرفنا مفتاح تشغيلها — وصلتنا الحقول ونضيفها.', rows: flatRows(turbo, 12) });
  }
  if (eng && typeof eng === 'object') {
    const rows = flatRows(eng, 30);
    if (rows.length) out.push({ id: 'gp-eng', group: 'للفني', kind: 'info', title: 'قراءات المهندس', desc: 'قراءات الراديو التفصيلية من وضع المهندس في راوترك.', rows });
  }
  return out;
}

export async function gpRunLab(io: GpLabIo, id: string, value?: string): Promise<string | void> {
  if (id !== 'gp-turbo') throw new Error('ميزة غير معروفة: ' + id);
  const cur = await io.get(TURBO);
  const k = turboKey(cur);
  if (!k) throw new Error(`gamingturbo: ما لقينا مفتاح التشغيل في الرد (${JSON.stringify(cur).slice(0, 80)})`);
  const on = value === '1';
  if (k.on === on) return 'تم';
  await io.post(TURBO, { ...cur, [k.key]: flipValue(cur[k.key], on) });
  await new Promise(r => setTimeout(r, 1500));
  const after = turboKey(await io.get(TURBO));
  if (!after || after.on !== on) throw new Error(`gamingturbo: الراوتر قبل الأمر بس القراءة بعده مختلفة (${k.key})`);
  return 'تم';
}
