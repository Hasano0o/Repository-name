import { Carrier, CellTower, Signal } from '../drivers/types';
import { freqLabel } from './bands';
import { isLowBand } from './towers';
import { estimateLoad } from './congestion';

export type Need = 'yes' | 'maybe' | 'no';

export interface AntennaAdvice {
  need: Need;
  headline: string;
  reasons: string[];
  type: { title: string; points: string[] };
  /** فحص التركيب — لمن عنده أنتنا خارجية */
  install: { ok: boolean; text: string }[];
  /** لو السبب الحقيقي مو الإشارة */
  otherCause?: string;
}

const MHZ_RANGES: [number, number, string][] = [
  [600, 960, '700–900'],
  [1400, 2200, '1800–2100'],
  [2200, 2700, '2300–2600'],
  [3300, 4200, '3500'],
];

function freqNum(tech: 'LTE' | 'NR', band: number): number | undefined {
  const f = parseInt(freqLabel(tech, band), 10);
  return Number.isFinite(f) ? f : undefined;
}

/**
 * مستشار الأنتنا: يقرر من الإشارة وصحة الوصلة إذا الأنتنا الخارجية بتفيد،
 * وأي نوع، ويفحص التركيب لو فيه أنتنا.
 */
export function adviseAntenna(sig: Signal, carriers: Carrier[], cells: CellTower[]): AntennaAdvice {
  const rsrp = sig.rsrp ?? -140;
  const sinr = sig.sinr ?? -10;
  const tx = sig.txPower;
  const cqi = sig.cqi;
  const reasons: string[] = [];
  let score = 0; // كل ما زاد = الحاجة للأنتنا أكبر

  if (rsrp < -110) { score += 3; reasons.push(`الإشارة ضعيفة جداً (${rsrp} dBm) — الأنتنا الخارجية ترفعها عادة ٨–١٥ dB.`); }
  else if (rsrp < -100) { score += 2; reasons.push(`الإشارة ضعيفة (${rsrp} dBm).`); }
  else if (rsrp < -93) { score += 1; reasons.push(`الإشارة متوسطة (${rsrp} dBm).`); }

  if (sinr < 3) { score += 2; reasons.push(`تشويش عالي (SINR ${sinr}) — أنتنا اتجاهية تسمع برج واحد وتتجاهل الباقي.`); }
  else if (sinr < 10) { score += 1; reasons.push(`فيه تشويش متوسط (SINR ${sinr}).`); }

  if (tx !== undefined && tx >= 20) { score += 2; reasons.push(`الراوتر على أقصى قوة إرسال (${tx} dBm) — البرج بالكاد يسمعه، والأنتنا تحل الرفع البطيء.`); }
  else if (tx !== undefined && tx >= 14) { score += 1; reasons.push(`الراوتر يجهد في الإرسال (${tx} dBm).`); }

  if (cqi !== undefined && cqi < 7) { score += 1; reasons.push(`كفاءة الوصلة منخفضة (CQI ${cqi} من 15).`); }

  const need: Need = score >= 4 ? 'yes' : score >= 2 ? 'maybe' : 'no';

  // هل المشكلة زحمة مو إشارة؟
  const load = estimateLoad(sig.rsrq, sig.sinr);
  let otherCause: string | undefined;
  if (need === 'no' && load !== undefined && load >= 0.75) {
    otherCause = 'إشارتك قوية ونظيفة، فالبطء (لو فيه) سببه زحمة البرج — الأنتنا ما بتحلها. جرّب برج أو تردد ثاني وقت الزحمة.';
  }

  const headline =
    need === 'yes' ? 'نعم — الأنتنا الخارجية بتفرق معك بوضوح' :
    need === 'maybe' ? 'ممكن تفيد — جرّب التوجيه وتغيير المكان أول' :
    'ما تحتاج أنتنا — إشارتك داخل البيت كافية';
  if (!reasons.length) reasons.push(`إشارة قوية (${rsrp} dBm) ونظيفة (SINR ${sinr}) والراوتر مرتاح في الإرسال.`);

  // ─── نوع الأنتنا ───
  const used = carriers.length
    ? carriers.map(c => ({ tech: c.tech, band: c.band }))
    : [{ tech: 'LTE' as const, band: parseInt((sig.band ?? '').match(/B(\d+)/)?.[1] ?? '0', 10) }].filter(x => x.band);
  const freqs = used.map(u => freqNum(u.tech, u.band)).filter((f): f is number => f !== undefined);
  // ترددات 5G اللي شافها الراوتر فعلاً — وإلا نفترض 3500 الشائع
  const nrSeen = cells.filter(c => c.tech === 'NR' && c.band).map(c => freqNum('NR', c.band!)).filter((f): f is number => f !== undefined);
  if (nrSeen.length) freqs.push(...nrSeen);
  else if (sig.nrAvailable || sig.nrRsrp !== undefined) freqs.push(3500);
  const ranges = [...new Set(MHZ_RANGES.filter(([lo, hi]) => freqs.some(f => f >= lo && f <= hi)).map(r => r[2]))];
  const hasLow = used.some(u => isLowBand(u));
  const has5g = !!(sig.nrAvailable || sig.nrRsrp !== undefined || carriers.some(c => c.tech === 'NR'));

  // كم برج قوي حولك؟ برج واحد مسيطر = اتجاهية، أكثر من برج متقارب = واسعة
  const strong = new Map<string, number>();
  for (const c of cells) {
    if (c.rsrp === undefined || !c.pci) continue;
    const k = `${c.tech}:${c.pci}`;
    strong.set(k, Math.max(strong.get(k) ?? -200, c.rsrp));
  }
  const top = [...strong.values()].sort((a, b) => b - a);
  const dominant = top.length < 2 || top[0] - top[1] >= 8;

  const points: string[] = [];
  const kind = need === 'yes' && rsrp < -108
    ? 'اتجاهية عالية الكسب (Yagi أو لوحية ضيقة)'
    : dominant ? 'لوحية اتجاهية (Panel)' : 'لوحية بزاوية واسعة أو Omni';
  points.push(`النوع: ${kind}${dominant ? ' — عندك برج واحد مسيطر فوجّهها عليه.' : ' — حولك أكثر من برج بقوة متقاربة.'}`);
  points.push(`الترددات: لازم تدعم ${ranges.length ? ranges.join(' و ') : '700–2700'} ميقاهرتز${has5g ? ' — واختر موديل يدعم 5G (حتى 3800 أو أكثر)' : ''}.`);
  points.push('MIMO 2×2: خذ أنتنا بمنفذين (كيبلين) — الكيبل الواحد يخسرك نص السرعة.');
  if (hasLow) points.push('ترددك المنخفض (700–900) يحتاج أنتنا أكبر حجماً عشان يعطي كسب عالي.');
  points.push('الكيبل: أقصر ما يمكن (أقل من ١٠ متر) ومن نوع LMR-400 أو 5D-FB — كل متر زيادة يضيّع إشارة.');
  points.push('المكان: أعلى نقطة في البيت، وما قدامها جدار أو خزان أو شجر.');

  // ─── فحص التركيب (لمن عنده أنتنا) ───
  const install: { ok: boolean; text: string }[] = [];
  const streams = sig.dlStreams;
  if (streams !== undefined) {
    if (streams < 2 && sinr >= 10) install.push({ ok: false, text: 'الراوتر يستقبل مسار واحد رغم إن الإشارة نظيفة — غالباً كيبل من الاثنين مفصول أو المنفذ غلط. تأكد من الكيبلين وإنهم مشدودين.' });
    else if (streams >= 2) install.push({ ok: true, text: `الكيبلين شغالين (${streams}×${streams}).` });
  }
  if (tx !== undefined) {
    if (tx >= 18 && rsrp > -100) install.push({ ok: false, text: 'الاستقبال زين لكن الإرسال على الحد — ممكن الكيبل طويل أو الوصلات فيها فقد. قصّر الكيبل أو غيّر الوصلات.' });
    else if (tx < 14) install.push({ ok: true, text: `الإرسال مرتاح (${tx} dBm).` });
  }
  if (rsrp > -95 && sinr < 5) install.push({ ok: false, text: 'الإشارة قوية لكن مشوّشة — الأنتنا تسمع أكثر من برج. لف الأنتنا شوي يمين ويسار بوضع الصوت لين يعلى SINR.' });
  else if (sinr >= 13) install.push({ ok: true, text: `التوجيه نظيف (SINR ${sinr}).` });
  if (rsrp < -105) install.push({ ok: false, text: 'الإشارة لسا ضعيفة — جرّب ترفع الأنتنا أعلى، أو وجّهها على برج ثاني من شاشة الأبراج.' });

  return { need, headline, reasons, type: { title: 'الأنتنا المناسبة لك', points }, install, otherCause };
}
