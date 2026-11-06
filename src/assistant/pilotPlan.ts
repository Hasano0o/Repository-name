/**
 * «اضبط لي كل شي» — المرحلة الأولى: **فحص صامت** (قراءة بس، ما نغيّر أي شي في الراوتر).
 * من القراءات نطلع تقرير مبسط: وضعك الحين + وش نقترح نجرّب + ليش + كم بينقطع النت.
 * المستخدم يختار ويوافق ← بعدها بس تبدأ التجارب (runAutopilot بالخطة نفسها).
 *
 * قرار حسن (٧ نوفمبر): الشكاوى كلها «الشبكة تختفي وقت التجارب» ← نقلل التجارب:
 *  • ما نجرّب شي نعرف مسبقاً إنه ما بيفيد (إشارتك ممتازة ومدموجة، جرّبناه قبل وما فرق،
 *    الأبراج الثانية أضعف بوضوح، تثبيت 4G يطفي 5G عندك).
 *  • نقول كم تجربة وكم تقريباً بينقطع النت — قبل ما نبدأ.
 *
 * ملف بدون react-native — عشان الاختبارات تشتغل في Node.
 */
import type { CellTower } from '../drivers/types';
import { bandLabel, SCAN_PREFERRED } from '../utils/bands';

export type PlanKey = 'band' | 'tower' | 'wifi';
export type PlanLevel = 'good' | 'ok' | 'weak';

export interface PlanTarget {
  tech: 'LTE' | 'NR';
  band?: number;
  arfcn: string;
  pci: string;
  name: string;
  rsrp?: number;
}

export interface PlanInput {
  now: number;
  sig: {
    rsrp?: number; rsrq?: number; sinr?: number; band?: string; pci?: string;
    nrRsrp?: number; nrSinr?: number; nrBand?: string;
  };
  ping?: { median: number; jitter: number };
  /** النواقل المدموجة الحين */
  carriers: { tech: 'LTE' | 'NR'; band: number }[];
  bandCfg?: { supported: number[]; locked: number[]; lteLockKills5g?: boolean } | null;
  cells: CellTower[];
  /** ترددات شبكتك (زين/موبايلي/stc) لو نعرفها */
  opLte?: number[] | null;
  /** تجارب سابقة محفوظة (safeLock) */
  trials: { key: string; verdict: string; at: number }[];
  caps: { band: boolean; tower: boolean; towerRisk?: string; wifi: boolean };
  /** الأبراج المرشحة (من groupTowers — الشاشة/المحرك يحسبها) */
  towerTargets: PlanTarget[];
  /** وش حصّل الأعضاء على نفس برجك (السيرفر — بدون موقع) */
  community?: CommunityInput | null;
}

/** نفس ComboStat في services/community.ts (هنا بدون react-native) */
export interface CommunityCombo {
  combo: string; users: number; enough: boolean; mine?: boolean;
  ping: number | null; jitter?: number | null; score: number | null; sinr?: number | null;
  night_ping?: number | null; day_ping?: number | null;
}
export interface CommunityInput { users: number; combos: CommunityCombo[] }

export interface CommunityAdvice {
  facts: string[];
  /** تجميعة أعضاء برجك اللي أفضل من وضعك بوضوح */
  best?: CommunityCombo;
  /** ترددات 4G فيها (اللي نقدر نثبّتها) */
  lte?: number[];
  /** الفرق بس في 5G — ما نقدر نوصله من «أفضل تردد» */
  nrOnly?: boolean;
}

/** «B1+B3+n78» ← { lte: [1,3], nr: [78] } */
export function parseCombo(c: string): { lte: number[]; nr: number[] } {
  const lte: number[] = [], nr: number[] = [];
  for (const x of c.split('+')) {
    const m = x.trim().match(/^([BbNn])(\d{1,3})$/);
    if (!m) continue;
    (m[1].toUpperCase() === 'B' ? lte : nr).push(Number(m[2]));
  }
  return { lte: [...new Set(lte)].sort((a, b) => a - b), nr: [...new Set(nr)].sort((a, b) => a - b) };
}
export const comboOf = (carriers: { tech: 'LTE' | 'NR'; band: number }[]) => {
  const lte = [...new Set(carriers.filter(c => c.tech === 'LTE').map(c => c.band))].sort((a, b) => a - b);
  const nr = [...new Set(carriers.filter(c => c.tech === 'NR').map(c => c.band))].sort((a, b) => a - b);
  return [...lte.map(b => `B${b}`), ...nr.map(b => `n${b}`)].join('+');
};
const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const members = (n: number) => (n === 1 ? 'عضو واحد' : n === 2 ? 'عضوين' : n <= 10 ? `${n} أعضاء` : `${n} عضو`);

