/**
 * خانة «كلمة مرور الراوتر»: الكيبورد (خصوصاً العربي وقت ما تكون الكلمة ظاهرة 👁) يدخّل أشياء ما تنشاف:
 * مسافة بعد اقتراح كلمة، أو علامات اتجاه (U+200E/200F…) لما تنكتب كلمة إنجليزية جنب نص عربي.
 * Soyealink (٧ نوفمبر): «B-2704197900» (١٢ حرف) وصل الراوتر ١٣ حرف ← 108006 «كلمة غلط» ٥ مرات.
 * نشيل اللي على الأطراف + علامات الاتجاه/العرض الصفري من أي مكان. المسافة داخل الكلمة نخليها (ممكن تكون منها).
 */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿­]/g;

export function cleanPassword(raw: string): string {
  return (raw ?? '').replace(INVISIBLE, '').replace(/^[\s ]+|[\s ]+$/g, '');
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
