/** ملف صافي بدون react-native (عليه اختبارات) */
/**
 * RequireJS (صفحات ZTE الجديدة مثل U30 Pro): الصفحة فيها require.js بس، والباقي ينحمّل بأسماء موديولات بدون .js
 * (data-main="js/main" ← require.config({paths}) ← require(['service','config/config']) ← config/<DEVICE>/menu).
 *
 * تقرير ٢٥ أكتوبر (U30 Pro): المحاولة الأولى جابت main.js بس — لأننا كنا ناخذ baseUrl من require.js نفسه
 * (فيه baseUrl:"./" افتراضي) فصارت كل المسارات من جذر الموقع وغلط. الحين:
 *  • baseUrl من data-main أو من require.config({...}) بس — مو من أي نص فيه كلمة baseUrl
 *  • paths تنطبق (tmpl:"../tmpl"، jquery:"lib/jquery/…")
 *  • القوائم الديناميكية في ZTE: "config/"+t.DEVICE+"/menu" ← نطلّع DEVICE من config/config.js
 *  • ملفات القوائم (config/<جهاز>/menu*.js) فيها مسارات الصفحات كنصوص ("wifi/ssid") ← نجيبها
 */
export interface AmdConfig { base: string; paths: Record<string, string> }

const strings = (s: string) => [...s.matchAll(/["']([^"'\n]{1,160})["']/g)].map(m => m[1]);

/** يحدّث الإعداد من نص ملف: data-main (في الصفحة) أو require.config({...}) (في main.js) */
export function readAmdConfig(text: string, cfg: AmdConfig | null): AmdConfig | null {
  let out = cfg;
  const dm = text.match(/data-main=["']?([^"'\s>]+)/i)?.[1];
  if (dm && !out) out = { base: dm.includes('/') ? dm.replace(/[^/]*$/, '') : '', paths: {} };
  const call = text.match(/\b(?:require|requirejs)\.config\s*\(\s*\{([\s\S]{0,8000})/);
  if (call) {
    out = out ?? { base: '', paths: {} };
    const bu = call[1].match(/baseUrl\s*:\s*["']([^"']*)["']/)?.[1];
    if (bu !== undefined) out.base = bu === '' || bu.endsWith('/') ? bu : bu + '/';
    const p = call[1].match(/paths\s*:\s*\{([^}]{0,6000})\}/)?.[1];
    if (p) for (const m of p.matchAll(/["']?([\w./-]+)["']?\s*:\s*["']([^"']{1,160})["']/g)) out.paths[m[1]] = m[2];
  }
  return out;
}

/** اسم موديول ← مسار ملف (نسبةً لجذر الصفحة). text!x ← x كما هو · إضافات ثانية (css!) نتخطاها */
export function idToFile(id: string, cfg: AmdConfig): string | null {
  let s = id.trim();
  if (!s || /^(require|exports|module)$/.test(s) || /^https?:|^\/\//.test(s)) return null;
  let keepExt = false;
  const bang = s.indexOf('!');
  if (bang >= 0) {
    if (s.slice(0, bang) !== 'text') return null;
    s = s.slice(bang + 1);
    keepExt = true;
  }
  if (/^\/|\.js$/i.test(s) && !keepExt) return s.startsWith('/') ? s : cfg.base + s;
  // أطول بادئة من paths
  const parts = s.split('/');
  for (let n = parts.length; n > 0; n--) {
    const key = parts.slice(0, n).join('/');
    const p = cfg.paths[key];
    if (p) { s = [p, ...parts.slice(n)].join('/'); break; }
  }
  const f = keepExt || /\.(js|html?|json)$/i.test(s) ? s : s + '.js';
  return f.startsWith('/') ? f : cfg.base + f;
}

/** أسماء الموديولات اللي يطلبها الملف (بما فيها قوائم ZTE الديناميكية) */
export function findAmdIds(text: string, filePath: string): string[] {
  const ids = new Set<string>();
  const dm = text.match(/data-main=["']?([^"'\s>]+)/i)?.[1];
  if (dm) ids.add(dm.replace(/^.*\//, '').replace(/\.js$/, ''));
  for (const m of text.matchAll(/\b(?:require|define|requirejs)\s*\(\s*(?:["'][^"']*["']\s*,\s*)?\[([^\]]{0,4000})\]/g)) {
    for (const x of strings(m[1])) ids.add(x);
  }
  for (const m of text.matchAll(/\brequire\s*\(\s*["']([^"']{1,160})["']\s*\)/g)) ids.add(m[1]);
  // paths نفسها ملفات (jquery، text…) — المكتبات المعروفة يتخطاها الجامع
  const p = text.match(/\b(?:require|requirejs)\.config\s*\(\s*\{[\s\S]{0,8000}?paths\s*:\s*\{([^}]{0,6000})\}/)?.[1];
  if (p) for (const m of p.matchAll(/["']?([\w./-]+)["']?\s*:\s*["'][^"']+["']/g)) ids.add(m[1]);
  // ZTE: "config/"+t.DEVICE+"/menu" — DEVICE ينكتب في config/config.js
  const dev = text.match(/\bDEVICE\s*:\s*["']([\w.-]{1,40})["']/)?.[1];
  if (dev) for (const f of ['menu', 'config', 'menu_4ggateway', 'menu_bridge', 'menu_pppoe', 'menu_multiwan']) ids.add(`config/${dev}/${f}`);
  // ملفات القوائم: مسارات الصفحات نصوص مثل "wifi/ssid" أو "home"
  if (/\/menu[\w-]*\.js$/i.test(filePath)) {
    for (const s of strings(text)) if (/^[a-z][\w-]*(\/[\w-]+){1,3}$/i.test(s) && !/^(https?|www)/i.test(s)) ids.add(s);
  }
  return [...ids].filter(Boolean);
}
