/**
 * «وش يثقّل نتك الحين؟» — منطق بدون react-native (ينختبر).
 * الفكرة: الجوال واقف على الشاشة (ما يحمّل شي)، فأي سرعة كبيرة يقراها الراوتر = أجهزة ثانية.
 * ومعها البنق الحين مقارنة بأحسن بنق شفناه: لو ارتفع كثير وقت ما الراوتر مشغول = التحميل يخرّب اللعب.
 * راوتر ما يعطي السرعة الحين (getTraffic) ← نحكم من البنق بس ونقول إنها تقدير.
 */
export type HeavyLevel = 'idle' | 'light' | 'busy' | 'heavy' | 'unknown';

export interface HeavyInput {
  /** سرعة الراوتر الكلية الحين بالميقابت (undefined = الراوتر ما يعطيها) */
  downMbps?: number;
  upMbps?: number;
  /** وسيط البنق آخر ١٠ قياسات */
  pingMed?: number;
  /** أحسن بنق شفناه (أساس الخط الفاضي) */
  pingBase?: number;
  /** ٪ فقد البنق */
  lossPct?: number;
}

export interface HeavyVerdict {
  level: HeavyLevel;
  title: string;
  detail: string;
  tips: string[];
  /** زيادة البنق عن الأساس (ms) */
  added?: number;
  /** الحكم من البنق بس (الراوتر ما يعطي السرعة) */
  guess: boolean;
}

export function heavyVerdict(x: HeavyInput): HeavyVerdict {
  const added = x.pingMed !== undefined && x.pingBase !== undefined ? Math.max(0, Math.round(x.pingMed - x.pingBase)) : undefined;
  const lagBad = (added ?? 0) >= 40 || (x.lossPct ?? 0) >= 10;
  const tips: string[] = [];
  const hasRate = x.downMbps !== undefined || x.upMbps !== undefined;

  if (!hasRate) {
    if (x.pingMed === undefined) return { level: 'unknown', title: 'نقيس…', detail: 'خلّ الشاشة مفتوحة ثواني', tips, guess: true };
    if ((added ?? 0) >= 60 || (x.lossPct ?? 0) >= 15) {
      tips.push('افتح «الأجهزة» وشوف مين متصل', 'وقف التحديثات والبث على الأجهزة الثانية وارجع قِس');
      return { level: 'busy', title: 'غالباً فيه جهاز يحمّل الحين', detail: `البنق زاد ${added ?? '—'}ms عن أحسن قراءة — هذا شكل الخط لما أحد يحمّل. راوترك ما يعطينا السرعة الحين، فهذا تقدير من البنق.`, tips, added, guess: true };
    }
    return { level: 'idle', title: 'ما نشوف ضغط على النت', detail: 'البنق قريب من أحسن قراءة — غالباً ما أحد يحمّل الحين. راوترك ما يعطينا السرعة الحين، فهذا تقدير من البنق.', tips, added, guess: true };
  }

  const d = x.downMbps ?? 0, u = x.upMbps ?? 0;
  const level: HeavyLevel = d >= 15 || u >= 3 ? 'heavy' : d >= 3 || u >= 1 ? 'busy' : d >= 0.5 || u >= 0.3 ? 'light' : 'idle';
  const rate = `تنزيل ${fmt(d)} · رفع ${fmt(u)} ميقابت`;

  if (level === 'idle') {
    return { level, title: 'النت فاضي الحين', detail: `الراوتر شبه واقف (${rate}). لو اللعب يقطّع، السبب مو جهاز ثاني — غالباً الإشارة أو البرج.`, tips: ['جرّب «مُحسّن الألعاب» أو «اختار الأفضل»'], added, guess: false };
  }
  if (u >= 1 && u >= d / 4) tips.push('الرفع عالي: غالباً جهاز يرفع صور أو نسخة احتياطية (iCloud / Google Photos) أو بث مباشر — أجّلها وقت اللعب');
  if (d >= 3) tips.push('التنزيل عالي: غالباً تحديث لعبة أو جوال، أو بث بجودة عالية — وقفه أو خلّه بعد اللعب');
  tips.push('افتح «الأجهزة» وشوف مين متصل', 'وقت اللعب: «وضع المباراة» يوقف الأجهزة اللي تختارها (لو راوترك يدعم الحظر)');
  const title = level === 'heavy' ? 'فيه جهاز يحمّل بقوة الحين' : level === 'busy' ? 'فيه جهاز يستخدم النت الحين' : 'استخدام خفيف';
  const lag = added === undefined ? '' : lagBad ? ` · والبنق زاد ${added}ms عن أحسن قراءة — هذا اللي يخرّب لعبك` : ` · البنق ما تأثر كثير (+${added}ms)`;
  return { level, title, detail: `الراوتر يمرّر ${rate} وجوالك واقف على هالشاشة${lag}.`, tips, added, guess: false };
}

function fmt(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}
