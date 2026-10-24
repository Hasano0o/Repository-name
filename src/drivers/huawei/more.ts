/**
 * ميزات هواوي إضافية (المرجع: Salamek/huawei-lte-api):
 *   device/antenna_settings  antenna_type: 0 داخلية · 1 خارجية (1+2) · 2 خارجية (1) · 3 تلقائي
 *   device/antenna_status · antenna_type · antenna_set_type  (قراءة — تختلف حسب الموديل)
 *   ussd/send → ussd/status (1 = ينتظر) → ussd/get <content>
 *   diagnosis/diagnose_ping  POST <Host><Timeout> ثم GET للنتيجة
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

/** بنق من الراوتر نفسه — يفرّق: التأخير من الواي فاي ولا من شبكة الجوال */
export async function routerPing(io: Io, host: string): Promise<RouterPingResult> {
  await io.post('diagnosis/diagnose_ping', `<Host>${esc(host)}</Host><Timeout>4000</Timeout>`);
  let raw: [string, string][] = [];
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    await sleep(2000);
    const x = await tryGet(io, 'diagnosis/diagnose_ping');
    if (!x) continue;
    raw = fieldsOf(inner(x));
    // نلقط أي حقل فيه وقت (ms) — أسماء الحقول تختلف بين الموديلات
    const timeF = raw.find(([k, v]) => /time|rtt|delay|avg/i.test(k) && /\d/.test(v) && !/timeout/i.test(k));
    const resF = raw.find(([k]) => /result|status/i.test(k));
    const ms = timeF ? parseFloat(timeF[1]) : undefined;
    if (ms !== undefined && Number.isFinite(ms)) return { ok: true, ms, raw };
    if (resF && /fail|timeout|unreach/i.test(resF[1])) return { ok: false, raw };
    if (resF && /succ|ok|^0$/i.test(resF[1])) return { ok: true, raw };
  }
  return { ok: false, raw };
}
