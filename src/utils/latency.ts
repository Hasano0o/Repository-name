export interface LatencyResult {
  median: number;
  min: number;
  jitter: number;
  lossPct: number;
  samples: number;
}

const ENDPOINT = 'https://speed.cloudflare.com/__down?bytes=0';

/* ═══ مناطق سيرفرات الألعاب ═══
 * نقيس لنقطة داخل نفس منطقة الاستضافة (AWS) اللي تستضيف عليها أغلب الألعاب سيرفراتها.
 * أي رد (حتى لو خطأ) يكفينا — اللي يهمنا زمن الرحلة فقط. */
export interface GameRegion {
  id: string;
  name: string;
  hint: string;
  url: string;
}

export const REGIONS: GameRegion[] = [
  { id: 'bh', name: 'البحرين', hint: 'سيرفرات الشرق الأوسط لأغلب الألعاب', url: 'https://dynamodb.me-south-1.amazonaws.com/ping' },
  { id: 'ae', name: 'الإمارات', hint: 'بعض سيرفرات الخليج', url: 'https://dynamodb.me-central-1.amazonaws.com/ping' },
  { id: 'eu', name: 'فرانكفورت', hint: 'سيرفرات أوروبا', url: 'https://dynamodb.eu-central-1.amazonaws.com/ping' },
  { id: 'cf', name: 'أقرب سيرفر', hint: 'Cloudflare — للمقارنة العامة', url: ENDPOINT },
];

export const regionById = (id?: string) => REGIONS.find(r => r.id === id) ?? REGIONS[0];

async function once(url: string, timeoutMs: number, method: 'GET' | 'HEAD'): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const sep = url.includes('?') ? '&' : '?';
    const r = await fetch(method === 'GET' ? `${url}${sep}r=${Math.random()}` : url, {
      method,
      signal: ctrl.signal,
      cache: 'no-store' as RequestCache,
    });
    if (method === 'GET') await r.text();
    return Date.now() - start;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** يقيس زمن الاستجابة لأي رابط: تسخين، ثم n قياسات */
