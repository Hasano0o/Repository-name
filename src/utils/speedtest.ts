/**
 * اختبار السرعة — على خوادم Cloudflare (speed.cloudflare.com)، بيانات حقيقية تنزل وترفع.
 * ─────────────────────────────────────────────
 * ليش كان يطلع أقل من الحقيقة: اتصال واحد + حجم ثابت صغير (٢٥ ميقا) — على 5G يخلص قبل ما يوصل سرعته.
 * الحين مثل الاختبارات المعروفة:
 *  • ٤ اتصالات مع بعض، وتزيد لين ٨ (٦ للرفع) لو الخط سريع — 5G ما يمتلي بأربع
 *  • بالوقت مو بالحجم: كل اتجاه ~٨ ثواني، والقطع تكبر لحالها حسب سرعتك
 *  • نتجاهل أول ثانية (بداية الاتصال)، والنتيجة الشريحة ٩٠٪ من نوافذ ١ ثانية (مثل Ookla) — speedCore.ts
 *  • البنق: ١٠ قياسات ← أقل قيمة + التذبذب، و«البنق تحت الضغط» وقت التنزيل
 * ما يرسل أي بيانات شخصية — بس طلبات تحميل ورفع لخادم القياس.
 */
export interface SpeedResult {
  pingMs: number;
  jitterMs: number;
  /** البنق وقت التنزيل — يكشف «البافر بلوت» (اللاق لما أحد يحمّل) */
  loadedPingMs?: number;
  downloadMbps: number;
  uploadMbps: number;
  /** ميقابايت استهلكها الاختبار */
  usedMB: number;
  /** وين قسنا (مدينة/رمز الخادم) والشركة لو عرفناها */
  server?: string;
  isp?: string;
}

export type SpeedPhase = 'meta' | 'ping' | 'download' | 'upload' | 'done';

export interface SpeedProgress {
  phase: SpeedPhase;
  /** القيمة الحالية للعدّاد (Mbps) */
  mbps?: number;
  /** ٠–١ داخل المرحلة */
  frac?: number;
  pingMs?: number;
  jitterMs?: number;
  loadedPingMs?: number;
  downloadMbps?: number;
  uploadMbps?: number;
  server?: string;
  isp?: string;
}

import { Chunk, finalMbps, wantStreams, windowMbps } from './speedCore';

const BASE = 'https://speed.cloudflare.com';
const STREAMS = 4;
const DUR_MS = 8000;
/**
 * سقف قطعة التنزيل: كانت ٥٠ ميقا × لين ٨ اتصالات = مئات الميقا في ذاكرة الجوال مع الخطوط السريعة (٣٠٠+ ميقابت)
 * ← أندرويد يقفل التطبيق (فيديو حسن ٢١ نوفمبر، «قِس الزحمة الحين» عند ٣٦٠ ميقا). ٢٠ ميقا = ~١٦٠ms على خط ١ جيجا.
 */
const MAX_DOWN = 20_000_000;
const WARMUP_MS = 1000;

const nocache = () => `r=${Math.random().toString(36).slice(2)}`;

async function timed(url: string, init: RequestInit = {}, timeoutMs = 15000, outer?: AbortSignal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuter = () => ctrl.abort();
  outer?.addEventListener?.('abort', onOuter);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
    outer?.removeEventListener?.('abort', onOuter);
  }
}

const COLO: Record<string, string> = {
  JED: 'جدة', RUH: 'الرياض', DMM: 'الدمام', DXB: 'دبي', FJR: 'الفجيرة', AUH: 'أبوظبي', BAH: 'البحرين',
  KWI: 'الكويت', DOH: 'الدوحة', MCT: 'مسقط', AMM: 'عمّان', CAI: 'القاهرة', FRA: 'فرانكفورت', MRS: 'مرسيليا',
  LHR: 'لندن', CDG: 'باريس', AMS: 'أمستردام', MXP: 'ميلانو', BOM: 'مومباي', SIN: 'سنغافورة',
};

/** وين بنقيس — best-effort (لو فشل نكمّل عادي). نستخدمها بعد في «نضيف راوترك» عشان نعرف الشركة من الإنترنت */
export async function readMeta(): Promise<{ server?: string; isp?: string }> {
  try {
    const r = await timed(`${BASE}/meta?${nocache()}`, {}, 4000);
    if (r.ok) {
      const j = await r.json();
      const colo = String(j?.colo ?? '').toUpperCase();
      return { server: COLO[colo] ?? (j?.city || colo || undefined), isp: j?.asOrganization || undefined };
    }
  } catch {}
  try {
    const r = await timed(`${BASE}/cdn-cgi/trace?${nocache()}`, {}, 4000);
    const txt = await r.text();
    const colo = (txt.match(/colo=([A-Z]+)/)?.[1] ?? '').toUpperCase();
    return { server: COLO[colo] ?? (colo || undefined) };
  } catch {}
  return {};
}

