/**
 * «أوقات الزحمة» — من سجل فحوصات اللعب (اليدوية + القياس الخفيف بالخلفية):
 * متوسط البنق لكل ساعة من اليوم (آخر ١٤ يوم)، وأسوأ وأفضل فترة ساعتين، وكم يرتفع البنق وقت الزحمة.
 * صافية بدون react-native — مختبرة في tests/rushHours.test.ts.
 */

export interface RushSample { at: number; region: string; median: number; jitter: number; lossPct: number }

export interface HourStat { hour: number; count: number; ping?: number; jitter?: number; loss?: number }

export interface RushReport {
  hours: HourStat[];
  /** عدد القياسات المحسوبة */
  samples: number;
  /** كم ساعة من اليوم لها قياسين أو أكثر */
  hoursCovered: number;
  ready: boolean;
  worst?: { from: number; to: number; ping: number };
  best?: { from: number; to: number; ping: number };
  /** كم ٪ أعلى البنق وقت الزحمة عن أفضل وقت */
  risePct?: number;
}

const DAY = 86_400_000;
const WINDOW = 2;
/** أقل شي عشان نحكم: ٨ ساعات مغطاة و ٢٠ قياس */
const MIN_HOURS = 8;
const MIN_SAMPLES = 20;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
/** «ضغط» القياس: البنق + التذبذب مضاعف (التذبذب هو اللاق الحقيقي) */
const load = (h: HourStat) => (h.ping ?? 0) + (h.jitter ?? 0) * 2;

export function rushReport(list: RushSample[], now: number, region?: string, days = 14): RushReport {
  const since = now - days * DAY;
  const rows = list.filter(e => e.at >= since && e.at <= now && (!region || e.region === region) && e.median > 0);
  const buckets: RushSample[][] = Array.from({ length: 24 }, () => []);
  for (const e of rows) buckets[new Date(e.at).getHours()].push(e);
  // الوسيط بدل المتوسط: قياس شاذ واحد (الجوال طلع من الشبكة) ما يخرب الساعة
  const hours: HourStat[] = buckets.map((b, hour) => b.length
    ? { hour, count: b.length, ping: Math.round(median(b.map(x => x.median))), jitter: Math.round(median(b.map(x => x.jitter))), loss: Math.round(median(b.map(x => x.lossPct))) }
    : { hour, count: 0 });
  const covered = hours.filter(h => h.count >= 2);
  const ready = covered.length >= MIN_HOURS && rows.length >= MIN_SAMPLES;
  const out: RushReport = { hours, samples: rows.length, hoursCovered: covered.length, ready };
  if (!ready) return out;

  // نوافذ ساعتين متتالية (تلف حول منتصف الليل)، كل ساعة فيها لازم يكون لها قياسين على الأقل
  let worst: RushReport['worst'];
  let best: RushReport['best'];
  let worstLoad = -1, bestLoad = Infinity;
  for (let h = 0; h < 24; h++) {
    const win = Array.from({ length: WINDOW }, (_, i) => hours[(h + i) % 24]);
    if (win.some(x => x.count < 2)) continue;
    const l = win.reduce((a, x) => a + load(x), 0) / WINDOW;
    const ping = Math.round(win.reduce((a, x) => a + (x.ping ?? 0), 0) / WINDOW);
    if (l > worstLoad) { worstLoad = l; worst = { from: h, to: (h + WINDOW) % 24, ping }; }
    if (l < bestLoad) { bestLoad = l; best = { from: h, to: (h + WINDOW) % 24, ping }; }
  }
  if (worst && best && best.ping > 0) {
    out.worst = worst;
    out.best = best;
    out.risePct = Math.max(0, Math.round(((worst.ping - best.ping) / best.ping) * 100));
  }
  return out;
}

/** «٩ م» / «١٢ ص» — ساعة بنظام ١٢ */
export function hourLabel(h: number): string {
  const x = ((h % 24) + 24) % 24;
  const n = x % 12 === 0 ? 12 : x % 12;
  return `${n} ${x < 12 ? 'ص' : 'م'}`;
}
