/**
 * الشريحة الإلكترونية — قراءة ردود الراوتر وكود الباركود (٢٧ نوفمبر، الشاشة التجريبية).
 * صيغة esim-profiles ما شفناها من راوتر حقيقي للحين ← نقرأ أي كتلة فيها iccid ونطلع الاسم والحالة بأسماء محتملة.
 * قراءة بس — ما فيه أي أمر للراوتر هنا.
 */

export interface EsimProfile { name: string; iccid4?: string; active?: boolean }

const fields = (b: string): [string, string][] =>
  [...b.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(m => [m[1], m[2].trim()] as [string, string]);
const pick = (f: [string, string][], re: RegExp) => f.find(([k, v]) => re.test(k) && v !== '')?.[1];

/** الشرائح المحمّلة في الراوتر — كل كتلة فيها iccid = شريحة */
export function parseEsimProfiles(xml: string): EsimProfile[] {
  if (!xml || /<error>/.test(xml)) return [];
  const out: EsimProfile[] = [];
  // نمشي على الوسوم: كل <iccid> ← الكتلة اللي هو داخلها مباشرة = شريحة وحدة
  const stack: { tag: string; start: number }[] = [];
  const parents: { start: number; tag: string }[] = [];
  for (const m of xml.matchAll(/<(\/?)(\w+)[^>]*>/g)) {
    const [, close, tag] = m;
    if (!close) {
      if (/^iccid$/i.test(tag) && stack.length) parents.push(stack[stack.length - 1]);
      stack.push({ tag, start: m.index! + m[0].length });
    } else {
      while (stack.length && stack[stack.length - 1].tag !== tag) stack.pop();
      stack.pop();
    }
  }
  for (const p of parents) {
    const endIdx = xml.indexOf(`</${p.tag}>`, p.start);
    const block = xml.slice(p.start, endIdx < 0 ? undefined : endIdx);
    const f = fields(block);
    const iccid = pick(f, /^iccid$/i)?.replace(/\D/g, '');
    const name = pick(f, /^(profile_?nick_?name|nick_?name|profile_?name|service_?provider_?name|spn|provider|operator|name)$/i) ?? '';
    const st = pick(f, /^(state|status|profile_?state|enable|enabled|active|is_?active)$/i);
    out.push({
      name: name || (iccid ? `شريحة …${iccid.slice(-4)}` : 'شريحة'),
      iccid4: iccid ? iccid.slice(-4) : undefined,
      active: st === undefined ? undefined : /^(1|true|enabled?|active)$/i.test(st),
    });
  }
  return out;
}

/** كود الباركود: LPA:1$<SM-DP+>$<رمز التفعيل>[$…] — غيره مو باركود شريحة */
export function parseLpa(code: string): { smdp: string; matchingId: string } | null {
  const m = String(code ?? '').trim().match(/^LPA:1\$([A-Za-z0-9.\-]+(?::\d+)?)\$([^$\s]*)/i);
  if (!m) return null;
  return { smdp: m[1].toLowerCase(), matchingId: m[2] };
}
