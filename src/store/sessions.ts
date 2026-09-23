import { RouterDriver } from '../drivers/types';
import { driverById } from '../drivers/registry';
import { SavedRouter, getPassword } from './routers';
import { assertLanHost } from '../utils/host';

interface Sess { d: RouterDriver; authAt: number; }
const sessions = new Map<string, Sess>();
const chains = new Map<string, Promise<unknown>>();

/** بعد كذا نعيد تسجيل الدخول احتياطاً — لو المستخدم غيّر كلمة مرور الراوتر من المتصفح */
const MAX_AGE = 5 * 60 * 1000;

export async function connect(r: SavedRouter, force = false): Promise<RouterDriver> {
  const cur = sessions.get(r.id);
  if (cur && !force && Date.now() - cur.authAt < MAX_AGE) return cur.d;
  const d = cur?.d ?? driverById(r.driverId);
  if (!d) throw new Error('نوع الراوتر غير مدعوم');
  // ═══ حماية: نتحقق أن العنوان لا يزال محلياً قبل إرسال كلمة المرور.
  // يمنع هجوم تعديل AsyncStorage لإرسال كلمة المرور لخادم خارجي.
  assertLanHost(r.host);
  const pw = (await getPassword(r.id)) ?? '';
  try {
    await d.login(r.host, r.username, pw);
  } finally {
    // لا نحتفظ بكلمة المرور في متغير أطول من اللازم (نتساعد مع GC)
    // لا نقدر "نمسح" متغير نصي في JS، لكن تضييق النطاق يخفف.
  }
  sessions.set(r.id, { d, authAt: Date.now() });
  return d;
}

/** يمنع تشغيل عمليتين تعديل على نفس الراوتر بنفس الوقت (قفل تردد + دمج مثلاً) */
export function withRouterLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  chains.set(id, next.then(() => {}, () => {}));
  return next;
}

const AUTH_FAIL = /(كلمة المرور|جلسة عالقة|جلسة أخرى|محاولات كثيرة|تعذّر تسجيل الدخول|108006|108007|108001|108002)/;

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
    if (AUTH_FAIL.test(String((e as any)?.message ?? e))) throw e;
    const fresh = await connect(r, true);
    return fn(fresh);
  }
}

export function dropSession(id: string) {
  sessions.get(id)?.d.logout().catch(() => {});
  sessions.delete(id);
}
