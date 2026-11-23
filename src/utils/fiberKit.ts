/**
 * «عدّة الألياف» (حسن ٢٣ نوفمبر) — مزايا تشتغل بدون دخول الراوتر:
 *  • سرعتك مقابل باقتك: السرعة الحقيقية ÷ سرعة الباقة + تشخيص (الواي فاي / حد الجوال / الشركة)
 *  • الواي فاي بالغرف: لكل غرفة بنق الجوال↔الراوتر + تنزيل قصير ← درجة ونصيحة
 * صافي (بدون react-native) — ينختبر في tests/fiberKit.test.ts.
 */

export const PLAN_CHOICES = [100, 200, 300, 500, 1000];

/** قياس الواي فاي (الجوال ↔ الراوتر) — نفس شكل LatencyResult */
export interface WifiRead { median: number; jitter: number; lossPct: number; samples: number }

/** قوة الواي فاي من الجوال (أندرويد — بناء ٢٣ نوفمبر) */
export interface PhoneWifi { rssi?: number | null; frequency?: number | null; linkSpeed?: number | null }

export type WifiBand = '2.4' | '5' | '6';
export function wifiBand(freq?: number | null): WifiBand | undefined {
  if (!freq || freq <= 0) return undefined;
  return freq < 3000 ? '2.4' : freq < 5925 ? '5' : '6';
}
export type RssiLevel = 'excellent' | 'good' | 'fair' | 'poor';
export function rssiLevel(rssi: number): RssiLevel {
  if (rssi >= -55) return 'excellent';
  if (rssi >= -67) return 'good';
  if (rssi >= -75) return 'fair';
  return 'poor';
}
/** ٠–١٠٠: ‎-90 = صفر · ‎-55 وفوق = ١٠٠ */
export const rssiScore = (rssi: number) => Math.round(Math.max(0, Math.min(100, ((rssi + 90) / 35) * 100)));
/** جوال قريب (قوي) بس على 2.4 جيجا — يضيّع سرعة */
export const near24 = (w?: PhoneWifi | null) => !!w && wifiBand(w.frequency) === '2.4' && typeof w.rssi === 'number' && w.rssi >= -62;

export type PlanVerdict = 'ok' | 'wifi' | 'phone' | 'isp' | 'unknown';
export interface PlanCheck { pct: number; verdict: PlanVerdict; title: string; why: string; steps: string[] }

/** الواي فاي ضعيف: بنق للراوتر عالي، أو متذبذب، أو فيه فقد */
export function wifiWeak(w?: WifiRead | null): boolean {
  return !!w && w.samples > 0 && (w.median > 15 || w.jitter > 12 || w.lossPct >= 5);
}

