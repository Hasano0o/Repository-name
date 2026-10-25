/**
 * «طلب جهاز جديد»: نرسل ملفات صفحة الراوتر كاملة (HTML + JS) للمطوّر بدل مقاطع مختارة —
 * عشان نعرف طريقة الدخول والروابط من أول تقرير، بدون ما نطلب من العضو يعيد كل شوي.
 *
 * • GET بس، على راوتر الشبكة المحلية بس (isLanHost) — ما ندخل ولا نرسل أي أمر للراوتر.
 * • ملفات الصفحة العامة (نفس اللي يحمّلها المتصفح قبل الدخول) — ما فيها بيانات العضو.
 *   للاحتياط نحجب رموز csrf وأي value في الخانات.
 * • نتخطى المكتبات المعروفة الكبيرة (jquery/vue/echarts…) — أسماؤها تكفي.
 * • حد: ١٫٥ ميقا للملف، ٨ ميقا للكل، ٨٠ ملف. نرسلها على دفعات صغيرة للسيرفر، والسيرفر يضغطها ويرسلها للبوت.
 */
import { isLanHost } from '../utils/host';
import { LIVE_BASE } from './live';
import { amdBaseOf, findAmdRefs } from './amdRefs';

const SKIP = /(jquery|vue(\.global|x|-router|-i18n)|element-plus|elementui|chunk-libs|echarts|tinymce|lottie|qrcode|axios\.min|jtopo|polyfill|bootstrap|font-?awesome|moment|lodash|highcharts|chart\.min|swiper|\.min\.js.*(forge|elliptic))/i;
const MAX_FILE = 1_500_000;
const MAX_TOTAL = 8_000_000;
const MAX_FILES = 80;
const PART = 550_000; // كل طلب أقل من ١ ميقا (حد nginx الافتراضي)

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
  /** مسار RequireJS الأساسي (نسبةً لجذر الصفحة) — لو الصفحة تستخدمه */
  let amdBase: string | null = null;
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
    const b = amdBaseOf(r.text);
    if (b !== null && (amdBase === null || /baseUrl/.test(r.text))) amdBase = b;
    if (amdBase !== null) {
      for (const ref of findAmdRefs(r.text, amdBase)) {
        const rp = resolvePath(ref, '/index.html');
        if (rp && !seen.has(rp) && !queue.includes(rp)) queue.push(rp);
      }
    }
  }
  return { files, skipped: [...new Set(skipped)] };
}

/** يرسل الملفات على دفعات؛ السيرفر يضغطها ويرسلها للبوت مع وصف قصير */
export async function sendRouterFiles(files: DumpFile[], meta: { model: string; host: string; skipped: string[] }): Promise<boolean> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const post = async (body: object) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(`${LIVE_BASE}/live-api/app/dump`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify(body),
      });
      return r.ok;
    } catch { return false; } finally { clearTimeout(t); }
  };
  let batch: DumpFile[] = [];
  let size = 0;
  for (const f of files) {
    // ملف أكبر من الدفعة: نقسّمه
    const pieces = f.t.length > PART ? Array.from({ length: Math.ceil(f.t.length / PART) }, (_, i) => ({ p: `${f.p}.part${i + 1}`, t: f.t.slice(i * PART, (i + 1) * PART) })) : [f];
    for (const pc of pieces) {
      if (size + pc.t.length > PART && batch.length) {
        if (!(await post({ id, files: batch }))) return false;
        batch = []; size = 0;
      }
      batch.push(pc); size += pc.t.length;
    }
  }
  if (batch.length && !(await post({ id, files: batch }))) return false;
  return post({ id, done: true, model: meta.model.slice(0, 60), host: meta.host.slice(0, 40), skipped: meta.skipped.slice(0, 40) });
}
