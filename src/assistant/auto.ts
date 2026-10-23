/**
 * «ابدأ لحالك»: لما المساعد يفتح شاشة بـ ?auto=1، الشاشة تبدأ المطلوب أول ما تجهز بياناتها — مرة وحدة بس.
 * • الشاشة نفسها تقرر وش «تبدأ» يعني: الأدوات اللي تقطع النت (الترددات/الأبراج/الألعاب) تعرض تأكيدها
 *   المعتاد مباشرة (ضغطة وحدة)، والقراءة فقط (السرعة) تبدأ على طول.
 * • نشيل auto من الرابط بعدها عشان الرجوع للشاشة ما يعيد التشغيل.
 */
import { useEffect, useRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

export function useAutoStart(ready: boolean, start: () => void): void {
  const { auto } = useLocalSearchParams<{ auto?: string }>();
  const done = useRef(false);
  const fn = useRef(start);
  fn.current = start;

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (auto !== '1' || done.current || !ready) return;
    done.current = true;
    // نخلي الشاشة ترسم أول قبل التأكيد/البدء (المؤقت ما ينلغي لما auto ينشال من الرابط — بس لو طلع من الشاشة)
    setTimeout(() => { if (alive.current) fn.current(); }, 350);
    try { router.setParams({ auto: undefined }); } catch {}
  }, [auto, ready]);
}