export function judgePlan(planMbps: number, downMbps: number, wifi?: WifiRead | null, phone?: PhoneWifi | null): PlanCheck {
  const pct = planMbps > 0 ? Math.round((downMbps / planMbps) * 100) : 0;
  // جوال على 2.4 جيجا وباقة فوق ١٠٠ ← 2.4 ما يوصل أكثر من ~١٠٠ ميقا عادةً
  if (pct < 80 && planMbps > 100 && wifiBand(phone?.frequency) === '2.4') {
    return {
      pct, verdict: 'wifi', title: 'جوالك على شبكة 2.4 جيجا',
      why: 'شبكة 2.4 جيجا بطيئة وما توصل سرعة الألياف — حتى لو الإشارة قوية.',
      steps: [
        'اتصل بشبكة 5 جيجا من نفس الراوتر (غالباً في اسمها 5G) وأعد الفحص',
        'لو ما فيه شبكة 5 جيجا: فعّلها من إعدادات الراوتر أو افصل الشبكتين باسمين مختلفين',
      ],
    };
  }
  if (pct >= 80) {
    return {
      pct, verdict: 'ok', title: 'توصلك سرعة باقتك ✓',
      why: 'السرعة اللي قسناها قريبة من سرعة باقتك — الخط والواي فاي تمام.',
      steps: [],
    };
  }
  if (wifiWeak(wifi)) {
    return {
      pct, verdict: 'wifi', title: 'النقص من الواي فاي',
      why: 'الاتصال بين جوالك والراوتر ضعيف أو متقطع، فالسرعة تضيع قبل ما توصل الخط.',
      steps: [
        'قرّب من الراوتر وأعد القياس — لو زادت السرعة فالمشكلة المسافة أو الجدران',
        'اتصل بشبكة 5 جيجا (غالباً في اسمها 5G) — أسرع بكثير من 2.4',
        'افحص «الواي فاي بالغرف» تعرف أضعف مكان في البيت',
        'لو البيت كبير: مقوّي أو Mesh بين الراوتر والمكان الضعيف',
      ],
    };
  }
  if (!wifi || wifi.samples === 0) {
    return {
      pct, verdict: 'unknown', title: 'السرعة أقل من باقتك',
      why: 'ما قدرنا نقيس الواي فاي بين جوالك والراوتر، فما نقدر نحدد السبب بالضبط.',
      steps: [
        'تأكد إن جوالك متصل بواي فاي الراوتر (مو بيانات الجوال)',
        'قرّب من الراوتر وأعد القياس',
        'لو تكرر النقص: أعد تشغيل الراوتر وجرّب بوقت ثاني',
      ],
    };
  }
  if (planMbps >= 500 && downMbps >= 200) {
    return {
      pct, verdict: 'phone', title: 'غالباً هذا حد الواي فاي في جوالك',
      why: 'الواي فاي عندك سليم، بس أغلب الجوالات ما تتعدى ٣٠٠–٦٠٠ ميقا على الواي فاي حتى لو الخط أسرع.',
      steps: [
        'جرّب من جوال أحدث (Wi‑Fi 6) أو كمبيوتر بكيبل — تشوف سرعة الخط الحقيقية',
        'خلك على شبكة 5 جيجا وقريب من الراوتر',
      ],
    };
  }
  return {
    pct, verdict: 'isp', title: 'الواي فاي سليم — النقص غالباً من الشركة',
    why: 'الاتصال بين جوالك والراوتر ممتاز، والسرعة توصل أقل من باقتك من جهة الخط.',
    steps: [
      'أعد القياس بوقت ثاني — الزحمة بالليل تنزّل السرعة',
      'أعد تشغيل الراوتر وقِس مرة ثانية',
      'لو تكرر النقص ٣ مرات بأوقات مختلفة: انسخ التقرير وأرسله لدعم الشركة',
    ],
  };
}

export interface PlanCheckLog { at: number; plan: number; down: number; up: number; ping: number; wifiMs?: number; verdict: PlanVerdict }

const fmtDate = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** نص شكوى جاهز للدعم — القياسات بالوقت (أحدث ٥) */
export function complaintText(plan: number, log: PlanCheckLog[]): string {
  const rows = [...log].sort((a, b) => b.at - a.at).slice(0, 5);
  const lines = rows.map(r => `• ${fmtDate(r.at)}: تنزيل ${Math.round(r.down)} · رفع ${Math.round(r.up)} ميقا · بنق ${Math.round(r.ping)}ms (${Math.round((r.down / plan) * 100)}٪ من الباقة)`);
  return [
    `السلام عليكم، اشتراكي ألياف بسرعة ${plan} ميقا، والسرعة اللي توصلني أقل بكثير:`,
    ...lines,
    'الواي فاي بين الجهاز والراوتر سليم (مقاس بتطبيق Bandly). أرجو فحص الخط.',
  ].join('\n');
}

// ═══ الواي فاي بالغرف ═══

export interface RoomRead { name: string; at: number; mbps: number; wifiMs: number; jitter: number; lossPct: number; rssi?: number; freq?: number; link?: number }
export type RoomLevel = 'excellent' | 'good' | 'fair' | 'poor';

const clamp = (x: number, a = 0, b = 100) => Math.max(a, Math.min(b, x));

/** درجة الاتصال بالراوتر (٠–١٠٠) من البنق والتذبذب والفقد */
export function linkScore(r: Pick<RoomRead, 'wifiMs' | 'jitter' | 'lossPct'>): number {
  const base = r.wifiMs <= 4 ? 100 : 100 - ((r.wifiMs - 4) / 56) * 100;
  return Math.round(clamp(base - r.jitter * 1.5 - r.lossPct * 5));
}

