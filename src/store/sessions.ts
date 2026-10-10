import { RouterDriver } from '../drivers/types';
import { driverById } from '../drivers/registry';
import { SavedRouter, getPassword } from './routers';
import { assertLanHost } from '../utils/host';
import { getBaseline, saveBaseline } from './baseline';
import { http } from '../drivers/http';

interface Sess { d: RouterDriver; authAt: number; }
const sessions = new Map<string, Sess>();
const chains = new Map<string, Promise<unknown>>();

/** بعد كذا نعيد تسجيل الدخول احتياطاً — لو المستخدم غيّر كلمة مرور الراوتر من المتصفح */
const MAX_AGE = 5 * 60 * 1000;

const connecting = new Map<string, Promise<RouterDriver>>();

/** اتصال واحد لكل راوتر في نفس الوقت — الشاشات والمهام الخلفية تنتظر نفس تسجيل الدخول بدل ما كل وحدة تسجّل لحالها */
export function connect(r: SavedRouter, force = false): Promise<RouterDriver> {
  const busy = connecting.get(r.id);
  if (busy) return busy;
  const p = doConnect(r, force).finally(() => connecting.delete(r.id));
  connecting.set(r.id, p);
  return p;
}

async function doConnect(r: SavedRouter, force = false): Promise<RouterDriver> {
  const cur = sessions.get(r.id);
  if (cur && !force && Date.now() - cur.authAt < MAX_AGE) return cur.d;
  const d = cur?.d ?? driverById(r.driverId);
  if (!d) throw new Error('نوع الراوتر غير مدعوم');
  // ═══ حماية: نتحقق أن العنوان لا يزال محلياً قبل إرسال كلمة المرور.
  // يمنع هجوم تعديل AsyncStorage لإرسال كلمة المرور لخادم خارجي.
  assertLanHost(r.host);
  // ═══ قبل تسجيل الدخول: هل الراوتر أصلاً موجود على الشبكة؟
  // بدونها لو المستخدم على راوتر ثاني، الدخول يجرّب طرق كثيرة وكل وحدة تنتظر مهلتها — دقايق «يتصل…»
  if (r.host !== 'device' && r.host !== 'demo' && !(await reachable(r.host))) {
    throw new Error('الراوتر ما رد — تأكد إنك متصل بشبكته');
  }
  const pw = (await getPassword(r.id)) ?? '';
  try {
    await d.login(r.host, r.username, pw);
  } finally {
    // لا نحتفظ بكلمة المرور في متغير أطول من اللازم (نتساعد مع GC)
    // لا نقدر "نمسح" متغير نصي في JS، لكن تضييق النطاق يخفف.
  }
  sessions.set(r.id, { d, authAt: Date.now() });
  if (!cur) await attachBaseline(r, d);
  return d;
}

/** يعطي الدرايفر إعدادات الراوتر الأصلية — ولو ما عندنا، نحفظها الحين (لو الراوتر نظيف) */
async function attachBaseline(r: SavedRouter, d: RouterDriver) {
  if (!d.useBaseline && !d.readBaseline) return;
  const b = await getBaseline(r.id);
  d.useBaseline?.(b);
  if (b || !d.readBaseline) return;
  // ما ننتظرها — ما تأخّر فتح الشاشة
  d.readBaseline()
    .then(async nb => {
      if (!nb) return;
      await saveBaseline(r.id, nb);
      d.useBaseline?.(nb);
    })
    .catch(() => {});
}

/** يمنع تشغيل عمليتين تعديل على نفس الراوتر بنفس الوقت (قفل تردد + دمج مثلاً) */
const LOCK_MAX_MS = 6 * 60 * 1000;

export function withRouterLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  // لو عملية علقت لأي سبب، ما نخلي اللي بعدها تنتظر للأبد — بعد ٦ دقائق نفك الدور
  const cap = new Promise<void>(res => setTimeout(res, LOCK_MAX_MS));
  chains.set(id, Promise.race([next.then(() => {}, () => {}), cap]));
  return next;
}

const AUTH_FAIL = /(كلمة المرور|جلسة عالقة|جلسة أخرى|محاولات كثيرة|تعذّر تسجيل الدخول|قفل تسجيل الدخول|مستخدم ثاني|108006|108007|108001|108002)/;
const NET_FAIL = /(تعذر الاتصال بالراوتر|Network request failed|timed? ?out|timeout|aborted|AbortError|انتهت المهلة|ما رد|ECONN|ENETUNREACH)/i;

export async function withSession<T>(
  r: SavedRouter,
  fn: (d: RouterDriver) => Promise<T>,
  retry = true,
): Promise<T> {
  const d = await connect(r);
  try {
    return await fn(d);
  } catch (e) {
    if (!retry) throw e;
    const msg = String((e as any)?.message ?? e);
    if (AUTH_FAIL.test(msg)) throw e;
    // انقطاع شبكة/مهلة: إعادة تسجيل الدخول ما تفيد وتصرف محاولات على الراوتر
    if (NET_FAIL.test(msg)) throw e;
    const fresh = await connect(r, true);
    return fn(fresh);
  }
}

export function dropSession(id: string) {
  sessions.get(id)?.d.logout().catch(() => {});
  sessions.delete(id);
}

/** أي رد من الراوتر (حتى 404) يعني إنه موجود. نجرب http و https مع بعض، بمهلة قصيرة */
async function reachable(host: string): Promise<boolean> {
  const h = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const tryUrl = (u: string) => http(u, { method: 'GET' }, 5000).then(() => true);
  const urls = /^https:/i.test(host) ? [`https://${h}/`] : [`http://${h}/`, `https://${h}/`];
  return new Promise<boolean>(resolve => {
    let left = urls.length;
    for (const u of urls) {
      tryUrl(u).then(() => resolve(true), () => { if (--left === 0) resolve(false); });
    }
  });
}