async function pingOnce(outer?: AbortSignal): Promise<number | null> {
  const t0 = Date.now();
  try {
    const r = await timed(`${BASE}/__down?bytes=0&${nocache()}`, {}, 4000, outer);
    await r.text();
    return Date.now() - t0;
  } catch { return null; }
}

/** min + التذبذب (متوسط الفرق بين قياسين ورا بعض) */
function pingStats(list: number[]): { min: number; jitter: number } {
  if (!list.length) return { min: 0, jitter: 0 };
  let j = 0;
  for (let i = 1; i < list.length; i++) j += Math.abs(list[i] - list[i - 1]);
  return { min: Math.min(...list), jitter: list.length > 1 ? j / (list.length - 1) : 0 };
}

/**
 * يشغّل عمّال يحمّلون/يرفعون قطع لين يخلص الوقت. نبدأ بـ STREAMS، ولو الخط سريع نزيد لين ٨ (٦ للرفع).
 * القطعة تكبر لحالها عشان كل طلب ياخذ ~٠٫٧ ثانية (أقل تأخير بين الطلبات = رقم أدق).
 * الحساب في speedCore: حجم كل قطعة يتوزّع على مدتها، والنتيجة الشريحة ٩٠٪ بعد الإحماء.
 */
async function transfer(
  kind: 'down' | 'up',
  onTick: (mbps: number, frac: number) => void,
  isCancelled: () => boolean,
  durMs: number = DUR_MS,
  /** أكبر قطعة تنزيل — كل قطعة تنحمّل كاملة في الذاكرة قبل ما نحسبها */
  maxDown: number = MAX_DOWN,
): Promise<{ mbps: number; bytes: number }> {
  const start = Date.now();
  const end = start + durMs;
  const chunks: Chunk[] = [];
  let total = 0;
  let failures = 0;
  const ctrl = new AbortController();
  const upCache = new Map<number, string>();
  const payload = (n: number) => {
    let p = upCache.get(n);
    if (!p) { p = '0'.repeat(n); upCache.set(n, p); }
    return p;
  };

  const worker = async () => {
    let size = kind === 'down' ? 1_000_000 : 250_000;
    while (Date.now() < end && !isCancelled()) {
      const t0 = Date.now();
      try {
        let got: number;
        if (kind === 'down') {
          const r = await timed(`${BASE}/__down?bytes=${size}&${nocache()}`, {}, 15000, ctrl.signal);
          // Blob بدل arrayBuffer: البيانات تبقى خارج ذاكرة JS (arrayBuffer بأندرويد يمر بـ base64 = ٣ أضعاف الحجم)
          const blob = await r.blob();
          got = blob.size;
          try { (blob as any).close?.(); } catch {}
        } else {
          const r = await timed(`${BASE}/__up?${nocache()}`, { method: 'POST', body: payload(size) }, 15000, ctrl.signal);
          await r.text();
          got = size;
        }
        total += got;
        chunks.push({ t0, t1: Date.now(), bytes: got });
        const took = Math.max(1, Date.now() - t0);
        // القطعة الجاية تاخذ ~٧٠٠ms (بين ٢٥٠ ألف و٥٠ ميقا تنزيل / ١٠ ميقا رفع)
        const max = kind === 'down' ? maxDown : 10_000_000;
        size = Math.round(Math.min(max, Math.max(250_000, (size * 700) / took)));
      } catch {
        if (Date.now() >= end || isCancelled()) break;
        if (++failures > 6) break;
        size = Math.max(250_000, Math.round(size / 2));
      }
    }
  };

  // العدّاد: كل ٢٥٠ms السرعة من آخر ٢ ثانية (بعد الإحماء) · وكل ثانية نشيك نزيد اتصالات؟
  const running: Promise<void>[] = [];
  let lastGrow = start + 1500;
  const tick = setInterval(() => {
    const now = Date.now();
    // القطع اللي لسا ما خلصت ما تنحسب ← النافذة تنتهي عند آخر قطعة خلصت
    let lastT = start;
    for (const c of chunks) if (c.t1 > lastT) lastT = c.t1;
    const from = Math.max(start + WARMUP_MS, lastT - 2000);
    const cur = lastT > from ? windowMbps(chunks, from, lastT) : 0;
    onTick(cur, Math.min(1, (now - start) / durMs));
    if (now >= lastGrow + 1000 && now < end - 2500) {
      lastGrow = now;
      const want = wantStreams(running.length, cur, kind);
      while (running.length < want) running.push(worker());
    }
  }, 250);

  try {
    for (let i = 0; i < STREAMS; i++) running.push(worker());
    // العمّال الجدد ينضافون للمصفوفة وقت الشغل — ننتظر لين ما يبقى أحد
    for (let n = 0; n < running.length; n++) await running[n];
  } finally {
    clearInterval(tick);
    ctrl.abort();
  }
  if (isCancelled()) throw new Error('cancelled');
  if (!chunks.length) throw new Error(kind === 'down' ? 'ما قدرنا نحمّل من خادم القياس' : 'ما قدرنا نرفع لخادم القياس');
  return { mbps: finalMbps(chunks, start, { warmupMs: WARMUP_MS }), bytes: total };
}