/** المرجع للسرعة: أفضل غرفة، ولو غرفة وحدة بس ← الباقة (بحد ٤٠٠ — حد أغلب الجوالات) أو ١٠٠ */
export function speedRef(rooms: RoomRead[], plan?: number): number {
  if (rooms.length >= 2) return Math.max(1, ...rooms.map(r => r.mbps));
  return plan ? Math.min(plan, 400) : 100;
}

export function roomScore(r: RoomRead, ref: number): number {
  const sp = clamp((r.mbps / Math.max(1, ref)) * 100);
  // لو عندنا قوة الإشارة من الجوال (أندرويد): نصّ درجة الاتصال من dBm
  const link = typeof r.rssi === 'number' ? (linkScore(r) + rssiScore(r.rssi)) / 2 : linkScore(r);
  return Math.round(link * 0.5 + sp * 0.5);
}

export function roomLevel(score: number): RoomLevel {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

export const ROOM_LEVEL_TXT: Record<RoomLevel, string> = { excellent: 'ممتاز', good: 'جيد', fair: 'متوسط', poor: 'ضعيف' };
export const ROOM_LEVEL_COL: Record<RoomLevel, string> = { excellent: '#12b76a', good: '#2f6bff', fair: '#f79009', poor: '#e5484d' };

export const ROOM_PRESETS = ['المجلس', 'الصالة', 'غرفة النوم', 'غرفة العيال', 'المطبخ', 'المكتب', 'السطح', 'الحوش'];

/** قراءة جديدة لنفس الغرفة تستبدل القديمة */
export function upsertRoom(rooms: RoomRead[], r: RoomRead): RoomRead[] {
  return [...rooms.filter(x => x.name !== r.name), r];
}

/** نصيحة البيت كامل */
export function roomsAdvice(rooms: RoomRead[], plan?: number): string[] {
  if (!rooms.length) return [];
  const ref = speedRef(rooms, plan);
  const scored = rooms.map(r => ({ r, s: roomScore(r, ref) })).sort((a, b) => b.s - a.s);
  const best = scored[0], worst = scored[scored.length - 1];
  const out: string[] = [];
  const weak = scored.filter(x => x.s < 40).map(x => x.r.name);
  const on24 = rooms.filter(r => near24({ rssi: r.rssi, frequency: r.freq })).map(r => r.name);
  const tip24 = on24.length ? `في ${on24.join('، ')} الإشارة قوية بس جوالك على 2.4 جيجا — اتصل بشبكة 5 جيجا وتزيد السرعة` : '';
  if (rooms.length === 1) {
    out.push(`قِس غرفة ثانية عشان نقارن ونعرف وين يضعف الواي فاي`);
    if (best.s < 60) out.push('الإشارة هنا مو قوية — جرّب جنب الراوتر وقارن');
    if (tip24) out.push(tip24);
    return out;
  }
  if (!weak.length && worst.s >= 60) {
    out.push('الواي فاي يغطي البيت كله زين 👌');
    if (tip24) out.push(tip24);
    return out;
  }
  if (weak.length) out.push(`الواي فاي ضعيف في: ${weak.join('، ')}`);
  if (tip24) out.push(tip24);
  if (worst.r.lossPct >= 5 || worst.r.wifiMs > 30) {
    out.push(`حط مقوّي أو جهاز Mesh في منتصف الطريق بين الراوتر و${worst.r.name} (مو داخل ${worst.r.name} نفسها)`);
  } else {
    out.push(`في ${worst.r.name} الإشارة توصل بس السرعة أقل — اتصل بشبكة 5 جيجا أو قرّب الراوتر شوي`);
  }
  out.push('الراوتر يكون مرتفع ووسط البيت، بعيد عن المطبخ والمرايا والخزائن الحديد');
  if (best.r.name !== worst.r.name) out.push(`أقوى مكان عندك: ${best.r.name}`);
  return out;
}
