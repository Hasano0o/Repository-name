/**
 * خانة «كلمة مرور الراوتر»: الكيبورد (خصوصاً العربي وقت ما تكون الكلمة ظاهرة 👁) يدخّل أشياء ما تنشاف:
 * مسافة بعد اقتراح كلمة، أو علامات اتجاه (U+200E/200F…) لما تنكتب كلمة إنجليزية جنب نص عربي.
 * Soyealink (٧ نوفمبر): «B-2704197900» (١٢ حرف) وصل الراوتر ١٣ حرف ← 108006 «كلمة غلط» ٥ مرات.
 * نشيل اللي على الأطراف + علامات الاتجاه/العرض الصفري من أي مكان. المسافة داخل الكلمة نخليها (ممكن تكون منها).
 */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿­]/g;

/**
 * حروف «الخطوط المزخرفة» (كيبوردات Fonts / الخط المائل في بعض الجوالات) — شكلها حرف إنجليزي وهي رمز ثاني:
 * Soyealink (٨ نوفمبر): أول حرف وصل U+1D609 «𝘉» (B مائل رياضي) بدل B — طوله ٢ في الجافاسكربت فالكلمة ١٣ والراوتر يرفض.
 * نرجّع بس كتل الحروف الرياضية (U+1D400–1D7FF) والعرض الكامل (FF01–FF5E) لأصلها بـ NFKC — باقي الحروف ما نلمسها.
 */
const FANCY = /[\u{1D400}-\u{1D7FF}\uFF01-\uFF5E]/gu;

/** الأصل — NFKC، ولو المحرّك ما يدعمه (أو رجّعه كما هو) نحسبه من موقع الحرف في الكتلة */
function plain(c: string): string {
  try { const n = c.normalize('NFKC'); if (n !== c) return n; } catch {}
  const cp = c.codePointAt(0)!;
  if (cp >= 0xff01 && cp <= 0xff5e) return String.fromCharCode(cp - 0xfee0);
  if (cp >= 0x1d7ce && cp <= 0x1d7ff) return String((cp - 0x1d7ce) % 10);
  if (cp >= 0x1d400 && cp < 0x1d6a4) { const i = (cp - 0x1d400) % 52; return String.fromCharCode(i < 26 ? 65 + i : 97 + i - 26); }
  return c;
}

export function cleanPassword(raw: string): string {
  return (raw ?? '').replace(FANCY, plain).replace(INVISIBLE, '').replace(/^[\s ]+|[\s ]+$/g, '');
}

/** كم حرف شلنا — للتشخيص بس (بدون الكلمة نفسها) */
export function passwordJunk(raw: string): number {
  return (raw ?? '').length - cleanPassword(raw).length;
}

/**
 * شكل الكلمة للتشخيص — بدون الكلمة نفسها: A حرف كبير · a صغير · 9 رقم · ␠ مسافة · الرموز كما هي · غيرها U+XXXX.
 * Soyealink (٨ نوفمبر): «B-2704197900» (١٢) يوصل ١٣ حتى بعد التنظيف — هذا يكشف وش الحرف الزايد ووينه.
 */
export function passwordShape(pw: string): string {
  return Array.from(pw ?? '').map(c => {
    if (/[A-Z]/.test(c)) return 'A';
    if (/[a-z]/.test(c)) return 'a';
    if (/[0-9]/.test(c)) return '9';
    if (c === ' ') return '␠';
    if (/[!-/:-@[-`{-~]/.test(c)) return c;
    return `<U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`;
  }).join('');
}
