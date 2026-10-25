/** ملف صافي بدون react-native (عليه اختبارات) */
/**
 * RequireJS (صفحات ZTE الجديدة مثل U30 Pro): الصفحة فيها require.js بس، والباقي ينحمّل بأسماء موديولات بدون .js
 * (data-main="js/main" ← require(['service','view/home'])). نطلّع المسار الأساسي ونحوّل الأسماء لملفات.
 * تقرير ٢٥ أكتوبر: ملف U30 Pro وصل فيه index.html و require.js بس.
 */
export function amdBaseOf(text: string): string | null {
  const dm = text.match(/data-main=["']?([^"'\s>]+)/i)?.[1];
  const bu = text.match(/baseUrl\s*:\s*["']([^"']*)["']/)?.[1];
  if (bu !== undefined) return bu.endsWith('/') || bu === '' ? bu : bu + '/';
  if (dm) return dm.replace(/[^/]*$/, '');
  return null;
}
export function findAmdRefs(text: string, base: string): string[] {
  const out = new Set<string>();
  const ids: string[] = [];
  const dm = text.match(/data-main=["']?([^"'\s>]+)/i)?.[1];
  if (dm) ids.push(dm.replace(/^.*\//, ''));
  for (const m of text.matchAll(/\b(?:require|define|requirejs)\s*\(\s*(?:["'][^"']*["']\s*,\s*)?\[([^\]]{0,4000})\]/g)) {
    for (const x of m[1].matchAll(/["']([^"']{1,120})["']/g)) ids.push(x[1]);
  }
  for (const m of text.matchAll(/\brequire\s*\(\s*["']([^"']{1,120})["']\s*\)/g)) ids.push(m[1]);
  const paths = text.match(/paths\s*:\s*\{([^}]{0,4000})\}/)?.[1];
  if (paths) for (const x of paths.matchAll(/:\s*["']([^"']{1,120})["']/g)) ids.push(x[1]);
  for (let id of ids) {
    id = id.trim();
    if (!id || /^(require|exports|module)$/.test(id) || /^https?:|^\/\//.test(id)) continue;
    const bang = id.indexOf('!');
    if (bang >= 0) {
      // text!tmpl/home.html ← ملف كما هو · غيره (css!, i18n!) نتخطاه
      if (id.slice(0, bang) !== 'text') continue;
      id = id.slice(bang + 1);
      out.add(id.startsWith('/') ? id : base + id);
      continue;
    }
    const f = /\.js$/i.test(id) ? id : id + '.js';
    out.add(f.startsWith('/') || f.startsWith('.') ? f : base + f);
  }
  return [...out];
}

