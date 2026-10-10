import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/* ═══ ترددات كل شبكة سعودية ═══
 * نعرض للمستخدم ترددات شبكته أول (زين/موبايلي/stc) بدل كل اللي يدعمها الراوتر.
 * القوائم «سخية» عمداً — الشركات تضيف ترددات وتختلف بين المناطق، فإخفاء تردد شغال أسوأ
 * من عرض تردد زيادة. وأي تردد نشوفه شغال فعلاً على أبراج الشبكة نتعلّمه ونضيفه لها.
 * ولا نخفي أبداً تردد فيه برج أو مختار أو شغال الحين — ودايم فيه «اعرض كل الترددات». */

export type OpKey = 'zain' | 'mobily' | 'stc';
export interface OpBands { lte: number[]; nr: number[] }

const OP_NAME: Record<OpKey, string> = { zain: 'زين', mobily: 'موبايلي', stc: 'stc' };

const OP_DEFAULT: Record<OpKey, OpBands> = {
  zain: { lte: [1, 3, 8, 20, 28, 38], nr: [28, 78] },
  mobily: { lte: [1, 3, 8, 20, 28, 38, 41], nr: [28, 41, 78] },
  stc: { lte: [1, 3, 7, 8, 28, 40], nr: [28, 41, 78] },
};

/** يعرف الشبكة من الاسم اللي يرجعه الراوتر (Zain KSA / STC / Mobily / رمز PLMN) */
export function opKeyOf(name?: string): OpKey | null {
  const n = (name ?? '').toLowerCase();
  if (!n) return null;
  if (/zain|زين|42004/.test(n)) return 'zain';
  if (/mobily|موبايلي|etihad|اتحاد|42003/.test(n)) return 'mobily';
  if (/\bstc\b|al ?jawal|aljawal|الجوال|saudi telecom|الاتصالات السعودية|42001|ksa-?stc/.test(n)) return 'stc';
  return null;
}

export const opName = (k: OpKey | null) => (k ? OP_NAME[k] : '');

const routerKey = (id: string) => `bandly.op.${id}`;
const learnKey = (k: OpKey) => `bandly.opBands.${k}`;

/** نحفظ شبكة كل راوتر لما نعرفها (من الشاشة الرئيسية للراوتر) */
export async function rememberOperator(routerId: string, name?: string): Promise<void> {
  const k = opKeyOf(name);
  if (!k) return;
  try { await AsyncStorage.setItem(routerKey(routerId), k); } catch {}
}

async function getLearned(k: OpKey): Promise<OpBands> {
  try {
    const raw = await AsyncStorage.getItem(learnKey(k));
    const v = raw ? JSON.parse(raw) : null;
    return { lte: Array.isArray(v?.lte) ? v.lte : [], nr: Array.isArray(v?.nr) ? v.nr : [] };
  } catch {
    return { lte: [], nr: [] };
  }
}

/** تردد شفناه شغال (أساسي أو مدموج) على هالشبكة — نضيفه لقائمتها */
export async function learnOperatorBands(routerId: string, lte: number[], nr: number[]): Promise<void> {
  try {
    const k = (await AsyncStorage.getItem(routerKey(routerId))) as OpKey | null;
    if (!k || !OP_DEFAULT[k]) return;
    const cur = await getLearned(k);
    const add = (have: number[], base: number[], xs: number[]) =>
      xs.filter(b => Number.isFinite(b) && b > 0 && !have.includes(b) && !base.includes(b));
    const nl = add(cur.lte, OP_DEFAULT[k].lte, lte);
    const nn = add(cur.nr, OP_DEFAULT[k].nr, nr);
    if (!nl.length && !nn.length) return;
    await AsyncStorage.setItem(learnKey(k), JSON.stringify({ lte: [...cur.lte, ...nl], nr: [...cur.nr, ...nn] }));
  } catch {}
}

/** شبكة الراوتر وتردداتها (الافتراضية + اللي تعلمناها). null = ما نعرف الشبكة → نعرض الكل */
export function useOperatorBands(routerId?: string): { key: OpKey; name: string; bands: OpBands } | null {
  const [v, setV] = useState<{ key: OpKey; name: string; bands: OpBands } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!routerId) return;
      try {
        const k = (await AsyncStorage.getItem(routerKey(routerId))) as OpKey | null;
        if (!k || !OP_DEFAULT[k]) return;
        const l = await getLearned(k);
        const uniq = (xs: number[]) => [...new Set(xs)];
        if (alive) setV({ key: k, name: OP_NAME[k], bands: { lte: uniq([...OP_DEFAULT[k].lte, ...l.lte]), nr: uniq([...OP_DEFAULT[k].nr, ...l.nr]) } });
      } catch {}
    })();
    return () => { alive = false; };
  }, [routerId]);
  return v;
}
