import { RouterDriver } from '../drivers/types';
import { driverById } from '../drivers/registry';
import { SavedRouter, getPassword } from './routers';

const sessions = new Map<string, RouterDriver>();

export async function connect(r: SavedRouter, force = false): Promise<RouterDriver> {
  const existing = sessions.get(r.id);
  if (existing && !force) return existing;
  const d = driverById(r.driverId);
  if (!d) throw new Error('نوع الراوتر غير مدعوم');
  const pw = (await getPassword(r.id)) ?? '';
  await d.login(r.host, r.username, pw);
  sessions.set(r.id, d);
  return d;
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
  sessions.get(id)?.logout().catch(() => {});
  sessions.delete(id);
}
