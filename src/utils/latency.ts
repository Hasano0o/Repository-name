export interface LatencyResult {
  median: number;
  min: number;
  jitter: number;
  lossPct: number;
  samples: number;
  /** سبب الفشل بالعربي لو ما وصلنا للخادم أبداً */
  error?: string;
  /** الخادم اللي فعلاً قسنا عليه (لو استخدمنا البديل) */
  via?: string;
}

const ENDPOINT = 'https://speed.cloudflare.com/__down?bytes=0';

/* ═══ مناطق سيرفرات الألعاب ═══
 * نقيس لنقطة داخل نفس منطقة الاستضافة (AWS) اللي تستضيف عليها أغلب الألعاب سيرفراتها.
 * أي رد (حتى لو خطأ 403) يكفينا — اللي يهمنا زمن الرحلة فقط.
 * لكل منطقة خادم بديل لو الأول محجوب. */
export interface GameRegion {
  id: string;
  name: string;
  hint: string;
  url: string;
  alt: string[];
}

export const REGIONS: GameRegion[] = [
  // البحرين (me-south-1) متوقفة من 2026 بعد استهداف مراكز بيانات AWS — شلناها
  { id: 'ae', name: 'الإمارات', hint: 'الأقرب لسيرفرات الشرق الأوسط', url: 'https://dynamodb.me-central-1.amazonaws.com/ping', alt: ['https://s3.me-central-1.amazonaws.com/', 'https://ec2.me-central-1.amazonaws.com/ping'] },
  { id: 'in', name: 'الهند', hint: 'سيرفرات آسيا الغربية (مومباي)', url: 'https://dynamodb.ap-south-1.amazonaws.com/ping', alt: ['https://s3.ap-south-1.amazonaws.com/', 'https://ec2.ap-south-1.amazonaws.com/ping'] },
  { id: 'it', name: 'إيطاليا', hint: 'سيرفرات جنوب أوروبا (ميلان)', url: 'https://dynamodb.eu-south-1.amazonaws.com/ping', alt: ['https://s3.eu-south-1.amazonaws.com/', 'https://ec2.eu-south-1.amazonaws.com/ping'] },
  { id: 'eu', name: 'ألمانيا', hint: 'سيرفرات أوروبا (فرانكفورت)', url: 'https://dynamodb.eu-central-1.amazonaws.com/ping', alt: ['https://s3.eu-central-1.amazonaws.com/', 'https://ec2.eu-central-1.amazonaws.com/ping'] },
  { id: 'fr', name: 'فرنسا', hint: 'سيرفرات أوروبا (باريس)', url: 'https://dynamodb.eu-west-3.amazonaws.com/ping', alt: ['https://s3.eu-west-3.amazonaws.com/', 'https://ec2.eu-west-3.amazonaws.com/ping'] },
  { id: 'uk', name: 'بريطانيا', hint: 'سيرفرات أوروبا (لندن)', url: 'https://dynamodb.eu-west-2.amazonaws.com/ping', alt: ['https://s3.eu-west-2.amazonaws.com/', 'https://ec2.eu-west-2.amazonaws.com/ping'] },
  { id: 'se', name: 'السويد', hint: 'سيرفرات شمال أوروبا (ستوكهولم)', url: 'https://dynamodb.eu-north-1.amazonaws.com/ping', alt: ['https://s3.eu-north-1.amazonaws.com/', 'https://ec2.eu-north-1.amazonaws.com/ping'] },
  { id: 'sg', name: 'سنغافورة', hint: 'سيرفرات آسيا', url: 'https://dynamodb.ap-southeast-1.amazonaws.com/ping', alt: ['https://s3.ap-southeast-1.amazonaws.com/', 'https://ec2.ap-southeast-1.amazonaws.com/ping'] },
  { id: 'us', name: 'أمريكا', hint: 'سيرفرات أمريكا الشرقية (فرجينيا)', url: 'https://dynamodb.us-east-1.amazonaws.com/ping', alt: ['https://s3.us-east-1.amazonaws.com/', 'https://ec2.us-east-1.amazonaws.com/ping'] },
  { id: 'cf', name: 'أقرب سيرفر', hint: 'Cloudflare — للمقارنة العامة', url: ENDPOINT, alt: ['https://www.cloudflare.com/cdn-cgi/trace', 'https://1.1.1.1/cdn-cgi/trace'] },
];

