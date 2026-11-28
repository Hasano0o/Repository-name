/**
 * صيغ بديلة للمزايا التجريبية (٢٨ نوفمبر — «الإصلاح الذاتي»): لو الصيغة الأولى انرفضت أو القراءة بعدها ما تطابقت،
 * نجرّب البدائل المعروفة بالترتيب (الصيغة اللي نجحت عند الأعضاء — من الرسيفر — أول). كل محاولة لازم تتأكد بالقراءة.
 * صافي — عليه اختبارات.
 */
export interface LabResult { msg?: string; variant?: string; tried?: string[] }

export function orderVariants(all: string[], prefer?: string): string[] {
  return prefer && all.includes(prefer) ? [prefer, ...all.filter(v => v !== prefer)] : all.slice();
}

/** يجرّب fn لكل صيغة لين وحدة تنجح — يرجّع اسمها، ولو كلها فشلت يرمي آخر خطأ ومعه الصيغ اللي جرّبناها */
export async function tryVariants(all: string[], prefer: string | undefined, fn: (v: string) => Promise<string | void>): Promise<LabResult> {
  const tried: string[] = [];
  let last: unknown;
  for (const v of orderVariants(all, prefer)) {
    tried.push(v);
    try {
      const msg = await fn(v);
      return { msg: msg || undefined, variant: v, tried };
    } catch (e: any) {
      last = e;
      // الراوتر قال «ما أعرف هالأمر» أو المستخدم ما يقدر — البدائل ما تفيد
      if (e?.unsupported || e?.noVariant) break;
    }
  }
  const err = last instanceof Error ? last : new Error(String(last ?? 'فشل'));
  err.message = `${err.message} [جرّبنا: ${tried.join(',')}]`;
  throw err;
}
