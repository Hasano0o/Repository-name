/**
 * «طلب جهاز جديد»: نرسل ملفات صفحة الراوتر كاملة (HTML + JS) للمطوّر بدل مقاطع مختارة —
 * عشان نعرف طريقة الدخول والروابط من أول تقرير، بدون ما نطلب من العضو يعيد كل شوي.
 *
 * • قراءة بس، على راوتر الشبكة المحلية بس (isLanHost) — ما ندخل ولا نرسل أي أمر تغيير.
 *   (استثناء قراءة: FiberHome يعطي أسماء الإعدادات بطلب POST مشفّر «get_xmlnode_js_file» بدون دخول — نفس صفحته)
 * • ملفات الصفحة العامة (نفس اللي يحمّلها المتصفح قبل الدخول) — ما فيها بيانات العضو.
 *   للاحتياط نحجب رموز csrf وأي value في الخانات.
 * • نتخطى المكتبات المعروفة الكبيرة (jquery/vue/echarts…) — أسماؤها تكفي.
 * • حد: ١٫٥ ميقا للملف، ٨ ميقا للكل، ٨٠ ملف. نرسلها على دفعات صغيرة للسيرفر، والسيرفر يضغطها ويرسلها للبوت.
 */
import { isLanHost } from '../utils/host';
import { LIVE_BASE } from './live';
import { readAmdConfig, idToFile, findAmdIds, AmdConfig } from './amdRefs';
import { fhBody, fhDecrypt, fhKey } from '../drivers/fiberhome/crypto';

// مكتبات كبيرة ما تنعدّل — أسماؤها تكفي. ما نتخطى polyfill/vue-i18n/vue-router/axios/bootstrap بعد:
// FiberHome يخبّي فيها RequireJS ودوال الاتصال ($post) وأسماء الإعدادات (تقرير ٢٦ أكتوبر) — صغيرة ونحتاجها
const SKIP = /(copyrightPage|opensource|privatePolicy|\/faq[\w-]*\.html|chunk-vendors|jquery(?!\.tp)|element-plus|elementui|chunk-libs|echarts|tinymce|lottie|jtopo|topo\.min|\/element(\.min)?\.js|font-?awesome|moment|lodash|highcharts|chart\.min|swiper|\.min\.js.*(forge|elliptic))/i;
// Nokia FastMile 3.1 (تقرير ٢٧ أكتوبر): main-es2015.js (Angular) أكبر من ١٫٥ ميقا — انقطع قبل شاشة الدخول والترددات.
// الملفات الكبيرة تنقسم أجزاء ٣٠٠ك على الإرسال، والسيرفر يجمعها (حده ٢٠ ميقا للتقرير)
const MAX_FILE = 6_000_000;
const MAX_TOTAL = 14_000_000;
/** Angular يبني نسختين من نفس الكود (es2015 + es5 للمتصفحات القديمة) — نسحب وحدة بس */
const ES5_TWIN = /-es5\.[0-9a-f]{16,}\.js$/i;
const MAX_FILES = 150; // صفحات RequireJS (ZTE) فيها موديول لكل شاشة
// الحد بالبايت (UTF-8) مو بالحرف — العربي ٢–٣ بايت للحرف. ٣٠٠ ك ← بعيد عن حد nginx (١ ميقا)
const PART = 300_000;
/** طول النص بالبايت (UTF-8) — بدون TextEncoder (ناقص في بعض نسخ RN) */
export function utf8Len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
/** ننظف النص من اللي يخرّب الطلب: أنصاف رموز UTF-16 يتيمة، وحروف تحكم (غير السطر/التاب) */
export function cleanText(s: string): string {
  // بدون lookbehind في الـ regex (احتياط لمحرك Hermes) — حلقة بسيطة
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) { out += s[i] + s[i + 1]; i++; } else out += '\ufffd';
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) { out += '\ufffd'; continue; }
    if ((c < 0x20 && c !== 9 && c !== 10 && c !== 13) || c === 0x7f) continue;
    out += s[i];
  }
  return out;
}
/** نقسم نص على حد بايتات (بدون ما نقص رمز بالنص) */
export function splitBytes(s: string, max: number): string[] {
  const out: string[] = [];
  let start = 0, bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < s.length;
    const b = c < 0x80 ? 1 : c < 0x800 ? 2 : pair ? 4 : 3;
    if (bytes + b > max && i > start) { out.push(s.slice(start, i)); start = i; bytes = 0; }
    bytes += b;
    if (pair) i++;
  }
  out.push(s.slice(start));
  return out;
}