export const REGION_KEY = 'bandly.gameRegion';

export const regionById = (id?: string) => REGIONS.find(r => r.id === id) ?? REGIONS[0];

interface Hit { ms: number | null; err?: string }

function reason(e: any, timeoutMs: number): string {
  const name = String(e?.name ?? '');
  const msg = String(e?.message ?? e ?? '');
  if (name === 'AbortError' || /abort|cancel/i.test(msg)) return `انتهت المهلة — الخادم ما رد خلال ${Math.round(timeoutMs / 1000)} ثواني من شبكتك`;
  if (/network request failed/i.test(msg)) return 'الشبكة رفضت الاتصال (ممكن حاجب إعلانات أو DNS خاص أو VPN)';
  if (/ssl|certificate|handshake/i.test(msg)) return 'فشل الاتصال الآمن (شهادة)';
  return msg ? `خطأ: ${msg.slice(0, 80)}` : 'خطأ غير معروف';
}

async function hit(url: string, timeoutMs: number, method: 'GET' | 'HEAD'): Promise<Hit> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const sep = url.includes('?') ? '&' : '?';
    const target = method === 'GET' ? `${url}${sep}r=${Math.random().toString(36).slice(2, 8)}` : url;
    const start = Date.now();
    const r = await fetch(target, { method, signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } });
    // نحسب الوقت لحد وصول رأس الرد — قراءة الجسم ما تدخل في البنق
    const ms = Date.now() - start;
    if (method === 'GET') { try { await r.text(); } catch {} }
    return { ms };
  } catch (e) {
    return { ms: null, err: reason(e, timeoutMs) };
  } finally {
    clearTimeout(t);
  }
}

async function once(url: string, timeoutMs: number, method: 'GET' | 'HEAD'): Promise<number | null> {
  return (await hit(url, timeoutMs, method)).ms;
}

/** قياس واحد — null إذا ما رد */
export const pingOnce = (url: string, timeoutMs = 2000) => once(url, timeoutMs, 'GET');
export const wifiOnce = (host: string, timeoutMs = 1200) => {
  const base = /^https?:\/\//.test(host) ? host : `http://${host}`;
  return once(base.replace(/\/+$/, '') + '/', timeoutMs, 'HEAD');
};

