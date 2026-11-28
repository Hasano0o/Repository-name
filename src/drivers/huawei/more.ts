/**
 * ميزات هواوي إضافية (المرجع: Salamek/huawei-lte-api):
 *   device/antenna_settings  antenna_type: 0 داخلية · 1 خارجية (1+2) · 2 خارجية (1) · 3 تلقائي
 *   device/antenna_status · antenna_type · antenna_set_type  (قراءة — تختلف حسب الموديل)
 *   ussd/send → ussd/status (1 = ينتظر) → ussd/get <content>
 *   diagnosis/diagnose_ping  POST <ServiceName><Host><Timeout> ثم GET للنتيجة (DiagnosticsState=Requested ← ينتظر)
 *     ServiceName من diagnosis/get-wan-service-name — مثل صفحة diagnosis-vue (تقرير page-diagnosis ٢٨ نوفمبر،
 *     كان الراوتر يرد 100006 لأننا ما نرسله)
 * أي مسار يرجع خطأ = الموديل ما يدعمه، فما نعرض الزر.
 */
import type { Io } from './apn-dns';
import type { AntennaInfo, RouterPingResult } from '../types';

const tag = (x: string, t: string) => x.match(new RegExp(`<${t}>([^<]*)</${t}>`, 'i'))?.[1];
const inner = (x: string) => x.match(/<response>([\s\S]*)<\/response>/)?.[1] ?? '';
const fieldsOf = (b: string): [string, string][] => [...b.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const tryGet = async (io: Io, p: string) => { try { const x = await io.get(p); return x.includes('<error>') ? null : x; } catch { return null; } };

export async function getAntenna(io: Io): Promise<AntennaInfo | null> {
  const set = await tryGet(io, 'device/antenna_settings');
  const st = await tryGet(io, 'device/antenna_status');
  const ty = await tryGet(io, 'device/antenna_type');
  const sty = await tryGet(io, 'device/antenna_set_type');
  if (!set && !st && !ty && !sty) return null;
  const raw: [string, string][] = [];
  for (const x of [st, ty, sty, set]) if (x) for (const f of fieldsOf(inner(x))) if (!raw.some(r => r[0] === f[0])) raw.push(f);
  const m = set ? Number(tag(set, 'antenna_type') ?? tag(set, 'antennatype')) : NaN;
  return { mode: Number.isFinite(m) && m >= 0 && m <= 3 ? m : undefined, canSet: !!set && Number.isFinite(m), raw };
}

/**
 * كيبل الأنتنا الخارجية لكل منفذ — من كود صفحة هواوي (location.js، صفحة تركيب الأنتنا الخارجية):
 * device/antenna_type ← antenna1type/antenna2type ("1" = خارجية) و antenna1insertstatus/antenna2insertstatus ("1" = موصول).
 * الصفحة تعتبر الأنتنا جاهزة لو وحدة خارجية وكل المنافذ موصولة.
 */
export async function getAntennaPlugs(io: Io): Promise<{ idx: number; plugged: boolean; external?: boolean }[] | null> {
  const ty = await tryGet(io, 'device/antenna_type');
  if (!ty) return null;
  const out: { idx: number; plugged: boolean; external?: boolean }[] = [];
  for (let i = 1; i <= 4; i++) {
    const ins = tag(ty, `antenna${i}insertstatus`);
    if (ins === undefined) continue;
    const t = tag(ty, `antenna${i}type`);
    out.push({ idx: i, plugged: ins.trim() === '1', external: t === undefined ? undefined : t.trim() === '1' });
  }
  return out.length ? out : null;
}

export async function setAntenna(io: Io, mode: number): Promise<void> {
  await io.post('device/antenna_settings', `<antenna_type>${Math.round(mode)}</antenna_type>`);
}

/** يرسل كود USSD من شريحة الراوتر ويرجع الرد (مثل رصيد الباقة) */
export async function ussd(io: Io, code: string): Promise<string> {
  const c = code.trim();
  if (!/^[*#0-9]{2,30}$/.test(c)) throw new Error('الكود لازم يكون أرقام و * و # بس');
  await io.post('ussd/send', `<content>${esc(c)}</content><codeType>CodeType</codeType><timeout></timeout>`);
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    await sleep(2000);
    const st = await tryGet(io, 'ussd/status');
    if (st && tag(st, 'result') === '1') continue; // لسا ينتظر رد الشبكة
    const g = await tryGet(io, 'ussd/get');
    const content = g ? tag(g, 'content') : undefined;
    if (content) return content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  }
  throw new Error('الشبكة ما ردّت على الكود خلال ٣٠ ثانية');
}

/** اسم الواجهة للتشخيص مثل الصفحة: الأولى «INTERNET»، وموديلات «module» أول اسم في القائمة */
export function pingServiceName(xml: string | null): string {
  const list = (xml ? tag(xml, 'service_name') ?? '' : '').split(',').map(x => x.trim()).filter(Boolean);
  if (!list.length || list.includes('INTERNET')) return 'INTERNET';
  return list[0];
}

/** نتيجة diagnose_ping بحقول الصفحة: SuccessCount · FailureCount · AverageResponseTime · Result (0 = نجح) */
export function parsePingResult(xml: string): RouterPingResult | 'wait' {
  const raw = fieldsOf(inner(xml));
  const f = (k: string) => raw.find(r => r[0] === k)?.[1];
  if (f('DiagnosticsState') === 'Requested') return 'wait';
  const avg = parseFloat(f('AverageResponseTime') ?? '');
  const okN = parseInt(f('SuccessCount') ?? '', 10);
  if (f('Result') !== undefined || f('SuccessCount') !== undefined) {
    const ok = f('Result') === '0' || okN > 0;
    return { ok, ms: ok && Number.isFinite(avg) ? avg : undefined, raw };
  }
  // موديلات أقدم بأسماء ثانية — نلقط أي وقت
  const timeF = raw.find(([k, v]) => /time|rtt|delay|avg/i.test(k) && /\d/.test(v) && !/timeout/i.test(k));
  const resF = raw.find(([k]) => /result|status/i.test(k));
  const ms = timeF ? parseFloat(timeF[1]) : undefined;
  if (ms !== undefined && Number.isFinite(ms)) return { ok: true, ms, raw };
  if (resF && /fail|timeout|unreach/i.test(resF[1])) return { ok: false, raw };
  if (resF && /succ|ok|^0$/i.test(resF[1])) return { ok: true, raw };
  return 'wait';
}

/** بنق من الراوتر نفسه — يفرّق: التأخير من الواي فاي ولا من شبكة الجوال */
export async function routerPing(io: Io, host: string): Promise<RouterPingResult> {
  const svc = pingServiceName(await tryGet(io, 'diagnosis/get-wan-service-name'));
  await io.post('diagnosis/diagnose_ping', `<ServiceName>${esc(svc)}</ServiceName><Host>${esc(host)}</Host><Timeout>4000</Timeout>`);
  let last: RouterPingResult = { ok: false, raw: [] };
  const end = Date.now() + 30_000;
  await sleep(3000);
  while (Date.now() < end) {
    const x = await tryGet(io, 'diagnosis/diagnose_ping');
    if (x) {
      const r = parsePingResult(x);
      if (r !== 'wait') return r;
      last = { ok: false, raw: fieldsOf(inner(x)) };
    }
    await sleep(3000);
  }
  return last;
}