/** يحل رابط نسبي مقابل مسار الصفحة — بدون URL() (ناقص في RN) */
export function resolvePath(ref: string, fromPath: string): string | null {
  let r = ref.trim().split('#')[0];
  if (!r || /^(data|javascript|mailto|blob):/i.test(r)) return null;
  if (/^https?:\/\//i.test(r) || r.startsWith('//')) return null; // برا الراوتر — ما نلمسه
  const q = r.indexOf('?');
  if (q >= 0) r = r.slice(0, q);
  const baseDir = fromPath.replace(/[^/]*$/, '');
  const parts = (r.startsWith('/') ? r : baseDir + r).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop(); else out.push(p);
  }
  return '/' + out.join('/');
}

/** روابط ملفات .js/.html داخل نص صفحة أو سكربت */
export function findRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/<script[^>]+src=["']?([^"'\s>]+)/gi)) refs.add(m[1]);
  // Vue/Webpack: <link href=/js/chunk-xxxx.js rel=prefetch> (بدون علامات تنصيص) — فيها صفحات الإعدادات (OPPO T1a، ٢٦ أكتوبر)
  for (const m of text.matchAll(/<link[^>]+href=["']?([^"'\s>]+\.js)(?:[?#][^"'\s>]*)?["']?/gi)) refs.add(m[1]);
  for (const m of text.matchAll(/["'`]([\w./-]{1,120}\.(?:js|html?))(?:[?#][^"'`]*)?["'`]/gi)) refs.add(m[1]);
  // Webpack: {"chunk-xxx":"hash"} + static/js/
  if (/static\/js\//.test(text)) {
    const map = text.match(/\{("chunk-[\w-]+":"[0-9a-f]+",?)+\}/);
    if (map) for (const m of map[0].matchAll(/"(chunk-[\w-]+)":"([0-9a-f]+)"/g)) refs.add(`/static/js/${m[1]}.${m[2]}.js`);
  }
  return [...refs];
}

/**
 * Webpack بأسماء القطع (هواوي H155-383 — Vue): A.p+"js/"+({0:"common",55:"lockband",70:"networkmode",…}[e]||e)+".js"
 * — صفحات الترددات ووضع الشبكة والأبراج ما تبان كروابط، فنطلّعها من الخريطة.
 * صفحات الشبكة أول (الحد ١٥٠ ملف)، والباقي بعدها.
 */
const NET_CHUNK = /band|net|mode|cell|lock|signal|freq|developer|antenna|common|login|device/i;
export function namedChunks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/["']([\w./-]*js\/)["']\s*\+\s*\(\{([^{}]{1,30000})\}\[\w+\]\s*\|\|\s*\w+\)\s*\+\s*["']\.js/g)) {
    for (const n of m[2].matchAll(/(?:\d+|"[\w-]+")\s*:\s*"([\w.-]+)"/g)) out.push(m[1] + n[1] + '.js');
  }
  const uniq = [...new Set(out)];
  return [...uniq.filter(f => NET_CHUNK.test(f)), ...uniq.filter(f => !NET_CHUNK.test(f))].slice(0, 120);
}

/**
 * RequireJS بـ data-main (أو محمّل FiberHome المخفي _0x…_("/src/main.js") اللي يسوي نفسه) ← baseUrl = مجلد السكربت.
 * FiberHome LG6851F (٣١ أكتوبر، ملف AUTH): getRoute('content/pages/frequencyLockSet') = /src/content/pages/frequencyLockSet.js
 * و require(['./index']) = /src/index.js — كنا نطلبها من الجذر ← 400 وضاعت كل صفحات الإعدادات.
 */
export function dataMainBase(text: string): string | null {
  // data-main العادي يتعامل معه readAmdConfig (ويحترم baseUrl لو موجود) — هنا المحمّل المخفي بس
  const m = text.match(/\b_0x\w+_\(\s*["'](\/[\w./-]+?)(?:\.js)?["']\s*\)/);
  return m ? m[1].replace(/[^/]+$/, '') : null;
}
const NET_PAGE = /freq|band|lock|network|net|rf|signal|carrier|antenna|cell|mode|wifi|wlan|apn|nat|upnp|dmz|led|reboot|config/i;
export function amdModuleIds(text: string, base: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:getRoute|require)\(\s*\[?\s*["']((?:\.\/)?[a-zA-Z][\w/.-]*)["']/g)) {
    const id = m[1];
    if (/\.(js|html?|css)$/i.test(id) || !/\//.test(id.replace(/^\.\//, '')) && !id.startsWith('./')) continue;   // ملفات كاملة (findRefs) أو أسماء مكتبات (vue…)
    const rp = resolvePath(id + '.js', base + 'x');
    if (rp) out.push(rp);
  }
  const u = [...new Set(out)];
  return [...u.filter(f => NET_PAGE.test(f.split('/').pop() ?? '')), ...u.filter(f => !NET_PAGE.test(f.split('/').pop() ?? ''))];
}

/**
 * ZTE (MC801A Pro/MC888…، ٣٠ أكتوبر): قائمة الصفحة {hash:"#mobile_network",path:"network/mobile_network"} —
 * router.js يحمّل "text!tmpl/<path>.html" والموديول "<path>" (= /js/<path>.js). شاشات الترددات والأبراج والواي فاي
 * كلها هنا وما لها رابط ثابت، فبدونها الملف ناقص. الأهم أول (شبكة/أبراج/واي فاي) لأن عدد الملفات محدود.
 */
export function zteMenuPaths(text: string): string[] {
  const paths = [...new Set([...text.matchAll(/\{\s*hash\s*:\s*["']#[\w-]+["']\s*,\s*path\s*:\s*["']([\w/-]{1,60})["']/g)].map(m => m[1]))];
  const key = /network|band|cell|lock|signal|wifi|wlan|adm|status|device/i;
  const ordered = [...paths.filter(p => key.test(p)), ...paths.filter(p => !key.test(p))];
  return ordered.flatMap(p => ['/js/' + p + '.js', '/tmpl/' + p + '.html']).slice(0, 80);
}

/** <base href="/web_whw/"> ← "/web_whw/" (محلي بس) */
export function baseHrefOf(text: string): string | null {
  const m = text.match(/<base[^>]+href=["']?([^"'\s>]+)/i);
  if (!m || /^(https?:)?\/\//i.test(m[1])) return null;
  const h = ('/' + m[1].replace(/^\/+/, '')).replace(/\/?$/, '/');
  return h === '/' ? null : h;
}
/**
 * Angular (runtime.*.js): الصفحات تنحمّل كقطع «<رقم>.<هاش>.js» من خريطة مثل {123:"0a1b2c3d4e5f6a7b",…}
 * — نطلّع أسماء القطع عشان تنجمع (Nokia — تقرير ٢٧ أكتوبر).
 */
export function angularChunks(text: string): string[] {
  if (!/\.u\s*=|"\.js"|\+"\.js"/.test(text)) return [];
  const out = new Set<string>();
  for (const map of text.matchAll(/\{((?:\s*(?:\d+|"[\w-]+"|[A-Za-z_$][\w$]*)\s*:\s*"[0-9a-f]{8,20}"\s*,?)+)\}/g)) {
    for (const m of map[1].matchAll(/(\d+|"[\w-]+"|[A-Za-z_$][\w$]*)\s*:\s*"([0-9a-f]{8,20})"/g)) out.add(`${m[1].replace(/"/g, '')}.${m[2]}.js`);
  }
  return [...out].slice(0, 120);
}

/** احتياط: ما نرسل رموز جلسة أو قيم خانات حتى لو موجودة في الصفحة */
export function scrub(text: string): string {
  return text
    .replace(/(<meta[^>]+name=["']?csrf[\w-]*["']?[^>]*content=)["'][^"']*["']/gi, '$1"«محذوف»"')
    .replace(/(<input[^>]*\svalue=)["'][^"']*["']/gi, '$1"«محذوف»"');
}

/** أصل الرابط (http://host) — للـ Referer */
export function originOf(url: string): string {
  return url.match(/^https?:\/\/[^/]+/i)?.[0] ?? '';
}

async function get(url: string, ms = 6000, method: 'GET' | 'POST' = 'GET'): Promise<{ ok: boolean; text: string; type: string; status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    // Referer = صفحة الراوتر نفسها: TP-Link (Archer MR600 — ٢٧ أكتوبر) يرفض/يرجّع صفحة الدخول لأي ملف بدونه،
    // فوصلنا index.html بس وضاعت encrypt.js / lib.js / oid_str.js / jquery.tp.min.js
    // credentials: الكوكي من دخول التطبيق (للصفحات اللي بعد الدخول — afterLoginPages)
    const r = await fetch(url, { method, signal: ctrl.signal, cache: 'no-store', credentials: 'include', headers: { Referer: originOf(url) + '/' } } as any);
    const type = r.headers.get('content-type') || '';
    const text = await r.text();
    return { ok: r.ok, text, type, status: r.status };
  } catch (e) {
    return { ok: false, text: '', type: '', status: (e as any)?.name === 'AbortError' ? -1 : 0 };
  } finally {
    clearTimeout(t);
  }
}

export interface DumpFile { p: string; t: string }

/** سطر «ما وصل» للـ README: وش رد الراوتر بالضبط (قبل: أي فشل ينبلع بصمت — main.html في FiberHome ما ندري وش صار له) */
export function missLine(p: string, r: { ok: boolean; status: number; text: string }, sameAsHome = false): string {
  if (sameAsHome) return `✗ ${p} ← رجّع صفحة البداية بدل الملف`;
  if (r.status === -1) return `✗ ${p} ← انتهت المهلة`;
  if (r.status === 0) return `✗ ${p} ← ما رد (انقطع الطلب)`;
  if (r.ok && !r.text) return `✗ ${p} ← فاضي (${r.status})`;
  return `✗ ${p} ← HTTP ${r.status}`;
}
/** الصفحات (.html) أول: هي اللي تهمنا لو ما وصلت — والـ js المخمّنة من النصوص كثير منها 404 طبيعي */
function topMisses(m: string[], n = 25): string[] {
  return [...m.filter(x => /\.html?\b/.test(x)), ...m.filter(x => !/\.html?\b/.test(x))].slice(0, n);
}

export async function collectRouterFiles(host: string, onStep?: (n: number) => void, opts?: { start?: string[]; afterLogin?: boolean }): Promise<{ files: DumpFile[]; skipped: string[] }> {
  if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي');
  const base = 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const files: DumpFile[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = opts?.start?.length ? [...opts.start] : ['/'];
  const misses: string[] = [];
  let total = 0;
  let homeSample = '';
  /** إعداد RequireJS (المسار الأساسي + paths) — لو الصفحة تستخدمه */
  let amd: AmdConfig | null = null;
  /** مجلد <base href> لو الصفحة تحدده */
  let appBase = '';
  /** مجلد data-main (RequireJS) — FiberHome LG6851F: /src/ */
  let dmBase = '';
  while (queue.length && files.length < MAX_FILES && total < MAX_TOTAL) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    if (SKIP.test(p)) { skipped.push(p); continue; }
    if (ES5_TWIN.test(p) && (seen.has(p.replace(/-es5\./i, '-es2015.')) || queue.includes(p.replace(/-es5\./i, '-es2015.')))) { skipped.push(p); continue; }
    const r = await get(base + p);
    if (!r.ok || !r.text) { misses.push(missLine(p, r)); continue; }
    // راوترات ترجع الصفحة الرئيسية لأي رابط مو موجود — ما نكررها (بس نكتب إنه صار)
    if (p !== '/' && homeSample && r.text.slice(0, 400) === homeSample) { misses.push(missLine(p, r, true)); continue; }
    if (p === '/') homeSample = r.text.slice(0, 400);
    const t = scrub(r.text.slice(0, MAX_FILE));
    files.push({ p: p === '/' ? '/index.html' : p, t });
    total += t.length;
    onStep?.(files.length);
    // FiberHome LG6851F: checkBrowser.js يحمّل polyfill.min.js (فيه $post والتشفير) بكود مخفي (hex) — ما يبان كرابط
    if (/_0xdx2|DO_WEB_LOGIN/.test(r.text) && !seen.has('/plugins/polyfill.min.js') && !queue.includes('/plugins/polyfill.min.js')) queue.push('/plugins/polyfill.min.js');
    // <base href="/web_whw/"> (Nokia — Angular): الروابط النسبية تنحسب منه مو من مكان الصفحة
    const bh = baseHrefOf(r.text);
    if (bh) appBase = bh;
    // ملفات السكربت داخل مجلد الـ base تحمّل قطعها من نفس المجلد (publicPath)
    const from = bh ? bh + 'index.html' : p === '/' ? '/index.html' : p;
    // اسم نسبي داخل سكربت (location.href="main.html" في /js/login.js) ينحسب في المتصفح من الصفحة مو من مكان
    // السكربت — كنا نطلب /js/main.html وتضيع صفحة الإعدادات (FiberHome LG6851F). نجرّب الاثنين.
    const isJs = /\.js$/i.test(p);
    for (const ref of [...findRefs(r.text), ...angularChunks(r.text)]) {
      const cands = [resolvePath(ref, from)];
      if (isJs && !bh && !/^\.{0,2}\//.test(ref)) cands.push(resolvePath(ref, '/index.html'));
      for (const rp of cands) if (rp && !seen.has(rp) && !queue.includes(rp)) queue.push(rp);
    }
    const dmb = dataMainBase(r.text);
    if (dmb) dmBase = dmb;
    if (dmBase) for (const rp of amdModuleIds(r.text, dmBase)) {
      if (!seen.has(rp) && !queue.includes(rp)) queue.push(rp);
    }
    // ZTE: شاشات القائمة (path:"network/…") ← /js/<path>.js + /tmpl/<path>.html
    for (const rp of zteMenuPaths(r.text)) {
      if (!seen.has(rp) && !queue.includes(rp)) queue.push(rp);
    }
    // قطع Webpack بالأسماء: المسار من publicPath (مجلد الصفحة) مو من مكان main.js — "js/lockband.js" ← /js/lockband.js
    for (const ref of namedChunks(r.text)) {
      const rp = resolvePath(ref, (appBase || '/') + 'index.html');
      if (rp && !seen.has(rp) && !queue.includes(rp)) queue.push(rp);
    }
    amd = readAmdConfig(r.text, amd);
    // data-main معروف (FiberHome: /src/) ← الموديولات من مجلده مو من الجذر (كانت طلبات 400 زايدة)
    if (amd && dmBase) amd = { ...amd, base: dmBase };
    if (amd) {
      for (const id of findAmdIds(r.text, p)) {
        const f = idToFile(id, amd);
        const rp = f ? resolvePath(f, '/index.html') : null;
        if (rp && !seen.has(rp) && !queue.includes(rp)) queue.push(rp);
      }
    }
  }
  // FiberHome: أسماء الإعدادات (x_NetworkSettings_obj… ٥٩٢ اسم) ما هي ملف ثابت — الصفحة تطلبها وقت التشغيل
  // بـ get_xmlnode_js_file (بدون دخول، «nocheck») وتسوي لها eval. نطلبها بنفس الطريقة ونحفظ النص بس.
  const fh = !opts?.afterLogin && files.some(f => (/get_xmlnode_js_file/.test(f.t) && /FHNCAPIS/.test(f.t)) || /DO_WEB_LOGIN/.test(f.t));
  if (fh) {
    const r = await fiberhomeNodes(base);
    files.push(r.ok ? { p: '/_bandly/xmlnode.js', t: scrub(r.text.slice(0, MAX_FILE)) } : { p: '/_bandly/xmlnode-error.txt', t: r.text });
    // وش يرد الراوتر على أوامر التعرّف (بدون دخول) — عشان نعرف ليش التطبيق ما تعرّف عليه
    const probe: string[] = [];
    for (const q of ['is_encrypt', 'get_refresh_sessionid']) {
      const x = await get(`${base}/api/tmp/FHNCAPIS?ajaxmethod=${q}&_=${Math.random()}`);
      probe.push(`GET FHNCAPIS ${q} → ${x.ok ? 'ok' : 'فشل'} ${x.type} · ${x.text.slice(0, 160).replace(/"sessionid"\s*:\s*"[^"]*"/, '"sessionid":"«محذوف»"')}`);
    }
    files.push({ p: '/_bandly/probe.txt', t: probe.join('\n') });
    onStep?.(files.length);
  }
  // TP-Link 4G (Archer MR…): المفتاح العام nn/ee وseq وحالة الدخول — الصفحة تطلبها POST بدون دخول.
  // نحتاج شكل الرد (JSON ولا var nn=…) عشان نعرف أي نسخة تشفير عنده — المفتاح عام مو سر
  if (!opts?.afterLogin && files.some(f => /\/cgi\/getParm/.test(f.t))) {
    const probe: string[] = [];
    for (const q of ['/cgi/getParm', '/cgi/getBusy', '/cgi/getGDPRParm']) {
      const x = await get(base + q, 6000, 'POST');
      probe.push(`POST ${q} → ${x.ok ? 'ok' : 'فشل'} ${x.type} · ${x.text.slice(0, 600)}`);
    }
    files.push({ p: '/_bandly/probe.txt', t: probe.join('\n') });
    onStep?.(files.length);
  }
  // فحوص حية بدون دخول (٣٠ أكتوبر — MC801A Pro: الملفات قالت «G5» بس الراوتر نفسه رد /ubus/ = 404)
  if (!opts?.afterLogin) try {
    const live = await liveChecks(base, files.map(f => f.t).join('\n'));
    if (live) { files.push({ p: '/_bandly/live.txt', t: live }); onStep?.(files.length); }
  } catch {}
  return { files, skipped: [...new Set(skipped), ...topMisses([...new Set(misses)])] };
}

// ═══ فحوص حية (قراءة بس، بدون دخول) ═══
/** أي قيمة شكلها سر تنحذف: الرموز والجلسات والكلمات والمعرّفات (IMEI/ICCID/MAC/SSID) و RD/LD */
const LIVE_SECRET = /(sessionid|session|token|sesinfo|tokinfo|passw\w*|psk|wpa\w*key|\bkey\b|secret|nonce|csrf|imei|imsi|iccid|\bmac\w*|ssid\w*|serial\w*|sn\b|\bRD\b|\bLD\b|msisdn|phone)/i;
export function scrubLive(text: string): string {
  return String(text ?? '')
    // JSON: "key":"value"
    .replace(/"([\w.-]{1,60})"\s*:\s*"([^"]*)"/g, (all, k, v) => (LIVE_SECRET.test(k) && v ? `"${k}":"«محذوف»"` : all))
    // XML: <key>value</key>
    .replace(/<([\w-]{1,60})>([^<]*)<\/\1>/g, (all, k, v) => (LIVE_SECRET.test(k) && v.trim() ? `<${k}>«محذوف»</${k}>` : all))
    // key=value
    .replace(/\b([\w.-]{1,60})=([^&\s"'<]+)/g, (all, k, v) => (LIVE_SECRET.test(k) ? `${k}=«محذوف»` : all));
}

async function req(url: string, method: 'GET' | 'POST' = 'GET', body?: string, ms = 5000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method, body, signal: ctrl.signal, cache: 'no-store',
      headers: { Referer: originOf(url) + '/', 'X-Requested-With': 'XMLHttpRequest', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    } as any);
    const text = await r.text();
    return `${r.status} · ${r.headers.get('content-type') || '?'} · ${text.length}B · ${Date.now() - t0}ms · ${scrubLive(text).replace(/\s+/g, ' ').slice(0, 400)}`;
  } catch (e: any) {
    return `فشل (${e?.name === 'AbortError' ? 'ما رد خلال ' + ms / 1000 + 'ث' : String(e?.message ?? e).slice(0, 80)}) · ${Date.now() - t0}ms`;
  } finally {
    clearTimeout(t);
  }
}

/** الحقول العامة اللي تكشف نوع الفيرموير وطريقة الكتابة — بدون أي سر */
const ZTE_PUBLIC = 'wa_inner_version,cr_version,web_version,hardware_version,model_name,Language,loginfo,network_type,network_provider,lte_band_lock,nr5g_band_lock,net_select';

/**
 * أسئلة حية تنجاوب بدون دخول: هل فيه ubus؟ وش الإصدارات؟ وش يرد على أوامر القراءة العامة؟ https موجود؟
 * كل الطلبات قراءة (GET، أو POST قراءة مثل ubus "[]") — ولا أمر يغيّر شي.
 */
export async function liveChecks(base: string, allText: string): Promise<string> {
  const out: string[] = [`Bandly — فحوص حية (قراءة بس، بدون دخول) · ${base}`];
  const add = async (label: string, url: string, method: 'GET' | 'POST' = 'GET', body?: string) => out.push(`${label}: ${method} ${url.replace(base, '')} → ${await req(url, method, body)}`);
  await add('الصفحة', base + '/');
  out.push(`https: ${await req(base.replace(/^http:/, 'https:') + '/', 'GET', undefined, 4000)}`);
  if (/goform_get_cmd_process|goform_set_cmd_process/.test(allText)) {
    await add('ZTE إصدارات', `${base}/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=${encodeURIComponent(ZTE_PUBLIC)}`);
    await add('ZTE ubus', base + '/ubus/', 'POST', '[]');
    await add('ZTE ubus GET', base + '/ubus');
    await add('ZTE شرايح الواي فاي', `${base}/goform/goform_get_cmd_process?isTest=false&cmd=queryWiFiChipAdvancedInfo`);
  }
  if (/\/api\/webserver|SesTokInfo|api\/device/.test(allText)) {
    await add('هواوي الجهاز', base + '/api/device/basic_information');
    await add('هواوي SesTokInfo', base + '/api/webserver/SesTokInfo');
    await add('هواوي token', base + '/api/webserver/token');
    await add('هواوي state-login', base + '/api/user/state-login');
  }
  return out.length > 2 ? out.join('\n') : out.join('\n');
}

/**
 * قراءة بس — نفس initPageConfigure في plugins/polyfill.min.js (بعد فك الـ packer):
 *   ١. GET /api/tmp/FHNCAPIS?ajaxmethod=is_encrypt ← {enable}
 *   ٢. GET /api/tmp/FHNCAPIS?ajaxmethod=get_refresh_sessionid ← {sessionid}
 *   ٣. POST /api/tmp/FHNCAPIS {dataObj:null, ajaxmethod:"get_xmlnode_js_file", sessionid} (AES لو enable=1) ← {xml}
 * ما نحفظ sessionid ولا نرسله — النص الراجع أسماء إعدادات عامة بس.
 */
export async function fiberhomeNodes(base: string): Promise<{ ok: boolean; text: string }> {
  const H = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' };
  const step = async (name: string, url: string, init?: RequestInit) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { ...init, headers: { ...H, ...(init?.headers as any) }, signal: ctrl.signal, cache: 'no-store' } as any);
      const text = await r.text();
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return text;
    } catch (e: any) {
      throw new Error(e?.message?.startsWith(name) ? e.message : `${name}: ${e?.name === 'AbortError' ? 'ما رد' : String(e?.message ?? e).slice(0, 80)}`);
    } finally { clearTimeout(t); }
  };
  const api = `${base}/api/tmp/FHNCAPIS`;
  try {
    const enc = JSON.parse(await step('is_encrypt', `${api}?ajaxmethod=is_encrypt&_=${Math.random()}`));
    const encrypt = String(enc?.enable) === '1';
    const sid = String(JSON.parse(await step('get_refresh_sessionid', `${api}?ajaxmethod=get_refresh_sessionid&_=${Math.random()}`))?.sessionid ?? '');
    if (encrypt && sid.length < 16) return { ok: false, text: `get_refresh_sessionid: sessionid قصير (${sid.length})` };
    const raw = await step('get_xmlnode_js_file', `${api}?_${Math.random()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: fhBody({ dataObj: null, ajaxmethod: 'get_xmlnode_js_file' }, sid, encrypt),
    });
    let obj: any;
    try { obj = JSON.parse(encrypt ? fhDecrypt(raw, fhKey(sid)) : raw); } catch { return { ok: false, text: `get_xmlnode_js_file: ما قدرنا نفك الرد (encrypt=${encrypt ? 1 : 0}، طول ${raw.length})` }; }
    const xml = typeof obj?.xml === 'string' ? obj.xml : '';
    if (!xml) return { ok: false, text: `get_xmlnode_js_file: الرد بدون xml — مفاتيحه: ${Object.keys(obj ?? {}).join(',').slice(0, 120)}` };
    return { ok: true, text: `// encrypt=${encrypt ? 1 : 0} — من get_xmlnode_js_file (Bandly)\n${xml}` };
  } catch (e: any) {
    return { ok: false, text: String(e?.message ?? e) };
  }
}

/** يرسل الملفات على دفعات؛ السيرفر يضغطها ويرسلها للبوت مع وصف قصير */
export interface SendResult { ok: boolean; sent: number; failed: string[]; status?: number }

/**
 * يرسل الملفات على دفعات؛ السيرفر يضغطها ويرسلها للبوت.
 * تقرير ٢٦ أكتوبر (U30 Pro): أول دفعة انرفضت (400) فوقف كل شي بصمت — لا zip ولا خبر.
 * الحين: الدفعة بالبايت، كل طلب يتعاد مرة، والدفعة اللي تنرفض نرسل ملفاتها واحد واحد ونتخطى الخربان بس،
 * وفي الآخر «done» دايماً (حتى لو فيه ملفات فشلت) مع قائمة اللي ما وصل.
 */
export async function sendRouterFiles(files: DumpFile[], meta: { model: string; host: string; skipped: string[] }): Promise<SendResult> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  let status: number | undefined;
  const once = async (body: object): Promise<boolean> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(`${LIVE_BASE}/live-api/app/dump`, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, signal: ctrl.signal, body: JSON.stringify(body),
      });
      if (!r.ok) status = r.status;
      return r.ok;
    } catch { status = 0; return false; } finally { clearTimeout(t); }
  };
  const post = async (body: object) => (await once(body)) || (await new Promise(r => setTimeout(r, 1500)), await once(body));
  const failed: string[] = [];
  let sent = 0;
  const flush = async (batch: DumpFile[]) => {
    if (!batch.length) return;
    if (await post({ id, files: batch })) { sent += batch.length; return; }
    if (batch.length === 1) { failed.push(batch[0].p); return; }
    for (const f of batch) {
      if (await once({ id, files: [f] })) sent++; else failed.push(f.p);
    }
  };
  let batch: DumpFile[] = [];
  let size = 0;
  for (const f of files) {
    const t = cleanText(f.t);
    const parts = utf8Len(t) > PART ? splitBytes(t, PART) : [t];
    const pieces = parts.length > 1 ? parts.map((x, i) => ({ p: `${f.p}.part${i + 1}`, t: x })) : [{ p: f.p, t }];
    for (const pc of pieces) {
      const b = utf8Len(pc.t);
      if (size + b > PART && batch.length) { await flush(batch); batch = []; size = 0; }
      batch.push(pc); size += b;
    }
  }
  await flush(batch);
  const done = await post({
    id, done: true, model: meta.model.slice(0, 60), host: meta.host.slice(0, 40),
    skipped: [...meta.skipped, ...failed.map(f => `✗ ما وصل: ${f}`)].slice(0, 40),
  });
  return { ok: done && sent > 0, sent, failed, status };
}
