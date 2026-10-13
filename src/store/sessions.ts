import { RouterDriver } from '../drivers/types';
import { driverById } from '../drivers/registry';
import { SavedRouter, getPassword } from './routers';
import { assertLanHost } from '../utils/host';
import { getBaseline, saveBaseline } from './baseline';
import { http } from '../drivers/http';
import { diag } from '../services/diag';

interface Sess { d: RouterDriver; authAt: number; }
const sessions = new Map<string, Sess>();
const chains = new Map<string, Promise<unknown>>();

/** بعد كذا نعيد تسجيل الدخول احتياطاً — لو المستخدم غيّر كلمة مرور الراوتر من المتصفح */
const MAX_AGE = 5 * 60 * 1000;

const connecting = new Map<string, Promise<RouterDriver>>();

/**
 * مفتاح الجلسة = نوع الراوتر + عنوانه (مو رقم الراوتر في التطبيق).
 * لو المستخدم أضاف نفس الراوتر مرتين، كانت كل نسخة تسجّل دخول لحالها وتطرد الثانية
 * (الراوتر يقبل جلسة وحدة) — فيطلع «الراوتر يطلّع التطبيق كل ما يدخل» بدون أي جهاز ثاني.
 */
const keyOf = (r: SavedRouter) =>
  `${r.driverId}@${r.host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
const idKey = new Map<string, string>();

/** اتصال واحد لكل راوتر في نفس الوقت — الشاشات والمهام الخلفية تنتظر نفس تسجيل الدخول بدل ما كل وحدة تسجّل لحالها */
export function connect(r: SavedRouter, force = false): Promise<RouterDriver> {
  const k = keyOf(r);
  idKey.set(r.id, k);
  const busy = connecting.get(k);
  if (busy) return busy;
  const p = doConnect(r, force).finally(() => connecting.delete(k));
  connecting.set(k, p);
  return p;
}

async function doConnect(r: SavedRouter, force = false): Promise<RouterDriver> {
  const k = keyOf(r);
  const cur = sessions.get(k);
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
  diag(`[login] ${r.driverId}${force ? ' (force)' : ''}`);
  try {
    await d.login(r.host, r.username, pw);
  } finally {
    // لا نحتفظ بكلمة المرور في متغير أطول من اللازم (نتساعد مع GC)
    // لا نقدر "نمسح" متغير نصي في JS، لكن تضييق النطاق يخفف.
  }
  sessions.set(k, { d, authAt: Date.now() });
  // الإحصائيات: دخول حقيقي لراوتر (مو التجريبي ولا الجوال نفسه)
  if (r.host !== 'demo' && r.host !== 'device' && d.name !== 'راوتر تجريبي') {
    import('../services/stats').then(m => m.markLogin(d.name || r.driverId)).catch(() => {});
  }
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
const SESSION_GONE = /(ما عندك صلاحية|انتهت الجلسة|رمز الجلسة غير صالح|\b100003\b|\b125002\b|\b125003\b)/;
const NET_FAIL = /(تعذر الاتصال بالراوتر|Network request failed|timed? ?out|timeout|aborted|AbortError|انتهت المهلة|ما رد|ECONN|ENETUNREACH)/i;

/** الراوتر يطلّعنا كل ما دخلنا — غالباً جهاز ثاني ماسك الجلسة (الراوتر يقبل جلسة وحدة) */
const KICKED_MSG = 'الراوتر يطلّع التطبيق كل ما يدخل — غالباً تطبيق «HUAWEI AI Life» أو صفحة الراوتر مفتوحة في جوال أو كمبيوتر ثاني. سكّرها وجرّب مرة ثانية.';
const kickedAt = new Map<string, number>();
/** رد مختصر للتشخيص: كود الخطأ أو أول الكلام */
const short = (m: string) => (m.match(/\b(1\d{5})\b/)?.[1] ?? m.replace(/\s+/g, ' ').slice(0, 28));

export async function withSession<T>(
  r: SavedRouter,
  fn: (d: RouterDriver) => Promise<T>,
  retry = true,
): Promise<T> {
  const d = await connect(r);
  try {
    return await fn(d);
  } catch (e) {
    const msg = String((e as any)?.message ?? e);
    diag(`[session] error: ${short(msg)}`);
    // الراوتر طلّعنا (انتهت الجلسة / دخل أحد من المتصفح / بعد تغيير الإعدادات) —
    // ندخل من جديد ونكمّل مرة وحدة، حتى لو retry=false: الأوامر نفسها تتكرر بأمان (نفس القيم)
    if (SESSION_GONE.test(msg)) {
      // لو طُردنا قبل شوي وما زبط الدخول: نوقف بسرعة بدل ما نعيد مع كل خطوة
      if (Date.now() - (kickedAt.get(keyOf(r)) ?? 0) < 12_000) throw new Error(KICKED_MSG);
      // ندخل من جديد ونعيد — بعض الموديلات (H155 مثلاً) تطرد كل الجلسات بعد تغيير الترددات
      // وتاخذ ثواني لين تقبل دخول جديد، فننتظر أطول شوي كل مرة
      const trail: string[] = [short(msg)];
      for (const wait of [1500, 4000, 8000]) {
        await new Promise(res => setTimeout(res, wait));
        let fresh: RouterDriver | undefined;
        try {
          fresh = await connect(r, true);
          return await fn(fresh);
        } catch (e2) {
          const m2 = String((e2 as any)?.message ?? e2);
          trail.push(short(m2));
          if (!SESSION_GONE.test(m2)) throw e2;
        }
        // فيرموير هواوي الجديدة (H155/H158…) ترد 100003 على أي رابط مو موجود — مو طرد!
        // دخلنا للتو: لو قراءة الإشارة شغالة، فالمشكلة إن راوترك ما يدعم هالأمر بالذات
        // الدخول نفسه فشل (مثل 125003) — ما فيه جلسة نفحصها، نكمّل المحاولات
        if (!fresh) continue;
        try {
          if (fresh.getSignal) {
            await fresh.getSignal();
            diag(`[session] 100003 بس الجلسة شغالة → أمر غير مدعوم trail=${trail.join('>')}`);
            const err = new Error('راوترك ما يدعم هالخاصية (الراوتر رفض الأمر وهو داخل) — جرّب خاصية ثانية أو أرسل تشخيص للمطوّر');
            (err as any).unsupported = true;
            throw err;
          }
        } catch (e3) {
          if ((e3 as any)?.unsupported) {
            import('../services/errors').then(m => m.reportError('unsupported', `${String((e as any)?.message ?? e).slice(0, 60)} [${trail.join(' → ')}]`, r)).catch(() => {});
            throw e3;
          }
          trail.push('sig:' + short(String((e3 as any)?.message ?? e3)));
        }
      }
      kickedAt.set(keyOf(r), Date.now());
      diag(`[session] KICKED trail=${trail.join('>')}`);
      // نسجّله عند المطوّر (من أي شاشة) مع تسلسل الردود — مرة باليوم لكل جهاز
      import('../services/errors').then(m => m.reportError('session', `${KICKED_MSG} [${trail.join(' → ')}]`, r)).catch(() => {});
      throw new Error(KICKED_MSG);
    }
    if (!retry) throw e;
    if (AUTH_FAIL.test(msg)) throw e;
    // انقطاع شبكة/مهلة: إعادة تسجيل الدخول ما تفيد وتصرف محاولات على الراوتر
    if (NET_FAIL.test(msg)) throw e;
    const fresh = await connect(r, true);
    return fn(fresh);
  }
}

/**
 * للخطوات اللي لازم تنجح (إرجاع الإعداد بعد فشل): نتجاهل «طُردنا قبل شوي» ونعيد الدخول
 * بصبر لين maxMs — بعض الموديلات (H155) تطرد الجلسات وترفض الدخول دقيقة بعد تغيير وضع الشبكة،
 * ولو استسلمنا بسرعة يبقى الراوتر على إعداد بلا خدمة.
 */
export async function withSessionPatient<T>(
  r: SavedRouter,
  fn: (d: RouterDriver) => Promise<T>,
  maxMs = 90_000,
  onTry?: (n: number) => void,
): Promise<T> {
  const deadline = Date.now() + maxMs;
  const waits = [0, 3000, 6000, 10000, 15000, 20000];
  let last: unknown;
  for (let i = 0; ; i++) {
    const w = waits[Math.min(i, waits.length - 1)];
    if (i && Date.now() + w > deadline) break;
    if (w) await new Promise(res => setTimeout(res, w));
    kickedAt.delete(keyOf(r));
    onTry?.(i);
    try {
      const d = await connect(r, i > 0);
      return await fn(d);
    } catch (e) {
      last = e;
      const m = String((e as any)?.message ?? e);
      // قفل دخول بسبب محاولات كثيرة: ما نزيده. وأمر غير مدعوم: إعادة الدخول ما تفيد
      if (/قفل تسجيل الدخول|محاولات كثيرة|108007|ما يدعم/.test(m) || (e as any)?.unsupported) break;
    }
  }
  throw last ?? new Error('ما قدرنا ندخل الراوتر');
}

export function dropSession(id: string) {
  const k = idKey.get(id) ?? id;
  sessions.get(k)?.d.logout().catch(() => {});
  sessions.delete(k);
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