/**
 * أعضاء على نفس برجك: هل فيه تجميعة أفضل من وضعك بوضوح؟
 * «أفضل بوضوح» = بنق أقل ٢٠٪ و ٨ms على الأقل، أو درجة لعب أعلى بـ ٨ — ومن ٣ أعضاء مختلفين على الأقل.
 * الأمانة: هذي نتايجهم، مو ضمان عندك — التوصية «نجرّبها ونقيس».
 */
export function communityAdvice(cur: string, curPing: number | undefined, comm?: CommunityInput | null): CommunityAdvice {
  const facts: string[] = [];
  if (!comm) return { facts };
  if (!comm.users) {
    facts.push('على برجك: ما عندنا قراءات أعضاء للحين — كل ما شارك أعضاء أكثر تصير التوصية أدق');
    return { facts };
  }
  const mine = comm.combos.find(c => c.combo === cur);
  const ref = curPing ?? mine?.ping ?? undefined;
  const refScore = mine?.enough ? mine.score : null;
  const better = comm.combos.filter(c => c.enough && c.combo !== cur && (
    (c.ping !== null && ref !== undefined && c.ping <= ref * 0.8 && ref - c.ping >= 8)
    || (c.score !== null && refScore !== null && c.score >= refScore + 8)
  ));
  const top = comm.combos.find(c => c.enough);
  facts.push(top
    ? `على برجك ${members(comm.users)} شاركوا · أفضل نتيجة عندهم ${top.combo}${top.ping !== null ? ` (بنق ${top.ping}ms` : ' ('}${top.ping !== null ? '، ' : ''}${members(top.users)})`
    : `على برجك ${members(comm.users)} شاركوا — لسا ما فيه تجميعة عندها ${MIN_COMMUNITY} أعضاء نحكم منها`);
  const busy = mine?.night_ping && mine.day_ping && mine.night_ping >= mine.day_ping * 1.4 && mine.night_ping - mine.day_ping >= 15;
  if (busy) facts.push(`برجك يزحم بالليل: البنق عند الأعضاء ~${mine!.day_ping}ms بالنهار و ~${mine!.night_ping}ms من ٨م`);
  const best = better[0];
  if (!best) return { facts };
  const b = parseCombo(best.combo), c = parseCombo(cur);
  if (sameSet(b.lte, c.lte)) return { facts, best, nrOnly: true };
  return { facts, best, lte: b.lte };
}
export const MIN_COMMUNITY = 3;


export interface PlanItem {
  key: PlanKey;
  title: string;
  /** ننصح فيها؟ (المستخدم يقدر يغيّر) */
  on: boolean;
  why: string;
  /** وصف الانقطاع ببساطة */
  cut: string;
  /** تقدير المدة بالثواني */
  secs: number;
  bands?: number[];
  /** تجميعة أعضاء برجك — المحرك يجرّبها كدمج بنفسها */
  prefer?: number[];
  targets?: PlanTarget[];
}

export interface PilotPlan {
  level: PlanLevel;
  headline: string;
  facts: string[];
  items: PlanItem[];
  /** اللي ما نقدر نسويه أصلاً وليش */
  skipped: { key: PlanKey; title: string; why: string }[];
  tips: string[];
  at: number;
}

const DAY = 86400_000;
/** تجربة سابقة بنفس النوع «ما فرقت» خلال كذا يوم ← ما ننصح نعيدها */
export const RECENT_DAYS = 7;
/** ثواني تقريبية لكل تجربة (تغيير + رجوع الاتصال + قياس) */
export const SECS_BAND = 45;
export const SECS_TOWER = 60;
export const SECS_WIFI = 25;

const num = (v?: string) => {
  const m = (v ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
};
const r0 = (x: number) => Math.round(x);
const mins = (secs: number) => (secs < 90 ? `${Math.max(1, r0(secs / 60))} دقيقة` : `${r0(secs / 60)} دقائق`);
const daysAgo = (now: number, at: number) => {
  const d = Math.floor((now - at) / DAY);
  return d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : `قبل ${d} أيام`;
};

export function signalLevel(rsrp?: number, sinr?: number): PlanLevel {
  if (rsrp === undefined) return 'weak';
  const s = sinr ?? 0;
  if (rsrp >= -90 && s >= 13) return 'good';
  if (rsrp >= -105 && s >= 3) return 'ok';
  return 'weak';
}
const RSRP_WORD = (v: number) => (v >= -80 ? 'ممتازة' : v >= -90 ? 'جيدة' : v >= -100 ? 'متوسطة' : 'ضعيفة');
const SINR_WORD = (v: number) => (v >= 20 ? 'ممتاز' : v >= 13 ? 'جيد' : v >= 3 ? 'متوسط' : 'ضعيف');

/** ترددات 4G المرشحة: اللي لها أبراج حولك فعلاً (الأقوى أول) + نكمّل من ترددات شبكتك — نفس منطق المحرك */
export function bandCandidates(cells: CellTower[], supported: number[], opLte?: number[] | null, max = 4): number[] {
  const seen = new Map<number, number>();
  for (const c of cells) {
    if (c.tech === 'LTE' && c.band && supported.includes(c.band)) seen.set(c.band, Math.max(c.rsrp ?? -999, seen.get(c.band) ?? -999));
  }
  const out = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  for (const b of (opLte?.length ? opLte : SCAN_PREFERRED)) if (out.length < max && supported.includes(b) && !out.includes(b)) out.push(b);
  return out.slice(0, max);
}

function recent(trials: PlanInput['trials'], re: RegExp, now: number) {
  return trials
    .filter(t => re.test(t.key) && now - t.at < RECENT_DAYS * DAY)
    .sort((a, b) => b.at - a.at)[0];
}

export function buildPlan(p: PlanInput): PilotPlan {
  const { sig, now } = p;
  const sa = sig.rsrp === undefined && sig.nrRsrp !== undefined;
  const mainRsrp = sa ? sig.nrRsrp : sig.rsrp;
  const mainSinr = sa ? sig.nrSinr : sig.sinr;
  const level = signalLevel(mainRsrp, mainSinr);
  const has5g = sig.nrRsrp !== undefined || p.carriers.some(c => c.tech === 'NR');
  const merged = p.carriers.length >= 2;

  // ═══ وضعك الحين ═══
  const facts: string[] = [];
  const b4 = num(sig.band);
  if (sig.rsrp !== undefined) {
    facts.push(`4G${b4 ? ` ${bandLabel('LTE', b4)}` : ''}: القوة ${r0(sig.rsrp)} (${RSRP_WORD(sig.rsrp)})${sig.sinr !== undefined ? ` · النقاء ${r0(sig.sinr)} (${SINR_WORD(sig.sinr)})` : ''}`);
  }
  if (sig.nrRsrp !== undefined) {
    const b5 = num(sig.nrBand);
    facts.push(`5G${b5 ? ` ${bandLabel('NR', b5)}` : ''}: القوة ${r0(sig.nrRsrp)} (${RSRP_WORD(sig.nrRsrp)})${sig.nrSinr !== undefined ? ` · النقاء ${r0(sig.nrSinr)}` : ''}`);
  } else if (!sa) facts.push('5G: ما فيه 5G شغّال الحين');
  facts.push(merged
    ? `مدموج: ${p.carriers.map(c => bandLabel(c.tech, c.band)).join(' + ')}`
    : 'بدون دمج ترددات الحين');
  if (p.ping) facts.push(`البنق ${r0(p.ping.median)}ms · التذبذب ${r0(p.ping.jitter)}ms`);
  const others = new Set(p.cells.filter(c => c.kind === 'neighbor' && c.pci).map(c => `${c.tech}${c.pci}`)).size;
  if (others) facts.push(`حولك ${others} ${others === 1 ? 'برج ثاني' : others === 2 ? 'برجين ثانيين' : 'أبراج ثانية'} يشوفها الراوتر`);
  const lockedNow = !!p.bandCfg?.locked.length && p.bandCfg.locked.length < p.bandCfg.supported.length;
  if (lockedNow) facts.push(`عندك تثبيت ترددات الحين: ${p.bandCfg!.locked.map(b => bandLabel('LTE', b)).join(' + ')}`);

  const items: PlanItem[] = [];
  const skipped: PilotPlan['skipped'] = [];

  // ═══ أعضاء برجك ═══
  const cur = comboOf(p.carriers);
  const comm = communityAdvice(cur, p.ping?.median, p.community);
  facts.push(...comm.facts);
  if (comm.best && comm.nrOnly) facts.push(`أعضاء برجك حصّلوا أفضل مع ${comm.best.combo} — الفرق في 5G، تقدر تجرّبه من شاشة 5G`);

  // ═══ الترددات ═══
  if (!p.caps.band || !p.bandCfg) skipped.push({ key: 'band', title: 'أفضل تردد', why: 'راوترك ما يدعم تثبيت الترددات من التطبيق' });
  else {
    const supported = p.bandCfg.supported;
    const prefer = comm.lte?.length && comm.lte.every(b => supported.includes(b)) ? comm.lte : undefined;
    let bands = bandCandidates(p.cells, supported, p.opLte);
    if (prefer) bands = [...prefer, ...bands.filter(b => !prefer.includes(b))].slice(0, Math.max(4, prefer.length));
    if (bands.length < 2) skipped.push({ key: 'band', title: 'أفضل تردد', why: 'راوترك يدعم تردد واحد بس — ما فيه شي نجرّبه' });
    else {
      const tests = bands.length + (bands.length >= 3 ? 2 : 1) + (prefer && prefer.length >= 2 ? 1 : 0);
      const secs = tests * SECS_BAND;
      const last = recent(p.trials, /^pilot:band/, now);
      let on = true;
      let why = `نجرّب ${bands.map(b => bandLabel('LTE', b)).join(' و')} كل واحد لحاله، وبعدها دمج الأفضل — ونثبّت بس لو فرق واضح (١٢٪ وأكثر).`;
      if (p.bandCfg.lteLockKills5g && has5g) {
        on = false;
        why = 'تثبيت تردد 4G في راوترك يحوّله «4G بس» ويطفي 5G — ما ننصح فيها.';
      } else if (prefer && comm.best) {
        why = `أعضاء على نفس برجك (${members(comm.best.users)}) حصّلوا أفضل مع ${prefer.map(b => bandLabel('LTE', b)).join(' + ')}`
          + `${comm.best.ping !== null ? ` (بنق ${comm.best.ping}ms)` : ''} — نجرّبها عندك ونقيس، ونثبّت بس لو فرق فعلاً.`;
      } else if (merged && level === 'good') {
        on = false;
        why = 'إشارتك مدموجة ونقاؤها جيد — التجربة غالباً ما بتزيد، وبتقطع النت عالفاضي.';
      } else if (last && (last.verdict === 'same' || last.verdict === 'worse')) {
        on = false;
        why = `جرّبناها ${daysAgo(now, last.at)} وما فرقت — ما ننصح نعيدها الحين.`;
      }
      items.push({
        key: 'band', title: 'أفضل تردد', on, why, bands, secs, prefer: prefer && prefer.length >= 2 ? prefer : undefined,
        cut: `${tests} تجارب · النت ينقطع ١٠–٣٠ ثانية مع كل وحدة`,
      });
    }
  }

  // ═══ الأبراج ═══
  if (p.caps.towerRisk) skipped.push({ key: 'tower', title: 'أفضل برج', why: 'نوع راوترك يطيح لو ثبّتناه على برج — ما نجرّبها لسلامتك' });
  else if (!p.caps.tower) skipped.push({ key: 'tower', title: 'أفضل برج', why: 'راوترك ما يدعم التثبيت على برج' });
  else if (!p.towerTargets.length) skipped.push({ key: 'tower', title: 'أفضل برج', why: 'الراوتر ما يشوف أبراج ثانية حولك — برجك الحالي هو المتاح' });
  else {
    const targets = p.towerTargets.slice(0, 3);
    const bestN = Math.max(...targets.map(t => t.rsrp ?? -999));
    const last = recent(p.trials, /^pilot:cell:/, now);
    let on = true;
    let why = `نثبّت على ${targets.length === 1 ? 'البرج الثاني' : `أقوى ${targets.length} أبراج`} بالدور ونقيس البنق، ونثبّت بس لو أقل بنق بوضوح.`;
    if (mainRsrp !== undefined && bestN > -999 && bestN < mainRsrp - 6) {
      on = false;
      why = `أقوى برج ثاني (${r0(bestN)}) أضعف من برجك (${r0(mainRsrp)}) بوضوح — غالباً ما بيفيد.`;
    } else if (last && (last.verdict === 'same' || last.verdict === 'worse')) {
      on = false;
      why = `جرّبنا الأبراج ${daysAgo(now, last.at)} وما فرقت — ما ننصح نعيدها الحين.`;
    }
    items.push({
      key: 'tower', title: 'أفضل برج', on, why, targets, secs: targets.length * SECS_TOWER,
      cut: `${targets.length} ${targets.length === 1 ? 'تجربة' : 'تجارب'} · النت ينقطع ١٥–٣٠ ثانية مع كل برج`,
    });
  }

  // ═══ الواي فاي ═══
  if (!p.caps.wifi) skipped.push({ key: 'wifi', title: 'أفضل قناة واي فاي', why: 'راوترك ما يسمح بتغيير القناة من التطبيق' });
  else {
    items.push({
      key: 'wifi', title: 'أفضل قناة واي فاي', on: true, secs: 3 * SECS_WIFI,
      why: 'نجرّب ٢–٣ قنوات ونخلّي الأنظف لجوالك — ما يلمس شبكة الشركة.',
      cut: 'الواي فاي بس ينقطع ثواني مع كل قناة',
    });
  }

  const onItems = items.filter(i => i.on);
  const headline = level === 'good'
    ? (onItems.length ? 'إشارتك جيدة — فيه شي بسيط ممكن يتحسّن' : 'إشارتك جيدة — ما يحتاج تغيّر شي')
    : level === 'ok'
      ? 'إشارتك متوسطة — فيه مجال نحسّن'
      : 'إشارتك ضعيفة — نجرّب ونشوف، والأهم مكان الراوتر واتجاهه';

  const tips: string[] = [];
  if (items.some(i => i.key !== 'wifi')) {
    tips.push('خلّ جوالك على واي فاي الراوتر وقت التجارب. لو سألك «الشبكة بدون إنترنت» اختر «استمرار/ابقَ متصل».');
    tips.push('طفّ بيانات الجوال وقت التجارب — عشان الجوال ما يهرب من واي فاي الراوتر لما ينقطع النت.');
    tips.push('لو انقطع أي شي في النص، افتح التطبيق وهو يرجّع إعدادك لحاله.');
  }
  if (level === 'weak') tips.push('الإشارة الضعيفة ما يصلحها التثبيت لحاله — جرّب «توجيه الأنتنا» أو حط الراوتر جنب الشباك.');

  return { level, headline, facts, items, skipped, tips, at: now };
}

/** المدة المتوقعة للي اخترته (ثواني) */
export const planSecs = (items: PlanItem[]) => items.filter(i => i.on).reduce((a, i) => a + i.secs, 0);
export const planDuration = (items: PlanItem[]) => {
  const s = planSecs(items);
  return s ? `حوالي ${mins(s)}` : '';
};

/**
 * بعد التغيير: هل الأرقام صارت أسوأ بوضوح؟ (صورة حسن ٧ نوفمبر: قال «حسّنت» والبنق ١٥٨←٢١٧ والدرجة ٣٧←٠)
 * أسوأ بوضوح = البنق +٢٥٪ و١٥ms على الأقل · التذبذب ×١٫٥ و+١٥ms · درجة اللعب −١٥.
 * يرجّع وصف بسيط أو null.
 */
export function worseAfter(
  b?: { ping?: number; jitter?: number; game?: number },
  a?: { ping?: number; jitter?: number; game?: number },
): string | null {
  if (!b || !a) return null;
  const out: string[] = [];
  if (b.ping !== undefined && a.ping !== undefined && a.ping > b.ping * 1.25 && a.ping - b.ping >= 15) out.push(`البنق ${b.ping}←${a.ping}ms`);
  if (b.jitter !== undefined && a.jitter !== undefined && a.jitter > b.jitter * 1.5 && a.jitter - b.jitter >= 15) out.push(`التذبذب ${b.jitter}←${a.jitter}ms`);
  if (b.game !== undefined && a.game !== undefined && b.game - a.game >= 15) out.push(`درجة اللعب ${b.game}←${a.game}`);
  return out.length ? out.join(' · ') : null;
}
