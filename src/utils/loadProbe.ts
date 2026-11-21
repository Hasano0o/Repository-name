/**
 * «قِس الزحمة الحين» — صافي بدون fetch (اختبارات في tests/loadProbe.test.ts).
 *
 * نقارن السرعة اللي وصلت فعلاً (اختبار تنزيل قصير، ومعه مجموع تحميل الراوتر لو أكبر — يشمل الأجهزة الثانية)
 * بالسرعة اللي المفروض تعطيها إشارتك (عرض النطاق × كفاءة الترميز من SINR).
 * الزحمة تقلل نصيبك من وقت البرج: الإشارة تسمح بـ ٥٠ ووصلك ٥ ← البرج مزحوم.
 * هذا يشتغل حتى مع التشويش، لأن التشويش ينزّل السرعة المتوقعة نفسها.
 */
import type { Signal, Carrier } from '../drivers/types';

const TDD_LTE = new Set([38, 39, 40, 41, 42, 43, 46, 48]);
const TDD_NR = new Set([34, 38, 39, 40, 41, 46, 48, 77, 78, 79]);

const mhz = (s?: string) => {
  const m = (s ?? '').match(/(\d+(?:\.\d+)?)\s*MHz/i);
  return m ? parseFloat(m[1]) : undefined;
};
const bandNum = (s?: string) => {
  const m = (s ?? '').match(/(?:^|[^\d])[Bn]?(\d{1,3})(?:[^\d]|$)/i);
  return m ? parseInt(m[1], 10) : undefined;
};

/**
 * ميقابت لناقل واحد: العرض × كفاءة الترميز × عدد المسارات × حصة التنزيل.
 * الكفاءة = ٠٫٧٥ × log2(1+SINR) (خصم التحكم والإشارات المرجعية) وسقفها ٥ لكل مسار (256QAM عملياً).
 * مسارين (MIMO) بس لما SINR ١٢+ — تحتها البرج يرسل مسار واحد غالباً.
 */
export function carrierMbps(bwMhz: number, sinr: number | undefined, tdd: boolean): number {
  if (sinr === undefined || !Number.isFinite(sinr) || bwMhz <= 0) return 0;
  const snr = Math.pow(10, Math.max(-5, Math.min(30, sinr)) / 10);
  const perLayer = Math.min(5, 0.75 * Math.log2(1 + snr));
  const layers = sinr >= 12 ? 2 : 1;
  return bwMhz * perLayer * layers * (tdd ? 0.7 : 1);
}

/** السرعة اللي المفروض توصلها إشارتك (ميقابت) — undefined لو ما عندنا SINR */
export function expectedMbps(sig: Signal, carriers: Carrier[] = []): number | undefined {
  if (carriers.length) {
    let sum = 0;
    let known = false;
    for (const c of carriers) {
      const s = c.sinr ?? (c.tech === 'NR' ? sig.nrSinr : c.role === 'PCC' ? sig.sinr : undefined);
      if (s === undefined) continue;
      known = true;
      const bw = c.bandwidth ?? (c.tech === 'NR' ? 40 : 10);
      sum += carrierMbps(bw, s, (c.tech === 'NR' ? TDD_NR : TDD_LTE).has(c.band));
    }
    if (known) return sum;
  }
  if (sig.sinr === undefined && sig.nrSinr === undefined) return undefined;
  let sum = 0;
  if (sig.sinr !== undefined) {
    const b = bandNum(sig.band);
    sum += carrierMbps(mhz(sig.dlBandwidth) ?? 20, sig.sinr, b !== undefined && TDD_LTE.has(b));
  }
  if (sig.nrSinr !== undefined && (sig.nrRsrp !== undefined || sig.nrActiveFromStatus)) {
    const b = bandNum(sig.nrBand);
    sum += carrierMbps(mhz(sig.nrDlBandwidth) ?? 40, sig.nrSinr, b === undefined || TDD_NR.has(b));
  }
  return sum;
}

export type ProbeLevel = 'free' | 'normal' | 'busy' | 'packed' | 'weak';
export interface ProbeResult {
  level: ProbeLevel;
  /** نسبة الزحمة ٠–١ (١ − الواصل/المتوقع) */
  load?: number;
  gotMbps: number;
  expMbps: number;
  title: string;
  note: string;
}

/** got = أعلى سرعة وصلت (اختبارنا أو مجموع تحميل الراوتر)، exp = المتوقع من الإشارة */
export function judgeProbe(gotMbps: number, expMbps: number | undefined): ProbeResult | undefined {
  if (expMbps === undefined || !Number.isFinite(gotMbps)) return undefined;
  const got = Math.max(0, gotMbps);
  const exp = Math.max(0, expMbps);
  // الإشارة نفسها ما تسمح بأكثر من كم ميقا — البطء من الإشارة مو الزحمة
  if (exp < 6) {
    return {
      level: 'weak', gotMbps: got, expMbps: exp,
      title: 'السرعة محدودة بإشارتك',
      note: 'إشارتك ما تسمح بأكثر من كذا حتى لو البرج فاضي — حسّن الإشارة أول (التوجيه أو مكان الراوتر)، وبعدها نقيس الزحمة.',
    };
  }
  const ratio = Math.min(1, got / exp);
  const load = Math.round((1 - ratio) * 100) / 100;
  if (ratio >= 0.6) {
    return { level: 'free', load, gotMbps: got, expMbps: exp, title: 'البرج مرتاح', note: 'السرعة قريبة من اللي تسمح فيه إشارتك — ما فيه زحمة تُذكر الحين.' };
  }
  if (ratio >= 0.35) {
    return { level: 'normal', load, gotMbps: got, expMbps: exp, title: 'ضغط طبيعي', note: 'فيه ناس على البرج بس السرعة معقولة لإشارتك.' };
  }
  if (ratio >= 0.15) {
    return { level: 'busy', load, gotMbps: got, expMbps: exp, title: 'البرج مزحوم', note: 'إشارتك تسمح بسرعة أعلى بكثير من اللي وصلت — السبب زحمة البرج مو إشارتك. جرّب وقت ثاني أو تردد/برج ثاني.' };
  }
  return { level: 'packed', load, gotMbps: got, expMbps: exp, title: 'البرج مزحوم جداً', note: 'وصلك جزء صغير من اللي تسمح فيه إشارتك — البرج مضغوط بقوة الحين. جرّب تردد أو برج ثاني، أو قِس بعد ساعة.' };
}
