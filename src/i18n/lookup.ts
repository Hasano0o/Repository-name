/**
 * قلب الترجمة — صافي بدون react-native (عليه اختبارات، والفاحص tests/i18nScan.cjs يستخدمه هو نفسه).
 *
 * الترتيب لكل نص:
 *  ١) «أ · ب»: نترجم كل جزء — نقبلها بس لو كل الأجزاء انترجمت كاملة
 *  ٢) الجملة كلها: القاموس، ثم الأنماط ({0} {1}…) من الأطول للأقصر
 *  ٣) نص بأكثر من سطر: كل سطر لحاله
 *  ٤) جمل مفصولة بـ « — » أو « · » أو « • »: نترجم اللي نعرفه منها
 * نص ما له ترجمة يرجع null (والمنادي يعرضه عربي).
 */
export const AR = /[؀-ۿ]/;
export const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
export const toLatinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.').replace(/٪/g, '%').replace(/،/g, ',').replace(/؟/g, '?').replace(/؛/g, ';');

interface Pat { re: RegExp; out: string; lit: string }

export function makeTranslator(EN: Record<string, string>, EN_PATTERNS: Record<string, string>) {
  const DICT = new Map<string, string>();
  for (const k of Object.keys(EN)) DICT.set(norm(k), EN[k]);

  let PATS: Pat[] | null = null;
  const pats = (): Pat[] => {
    if (PATS) return PATS;
    const list = Object.keys(EN_PATTERNS).sort((a, b) => b.length - a.length);
    PATS = list.map(k => {
      const src = norm(k)
        .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
        .replace(/\{(\d)\}/g, '\u0000$1\u0001')
        .replace(/[{}]/g, '\\$&')
        .replace(/\u0000(\d)\u0001/g, '(?<g$1>.+?)');
      // أطول جزء ثابت في النمط: لو النص ما يحتويه ما نشغّل الـ regex أصلاً (مئات الأنماط لكل نص متغيّر)
      const lit = norm(k).split(/\{\d\}/).sort((a, b) => b.length - a.length)[0] ?? '';
      return { re: new RegExp('^' + src + '$'), out: EN_PATTERNS[k], lit };
    });
    return PATS;
  };

  function lookup(s: string): string | null {
    const k = norm(s);
    if (!k) return s;
    const hit = DICT.get(k);
    if (hit !== undefined) return hit;
    // نمط عام مثل «{0} ثانية» ممكن يمسك جملة طويلة تنتهي بـ«ثانية» ويطلّع نص نصه عربي.
    // فناخذ أول نمط يطلّع نص بدون عربي؛ ولو ما فيه، أول واحد طابق (اسم راوتر عربي جوا الجملة مثلاً).
    let partial: string | null = null;
    for (const p of pats()) {
      if (p.lit && !k.includes(p.lit)) continue;
      const m = p.re.exec(k);
      if (!m) continue;
      const res = p.out.replace(/\{(\d)\}/g, (_, i) => {
        const g = m.groups?.['g' + i] ?? '';
        return AR.test(g) ? full(g) : g;
      });
      if (!AR.test(res)) return res;
      if (partial === null) partial = res;
    }
    return partial;
  }

  /** الترجمة بدون المسافات اللي حول النص — null = ما لقينا شي */
  function core(s: string): string | null {
    let out: string | null = null;
    // «STC · وضع تجريبي»: أجزاء مفصولة بنقطة — نقبل التقسيم بس لو كل جزء انترجم كامل،
    // وإلا نجرّب الجملة كلها (ممكن لها نمط خاص بها)
    if (s.includes(' · ')) {
      const parts = s.split(' · ').map(p => (AR.test(p) ? lookup(p) : p));
      if (parts.every(p => p !== null && !AR.test(p))) out = parts.join(' · ');
    }
    if (out === null) out = lookup(s);
    if (out === null && s.includes('\n')) {
      // نص طويل بأكثر من سطر: نترجم كل سطر لحاله
      const lines = s.split('\n').map(line => (AR.test(line) ? lookup(line) : line));
      if (lines.some((l, i) => l !== null && AR.test(s.split('\n')[i]))) out = lines.map((l, i) => l ?? s.split('\n')[i]).join('\n');
    }
    if (out === null) {
      // جمل مفصولة بـ « — » أو « · »: نترجم كل جزء
      for (const sep of [' — ', ' · ', ' • ']) {
        if (s.includes(sep)) {
          const src = s.split(sep);
          const parts = src.map(p => (AR.test(p) ? lookup(p) : p));
          if (parts.some((p, i) => p !== null && AR.test(src[i]))) {
            out = parts.map((p, i) => p ?? src[i]).join(sep);
            break;
          }
        }
      }
    }
    return out;
  }

  /** الترجمة الكاملة لنص (يحافظ على المسافات حوله ويحوّل الأرقام العربية). ما له ترجمة ← نفسه. */
  function full(s: string): string {
    if (typeof s !== 'string' || !AR.test(s)) return s;
    const out = core(s);
    if (out === null) return toLatinDigits(s);
    const lead = s.match(/^\s*/)?.[0] ?? '';
    const trail = s.match(/\s*$/)?.[0] ?? '';
    return toLatinDigits(lead + out.trim() + trail);
  }

  return { full, core, size: DICT.size, patterns: () => pats().length };
}
