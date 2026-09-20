import { Signal, DeviceDetails, NetworkInfo, Usage, CellTower } from '../drivers/types';
import { Sample, summarize } from '../store/history';
import { LatencyResult, gamingGrade } from './latency';
import { fmtBytes, fmtTime } from './format';
import { overallLevel, LEVEL_LABEL } from './signal';
import { bandLabel } from './bands';

export interface ReportInput {
  routerName: string;
  host: string;
  driverName: string;
  net?: NetworkInfo | null;
  signal?: Signal | null;
  details?: DeviceDetails | null;
  usage?: Usage | null;
  cells?: CellTower[];
  history: Sample[];
  latency?: LatencyResult | null;
}

export interface ReportSummary {
  quality: string;
  headline: string;
  lines: string[];
  advice: string[];
}

export function buildSummary(r: ReportInput): ReportSummary {
  const h = summarize(r.history);
  const lvl = overallLevel(r.signal ?? undefined);
  const lines: string[] = [];
  const advice: string[] = [];

  lines.push(`المشغّل: ${r.net?.operator ?? '—'}`);
  lines.push(`نوع الشبكة: ${r.net?.mode ?? r.signal?.network ?? '—'}`);
  if (r.signal?.band) lines.push(`التردد: ${r.signal.band}`);
  if (r.signal?.nrBand) lines.push(`تردد 5G: n${String(r.signal.nrBand).replace(/^n/i, '')}`);
  if (r.signal?.rsrp !== undefined) lines.push(`قوة الإشارة (RSRP): ${r.signal.rsrp} dBm`);
  if (r.signal?.sinr !== undefined) lines.push(`نقاء الإشارة (SINR): ${r.signal.sinr} dB`);
  if (r.signal?.nrRsrp !== undefined) lines.push(`قوة 5G: ${r.signal.nrRsrp} dBm`);
  if (r.signal?.nrSinr !== undefined) lines.push(`نقاء 5G: ${r.signal.nrSinr} dB`);
  if (r.latency?.samples) {
    lines.push(`الاستجابة: ${r.latency.median}ms · تذبذب ${r.latency.jitter}ms · فقد ${r.latency.lossPct}%`);
  }
  if (r.usage) lines.push(`الاستهلاك: تنزيل ${fmtBytes(r.usage.downloadBytes)} · رفع ${fmtBytes(r.usage.uploadBytes)}`);

  if (h.count > 1) {
    lines.push(
      `السجل (${h.count} قراءة من ${h.from ? fmtTime(h.from) : '—'} إلى ${h.to ? fmtTime(h.to) : '—'}):`,
    );
    if (h.rsrpAvg !== undefined) lines.push(`  متوسط RSRP ${h.rsrpAvg} dBm (أدنى ${h.rsrpMin} · أعلى ${h.rsrpMax})`);
    if (h.sinrAvg !== undefined) lines.push(`  متوسط SINR ${h.sinrAvg} dB (أدنى ${h.sinrMin})`);
    if (h.topBands.length) lines.push(`  أكثر التردادت استخداماً: ${h.topBands.map(([b, n]) => `${b} (${n})`).join('، ')}`);
  }

  const neigh = (r.cells ?? []).filter(c => c.kind !== 'serving' && c.rsrp !== undefined);
  if (neigh.length) {
    const best = [...neigh].sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))[0];
    lines.push(`أقوى برج مجاور: ${best.band ? bandLabel(best.tech, best.band) : best.tech} · ${best.rsrp} dBm`);
    if ((best.rsrp ?? -999) > (r.signal?.rsrp ?? -999) + 6) {
      advice.push('فيه برج مجاور أقوى من اللي أنت عليه — جرّب تثبّت عليه من شاشة الأبراج.');
    }
  }

  if ((r.signal?.sinr ?? 99) < 0) advice.push('نقاء الإشارة سالب — غالباً تداخل. جرّب تقفل على تردد ثاني أو غيّر مكان الراوتر.');
  if ((r.signal?.rsrp ?? 0) < -105) advice.push('الإشارة ضعيفة — قرّب الراوتر من النافذة أو استخدم مساعد التوجيه.');
  if (r.latency?.samples && gamingGrade(r.latency).score < 0.5) {
    advice.push('الاستجابة غير مناسبة للألعاب — جرّب شاشة الألعاب لمقارنة الترددات.');
  }
  if (h.count > 5 && h.rsrpMin !== undefined && h.rsrpMax !== undefined && h.rsrpMax - h.rsrpMin > 15) {
    advice.push('الإشارة متقلبة بشكل كبير عبر الوقت — قد يكون الراوتر في مكان غير مستقر.');
  }
  if (!advice.length) advice.push('الاتصال مستقر — ما فيه شي يحتاج تعديل حالياً.');

  const headline =
    r.latency?.samples
      ? `${LEVEL_LABEL[lvl]} · ${r.latency.median}ms`
      : LEVEL_LABEL[lvl];

  return { quality: LEVEL_LABEL[lvl], headline, lines, advice };
}

export function reportToText(r: ReportInput, s: ReportSummary): string {
  return [
    '=== تقرير جودة الاتصال ===',
    `التاريخ: ${new Date().toLocaleString('ar-SA')}`,
    `الراوتر: ${r.routerName} (${r.driverName}) · ${r.host}`,
    r.details?.model ? `الموديل: ${r.details.model}` : '',
    '',
    `التقييم العام: ${s.headline}`,
    '',
    ...s.lines,
    '',
    'ملاحظات:',
    ...s.advice.map(a => '• ' + a),
    '',
    'أُنشئ من تطبيق مدير الرواترات.',
  ].filter(Boolean).join('\n');
}
