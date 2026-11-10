/**
 * غلاف راوتر «برمج لي جهازي» — لراوتر انضاف بمطابقة تلقائية من الرسيفر (درايفر عائلة، مو درايفر موديله).
 *
 * • القراءات (get… / is… / list…) والدخول تمر. قراءة فشلت في «اكتشاف الميزات» تنخفي (undefined) —
 *   الشاشات تشيك وجود الدالة فتخفي الميزة لحالها.
 * • أوامر التغيير: تمر **بس** اللي الرسيفر لقى أمرها في كود صفحة هالراوتر نفسه (auto.writes)؛
 *   غيرها يوقف **قبل** ما يوصل الدرايفر، بعلامة noChange (safeApply يوقف بدون «رجّع إعدادك»).
 *   بدون auto.writes = قراءة بس.
 * • تثبيت البرج/القناة ما ينفتح من هنا أبداً — أمر بصيغة عائلة ثانية يعلّق الراوتر على «No Service» (MU5001 — ١٨ أكتوبر).
 *
 * القائمة بيضاء: أي دالة جديدة تنضاف للدرايفرات تنحجب تلقائياً لين نسمح لها. ملف صافي بدون react-native (عليه اختبارات).
 */
import type { Capability, RouterDriver } from './types';
import { noChange } from './noChange';

export const READ_ONLY_MSG = 'راوترك انضاف بـ«برمج لي جهازي» — قراءة بس للحين. التغيير ينفتح بعد ما نتأكد منه على موديلك.';
export const WRITE_BLOCKED_MSG = 'هالأمر ما لقيناه في صفحة راوترك (أو لسا ما انفتح لموديله) — ما غيّرنا شي.';

/** اللي ينحفظ مع الراوتر: وش انفتح له ووش انخفى */
export interface AutoCaps {
  /** دوال التغيير المسموحة (من الرسيفر — أمرها موجود في كود صفحة الراوتر) */
  writes?: string[];
  /** قراءات فشلت في الاكتشاف على هالراوتر — تنخفي */
  hide?: string[];
}

/** ما تنفتح تلقائي أبداً، حتى لو الرسيفر أرسلها */
const NEVER = new Set(['lockCell', 'lockChannel']);
/** دوال مسموحة بالاسم — الدخول والخروج والتعريف وقراءات ما تبدأ بـ get */
const ALLOW = new Set([
  'detect', 'login', 'logout', 'markStale', 'identify',
  'afterLoginPages', 'prepareAfterLogin', 'pageFilesKnown',
  'readBaseline', 'useBaseline', 'readLockState',
]);
/** ما تنخفي مهما صار — بدونها الراوتر ما ينفتح */
const KEEP = new Set(['getSignal', 'getSnapshot']);

export function isReadMethod(name: string): boolean {
  return ALLOW.has(name) || /^(get|is|list)[A-Z]/.test(name);
}

export function isReadOnlyDriver(d: unknown): boolean {
  return !!d && (d as any).readOnly === true;
}

/** القدرات الظاهرة: القراءة اللي ما انخفت + التغيير اللي انفتح أمره */
export function autoCapabilities(base: Capability[], caps: AutoCaps): Capability[] {
  const w = new Set((caps.writes ?? []).filter(m => !NEVER.has(m)));
  const h = new Set(caps.hide ?? []);
  const need: Record<Capability, boolean> = {
    signal: true,
    devices: !h.has('getDevices'),
    usage: !h.has('getUsage'),
    traffic: !h.has('getTraffic'),
    cells: !h.has('getCells'),
    bandLock: w.has('setBand'),
    reboot: w.has('reboot'),
    sms: w.has('sendSms') && !h.has('listSms'),
    block: w.has('blockDevice'),
  };
  return base.filter(c => need[c]);
}

export function readOnlyDriver<T extends RouterDriver>(d: T, caps: AutoCaps = {}): T {
  if (isReadOnlyDriver(d)) return d;
  const writes = new Set((caps.writes ?? []).filter(m => !NEVER.has(m) && !isReadMethod(m)));
  const hide = new Set((caps.hide ?? []).filter(m => /^(get|list)[A-Z]/.test(m) && !KEEP.has(m)));
  const blockedMsg = writes.size ? WRITE_BLOCKED_MSG : READ_ONLY_MSG;
  return new Proxy(d, {
    get(t, prop) {
      if (prop === 'readOnly') return true;
      if (prop === 'autoWrites') return [...writes];
      if (prop === 'capabilities') return autoCapabilities(t.capabilities ?? [], { writes: [...writes], hide: [...hide] });
      const v = (t as any)[prop];
      if (typeof v !== 'function') return v;
      // this = الدرايفر الأصلي: الدوال الداخلية (طلبات الدخول والقراءة) تشتغل عادي
      if (typeof prop === 'symbol') return v.bind(t);
      if (isReadMethod(prop)) return hide.has(prop) ? undefined : v.bind(t);
      if (writes.has(prop)) return v.bind(t);
      return async () => { throw noChange(blockedMsg); };
    },
    set(t, prop, value) {
      (t as any)[prop] = value;
      return true;
    },
  });
}
