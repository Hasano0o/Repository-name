/**
 * «أي سيرفر أقرب لك؟» — ترتيب النتايج وتجميعها بكلام بسيط (بدون react-native عشان الاختبارات).
 * - كل منطقة تاخذ وصف واحد واضح (ممتاز / جيد / مقبول / بعيد / يقطّع) بدل أرقام التذبذب والفقد.
 * - المناطق تتجمّع حسب مناطق «تغيير الخادم» داخل الألعاب (الشرق الأوسط، أوروبا، آسيا، الأمريكتين).
 * - «أقرب سيرفر» (Cloudflare) وسيرفر Bandly للمقارنة بس — ما يصيرون «الأنسب للعب».
 */

export interface PingRes { median: number; jitter: number; lossPct: number; samples: number }

export type Quality = 'great' | 'good' | 'ok' | 'far' | 'drops' | 'none';

/** حدود البنق (ms) */
export const Q_GREAT = 60;
export const Q_GOOD = 100;
export const Q_OK = 150;

export function quality(r?: PingRes | null): Quality {
  if (!r || !r.samples) return 'none';
  if (r.lossPct >= 5) return 'drops';
  if (r.median < Q_GREAT) return 'great';
  if (r.median < Q_GOOD) return 'good';
  if (r.median < Q_OK) return 'ok';
  return 'far';
}

export const QUALITY_WORD: Record<Quality, string> = {
  great: 'ممتاز',
  good: 'جيد',
  ok: 'مقبول',
  far: 'بعيد',
  drops: 'يقطّع',
  none: 'ما رد',
};

/** تذبذب عالي يستاهل تنبيه صغير (بدون ما نزحم الصف بالأرقام) */
export const shaky = (r?: PingRes | null) => !!r && r.samples > 0 && r.lossPct < 5 && r.jitter >= 40;

export type GroupId = 'me' | 'eu' | 'asia' | 'am' | 'ref';

export const GROUP_OF: Record<string, GroupId> = {
  'sa-jed': 'me', 'sa-ruh': 'me', sa: 'me', ae: 'me', qa: 'me', eg: 'me',
  tr: 'eu', it: 'eu', eu: 'eu', fr: 'eu', uk: 'eu', se: 'eu',
  in: 'asia', sg: 'asia', kr: 'asia',
  us: 'am', br: 'am',
  cf: 'ref',
};

export const GROUP_NAME: Record<GroupId, string> = {
  me: 'الشرق الأوسط',
  eu: 'أوروبا',
  asia: 'آسيا',
  am: 'الأمريكتين',
  ref: 'للمقارنة',
};

/** اسم المنطقة داخل اللعبة (قائمة «تغيير الخادم») */
export const IN_GAME: Record<GroupId, string> = {
  me: 'الشرق الأوسط',
  eu: 'أوروبا',
  asia: 'آسيا',
  am: 'أمريكا الشمالية',
  ref: '',
};
export const inGameName = (id: string) => (id === 'kr' ? 'كوريا واليابان' : id === 'br' ? 'أمريكا الجنوبية' : IN_GAME[GROUP_OF[id] ?? 'ref']);

/** المناطق اللي تنفع «أنسب سيرفر» (مو مرجع عام ولا سيرفرنا) */
export const isGameRegion = (id: string) => !!GROUP_OF[id] && GROUP_OF[id] !== 'ref';

const better = (a?: PingRes, b?: PingRes) => {
  const qa = !!a && a.samples > 0, qb = !!b && b.samples > 0;
  if (qa !== qb) return qa ? -1 : 1;
  if (!qa) return 0;
  const da = a!.lossPct >= 5, db = b!.lossPct >= 5;
  if (da !== db) return da ? 1 : -1;
  return a!.median - b!.median;
};

/** أنسب منطقة للعب: أقل بنق بدون تقطيع */
export function bestRegion(res: Record<string, PingRes>): string | null {
  const ids = Object.keys(res).filter(id => isGameRegion(id) && res[id].samples > 0);
  if (!ids.length) return null;
  ids.sort((a, b) => better(res[a], res[b]));
  return ids[0];
}

export interface Group { id: GroupId; name: string; ids: string[]; best?: number }

/** النتايج مجمّعة ومرتّبة — المجموعة الأقرب أول، وداخلها الأقل بنق أول */
export function groupResults(res: Record<string, PingRes>): Group[] {
  const by = new Map<GroupId, string[]>();
  for (const id of Object.keys(res)) {
    const g = GROUP_OF[id];
    if (!g) continue;
    if (!by.has(g)) by.set(g, []);
    by.get(g)!.push(id);
  }
  const out: Group[] = [];
  for (const [g, ids] of by) {
    ids.sort((a, b) => better(res[a], res[b]));
    const ok = ids.map(i => res[i]).filter(r => r.samples > 0);
    out.push({ id: g, name: GROUP_NAME[g], ids, best: ok.length ? Math.min(...ok.map(r => r.median)) : undefined });
  }
  out.sort((a, b) => {
    if (a.id === 'ref' || b.id === 'ref') return a.id === 'ref' ? 1 : -1;
    return (a.best ?? 1e9) - (b.best ?? 1e9);
  });
  return out;
}

/** طول الشريط (٪): الأقرب أطول — ٠ لو ما رد */
export function barPct(r: PingRes | undefined, minMs: number): number {
  if (!r || !r.samples) return 0;
  const p = Math.round((Math.max(1, minMs) / Math.max(1, r.median)) * 100);
  return Math.max(6, Math.min(100, p));
}
