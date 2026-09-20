import { Signal, CellTower } from '../drivers/types';
import { bandLabel } from './bands';
import { overallLevel, LEVEL_LABEL } from './signal';

export type ActionRoute = 'towers' | 'optimize' | 'aim' | 'bands' | 'ping' | 'report' | 'speed';

export interface Advice {
  sentence: string;
  action?: { label: string; route: ActionRoute; hint?: string };
}

export function buildAdvice(signal?: Signal | null, cells: CellTower[] = []): Advice {
  if (!signal || (signal.rsrp === undefined && signal.nrRsrp === undefined)) {
    return {
      sentence: 'ما قدرنا نقرأ الإشارة من الراوتر — جرّب تحدّث الصفحة أو تأكد إنك على شبكته.',
      action: { label: 'افتح تقرير الاتصال', route: 'report' },
    };
  }

  const lvl = LEVEL_LABEL[overallLevel(signal)];
  const nr = signal.nrRsrp !== undefined;
  const parts: string[] = [`جودة اتصالك ${lvl}`];
  if (nr) parts.push(`و5G ماسك${signal.nrBand ? ' على n' + String(signal.nrBand).replace(/^n/i, '') : ''}`);

  const serving = signal.rsrp ?? -140;
  const neighbors = cells.filter(c => c.kind !== 'serving' && c.rsrp !== undefined);
  const best = neighbors.sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))[0];
  const gain = best?.rsrp !== undefined ? Math.round(best.rsrp - serving) : 0;

  if (best && gain >= 6) {
    const name = best.band ? bandLabel(best.tech, best.band) : best.tech;
    return {
      sentence: `${parts.join(' ')}. فيه برج مجاور أقوى منك بـ${gain} dB — تثبيته يرفع سرعتك.`,
      action: { label: `ثبّت على ${name}`, route: 'towers', hint: `+${gain} dB` },
    };
  }

  if ((signal.sinr ?? 99) < 0) {
    return {
      sentence: `${parts.join(' ')}، لكن فيه تداخل قوي (SINR سالب) — تغيير التردد غالباً يحلّه.`,
      action: { label: 'شغّل المُحسِّن التلقائي', route: 'optimize' },
    };
  }

  if (serving < -105) {
    return {
      sentence: `${parts.join(' ')}. الإشارة ضعيفة — مكان الراوتر هو الفرق الأكبر هنا.`,
      action: { label: 'افتح مساعد التوجيه', route: 'aim' },
    };
  }

  if (!nr && signal.nrAvailable) {
    return {
      sentence: `${parts.join(' ')}. البرج يدعم 5G لكنه غير نشط الحين — ينشط وقت التحميل. ` +
        'لو ما نشط حتى وأنت تحمّل، الأرجح أن شريحتك أو باقتك ما تدعم 5G.',
      action: { label: 'تأكد من 5G في الأبراج', route: 'towers' },
    };
  }

  if (!nr) {
    return {
      sentence: `${parts.join(' ')}. ما فيه 5G حالياً — الفحص يكشف إذا فيه تغطية حولك.`,
      action: { label: 'افحص ترددات 5G', route: 'bands' },
    };
  }

  return {
    sentence: `${parts.join(' ')}. وضعك مستقر — تقدر تقيس الاستجابة إذا تلعب.`,
    action: { label: 'قِس أفضل تردد للألعاب', route: 'ping' },
  };
}
