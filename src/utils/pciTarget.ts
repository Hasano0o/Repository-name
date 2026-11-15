/**
 * «تنبيه برج معيّن» في توجيه الأنتنا (اقتراح عضو ١٥ نوفمبر): العضو يشوف في NetMonster برج عاجبه (مثلاً PCI 38)،
 * يكتب رقمه، ويوجّه الأنتنا بدون ما يطالع — أول ما الراوتر يشبك على هالبرج (4G أو 5G) يجيه صوت.
 * بدون react-native — ينختبر في node.
 */
import type { Signal } from '../drivers/types';

/** رقم PCI صالح (0–1007 — أكبر مدى في 5G) أو null */
export function normPci(v: string | number | undefined | null): string | null {
  const s = String(v ?? '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  if (!s) return null;
  const n = Number(s);
  return n >= 0 && n <= 1007 ? String(n) : null;
}

/** الراوتر الحين على البرج المطلوب؟ (الأساسي 4G أو 5G) — يرجّع التقنية اللي طابقت */
export function pciHit(target: string | null, s: Signal | null | undefined): 'LTE' | 'NR' | null {
  const t = normPci(target);
  if (!t || !s) return null;
  if (normPci(s.pci) === t) return 'LTE';
  if (normPci(s.nrPci) === t) return 'NR';
  return null;
}