/** تنزيل قصير بس (بدون بنق ولا رفع) — لـ«قِس الزحمة الحين» */
export async function quickDownload(
  durMs = 6000,
  onTick: (mbps: number, frac: number) => void = () => {},
  isCancelled: () => boolean = () => false,
): Promise<{ mbps: number; bytes: number }> {
  // القياس القصير يكفيه قطع أصغر — أخف على الذاكرة (٨ اتصالات × ٨ ميقا بالكثير)
  return transfer('down', onTick, isCancelled, durMs, 8_000_000);
}

export async function runSpeedTest(
  onProgress: (p: SpeedProgress) => void = () => {},
  isCancelled: () => boolean = () => false,
): Promise<SpeedResult> {
  try {
    onProgress({ phase: 'meta' });
    const meta = await readMeta();
    const base: SpeedProgress = { phase: 'ping', ...meta };

    // ═══ البنق ═══
    onProgress(base);
    const pings: number[] = [];
    for (let i = 0; i < 10 && !isCancelled(); i++) {
      const p = await pingOnce();
      if (p !== null) pings.push(p);
      const st = pingStats(pings);
      onProgress({ ...base, frac: (i + 1) / 10, pingMs: pings.length ? st.min : undefined, jitterMs: pings.length > 1 ? st.jitter : undefined });
    }
    if (!pings.length) throw new Error('offline');
    const ps = pingStats(pings);

    // ═══ التنزيل (+ البنق تحت الضغط) ═══
    const loaded: number[] = [];
    let stopLoaded = false;
    const loadedLoop = (async () => {
      await new Promise(r => setTimeout(r, 1500));
      while (!stopLoaded && !isCancelled()) {
        const p = await pingOnce();
        if (p !== null) loaded.push(p);
        await new Promise(r => setTimeout(r, 400));
      }
    })();
    const after = { pingMs: ps.min, jitterMs: ps.jitter, ...meta };
    const median = (l: number[]) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : undefined; };
    const down = await transfer('down', (mbps, frac) => onProgress({ phase: 'download', mbps, frac, ...after, loadedPingMs: median(loaded) }), isCancelled);
    stopLoaded = true;
    await loadedLoop;
    const loadedPingMs = median(loaded);

    // ═══ الرفع ═══
    const after2 = { ...after, loadedPingMs, downloadMbps: down.mbps };
    const up = await transfer('up', (mbps, frac) => onProgress({ phase: 'upload', mbps, frac, ...after2 }), isCancelled);

    const res: SpeedResult = {
      pingMs: Math.round(ps.min),
      jitterMs: Math.round(ps.jitter * 10) / 10,
      loadedPingMs: loadedPingMs !== undefined ? Math.round(loadedPingMs) : undefined,
      downloadMbps: down.mbps,
      uploadMbps: up.mbps,
      usedMB: Math.round((down.bytes + up.bytes) / 1e6),
      ...meta,
    };
    onProgress({ phase: 'done', ...after2, uploadMbps: up.mbps, mbps: down.mbps });
    return res;
  } catch (e: any) {
    if (isCancelled() || e?.message === 'cancelled') throw new Error('وقّفنا الاختبار');
    if (e?.name === 'AbortError') throw new Error('الاختبار أخذ وقت طويل — الاتصال بطيء أو منقطع');
    if (e?.message && /خادم القياس/.test(e.message)) throw e;
    throw new Error('تعذر إجراء الاختبار — تأكد إن الإنترنت شغال');
  }
}

// ═══ وش يكفي له اتصالك (للأيقونات تحت العدّاد) — ٠ إلى ٥ ═══
export interface UseRating { key: 'browse' | 'video' | 'game' | 'call'; label: string; score: number }
export function ratingsFor(r: Pick<SpeedResult, 'downloadMbps' | 'uploadMbps' | 'pingMs' | 'jitterMs' | 'loadedPingMs'>): UseRating[] {
  const step = (v: number, th: number[]) => th.filter(t => v >= t).length; // كم عتبة تعدّاها
  const lowIsGood = (v: number, th: number[]) => th.filter(t => v <= t).length;
  const lag = Math.max(r.pingMs, r.loadedPingMs ?? 0);
  return [
    { key: 'browse', label: 'التصفح', score: step(r.downloadMbps, [1, 3, 8, 15, 30]) },
    { key: 'video', label: 'الفيديو', score: step(r.downloadMbps, [3, 8, 15, 25, 50]) }, // 4K يبي ٢٥+
    { key: 'game', label: 'الألعاب', score: Math.min(lowIsGood(lag, [200, 120, 80, 50, 30]), lowIsGood(r.jitterMs, [60, 30, 15, 8, 4])) },
    { key: 'call', label: 'المكالمات', score: Math.min(step(r.uploadMbps, [0.5, 1, 2, 4, 8]), lowIsGood(r.jitterMs, [60, 30, 15, 8, 4])) },
  ];
}
