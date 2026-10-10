/* ═══ فحص الإنترنت الفعلي ═══
 * الإشارة القوية ما تعني إن النت شغال: أحياناً الراوتر لاقط البرج بس البيانات واقفة
 * (الباقة خلصت، جلسة البيانات علقت، أو قفل تردد البرج ما يمرر عليه).
 * نطلب صفحتين صغيرتين جداً (بدون محتوى تقريباً) من قوقل وأبل — أي وحدة ترد = فيه نت.
 * ملاحظة: لو الجوال حوّل لبيانات الجوال لحاله ممكن يطلع «فيه نت» والراوتر فعلاً واقف —
 * فالفحص يكشف الانقطاع بأمان (ما يقول «ما فيه نت» غلط)، بس ممكن يفوّته أحياناً. */

const URLS = [
  'https://connectivitycheck.gstatic.com/generate_204',
  'https://captive.apple.com/hotspot-detect.html',
];

async function one(url: string, ms: number): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${url}?b=${Date.now()}`, { method: 'GET', signal: ctrl.signal, cache: 'no-store' as RequestCache });
    return r.status === 204 || r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** true = فيه إنترنت. أي رابط يرد يكفي */
export function hasInternet(timeoutMs = 6000): Promise<boolean> {
  return new Promise(resolve => {
    let left = URLS.length;
    let done = false;
    for (const u of URLS) {
      one(u, timeoutMs).then(ok => {
        if (done) return;
        if (ok) { done = true; resolve(true); return; }
        if (--left === 0) resolve(false);
      });
    }
  });
}
