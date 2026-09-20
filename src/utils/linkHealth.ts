import { Signal } from '../drivers/types';

export type HealthLevel = 'excellent' | 'good' | 'fair' | 'poor';

export interface HealthItem {
  key: 'efficiency' | 'uplink' | 'mimo';
  title: string;
  /** ٠–١ لطول الشريط */
  bar: number;
  value: string;
  level: HealthLevel;
  note: string;
}

export const HEALTH_COLOR: Record<HealthLevel, string> = {
  excellent: '#12b76a', good: '#5ba644', fair: '#f79009', poor: '#e5484d',
};

type Tech = 'LTE' | 'NR';

/**
 * كفاءة الوصلة: CQI (٠–١٥) هو تقييم المودم لجودة استقباله، والبرج يختار السرعة (MCS) بناءً عليه.
 * نعتمد CQI لأنه أثبت، ونرجع لـ MCS لو ما وصل.
 */
function efficiency(cqi?: number, mcs?: number): HealthItem | null {
  let ratio: number | undefined;
  let value = '';
  if (cqi !== undefined && cqi >= 0) {
    ratio = Math.min(1, cqi / 15);
    value = `CQI ${cqi} من 15`;
  } else if (mcs !== undefined && mcs >= 0) {
    ratio = Math.min(1, mcs / 27);
    value = `MCS ${mcs}`;
  }
  if (ratio === undefined) return null;
  const pct = Math.round(ratio * 100);
  const level: HealthLevel = ratio >= 0.73 ? 'excellent' : ratio >= 0.53 ? 'good' : ratio >= 0.33 ? 'fair' : 'poor';
  const note =
    level === 'excellent' ? 'البرج يعطيك أعلى سرعة تقريباً — الاستقبال نظيف.' :
    level === 'good' ? 'سرعة جيدة. تحسين بسيط في الاتجاه ممكن يرفعها.' :
    level === 'fair' ? 'البرج ينزّل سرعتك بسبب التشويش أو ضعف الاستقبال — جرّب التوجيه.' :
    'الاستقبال مشوّش جداً — البرج يرسل لك بأبطأ ترميز. غيّر مكان الراوتر أو اتجاهه.';
  return { key: 'efficiency', title: 'كفاءة الوصلة', bar: ratio, value: `${pct}٪ · ${value}`, level, note };
}

/** جهد الإرسال: كل ما ارتفع، الراوتر يجهد نفسه عشان يوصل للبرج (الحد الأقصى ~23 dBm) */
function uplink(tx?: number): HealthItem | null {
  if (tx === undefined) return null;
  const MAX = 23;
  const effort = Math.max(0, Math.min(1, (tx + 10) / (MAX + 10)));
  const level: HealthLevel = tx <= 5 ? 'excellent' : tx <= 13 ? 'good' : tx <= 19 ? 'fair' : 'poor';
  const note =
    level === 'excellent' ? 'الراوتر يوصل للبرج بسهولة — الرفع والمكالمات مرتاحة.' :
    level === 'good' ? 'جهد طبيعي.' :
    level === 'fair' ? 'الراوتر يجهد عشان يوصل صوته للبرج — الرفع ممكن يبطأ.' :
    'الراوتر على أقصى قوة إرسال — البرج بالكاد يسمعه. هذا سبب الرفع البطيء والانقطاع.';
  // الشريط هنا "راحة": كل ما قل الجهد زاد الشريط
  return { key: 'uplink', title: 'جهد الإرسال', bar: 1 - effort, value: `${tx} dBm من ${MAX}`, level, note };
}

/** MIMO: كم مسار بيانات يستقبل الراوتر معاً (١ = هوائي واحد فعلياً) */
function mimo(streams?: number, weak = false): HealthItem | null {
  if (!streams) return null;
  const s = Math.min(4, streams);
  const level: HealthLevel = s >= 4 ? 'excellent' : s >= 2 ? 'good' : weak ? 'fair' : 'poor';
  const note =
    s >= 2 ? `الراوتر يستقبل ${s} مسارات معاً — الهوائيات شغالة صح.` :
    weak ? 'مسار واحد — طبيعي مع الإشارة الضعيفة، البرج يقلّل المسارات.' :
    'مسار واحد رغم إن الإشارة كويسة — لو عندك أنتنا خارجية تأكد من الكيبلين والتوصيل.';
  return { key: 'mimo', title: 'مسارات الاستقبال', bar: s / 4, value: s >= 2 ? `${s}×${s}` : '1 مسار', level, note };
}

export function linkHealth(sig: Signal | null | undefined, tech: Tech = 'LTE'): HealthItem[] {
  if (!sig) return [];
  const isNr = tech === 'NR';
  const weak = ((isNr ? sig.nrSinr : sig.sinr) ?? 99) < 5;
  return [
    efficiency(isNr ? sig.nrCqi : sig.cqi, isNr ? sig.nrDlMcs : sig.dlMcs),
    uplink(isNr ? sig.nrTxPower : sig.txPower),
    mimo(isNr ? sig.nrRank : sig.dlStreams, weak),
  ].filter((x): x is HealthItem => !!x);
}

// ─── قراءة الحقول الخام من هواوي ───

/** "PPusch:10dBm PPucch:1dBm" → 10 */
export function parseTxPower(raw?: string): number | undefined {
  const m = (raw ?? '').match(/PPusch:\s*(-?\d+(?:\.\d+)?)/i) ?? (raw ?? '').match(/^\s*(-?\d+(?:\.\d+)?)\s*dBm?\s*$/i);
  return m ? parseFloat(m[1]) : undefined;
}

/** "mcsDownCarrier1Code0:15 mcsDownCarrier1Code1:20" → { mcs: 18, streams: 2 } (الناقل الأساسي) */
export function parseDlMcs(raw?: string): { mcs?: number; streams?: number } {
  const vals = [...(raw ?? '').matchAll(/Carrier1Code\d+:\s*(\d+)/gi)].map(m => parseInt(m[1], 10));
  if (!vals.length) {
    const n = parseInt((raw ?? '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) && (raw ?? '').trim().match(/^\d+$/) ? { mcs: n } : {};
  }
  return { mcs: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), streams: vals.length };
}

/** "mcsUpCarrier1:27" → 27 */
export function parseUlMcs(raw?: string): number | undefined {
  const m = (raw ?? '').match(/Carrier1:\s*(\d+)/i) ?? (raw ?? '').match(/^\s*(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : undefined;
}
