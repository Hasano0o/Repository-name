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
const SKIP = /(copyrightPage|opensource|privatePolicy|\/faq[\w-]*\.html|chunk-vendors|jquery|element-plus|elementui|chunk-libs|echarts|tinymce|lottie|jtopo|topo\.min|\/element(\.min)?\.js|font-?awesome|moment|lodash|highcharts|chart\.min|swiper|\.min\.js.*(forge|elliptic))/i;
const MAX_FILE = 1_500_000;
const MAX_TOTAL = 8_000_000;
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

/** احتياط: ما نرسل رموز جلسة أو قيم خانات حتى لو موجودة في الصفحة */
export function scrub(text: string): string {
  return text
    .replace(/(<meta[^>]+name=["']?csrf[\w-]*["']?[^>]*content=)["'][^"']*["']/gi, '$1"«محذوف»"')
    .replace(/(<input[^>]*\svalue=)["'][^"']*["']/gi, '$1"«محذوف»"');
}

async function get(url: string, ms = 6000): Promise<{ ok: boolean; text: string; type: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' } as any);
    const type = r.headers.get('content-type') || '';
    const text = await r.text();
    return { ok: r.ok, text, type };
  } catch {
    return { ok: false, text: '', type: '' };
  } finally {
    clearTimeout(t);
  }
}

export interface DumpFile { p: string; t: string }

export async function collectRouterFiles(host: string, onStep?: (n: number) => void): Promise<{ files: DumpFile[]; skipped: string[] }> {
  if (!isLanHost(host)) throw new Error('العنوان لازم يكون محلي');
  const base = 'http://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const files: DumpFile[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = ['/'];
  let total = 0;
  let homeSample = '';
  /** إعداد RequireJS (المسار الأساسي + paths) — لو الصفحة تستخدمه */
  let amd: AmdConfig | null = null;
  while (queue.length && files.length < MAX_FILES && total < MAX_TOTAL) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    if (SKIP.test(p)) { skipped.push(p); continue; }
    const r = await get(base + p);
    if (!r.ok || !r.text) continue;
    // راوترات ترجع الصفحة الرئيسية لأي رابط مو موجود — ما نكررها
    if (p !== '/' && homeSample && r.text.slice(0, 400) === homeSample) continue;
    if (p === '/') homeSample = r.text.slice(0, 400);
    const t = scrub(r.text.slice(0, MAX_FILE));
    files.push({ p: p === '/' ? '/index.html' : p, t });
    total += t.length;
    onStep?.(files.length);
    for (const ref of findRefs(r.text)) {
      const rp = resolvePath(ref, p === '/' ? '/index.html' : p);
      if (rp && !seen.has(rp) && !queue.includes(rp)) queue.push(rp);
    }
    amd = readAmdConfig(r.text, amd);
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
  if (files.some(f => /get_xmlnode_js_file/.test(f.t) && /FHNCAPIS/.test(f.t))) {
    const r = await fiberhomeNodes(base);
    files.push(r.ok ? { p: '/_bandly/xmlnode.js', t: scrub(r.text.slice(0, MAX_FILE)) } : { p: '/_bandly/xmlnode-error.txt', t: r.text });
    onStep?.(files.length);
  }
  return { files, skipped: [...new Set(skipped)] };
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
