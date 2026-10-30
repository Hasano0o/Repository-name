/**
 * صفحات الراوتر اللي ما تنفتح إلا بعد الدخول (٣١ أكتوبر — FiberHome LG6851F الجديد).
 * «جهاز جديد» يسحب بدون دخول، فصفحة الإعدادات (main.html) ما وصلتنا وما نعرف أسماء أوامر الحفظ.
 * هنا: «أرسل تشخيص» ← لكل راوتر محفوظ درايفره يطلب صفحات بعد الدخول (afterLoginPages) ← ندخل (أو نستخدم
 * الجلسة الحالية) ← نسحبها GET بس بنفس قواعد «جهاز جديد» (حذف الأسرار، الشبكة المحلية بس) ← zip للبوت
 * باسم فيه «AUTH». والصفحة اللي ما وصلت تنكتب في README مع رد الراوتر (عشان نعرف ليش).
 */
import { listRouters, SavedRouter } from '../store/routers';
import { connect } from '../store/sessions';
import { driverById } from '../drivers/registry';
import { collectRouterFiles, sendRouterFiles } from './routerDump';

/** راوتر واحد (زر صفحة الراوتر) — null = درايفره ما يحتاج شي */
export async function sendAfterLoginPagesFor(r: SavedRouter, onStep?: (msg: string) => void): Promise<string | null> {
  const d = await connect(r);
  const pages = d.afterLoginPages?.() ?? [];
  if (!pages.length) return null;
  const model = `${(r.driverName || r.name || r.driverId).slice(0, 40)}-AUTH`;
  onStep?.('نسحب صفحة الإعدادات…');
  const { files, skipped } = await collectRouterFiles(r.host, n => onStep?.(`نسحب صفحة الإعدادات… ${n}`), { start: pages, afterLogin: true });
  // الراوتر ممكن يحوّل main.html لصفحة البداية/الدخول (302 يتبعه fetch لحاله) ← هذا مو صفحة الإعدادات
  const loginish = (t: string) => t.length < 6000 && /frmLoad\s*\(|login\.html\?|js\/login\.js|DO_WEB_LOGIN/.test(t);
  const got = pages.filter(p => files.some(f => f.p === p && !loginish(f.t)));
  // حتى لو ما وصل شي نرسل ملف صغير فيه السبب — عشان يبان في البوت وما نخمّن
  const send = files.length ? files : [{ p: '/_bandly/auth-miss.txt', t: skipped.filter(x => x.startsWith('✗')).join('\n') || 'ما وصل ولا ملف' }];
  onStep?.(`نرسل ${send.length} ملف…`);
  const res = await sendRouterFiles(send, { model, host: r.host, skipped });
  if (!res.ok) return 'صفحة الإعدادات ما وصلت للمطوّر — تأكد من النت وجرّب مرة ثانية';
  if (got.length) return `✓ وصلت صفحة الإعدادات للمطوّر (${res.sent} ملف) — شكراً لك`;
  return 'الراوتر ما عطى صفحة الإعدادات — وصل السبب للمطوّر';
}

/** كل الراوترات المحفوظة اللي درايفرها يطلب صفحات بعد الدخول («أرسل تشخيص») */
export async function sendAfterLoginPages(onStep?: (msg: string) => void): Promise<string | null> {
  const notes: string[] = [];
  for (const r of await listRouters()) {
    if (r.host === 'demo' || r.host === 'device') continue;
    // ما ندخل راوتر درايفره ما يطلب شي (ZTE/هواوي جلسة وحدة — ما نطردهم على الفاضي)
    if (!driverById(r.driverId)?.afterLoginPages) continue;
    try {
      const n = await sendAfterLoginPagesFor(r, onStep);
      if (n) notes.push(n.replace(/ — شكراً لك$/, ''));
    } catch { /* مو على شبكته / الدخول فشل — التشخيص نفسه وصل */ }
  }
  return notes.length ? notes.join(' · ') : null;
}
