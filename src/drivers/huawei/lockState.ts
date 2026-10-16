/**
 * لقطة إعدادات القفل في هواوي — دوال صافية بدون شبكة (تنختبر في Node).
 *
 * اللقطة = حقول net/net-mode كاملة (وضع الشبكة، ترددات 4G، الخيارات الدقيقة)
 *        + قسمي lte_info و nr_info من net/lock-freq **حرفياً كما رجعها الراوتر**
 *          (فيها نوع القفل: ترددات / قناة / خلية، و«ثانوي بس»).
 * الإرجاع يكتبها كما هي، والمقارنة تتجاهل الترتيب والمسافات بس.
 */
import { parseLockRaw, sectionXml, lockKindOf, LockRaw } from './cellLock';

export interface HuaweiLockData {
  /** حقول net/net-mode بالترتيب اللي رجعها الراوتر */
  netMode: [string, string][];
  /** null = الراوتر ما فيه net/lock-freq (الترددات كلها في net-mode) */
  lockFreq: LockRaw | null;
}

const tag = (xml: string, t: string) =>
  xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1];

/** حقول رد net/net-mode */
export function parseNetModeFields(xml: string): [string, string][] {
  const inner = xml.match(/<response>([\s\S]*?)<\/response>/)?.[1] ?? '';
  return [...inner.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(m => [m[1], m[2]] as [string, string]);
}

/** جسم طلب net/net-mode يرجّع الحقول كما كانت */
export const netModeBody = (fields: [string, string][]) =>
  fields.map(([k, v]) => `<${k}>${v}</${k}>`).join('');

const hex = (v: string): bigint | null => {
  const s = v.trim();
  if (!/^[0-9a-f]+$/i.test(s)) return null;
  try { return BigInt('0x' + s); } catch { return null; }
};

function sameField(k: string, a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  // أقنعة الترددات: «0080000000000000» = «80000000000000»
  if (/band/i.test(k)) {
    const x = hex(a);
    const y = hex(b);
    if (x !== null && y !== null) return x === y;
  }
  return false;
}

const NET_LABEL: Record<string, string> = {
  NetworkMode: 'وضع الشبكة',
  networkOption: 'نوع 5G (SA/NSA)',
  LTEBand: 'ترددات 4G (وضع الشبكة)',
  LTEBandOption: 'خيار ترددات 4G',
  NetworkBand: 'ترددات 3G/2G',
};

/** الحقول اللي اختلفت عن اللقطة (أسماء بالعربي) — نقارن بس الحقول الموجودة في الاثنين */
export function netModeDiff(snap: [string, string][], cur: [string, string][]): string[] {
  const now = new Map(cur);
  const out: string[] = [];
  for (const [k, v] of snap) {
    const c = now.get(k);
    if (c === undefined) continue;
    if (!sameField(k, v, c)) out.push(NET_LABEL[k] ?? k);
  }
  return out;
}

/**
 * شكل موحّد لقسم قفل (للمقارنة): القفل الملغي (lock_mode 0 أو قسم فاضي) = «off» مهما كان الباقي.
 * غير كذا: النوع + الإدخالات (تردد/قناة/خلية) مرتبة + all_bands مرتبة.
 */
export function normSection(sec: string): string {
  const mode = (tag(sec ?? '', 'lock_mode') ?? '0').trim();
  if (!sec || mode === '0' || mode === '') return 'off';
  const entries = [...sec.matchAll(/<freq_info>([\s\S]*?)<\/freq_info>/g)].map(m => {
    const e = m[1];
    return [(tag(e, 'band') ?? '').trim(), (tag(e, 'freq') ?? '').trim(), (tag(e, 'pci') ?? '').trim()].join('/');
  }).sort();
  const all = (tag(sec, 'all_bands') ?? '').split(/[,;\s]+/).map(x => parseInt(x, 10))
    .filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return `${mode}|${entries.join(';')}|${[...new Set(all)].join(',')}`;
}

/** الأقسام اللي اختلفت عن اللقطة */
export function lockDiff(snap: LockRaw, cur: LockRaw): string[] {
  const out: string[] = [];
  if (normSection(snap.lte) !== normSection(cur.lte)) out.push('قفل 4G (ترددات/قناة/برج)');
  if (normSection(snap.nr) !== normSection(cur.nr)) out.push('قفل 5G (ترددات/قناة/برج)');
  return out;
}

const wrap = (name: string, raw: string) =>
  normSection(raw) === 'off' ? sectionXml(name, '0', [], '') : `<${name}>${raw}</${name}>`;

/**
 * جسم net/lock-freq يرجّع القسمين كما في اللقطة.
 * مثل صفحة الراوتر: وضع «4G فقط» (03) ما يرسل قسم 5G، و«5G فقط» (08) ما يرسل قسم 4G.
 * netMode = وضع الشبكة **اللي في اللقطة** (نرجّعه قبل الأقفال).
 */
export function lockRestoreBody(lf: LockRaw, netMode: string): string {
  const lte = wrap('lte_info', lf.lte);
  const nr = wrap('nr_info', lf.nr);
  if (netMode === '03') return lte;
  if (netMode === '08') return nr;
  return lte + nr;
}

/** الأقسام اللي نقدر نتحقق منها بعد الإرجاع (القسم اللي ما انرسل ما نحاسب عليه) */
export function lockDiffForMode(snap: LockRaw, cur: LockRaw, netMode: string): string[] {
  const d = lockDiff(snap, cur);
  if (netMode === '03') return d.filter(x => x.startsWith('قفل 4G'));
  if (netMode === '08') return d.filter(x => x.startsWith('قفل 5G'));
  return d;
}

const MODE_TEXT: Record<string, string> = { '00': 'تلقائي', '03': '4G فقط', '08': '5G فقط', '0803': '4G + 5G' };
const KIND_TEXT = { none: 'تلقائي', band: 'ترددات', channel: 'قناة', cell: 'برج' } as const;

function secText(sec: string, prefix: string): string {
  const k = lockKindOf(sec ?? '');
  if (k === 'none') return 'تلقائي';
  if (k === 'band') {
    const all = (tag(sec, 'all_bands') ?? '').split(/[,;\s]+/).filter(Boolean);
    const list = all.length ? all : [...sec.matchAll(/<band>(\d+)<\/band>/g)].map(m => m[1]);
    return list.map(b => prefix + b).join('+') || KIND_TEXT.band;
  }
  const pci = (tag(sec, 'pci') ?? '').trim();
  const freq = (tag(sec, 'freq') ?? '').trim();
  return k === 'cell' ? `برج ${pci}${freq ? ` · قناة ${freq}` : ''}` : `قناة ${freq}`;
}

/** وصف مختصر للّقطة */
export function huaweiSummary(d: HuaweiLockData): string {
  const mode = d.netMode.find(f => f[0] === 'NetworkMode')?.[1] ?? '';
  const parts: string[] = [];
  if (d.lockFreq) {
    parts.push(`4G: ${secText(d.lockFreq.lte, 'B')}`);
    parts.push(`5G: ${secText(d.lockFreq.nr, 'n')}`);
  }
  parts.push(`الشبكة: ${MODE_TEXT[mode] ?? (mode || '—')}`);
  return parts.join(' · ');
}

export { parseLockRaw };