const hostOf = (u: string) => u.replace(/^https?:\/\//, '').split('/')[0];

/**
 * يقيس زمن الاستجابة: يجرب الخادم الأول، ولو ما رد يجرب البدائل بالترتيب.
 * تسخينتين (أول اتصال فيه فتح الاتصال الآمن وما ينحسب)، بعدها n قياسات.
 */
export async function measureUrl(
  urls: string | string[],
  n = 12,
  timeoutMs = 3000,
  method: 'GET' | 'HEAD' = 'GET',
  gapMs = 120,
): Promise<LatencyResult> {
  const list = Array.isArray(urls) ? urls : [urls];
  let url = '';
  let lastErr = '';
  for (const u of list) {
    const w = await hit(u, timeoutMs, method);
    if (w.ms !== null) { url = u; break; }
    lastErr = w.err ?? lastErr;
  }
  if (!url) return { median: 0, min: 0, jitter: 0, lossPct: 100, samples: 0, error: lastErr || 'الخادم ما رد' };
  await hit(url, timeoutMs, method);

  const values: number[] = [];
  let lost = 0;
  let err = '';
  for (let i = 0; i < n; i++) {
    const v = await hit(url, timeoutMs, method);
    if (v.ms === null) { lost += 1; err = v.err ?? err; }
    else values.push(v.ms);
    await new Promise(r => setTimeout(r, gapMs));
  }

  if (!values.length) {
    return { median: 0, min: 0, jitter: 0, lossPct: 100, samples: 0, error: err || 'الخادم ما رد' };
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
    via: url !== list[0] ? hostOf(url) : undefined,
  };
}

/** كل روابط المنطقة: الأساسي ثم البدائل */
export const regionUrls = (r: GameRegion) => [r.url, ...r.alt];

export function measureLatency(n = 12, timeoutMs = 3000): Promise<LatencyResult> {
  return measureUrl(regionUrls(regionById('cf')), n, timeoutMs);
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
  // القياس عبر HTTPS أعلى من بنق اللعبة (UDP) بشوي، فالعقوبة تبدأ بعد 30ms
  const p = Math.max(0, r.median - 30) * 0.3 + r.jitter * 1.0 + r.lossPct * 8;
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
  /** شاشة تحل المشكلة */
  action?: 'devices' | 'aim';
}

/**
 * «جاهز للعب؟» — يجمع قياس الواي فاي وقياس السيرفر والإشارة ويطلع السبب.
 * wifi = بين الجوال والراوتر، game = للسيرفر، sinr = نقاء إشارة الراوتر (إن توفر)
 */
export function diagnose(game: LatencyResult, wifi: LatencyResult | null, sinr?: number, downBps?: number): Diagnosis {
  const score = gameScore(game);
  const light = scoreLight(score);

  if (!game.samples) {
    if (wifi && wifi.samples === 0) {
      return { light: 'red', score: 0, title: 'ما وصلنا للإنترنت', cause: 'جوالك مو متصل بواي فاي الراوتر', fix: 'اتصل بواي فاي الراوتر وأعد الفحص' };
    }
    return { light: 'red', score: 0, title: 'ما وصلنا للسيرفر', cause: game.error ?? 'النت مقطوع أو السيرفر ما رد', fix: 'افتح «أي سيرفر أقرب لك؟» تحت وشوف أي خادم يرد. لو كلها ما ترد: طفّ حاجب الإعلانات أو الـ DNS الخاص في إعدادات الجوال' };
  }

  // نقيس الراوتر عبر صفحة إدارته، وهي بطيئة ومتذبذبة بطبيعتها (معالج الراوتر مشغول)
  // فما نحكم على الواي فاي إلا بالفقد أو لو حتى أسرع رد كان بطيء جداً
  const wifiBad = !!wifi && wifi.samples > 0 && (wifi.lossPct >= 20 || wifi.min > 60);
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
      cause: wifi!.lossPct >= 20
        ? `الراوتر ما يرد على جوالك بثبات (فقد ${wifi!.lossPct}%)`
        : `حتى أسرع رد من الراوتر أخذ ${wifi!.min}ms — الواي فاي ضعيف`,
      fix: 'قرّب من الراوتر، أو اتصل بشبكة 5GHz، أو استخدم كيبل للجهاز',
    };
  }

  const heavy = downBps !== undefined && downBps > 1.5 * 1024 * 1024;
  if (heavy && (light !== 'green' || game.jitter > 12)) {
    return {
      light: light === 'green' ? 'yellow' : light, score,
      title: 'فيه جهاز ثاني ياكل النت',
      cause: `الراوتر يحمّل الحين ${(downBps! / 1048576).toFixed(1)} ميقابايت/ث غير لعبتك — هذا يرفع البنق والتذبذب`,
      fix: 'وقّف التحميل أو افصل الجهاز وقت اللعب',
      action: 'devices',
    };
  }

  if (sinr !== undefined && sinr < 5 && (game.jitter > 15 || game.lossPct > 0)) {
    return {
      light, score, title: 'الإشارة مشوشة',
      cause: `نقاء الإشارة ضعيف (SINR ${sinr.toFixed(1)}) فالبيانات تتعاد وتتأخر`,
      fix: 'وجّه الأنتنا من مساعد التوجيه، أو شغّل مُحسّن اللعبة تحت',
      action: 'aim',
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