export async function measureUrl(
  url: string,
  n = 12,
  timeoutMs = 3000,
  method: 'GET' | 'HEAD' = 'GET',
  gapMs = 120,
): Promise<LatencyResult> {
  const values: number[] = [];
  let lost = 0;

  await once(url, timeoutMs, method);

  for (let i = 0; i < n; i++) {
    const v = await once(url, timeoutMs, method);
    if (v === null) lost += 1;
    else values.push(v);
    await new Promise(r => setTimeout(r, gapMs));
  }

  if (!values.length) {
    return { median: 0, min: 0, jitter: 0, lossPct: 100, samples: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];

  let diffs = 0;
  for (let i = 1; i < values.length; i++) diffs += Math.abs(values[i] - values[i - 1]);
  const jitter = values.length > 1 ? Math.round(diffs / (values.length - 1)) : 0;

  return {
    median: Math.round(median),
    min: Math.round(min),
    jitter,
    lossPct: Math.round((lost / n) * 100),
    samples: values.length,
  };
}

export function measureLatency(n = 12, timeoutMs = 3000): Promise<LatencyResult> {
  return measureUrl(ENDPOINT, n, timeoutMs);
}

/** بين الجوال والراوتر فقط — يكشف هل المشكلة من الواي فاي */
export function measureWifi(host: string, n = 10): Promise<LatencyResult> {
  const base = /^https?:\/\//.test(host) ? host : `http://${host}`;
  return measureUrl(base.replace(/\/+$/, '') + '/', n, 1500, 'HEAD', 80);
}

export function gamingGrade(r: LatencyResult): { label: string; score: number } {
  if (!r.samples) return { label: 'فشل القياس', score: 0 };
  const p = r.median + r.jitter * 2 + r.lossPct * 8;
  if (p < 60) return { label: 'ممتاز للألعاب', score: 1 };
  if (p < 100) return { label: 'جيد', score: 0.75 };
  if (p < 160) return { label: 'مقبول', score: 0.5 };
  if (p < 250) return { label: 'ضعيف', score: 0.28 };
  return { label: 'سيئ', score: 0.12 };
}

/** درجة اللعب من 100 — التذبذب والفقد يوزنون أكثر من البنق لأنهم سبب اللاق الحقيقي */
export function gameScore(r: LatencyResult): number {
  if (!r.samples) return 0;
  const p = Math.max(0, r.median - 15) * 0.45 + r.jitter * 1.6 + r.lossPct * 9;
  return Math.max(0, Math.min(100, Math.round(100 - p)));
}

export type Light = 'green' | 'yellow' | 'red';

export function scoreLight(score: number): Light {
  if (score >= 70) return 'green';
  if (score >= 45) return 'yellow';
  return 'red';
}

export function scoreWord(score: number): string {
  if (score >= 85) return 'ممتاز للعب';
  if (score >= 70) return 'جيد للعب';
  if (score >= 45) return 'مقبول — ممكن لاق خفيف';
  if (score > 0) return 'سيئ — بتحس باللاق';
  return 'فشل القياس';
}

export interface Diagnosis {
  light: Light;
  score: number;
  title: string;
  cause?: string;
  fix?: string;
}

/**
 * «جاهز للعب؟» — يجمع قياس الواي فاي وقياس السيرفر والإشارة ويطلع السبب.
 * wifi = بين الجوال والراوتر، game = للسيرفر، sinr = نقاء إشارة الراوتر (إن توفر)
 */
export function diagnose(game: LatencyResult, wifi: LatencyResult | null, sinr?: number): Diagnosis {
  const score = gameScore(game);
  const light = scoreLight(score);

  if (!game.samples) {
    if (wifi && wifi.samples === 0) {
      return { light: 'red', score: 0, title: 'ما وصلنا للإنترنت', cause: 'جوالك مو متصل بواي فاي الراوتر', fix: 'اتصل بواي فاي الراوتر وأعد الفحص' };
    }
    return { light: 'red', score: 0, title: 'ما وصلنا للسيرفر', cause: 'النت مقطوع أو السيرفر ما رد', fix: 'تأكد إن النت شغال وأعد الفحص' };
  }

  const wifiBad = !!wifi && wifi.samples > 0 && (wifi.lossPct > 0 || wifi.jitter > 12 || wifi.min > 25);
  const wifiMissing = !!wifi && wifi.samples === 0;

  if (light === 'green' && !wifiBad) {
    return { light, score, title: 'جاهز للعب 🎮' };
  }

  if (wifiMissing) {
    return {
      light, score, title: light === 'green' ? 'جاهز، بس انتبه' : 'فيه مشكلة',
      cause: 'جوالك مو على واي فاي الراوتر — القياس لشريحة الجوال',
      fix: 'اتصل بواي فاي الراوتر عشان نقيس اتصالك الفعلي',
    };
  }

  if (wifiBad) {
    return {
      light: light === 'green' ? 'yellow' : light, score,
      title: 'المشكلة من الواي فاي',
      cause: `الاتصال بين جوالك والراوتر متذبذب (${wifi!.jitter}ms${wifi!.lossPct ? ` وفقد ${wifi!.lossPct}%` : ''})`,
      fix: 'قرّب من الراوتر، أو اتصل بشبكة 5GHz، أو استخدم كيبل للجهاز',
    };
  }

  if (sinr !== undefined && sinr < 5 && (game.jitter > 15 || game.lossPct > 0)) {
    return {
      light, score, title: 'الإشارة مشوشة',
      cause: `نقاء الإشارة ضعيف (SINR ${sinr.toFixed(1)}) فالبيانات تتعاد وتتأخر`,
      fix: 'وجّه الأنتنا من مساعد التوجيه، أو شغّل مُحسّن اللعبة تحت',
    };
  }

  if (game.jitter > 20 || game.lossPct > 1) {
    return {
      light, score, title: 'البرج زحمة الحين',
      cause: `الإشارة زينة، بس التذبذب ${game.jitter}ms${game.lossPct ? ` والفقد ${game.lossPct}%` : ''} — غالباً ضغط على البرج`,
      fix: 'جرّب مُحسّن اللعبة يدور لك تردد أهدى، أو العب وقت أخف',
    };
  }

  return {
    light, score, title: 'البنق عالي بس ثابت',
    cause: `الاستجابة ${game.median}ms — الطريق للسيرفر طويل`,
    fix: 'تأكد إنك على أقرب سيرفر داخل اللعبة، وشوف «أي سيرفر أقرب لك» تحت',
  };
}
