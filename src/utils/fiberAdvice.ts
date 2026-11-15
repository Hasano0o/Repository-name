/**
 * «مستشار الفايبر» — نصيحة من قراءة الضوء (Rx dBm) + متابعة النزول المفاجئ. صافي (ينختبر).
 * النطاق المقبول من صفحة الجهاز نفسها (موبايلي HG8245X6): الاستقبال −8 إلى −27 · الإرسال 0.5 إلى 5.
 */
export type FiberLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface FiberSample { t: number; rx: number }

export interface FiberAdvice {
  level: FiberLevel;
  title: string;
  why: string;
  steps: string[];
  /** نزول مفاجئ عن المعتاد (dB) — لو فيه */
  drop?: number;
}

export function fiberLevel(rx?: number): FiberLevel {
  if (rx === undefined || !Number.isFinite(rx)) return 'unknown';
  if (rx > -8 || rx < -27) return 'poor';
  if (rx >= -20) return 'excellent';
  if (rx >= -24) return 'good';
  return 'fair';
}

/** المعتاد = وسيط القراءات (آخر ٧ أيام) — يحتاج ٣ قراءات على الأقل */
export function usualRx(hist: FiberSample[], now = Date.now()): number | undefined {
  const xs = hist.filter(h => now - h.t < 7 * 864e5).map(h => h.rx).sort((a, b) => a - b);
  if (xs.length < 3) return undefined;
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** نضيف قراءة: وحدة كل ١٠ دقايق بالكثير، ونخلي آخر ٢٠٠ */
export function addFiberSample(hist: FiberSample[], rx: number, now = Date.now()): FiberSample[] {
  const last = hist[hist.length - 1];
  if (last && now - last.t < 10 * 60_000) return hist;
  return [...hist, { t: now, rx }].slice(-200);
}

export function adviseFiber(rx: number | undefined, tx: number | undefined, hist: FiberSample[] = [], now = Date.now()): FiberAdvice {
  const level = fiberLevel(rx);
  const usual = usualRx(hist, now);
  const drop = rx !== undefined && usual !== undefined && usual - rx >= 3 ? Math.round((usual - rx) * 10 + 1e-6) / 10 : undefined;
  const txBad = tx !== undefined && (tx < 0.5 || tx > 5);

  if (rx === undefined) {
    return {
      level, title: 'ما فيه قراءة ضوء',
      why: 'الراوتر ما أعطانا قراءة الفايبر — يا إما الكيبل مفصول، أو النت داخل له من كابل إيثرنت مو فايبر.',
      steps: ['تأكد إن كيبل الفايبر (الأصفر/الأخضر الرفيع) راكب في منفذ PON/OPTICAL', 'لو لمبة LOS حمراء تولّع: الخط مقطوع — بلاغ لشركتك'],
    };
  }
  if (rx > -8) {
    return {
      level, title: 'الضوء أقوى من اللازم', drop,
      why: `الاستقبال ${rx.toFixed(1)} dBm أقوى من −8 — نادر، وممكن يسبب أخطاء في الوصلة.`,
      steps: ['هذا يتصلح من جهة الشركة (تخفيف إشارة) — بلاغ مع رقم القراءة'],
    };
  }
  if (rx < -27) {
    return {
      level, title: 'الخط فيه عطل', drop,
      why: `الاستقبال ${rx.toFixed(1)} dBm أضعف من الحد (−27) — الوصلة ما تثبت وبيصير تقطيع أو انقطاع.`,
      steps: ['تأكد إن الكيبل مو مقطوع أو مضغوط تحت باب/أثاث', 'افصل وصلة الفايبر من الراوتر وركّبها مرة ثانية بهدوء (لا تلمس رأسها)', 'لو ما تحسّن: بلاغ لشركتك واذكر الرقم — العطل غالباً خارج البيت'],
    };
  }
  if (drop !== undefined) {
    return {
      level, title: `نزل ${drop} dB عن المعتاد`, drop,
      why: `المعتاد عندك ${usual!.toFixed(1)} والحين ${rx.toFixed(1)} — النزول المفاجئ غالباً كيبل انثنى أو انضغط.`,
      steps: ['شيك على مسار الكيبل: ثنية حادة؟ مضغوط تحت شي؟ مربوط بقوة؟', 'افصل الوصلة وركّبها من جديد', 'لو استمر النزول يومين: بلاغ للشركة'],
    };
  }
  if (level === 'excellent') {
    return {
      level, title: 'الفايبر ممتاز',
      why: `الاستقبال ${rx.toFixed(1)} dBm — ضمن الأفضل. لو فيه لاق فالسبب مو الفايبر.`,
      steps: txBad ? ['الإرسال برا النطاق — لو فيه تقطيع بلاغ للشركة'] : ['لو النت بطيء: شيك الواي فاي (قرّب أو استخدم 5GHz/كيبل) و«وش يثقّل نتك؟»'],
    };
  }
  if (level === 'good') {
    return {
      level, title: 'الفايبر جيد',
      why: `الاستقبال ${rx.toFixed(1)} dBm — مقبول، بس قريب من الطرف الضعيف.`,
      steps: ['ما يحتاج شي لو النت ثابت', 'لو فيه تقطيع: تأكد إن الكيبل بدون ثنيات حادة ولا مضغوط، ونظّف أو أعد تركيب الوصلة'],
    };
  }
  return {
    level, title: 'الفايبر ضعيف',
    why: `الاستقبال ${rx.toFixed(1)} dBm — قريب من الحد (−27)، ممكن يصير تقطيع وقت الحر أو مع أي ثنية.`,
    steps: ['شيك مسار الكيبل (ثنيات، ضغط، ربطات قوية)', 'أعد تركيب الوصلة بهدوء', 'لو ما تحسّن: كلّم شركتك واطلب فني يقيس الخط — اذكر الرقم'],
  };
}
